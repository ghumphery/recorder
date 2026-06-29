const path = require('path')
const fs = require('fs')
const https = require('https')
const { spawn } = require('child_process')
const os = require('os')

let ort = null
let session = null
let modelLoaded = false

// 模型下載 URL（campplus-zh-en ONNX）
const MODEL_URL = 'https://huggingface.co/welcomyou/campplus-3dspeaker-200k-onnx/resolve/main/campplus_cn_en_common_200k.onnx'
const MODEL_FILENAME = 'campplus_cn_en_common_200k.onnx'

function modelPath() {
  return path.join(os.homedir(), 'recoder', 'voiceprint', MODEL_FILENAME)
}

function ensureModelDir() {
  const dir = path.join(os.homedir(), 'recoder', 'voiceprint')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function isModelCached() {
  return fs.existsSync(modelPath())
}

function downloadModel(progressCallback) {
  return new Promise((resolve, reject) => {
    ensureModelDir()
    const dest = modelPath()
    const temp = dest + '.downloading'

    const file = fs.createWriteStream(temp)
    let receivedBytes = 0
    let totalBytes = 0

    https.get(MODEL_URL, (response) => {
      totalBytes = parseInt(response.headers['content-length'] || '0', 10)

      response.on('data', (chunk) => {
        receivedBytes += chunk.length
        file.write(chunk)
        if (totalBytes > 0 && progressCallback) {
          progressCallback(Math.round((receivedBytes / totalBytes) * 100))
        }
      })

      response.on('end', () => {
        file.end()
        fs.renameSync(temp, dest)
        if (progressCallback) progressCallback(100)
        resolve(true)
      })

      response.on('error', (err) => {
        file.close()
        fs.unlinkSync(temp)
        reject(err)
      })
    }).on('error', (err) => {
      file.close()
      try { fs.unlinkSync(temp) } catch (e) {}
      reject(err)
    })
  })
}

async function loadModel() {
  if (modelLoaded && session) return true
  try {
    if (!ort) ort = require('onnxruntime-node')
    const mp = modelPath()
    if (!fs.existsSync(mp)) return false
    session = await ort.InferenceSession.create(mp, {
      executionProviders: ['dml', 'cpu'],
      graphOptimizationLevel: 'all'
    })
    modelLoaded = true
    return true
  } catch (e) {
    // DML 失敗時 fallback 到 CPU
    try {
      if (!ort) ort = require('onnxruntime-node')
      const mp = modelPath()
      session = await ort.InferenceSession.create(mp, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all'
      })
      modelLoaded = true
      return true
    } catch (e2) {
      modelLoaded = false
      return false
    }
  }
}

/**
 * 從音檔中切割出指定時間區間的 PCM 資料
 */
function extractSegmentPcm(audioPath, startSec, endSec) {
  return new Promise((resolve, reject) => {
    const duration = endSec - startSec
    if (duration < 0.5) {
      // 太短的片段跳過
      resolve(null)
      return
    }
    const ffmpeg = path.join(path.dirname(require.main?.filename || __dirname), '..', '..', 'ffmpeg', 'ffmpeg.exe')
    const resourceFfmpeg = path.join(process.resourcesPath || '', 'ffmpeg', 'ffmpeg.exe')
    const ffmpegPath = fs.existsSync(ffmpeg) ? ffmpeg : (fs.existsSync(resourceFfmpeg) ? resourceFfmpeg : 'ffmpeg.exe')

    const chunks = []
    const proc = spawn(ffmpegPath, [
      '-y', '-i', audioPath,
      '-ss', String(startSec),
      '-t', String(duration),
      '-ar', '16000', '-ac', '1', '-sample_fmt', 's16',
      '-f', 'wav',
      'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    proc.stdout.on('data', (chunk) => chunks.push(chunk))
    proc.stderr.on('data', () => {}) // 忽略 ffmpeg 日誌

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve(null)
        return
      }
      const buf = Buffer.concat(chunks)
      // 跳過 WAV header (44 bytes)，取 PCM 資料
      const pcm = buf.slice(44)
      resolve(pcm)
    })

    proc.on('error', () => resolve(null))
  })
}

/**
 * 計算 80-dim fbank 特徵（與 campplus 模型匹配）
 */
function computeFbank(pcm) {
  // pcm: Int16Array (16kHz mono)
  const samples = new Float32Array(pcm.length / 2)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = (pcm.readInt16LE(i * 2)) / 32768.0
  }

  const sampleRate = 16000
  const frameLen = Math.floor(25 * sampleRate / 1000)  // 25ms
  const frameShift = Math.floor(10 * sampleRate / 1000) // 10ms
  const numFrames = Math.max(1, Math.floor((samples.length - frameLen) / frameShift) + 1)
  const numBins = 80

  // 預加重
  const preEmph = 0.97
  const preSamples = new Float32Array(samples.length)
  preSamples[0] = samples[0]
  for (let i = 1; i < samples.length; i++) {
    preSamples[i] = samples[i] - preEmph * samples[i - 1]
  }

  // Hamming window
  const window = new Float32Array(frameLen)
  for (let i = 0; i < frameLen; i++) {
    window[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (frameLen - 1))
  }

  // Mel filterbank (80 bins, 20-8000 Hz)
  const lowFreq = 20
  const highFreq = 8000
  const melLow = 2595 * Math.log10(1 + lowFreq / 700)
  const melHigh = 2595 * Math.log10(1 + highFreq / 700)
  const melPoints = new Float32Array(numBins + 2)
  for (let i = 0; i < numBins + 2; i++) {
    melPoints[i] = 700 * (Math.pow(10, (melLow + (melHigh - melLow) * i / (numBins + 1)) / 2595) - 1)
  }
  const fftSize = 512
  const fftBinFreqs = new Float32Array(fftSize / 2 + 1)
  for (let i = 0; i < fftBinFreqs.length; i++) {
    fftBinFreqs[i] = i * sampleRate / fftSize
  }

  // 計算 filterbank 權重
  const filterbank = new Float32Array((numBins + 2) * fftBinFreqs.length)
  for (let m = 0; m < numBins + 2; m++) {
    for (let k = 0; k < fftBinFreqs.length; k++) {
      if (k === 0) {
        filterbank[m * fftBinFreqs.length + k] = 0
        continue
      }
      if (m === 0) {
        filterbank[m * fftBinFreqs.length + k] = (melPoints[1] - fftBinFreqs[k]) / (melPoints[1] - melPoints[0])
        if (filterbank[m * fftBinFreqs.length + k] < 0) filterbank[m * fftBinFreqs.length + k] = 0
        continue
      }
      if (m === numBins + 1) {
        filterbank[m * fftBinFreqs.length + k] = (fftBinFreqs[k] - melPoints[numBins]) / (melPoints[numBins + 1] - melPoints[numBins])
        if (filterbank[m * fftBinFreqs.length + k] < 0) filterbank[m * fftBinFreqs.length + k] = 0
        continue
      }
      const left = (fftBinFreqs[k] - melPoints[m - 1]) / (melPoints[m] - melPoints[m - 1])
      const right = (melPoints[m + 1] - fftBinFreqs[k]) / (melPoints[m + 1] - melPoints[m])
      filterbank[m * fftBinFreqs.length + k] = Math.max(0, Math.min(left, right))
    }
  }

  // 計算每幀的 fbank
  const fbank = new Float32Array(numFrames * numBins)
  for (let t = 0; t < numFrames; t++) {
    const start = t * frameShift
    // 加窗
    const windowed = new Float32Array(frameLen)
    for (let i = 0; i < frameLen; i++) {
      windowed[i] = preSamples[start + i] * window[i]
    }

    // FFT (簡化實作：使用 DFT)
    const real = new Float32Array(fftSize)
    const imag = new Float32Array(fftSize)
    for (let i = 0; i < frameLen; i++) {
      real[i] = windowed[i]
    }
    for (let k = 0; k < fftSize / 2 + 1; k++) {
      let sumReal = 0, sumImag = 0
      for (let n = 0; n < fftSize; n++) {
        const angle = -2 * Math.PI * k * n / fftSize
        sumReal += real[n] * Math.cos(angle) - imag[n] * Math.sin(angle)
        sumImag += real[n] * Math.sin(angle) + imag[n] * Math.cos(angle)
      }
      real[k] = sumReal
      imag[k] = sumImag
    }

    // 功率譜
    const power = new Float32Array(fftSize / 2 + 1)
    for (let k = 0; k < power.length; k++) {
      power[k] = (real[k] * real[k] + imag[k] * imag[k]) / fftSize
    }

    // Mel filterbank 加權
    for (let m = 0; m < numBins; m++) {
      let sum = 0
      for (let k = 0; k < power.length; k++) {
        sum += power[k] * filterbank[(m + 1) * power.length + k]
      }
      fbank[t * numBins + m] = Math.log(Math.max(sum, 1e-10))
    }
  }

  // CMVN (per-utterance mean normalization)
  for (let m = 0; m < numBins; m++) {
    let mean = 0
    for (let t = 0; t < numFrames; t++) {
      mean += fbank[t * numBins + m]
    }
    mean /= numFrames
    for (let t = 0; t < numFrames; t++) {
      fbank[t * numBins + m] -= mean
    }
  }

  return { fbank, numFrames, numBins }
}

/**
 * 抽取單一段落的 speaker embedding
 */
async function extractEmbedding(pcm) {
  if (!session) {
    if (!await loadModel()) return null
  }

  const { fbank, numFrames, numBins } = computeFbank(pcm)
  if (numFrames < 5) return null // 太短無法抽取

  // 建立 ONNX tensor: shape [1, T, 80]
  const inputTensor = new ort.Tensor('float32', fbank, [1, numFrames, numBins])

  try {
    const results = await session.run({ input: inputTensor })
    // 輸出通常是 embedding，shape [1, 192]
    const outputName = session.outputNames[0]
    const embedding = results[outputName].data
    // L2 正規化
    let norm = 0
    for (let i = 0; i < embedding.length; i++) {
      norm += embedding[i] * embedding[i]
    }
    norm = Math.sqrt(norm)
    if (norm > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= norm
      }
    }
    return Array.from(embedding)
  } catch (e) {
    return null
  }
}

/**
 * 計算兩個 embedding 的 cosine similarity
 */
function cosineSimilarity(a, b) {
  let dot = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
  }
  return dot
}

/**
 * 階層式聚類分群
 * 回傳每個 segment 的 speaker 標籤
 */
function clusterEmbeddings(embeddings, threshold = 0.6) {
  const n = embeddings.length
  if (n === 0) return []
  if (n === 1) return ['Speaker_1']

  // 計算相似度矩陣
  const simMatrix = new Float32Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      simMatrix[i * n + j] = cosineSimilarity(embeddings[i], embeddings[j])
    }
  }

  // 簡單的貪婪聚類：從第一個 segment 開始，相似度高於 threshold 的歸為同一群
  const labels = new Array(n).fill(-1)
  let currentLabel = 0

  for (let i = 0; i < n; i++) {
    if (labels[i] >= 0) continue
    labels[i] = currentLabel
    for (let j = i + 1; j < n; j++) {
      if (labels[j] >= 0) continue
      if (simMatrix[i * n + j] >= threshold) {
        labels[j] = currentLabel
      }
    }
    currentLabel++
  }

  // 轉換為 Speaker_1, Speaker_2, ...
  const speakerMap = {}
  const result = []
  for (let i = 0; i < n; i++) {
    const label = labels[i]
    if (!speakerMap[label]) {
      speakerMap[label] = `Speaker_${Object.keys(speakerMap).length + 1}`
    }
    result.push(speakerMap[label])
  }

  return result
}

/**
 * 主流程：對音檔進行說話者標註
 * @param {string} audioPath - 16kHz mono WAV 路徑
 * @param {Array} segments - [{start, end, text}, ...]
 * @param {Function} progressCallback - (percent) => void
 * @returns {Array} segments 加上 speaker 欄位
 */
async function diarizeAudio(audioPath, segments, progressCallback) {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`音檔不存在: ${audioPath}`)
  }

  // 載入模型
  if (!await loadModel()) {
    throw new Error('無法載入聲紋模型，請先下載模型')
  }

  const total = segments.length
  const embeddings = []
  const validIndices = []

  for (let i = 0; i < total; i++) {
    const seg = segments[i]
    const pcm = await extractSegmentPcm(audioPath, seg.start, seg.end)

    if (pcm && pcm.length > 16000) { // 至少 1 秒
      const emb = await extractEmbedding(pcm)
      if (emb) {
        embeddings.push(emb)
        validIndices.push(i)
      } else {
        validIndices.push(i)
        embeddings.push(null)
      }
    } else {
      validIndices.push(i)
      embeddings.push(null)
    }

    if (progressCallback) {
      progressCallback(Math.round(((i + 1) / total) * 100))
    }
  }

  // 對有 embedding 的 segment 進行聚類
  const validEmbeddings = embeddings.filter(e => e !== null)
  const validPositions = embeddings.map((e, idx) => e !== null ? idx : -1).filter(p => p >= 0)

  let speakerLabels = []
  if (validEmbeddings.length > 0) {
    speakerLabels = clusterEmbeddings(validEmbeddings, 0.6)
  }

  // 將結果對應回原始 segments
  const result = segments.map((seg, idx) => ({
    ...seg,
    speaker: ''
  }))

  let labelIdx = 0
  for (let i = 0; i < validPositions.length; i++) {
    result[validPositions[i]].speaker = speakerLabels[labelIdx] || 'Speaker_1'
    labelIdx++
  }

  // 填補無 embedding 的 segment：繼承前一個 speaker
  let lastSpeaker = ''
  for (let i = 0; i < result.length; i++) {
    if (result[i].speaker) {
      lastSpeaker = result[i].speaker
    } else if (lastSpeaker) {
      result[i].speaker = lastSpeaker
    }
  }

  // 從後往前填補開頭無 speaker 的 segment
  let nextSpeaker = ''
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].speaker) {
      nextSpeaker = result[i].speaker
    } else if (nextSpeaker) {
      result[i].speaker = nextSpeaker
    }
  }

  // 最後仍無 speaker 的設為 Speaker_1
  for (let i = 0; i < result.length; i++) {
    if (!result[i].speaker) result[i].speaker = 'Speaker_1'
  }

  return result
}

module.exports = {
  isModelCached,
  downloadModel,
  loadModel,
  diarizeAudio,
  extractEmbedding,
  clusterEmbeddings,
  cosineSimilarity
}