const path = require('path')
const fs = require('fs')
const http = require('http')
const https = require('https')
const { spawn } = require('child_process')
const os = require('os')
const audioChunker = require('./audioChunker')

// 處理 HTTPS 重定向上限（node 原生 https.get 不自動 follow）
const REDIRECT_LIMIT = 5
const REQUEST_TIMEOUT_MS = 120000 // 120 秒
const USER_AGENT = 'Recorder/1.20.9 (Electron; onnxruntime-node)'

// v1.20.7: 長音檔切片 + 聚類強化常數
// v1.20.9: 改用共用 audioChunker 模組
const LONG_AUDIO_THRESHOLD_SEC = 3600   // 60 分鐘門檻
const CHUNK_DURATION_SEC = 3000         // 每段上限 50 分鐘 (3000 秒)
const MIN_SEGMENT_PAD_SEC = 0.5         // 過短 segment 左右延伸 padding
const CLUSTER_THRESHOLD = 0.5           // 全域聚類門檻
const NEIGHBOR_MERGE_THRESHOLD = 0.55   // 鄰近滑動視窗合併門檻
const EMBED_MIN_BYTES = 4800            // 約 0.3 秒 @ 16kHz s16

let ort = null
let session = null
let modelLoaded = false

// 模型下載 URL（campplus-zh-en ONNX）
const MODEL_URL = 'https://huggingface.co/welcomyou/campplus-3dspeaker-200k-onnx/resolve/main/campplus_cn_en_common_200k.onnx'
const MODEL_FILENAME = 'campplus_cn_en_common_200k.onnx'

// v1.20.7: 模型最低有效大小 40 MB（已統一，原本兩個常數同名衝突）
const MIN_MODEL_SIZE = 40 * 1024 * 1024

function modelPath() {
  return path.join(os.homedir(), 'recoder', 'voiceprint', MODEL_FILENAME)
}

function ensureModelDir() {
  const dir = path.join(os.homedir(), 'recoder', 'voiceprint')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function isModelCached() {
  try {
    if (!fs.existsSync(modelPath())) return false
    const size = fs.statSync(modelPath()).size
    return size >= MIN_MODEL_SIZE
  } catch (e) {
    return false
  }
}

function resetModel() {
  try {
    const mp = modelPath()
    if (fs.existsSync(mp)) {
      fs.unlinkSync(mp)
      console.log('[voiceprint] 已刪除損壞模型檔案: ' + mp)
    }
    const tmp = mp + '.downloading'
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    modelLoaded = false
    session = null
    return true
  } catch (e) {
    console.error('[voiceprint] 重設失敗: ' + e.message)
    return false
  }
}

function fetchWithRedirects(url, redirectsLeft = REDIRECT_LIMIT) {
  return new Promise((resolve, reject) => {
    let settled = false
    const safeReject = (err) => { if (settled) return; settled = true; reject(err) }
    const safeResolve = (val) => { if (settled) return; settled = true; resolve(val) }

    let req
    try {
      const lib = url.startsWith('https:') ? https : http
      req = lib.get(url, { headers: { 'User-Agent': USER_AGENT } }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume()
          if (redirectsLeft <= 0) {
            return safeReject(new Error(`重定向次數超過 ${REDIRECT_LIMIT}`))
          }
          const next = new URL(response.headers.location, url).toString()
          return fetchWithRedirects(next, redirectsLeft - 1).then(safeResolve, safeReject)
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return safeReject(new Error(`HTTP ${response.statusCode} ${response.statusMessage} (${url})`))
        }
        const ct = response.headers['content-type'] || ''
        if (/text\/(plain|html)/.test(ct)) {
          let peekBuf = Buffer.alloc(0)
          response.on('data', (chunk) => { peekBuf = Buffer.concat([peekBuf, chunk]) })
          response.on('end', () => {
            const text = peekBuf.toString('utf-8')
            const m = text.match(/Found\.\s*Redirecting to\s*(\S+)/i)
            if (m && redirectsLeft > 0) {
              const next = m[1]
              if (redirectsLeft <= 0) {
                return safeReject(new Error(`重定向次數超過 ${REDIRECT_LIMIT}`))
              }
              return fetchWithRedirects(next, redirectsLeft - 1).then(safeResolve, safeReject)
            }
            safeReject(new Error(`伺服器回傳非預期 HTML/text 內容 (前 100 chars: ${text.slice(0, 100)})`))
          })
          response.on('error', (err) => safeReject(err))
          return
        }
        safeResolve(response)
      })
    } catch (e) {
      return safeReject(e)
    }

    req.on('error', (err) => safeReject(err))
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      try { req.destroy() } catch (_) {}
      safeReject(new Error(`請求逾時 (${REQUEST_TIMEOUT_MS / 1000}s)`))
    })
  })
}

/**
 * 下載聲紋模型
 * v1.20.7: 已下載 (檔案大小 >= 40MB) 時直接 resolve(true)，避免重覆下載
 */
function downloadModel(progressCallback) {
  return new Promise((resolve, reject) => {
    // v1.20.7: 下載前檢查快取
    if (isModelCached()) {
      console.log('[voiceprint] 模型已存在且大小正常，跳過下載')
      if (progressCallback) progressCallback(100)
      resolve(true)
      return
    }
    ensureModelDir()
    const dest = modelPath()
    const temp = dest + '.downloading'
    try { fs.unlinkSync(temp) } catch (_) {}

    const file = fs.createWriteStream(temp)
    let receivedBytes = 0
    let totalBytes = 0
    let settled = false
    const cleanup = (err) => {
      if (settled) return
      settled = true
      try { file.destroy() } catch (_) {}
      try { fs.unlinkSync(temp) } catch (_) {}
      reject(err)
    }

    fetchWithRedirects(MODEL_URL).then((response) => {
      const cl = response.headers['content-length']
      totalBytes = cl ? parseInt(cl, 10) : 0

      response.on('data', (chunk) => {
        receivedBytes += chunk.length
        if (!file.write(chunk)) {
          response.pause()
          file.once('drain', () => response.resume())
        }
        if (totalBytes > 0 && progressCallback) {
          progressCallback(Math.round((receivedBytes / totalBytes) * 100))
        }
      })

      response.on('end', () => {
        file.end()
        if (receivedBytes < MIN_MODEL_SIZE) {
          return cleanup(new Error(`下載不完整 (只收到 ${receivedBytes} bytes)；HuggingFace 是否連線失敗？請重試。`))
        }
        try {
          if (totalBytes > 0 && receivedBytes !== totalBytes) {
            return cleanup(new Error(`下載不完整 (收到 ${receivedBytes}/${totalBytes} bytes)；請重試。`))
          }
          fs.renameSync(temp, dest)
          if (progressCallback) progressCallback(100)
          if (settled) return
          settled = true
          resolve(true)
        } catch (e) {
          cleanup(e)
        }
      })

      response.on('error', (err) => cleanup(err))
      file.on('error', (err) => cleanup(err))
    }).catch((err) => cleanup(err))
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
 * 取得 ffmpeg/ffprobe 路徑 (支援 dev + 打包後環境)
 */
function getFfmpegPath() {
  const ffmpeg = path.join(path.dirname(require.main?.filename || __dirname), '..', '..', 'ffmpeg', 'ffmpeg.exe')
  const resourceFfmpeg = path.join(process.resourcesPath || '', 'ffmpeg', 'ffmpeg.exe')
  if (fs.existsSync(ffmpeg)) return ffmpeg
  if (fs.existsSync(resourceFfmpeg)) return resourceFfmpeg
  return 'ffmpeg.exe'
}

/**
 * v1.20.7: 取得音檔時長 (透過 ffmpeg stderr 的 Duration: HH:MM:SS.xx)
 */
function getAudioDuration(audioPath) {
  return new Promise((resolve) => {
    const ffmpegPath = getFfmpegPath()
    let stderrBuf = ''
    const proc = spawn(ffmpegPath, ['-i', audioPath], { stdio: ['ignore', 'ignore', 'pipe'] })
    proc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString('utf-8') })
    proc.on('close', () => {
      const m = stderrBuf.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
      if (!m) { resolve(0); return }
      const h = parseInt(m[1], 10)
      const mm = parseInt(m[2], 10)
      const s = parseFloat(m[3])
      resolve(h * 3600 + mm * 60 + s)
    })
    proc.on('error', () => resolve(0))
  })
}

/**
 * v1.20.7: 將長音檔切成多個 ≤ CHUNK_DURATION_SEC 的 WAV，回傳 chunk 檔路徑陣列
 * 使用 ffmpeg -f segment，每段重新編碼 16kHz mono PCM
 */
function splitLongAudio(audioPath) {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceprint-chunk-'))
    const pattern = path.join(tmpDir, 'chunk_%03d.wav')
    const ffmpegPath = getFfmpegPath()
    const proc = spawn(ffmpegPath, [
      '-y', '-i', audioPath,
      '-ar', '16000', '-ac', '1', '-sample_fmt', 's16',
      '-f', 'segment',
      '-segment_time', String(CHUNK_DURATION_SEC),
      '-reset_timestamps', '1',
      pattern
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    let stderr = ''
    proc.stderr.on('data', (c) => { stderr += c.toString('utf-8') })
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg 切片失敗 (exit ${code}): ${stderr.slice(0, 200)}`))
        return
      }
      const files = fs.readdirSync(tmpDir)
        .filter(f => f.endsWith('.wav'))
        .map(f => path.join(tmpDir, f))
        .sort()
      if (files.length === 0) {
        reject(new Error('ffmpeg 切片完成但未產生任何 chunk'))
        return
      }
      // 計算每個 chunk 的時長（用 ffmpeg probe 簡化：差值法）
      getChunkDurations(files, tmpDir).then((durations) => {
        resolve({ tmpDir, files, durations })
      }).catch(reject)
    })
    proc.on('error', (e) => reject(e))
  })
}

/**
 * 計算每個 chunk 檔的時長（用 ffprobe-like 解析 WAV header 的樣本數）
 */
function getChunkDurations(files, tmpDir) {
  return Promise.all(files.map((fp) => new Promise((resolve) => {
    const proc = spawn(getFfmpegPath(), ['-i', fp], { stdio: ['ignore', 'ignore', 'pipe'] })
    let buf = ''
    proc.stderr.on('data', (c) => { buf += c.toString('utf-8') })
    proc.on('close', () => {
      const m = buf.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
      if (!m) { resolve(0); return }
      const h = parseInt(m[1], 10)
      const mm = parseInt(m[2], 10)
      const s = parseFloat(m[3])
      resolve(h * 3600 + mm * 60 + s)
    })
    proc.on('error', () => resolve(0))
  })))
}

/**
 * 從音檔中切割出指定時間區間的 PCM 資料
 * v1.20.7: 過短 (<0.5s) 時自動左右延伸 padding 補足長度
 */
function extractSegmentPcm(audioPath, startSec, endSec, audioDuration = null) {
  return new Promise((resolve, reject) => {
    let duration = endSec - startSec
    let paddedStart = startSec
    let paddedEnd = endSec
    // 過短時左右各延伸 padding
    if (duration < 1.5) {
      paddedStart = Math.max(0, startSec - MIN_SEGMENT_PAD_SEC)
      paddedEnd = endSec + MIN_SEGMENT_PAD_SEC
      if (audioDuration && audioDuration > 0) {
        paddedEnd = Math.min(audioDuration, paddedEnd)
      }
      duration = paddedEnd - paddedStart
    }
    if (duration < 0.3 || paddedEnd <= paddedStart) {
      resolve(null)
      return
    }

    const ffmpegPath = getFfmpegPath()
    const chunks = []
    const proc = spawn(ffmpegPath, [
      '-y', '-i', audioPath,
      '-ss', String(paddedStart),
      '-t', String(duration),
      '-ar', '16000', '-ac', '1', '-sample_fmt', 's16',
      '-f', 'wav',
      'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    proc.stdout.on('data', (chunk) => chunks.push(chunk))
    proc.stderr.on('data', () => {})

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve(null)
        return
      }
      const buf = Buffer.concat(chunks)
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
  const samples = new Float32Array(pcm.length / 2)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = (pcm.readInt16LE(i * 2)) / 32768.0
  }

  const sampleRate = 16000
  const frameLen = Math.floor(25 * sampleRate / 1000)
  const frameShift = Math.floor(10 * sampleRate / 1000)
  const numFrames = Math.max(1, Math.floor((samples.length - frameLen) / frameShift) + 1)
  const numBins = 80

  const preEmph = 0.97
  const preSamples = new Float32Array(samples.length)
  preSamples[0] = samples[0]
  for (let i = 1; i < samples.length; i++) {
    preSamples[i] = samples[i] - preEmph * preSamples[i - 1]
  }

  const window = new Float32Array(frameLen)
  for (let i = 0; i < frameLen; i++) {
    window[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (frameLen - 1))
  }

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

  const fbank = new Float32Array(numFrames * numBins)
  for (let t = 0; t < numFrames; t++) {
    const start = t * frameShift
    const windowed = new Float32Array(frameLen)
    for (let i = 0; i < frameLen; i++) {
      windowed[i] = preSamples[start + i] * window[i]
    }

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

    const power = new Float32Array(fftSize / 2 + 1)
    for (let k = 0; k < power.length; k++) {
      power[k] = (real[k] * real[k] + imag[k] * imag[k]) / fftSize
    }

    for (let m = 0; m < numBins; m++) {
      let sum = 0
      for (let k = 0; k < power.length; k++) {
        sum += power[k] * filterbank[(m + 1) * power.length + k]
      }
      fbank[t * numBins + m] = Math.log(Math.max(sum, 1e-10))
    }
  }

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
 * v1.20.7: 放寬 numFrames 限制 (<5 → <3)
 */
async function extractEmbedding(pcm) {
  if (!session) {
    if (!await loadModel()) return null
  }

  const { fbank, numFrames, numBins } = computeFbank(pcm)
  if (numFrames < 3) return null // 太短無法抽取 (v1.20.7: 5 → 3)

  const inputTensor = new ort.Tensor('float32', fbank, [1, numFrames, numBins])

  try {
    const results = await session.run({ input: inputTensor })
    const outputName = session.outputNames[0]
    const embedding = results[outputName].data
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
 * v1.20.7: 兩段式聚類
 * 第一階段: 鄰近滑動視窗 (window=3) median cosine similarity，>= NEIGHBOR_MERGE_THRESHOLD 的相鄰段強制合併
 * 第二階段: 全域貪婪聚類 (CLUSTER_THRESHOLD) 合併跨時段同 speaker
 */
function clusterEmbeddings(embeddings, threshold = CLUSTER_THRESHOLD) {
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

  // 第一階段：鄰近滑動視窗合併
  // window=3: 看 i 周圍 3 個鄰居的中位數相似度，若 >= NEIGHBOR_MERGE_THRESHOLD 視為同 speaker
  const window = 3
  const neighborMergeHints = [] // [{i, j}]
  for (let i = 0; i < n; i++) {
    const sims = []
    for (let j = Math.max(0, i - window); j <= Math.min(n - 1, i + window); j++) {
      if (i === j) continue
      sims.push(simMatrix[i * n + j])
    }
    if (sims.length === 0) continue
    sims.sort((a, b) => a - b)
    const median = sims[Math.floor(sims.length / 2)]
    // 找出所有鄰居相似度 >= NEIGHBOR_MERGE_THRESHOLD 的 segment
    if (median >= NEIGHBOR_MERGE_THRESHOLD) {
      const neighbors = []
      for (let j = Math.max(0, i - window); j <= Math.min(n - 1, i + window); j++) {
        if (i === j) continue
        if (simMatrix[i * n + j] >= NEIGHBOR_MERGE_THRESHOLD) neighbors.push(j)
      }
      neighbors.forEach(j => neighborMergeHints.push([Math.min(i, j), Math.max(i, j)]))
    }
  }

  // 建立 preCluster: 相鄰合併
  const labels = new Array(n).fill(-1)
  let currentLabel = 0
  // 用 union-find 處理鄰近合併提示
  const parent = new Array(n).fill(0).map((_, i) => i)
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }
  neighborMergeHints.forEach(([a, b]) => union(a, b))

  // 將同 group 標為同一 preLabel (按首次出現順序)
  const groupLabelMap = {}
  for (let i = 0; i < n; i++) {
    if (labels[i] >= 0) continue
    const root = find(i)
    if (!(root in groupLabelMap)) {
      groupLabelMap[root] = currentLabel++
    }
    labels[i] = groupLabelMap[root]
  }

  // 第二階段：全域聚類 - 對每個 group 取 centroid，再 cross-group 合併相似者
  const groupCentroids = {}
  const groupCounts = {}
  for (let i = 0; i < n; i++) {
    const g = labels[i]
    if (!groupCentroids[g]) {
      groupCentroids[g] = new Float32Array(embeddings[i].length)
      groupCounts[g] = 0
    }
    for (let d = 0; d < embeddings[i].length; d++) {
      groupCentroids[g][d] += embeddings[i][d]
    }
    groupCounts[g]++
  }
  // 正規化 centroid
  Object.keys(groupCentroids).forEach((g) => {
    const c = groupCentroids[g]
    let norm = 0
    for (let d = 0; d < c.length; d++) norm += c[d] * c[d]
    norm = Math.sqrt(norm)
    if (norm > 0) { for (let d = 0; d < c.length; d++) c[d] /= norm }
  })

  // 對 group centroid 做跨組合併
  const gKeys = Object.keys(groupCentroids)
  const gMap = {}
  let gCurrent = 0
  for (const gk of gKeys) {
    if (gk in gMap) continue
    gMap[gk] = gCurrent
    const ck = groupCentroids[gk]
    for (const other of gKeys) {
      if (other === gk || other in gMap) continue
      const co = groupCentroids[other]
      let dot = 0
      for (let d = 0; d < ck.length; d++) dot += ck[d] * co[d]
      if (dot >= threshold) gMap[other] = gCurrent
    }
    gCurrent++
  }

  // 重新映射 labels
  for (let i = 0; i < n; i++) {
    labels[i] = gMap[labels[i]]
  }

  // 警告：若超過 60% segment 落到同一群，可能只抓到一種聲音
  const groupSizes = {}
  for (const l of labels) groupSizes[l] = (groupSizes[l] || 0) + 1
  const maxGroupSize = Math.max(0, ...Object.values(groupSizes))
  if (maxGroupSize > n * 0.6 && n >= 4) {
    console.warn(`[voiceprint] 警告: ${maxGroupSize}/${n} segments (${Math.round(maxGroupSize / n * 100)}%) 落入同一 speaker；可能錄音只含一種聲音或聚類門檻過嚴`)
  }

  // 轉換為 Speaker_1, Speaker_2, ...
  const speakerMap = {}
  const result = []
  for (let i = 0; i < n; i++) {
    const l = labels[i]
    if (!(l in speakerMap)) {
      speakerMap[l] = `Speaker_${Object.keys(speakerMap).length + 1}`
    }
    result.push(speakerMap[l])
  }

  return result
}

/**
 * 主流程：對音檔進行說話者標註
 * v1.20.7:
 *   1) 音檔時長 >= 60 分鐘 → 切成 ≤50 分鐘 chunks 後逐段標註 (降 OOM/timeout 風險)
 *   2) 下載前檢查 isModelCached() 避免重覆下載 (已下放至 downloadModel)
 *   3) 過短 segment 自動 padding + 兩段式聚類 (clusterEmbeddings 已強化)
 * v1.20.9: 改用共用 audioChunker.chunkLongAudioIfNeeded() 避免重覆邏輯
 */
async function diarizeAudio(audioPath, segments, progressCallback) {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`音檔不存在: ${audioPath}`)
  }

  // 載入模型
  try {
    if (!await loadModel()) {
      const mp = modelPath()
      if (!fs.existsSync(mp)) {
        throw new Error(`聲紋模型檔不存在 (${mp})，請先在設定中下載模型`)
      }
      const stat = fs.statSync(mp)
      if (stat.size < MIN_MODEL_SIZE) {
        resetModel()
        throw new Error(`聲紋模型檔不完整 (大小: ${(stat.size / 1024 / 1024).toFixed(2)} MB)，已自動重設。請重新下載模型。`)
      }
      throw new Error(`聲紋模型檔已下載但 InferenceSession 建立失敗 (檔案大小: ${(stat.size / 1024 / 1024).toFixed(1)} MB)；請檢查 onnxruntime-node native binary 是否被 asar 打包、或是 CPU 不支援。建議到開發者控制台查看完整錯誤。`)
    }
  } catch (e) {
    throw e
  }

  const total = segments.length
  const audioDuration = await audioChunker.getAudioDuration(audioPath)
  let tmpDir = null
  let useChunks = false
  let chunkList = [] // [{ file, startOffset, endOffset }]
  let chunkAudioDuration = audioDuration

  // v1.20.9: 長音檔切片 (改用共用 audioChunker)
  if (audioDuration >= LONG_AUDIO_THRESHOLD_SEC) {
    try {
      console.log(`[voiceprint] 音檔時長 ${Math.round(audioDuration)}s >= ${LONG_AUDIO_THRESHOLD_SEC}s，啟動切片`)
      const chunkResult = await audioChunker.chunkLongAudioIfNeeded(audioPath, {
        thresholdSec: LONG_AUDIO_THRESHOLD_SEC,
        segmentSec: CHUNK_DURATION_SEC,
        prefix: 'chunk',
      })
      if (chunkResult) {
        tmpDir = chunkResult.tmpDir
        chunkList = chunkResult.chunks
        useChunks = true
        chunkAudioDuration = chunkResult.totalDuration
        console.log(`[voiceprint] 切成 ${chunkList.length} 個 chunks`)
      }
    } catch (e) {
      console.error(`[voiceprint] 切片失敗，將直接處理完整音檔: ${e.message}`)
      tmpDir = null
      useChunks = false
    }
  }

  // 將 segments 對應到 chunk (半開區間 [startOffset, endOffset))
  // v1.20.10 修正: 原先 segmentToChunk 誤判跨 chunk 的 segment，
  //                 使 seg.start=2900/end=3100 仍指向 chunk 0 而漏掉 [3000,3100) 部分。
  //                 改為對每個 segment 找出所有跨越的 chunks 依序拼 PCM。
  const findChunksForSegment = (seg) => {
    if (!useChunks) return []
    const result = []
    for (let i = 0; i < chunkList.length; i++) {
      const c = chunkList[i]
      // 該 chunk 與 segment 有重疊
      if (seg.end > c.startOffset && seg.start < c.endOffset) {
        result.push(i)
      }
    }
    return result
  }

  const embeddings = []
  const validIndices = []
  let processedCount = 0
  const reportProgress = () => {
    if (progressCallback) {
      progressCallback(Math.round((processedCount / total) * 100))
    }
  }

  for (let i = 0; i < total; i++) {
    const seg = segments[i]

    let pcm = null
    if (useChunks) {
      // 跨多個 chunks 時依序抽取並拼接 PCM
      const chunkIndices = findChunksForSegment(seg)
      const pcmChunks = []
      for (const ci of chunkIndices) {
        const c = chunkList[ci]
        const localStart = Math.max(0, seg.start - c.startOffset)
        const localEnd = Math.min(c.endOffset - c.startOffset, seg.end - c.startOffset)
        const subPcm = await extractSegmentPcm(c.file, localStart, localEnd, chunkAudioDuration)
        if (subPcm && subPcm.length > 0) pcmChunks.push(subPcm)
      }
      if (pcmChunks.length > 0) {
        pcm = Buffer.concat(pcmChunks)
      }
    } else {
      pcm = await extractSegmentPcm(audioPath, seg.start, seg.end, audioDuration)
    }

    if (pcm && pcm.length > EMBED_MIN_BYTES) {
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

    processedCount++
    // 每 5 段回報一次以減輕 IPC 壓力
    if (processedCount % 5 === 0 || processedCount === total) reportProgress()
  }

  // v1.20.7: 清理切片 temp 目錄
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
  }

  // 對有 embedding 的 segment 進行聚類
  const validEmbeddings = embeddings.filter(e => e !== null)
  const validPositions = embeddings.map((e, idx) => e !== null ? idx : -1).filter(p => p >= 0)

  let speakerLabels = []
  if (validEmbeddings.length > 0) {
    // v1.20.7: clusterEmbeddings 改為兩段式聚類
    speakerLabels = clusterEmbeddings(validEmbeddings, CLUSTER_THRESHOLD)
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

  // 填補無 embedding 的 segment：繼承前一個 speaker；如無則用「上一個 valid 的 embedding」對應的 label
  let lastSpeaker = ''
  for (let i = 0; i < result.length; i++) {
    if (result[i].speaker) {
      lastSpeaker = result[i].speaker
    } else if (lastSpeaker) {
      result[i].speaker = lastSpeaker
    }
  }

  let nextSpeaker = ''
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].speaker) {
      nextSpeaker = result[i].speaker
    } else if (nextSpeaker) {
      result[i].speaker = nextSpeaker
    }
  }

  for (let i = 0; i < result.length; i++) {
    if (!result[i].speaker) result[i].speaker = 'Speaker_1'
  }

  return result
}

module.exports = {
  isModelCached,
  downloadModel,
  loadModel,
  resetModel,
  diarizeAudio,
  extractEmbedding,
  extractSegmentPcm,
  clusterEmbeddings,
  cosineSimilarity,
  getAudioDuration,
}