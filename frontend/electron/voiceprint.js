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
const PROPAGATE_MIN_THRESHOLD = 0.5     // 半監督推算的 cosine 閾值（低於則留空）

let ort = null
let session = null
let modelLoaded = false
let currentModelKey = 'camplus'  // v1.22.0: 當前使用的模型 key

// v1.22.0: MODEL_REGISTRY — 多模型 Speaker Embedding 架構
//   為未來擴展準備，採用工廠模式。每個模型獨立設定：
//   - url: 預設下載 URL（可能隨時失效，故以手動匯入為主）
//   - filename: 本地存檔檔名
//   - minSize: 最低有效大小 (bytes)
//   - dim: embedding 維度
//   - fbankConfig: fbank 特徵參數
//   - inputName/outputName: ONNX tensor 名稱（null = 動態從 session 讀取）
//   - description: i18n key
//
// 現有 個模型：
//   - camplus: 中英日 200k 講者訓練 (現有，預設，27 MB)
//   - ecapa_tdnn: 業界標竿，VoxCeleb 100/200k 講者 (實驗性，需手動匯入)
//   - resnet_se: 短句友善，192-dim (實驗性，需手動匯入)
const MODEL_REGISTRY = {
  camplus: {
    key: 'camplus',
    label: 'camplus',
    url: 'https://huggingface.co/welcomyou/campplus-3dspeaker-200k-onnx/resolve/main/campplus_cn_en_common_200k.onnx',
    filename: 'camplus_cn_en_common_200k.onnx',
    minSize: 25 * 1024 * 1024,  // 25 MB
    dim: 192,
    fbankConfig: { numBins: 80, frameLenMs: 25, frameShiftMs: 10, sampleRate: 16000 },
    inputName: 'feats',     // 動態讀取為 session.inputNames[0]
    outputName: 'embs',     // 動態讀取為 session.outputNames[0]
    defaultModel: true,     // 預設
    descriptionKey: 'voiceprint.modelCamplusDesc',
  },
  ecapa_tdnn: {
    key: 'ecapa_tdnn',
    label: 'ecapa_tdnn',
    url: '',  // 公開下載 URL 不可用，需手動匯入
    filename: 'ecapa_tdnn.onnx',
    minSize: 25 * 1024 * 1024,  // 至少 25 MB
    dim: 192,
    fbankConfig: { numBins: 80, frameLenMs: 25, frameShiftMs: 10, sampleRate: 16000 },
    inputName: null,  // 動態讀取
    outputName: null, // 動態讀取
    defaultModel: false,
    descriptionKey: 'voiceprint.modelEcapaTdnnDesc',
  },
  resnet_se: {
    key: 'resnet_se',
    label: 'resnet_se',
    // 2026-07-02: 改用 WeSpeaker/wespeaker-cnceleb-resnet34-LM 官方 ONNX (HF LFS, CC-BY-4.0, 26.5 MB, 256-dim)
    //   input/output 張量名稱與 campplus 完全相同 (feats/embs)，可與現有 voiceprint.js fbank pipeline 相容
    //   進階：resnet293 大模型 (Wespeaker/wespeaker-voxceleb-resnet293-LM, 114 MB, 256-dim)
    url: 'https://huggingface.co/Wespeaker/wespeaker-cnceleb-resnet34-LM/resolve/main/cnceleb_resnet34_LM.onnx',
    filename: 'cnceleb_resnet34_LM.onnx',
    minSize: 25 * 1024 * 1024,  // 26.5 MB (安全下限 25 MB)
    dim: 256,  // WeSpeaker ResNet34-LM 為 256-dim
    fbankConfig: { numBins: 80, frameLenMs: 25, frameShiftMs: 10, sampleRate: 16000 },
    inputName: 'feats',     // 與 campplus 一致
    outputName: 'embs',     // 與 campplus 一致
    defaultModel: false,
    descriptionKey: 'voiceprint.modelResnetSeDesc',
  },
}

// v1.20.11: camplus 模型最低有效大小 25 MB
//   根因：v1.20.7 將 MIN_MODEL_SIZE 設為 40 MB 是依據錯誤估計，
//   實測 huggingface 上檔案大小 = 28,283,928 bytes (≒26.97 MB)，
//   永遠 < 40 MB → 每次下載都被誤判「不完整」而失敗。
//   HF LFS 雖然在 UI 顯示「~50 MB」，但 .onnx binary 本身只有 27 MB 左右。
//   25 MB 為安全下限，已驗證 c:/temp/voiceprint-test.onnx 為合法 protobuf ONNX
//   (magic 08 08 12 07 pytorch，含 xvector / head/conv1 / ReduceMean 等節點)。
const DEFAULT_MIN_MODEL_SIZE = 25 * 1024 * 1024

function modelPath(modelKey = 'camplus') {
  const cfg = MODEL_REGISTRY[modelKey]
  if (!cfg) return path.join(os.homedir(), 'recoder', 'voiceprint', 'unknown.onnx')
  return path.join(os.homedir(), 'recoder', 'voiceprint', cfg.filename)
}

function modelMinSize(modelKey = 'camplus') {
  const cfg = MODEL_REGISTRY[modelKey]
  return cfg ? cfg.minSize : DEFAULT_MIN_MODEL_SIZE
}

function ensureModelDir() {
  const dir = path.join(os.homedir(), 'recoder', 'voiceprint')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function isModelCached(modelKey = 'camplus') {
  try {
    const mp = modelPath(modelKey)
    if (!fs.existsSync(mp)) return false
    const size = fs.statSync(mp).size
    return size >= modelMinSize(modelKey)
  } catch (e) {
    return false
  }
}

function resetModel(modelKey = 'camplus') {
  try {
    const mp = modelPath(modelKey)
    if (fs.existsSync(mp)) {
      fs.unlinkSync(mp)
      console.log('[voiceprint] 已刪除損壞模型檔案: ' + mp)
    }
    const tmp = mp + '.downloading'
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    if (modelKey === currentModelKey) {
      modelLoaded = false
      session = null
    }
    return true
  } catch (e) {
    console.error('[voiceprint] 重設失敗: ' + e.message)
    return false
  }
}

// v1.22.0: 列出所有支援的模型 + 下載狀態
function listModels() {
  const out = []
  for (const key of Object.keys(MODEL_REGISTRY)) {
    const cfg = MODEL_REGISTRY[key]
    out.push({
      key: cfg.key,
      label: cfg.label,
      dim: cfg.dim,
      minSize: cfg.minSize,
      cached: isModelCached(key),
      defaultModel: !!cfg.defaultModel,
      downloadable: !!cfg.url,
      descriptionKey: cfg.descriptionKey,
    })
  }
  return out
}

// v1.22.0: 手動匯入使用者提供的 ONNX 檔案
function importModel(modelKey, sourcePath) {
  try {
    if (!MODEL_REGISTRY[modelKey]) return { success: false, error: '未知的模型 key' }
    const cfg = MODEL_REGISTRY[modelKey]
    if (!fs.existsSync(sourcePath)) return { success: false, error: '來源檔案不存在' }
    const stat = fs.statSync(sourcePath)
    if (stat.size < cfg.minSize) {
      return { success: false, error: `檔案太小 (${(stat.size/1024/1024).toFixed(1)} MB)，需至少 ${(cfg.minSize/1024/1024).toFixed(0)} MB` }
    }
    ensureModelDir()
    const dest = modelPath(modelKey)
    fs.copyFileSync(sourcePath, dest)
    return { success: true, size: stat.size, path: dest }
  } catch (e) {
    return { success: false, error: e.message }
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
 * v1.20.7: 已下載 (檔案大小 >= modelMinSize) 時直接 resolve(true)，避免重覆下載
 * v1.20.11: MIN_MODEL_SIZE 門檻從 40 MB 改為 25 MB（模型真實大小 ~27 MB）
 * v1.22.0: 支援指定 modelKey 參數，預設為 'camplus'
 */
function downloadModel(progressCallback, modelKey = 'camplus') {
  return new Promise((resolve, reject) => {
    const cfg = MODEL_REGISTRY[modelKey]
    if (!cfg) { reject(new Error(`未知的模型: ${modelKey}`)); return }
    if (!cfg.url) {
      reject(new Error(`${modelKey} 沒有可用的下載 URL，請改用「手動匯入」`))
      return
    }
    // v1.20.7: 下載前檢查快取
    if (isModelCached(modelKey)) {
      console.log(`[voiceprint] 模型 ${modelKey} 已存在且大小正常，跳過下載`)
      if (progressCallback) progressCallback(100)
      resolve(true)
      return
    }
    ensureModelDir()
    const dest = modelPath(modelKey)
    const temp = dest + '.downloading'
    try { fs.unlinkSync(temp) } catch (_) {}

    const minSize = cfg.minSize
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

    fetchWithRedirects(cfg.url).then((response) => {
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
        if (receivedBytes < minSize) {
          return cleanup(new Error(`下載不完整 (只收到 ${receivedBytes} bytes)；需要至少 ${minSize} bytes；HuggingFace 是否連線失敗？請重試。`))
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

/**
 * v1.22.0: 切換當前使用的模型
 *   - 切換前如果已載入其他模型，會卸載 session
 *   - 需要預先下載/匯入 modelKey 對應的 .onnx
 *   - 返回 { success, modelKey, dim, message }
 */
async function setActiveModel(modelKey) {
  try {
    if (!MODEL_REGISTRY[modelKey]) return { success: false, error: `未知的模型: ${modelKey}` }
    if (!isModelCached(modelKey)) return { success: false, error: `模型 ${modelKey} 尚未下載/匯入` }
    // 如果切換到相同模型，不需重載
    if (currentModelKey === modelKey && modelLoaded && session) {
      return { success: true, modelKey, dim: MODEL_REGISTRY[modelKey].dim, message: '已是當前模型' }
    }
    // 卸載舊 session
    if (session) { try { session.release && session.release() } catch (_) {} }
    session = null
    modelLoaded = false
    currentModelKey = modelKey
    // 載入新模型
    const ok = await loadModel(modelKey)
    if (!ok) return { success: false, error: `載入模型 ${modelKey} 失敗` }
    return { success: true, modelKey, dim: MODEL_REGISTRY[modelKey].dim, message: '已切換' }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * v1.22.0: 取得當前使用中的模型 key
 */
function getCurrentModel() {
  return currentModelKey
}

async function loadModel(modelKey) {
  // 向後相容：未傳 modelKey 時用 currentModelKey
  if (!modelKey) modelKey = currentModelKey
  if (modelKey === currentModelKey && modelLoaded && session) return true
  try {
    if (!ort) ort = require('onnxruntime-node')
    const mp = modelPath(modelKey)
    if (!fs.existsSync(mp)) return false
    // v1.20.12: campplus-zh-en 模型在 DML (DirectML) 上 AveragePool 等節點會拋 80070057 參數錯誤。
    // 改成優先 CPU。CPU 本身已成 principal 路徑，且聲紋抽取 5-15s/段不是 IO-bottleneck，DML 加速價值有限。
    const newSession = await ort.InferenceSession.create(mp, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all'
    })
    // 切換成功後才取代全域 session
    if (session) { try { session.release && session.release() } catch (_) {} }
    session = newSession
    modelLoaded = true
    currentModelKey = modelKey
    return true
  } catch (e) {
    modelLoaded = false
    console.error(`[voiceprint] loadModel(${modelKey}) 失敗:`, e && e.message ? e.message : e)
    return false
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
 * v1.21.0: 共用 helper — 抽取所有 segments 的 embeddings，並回傳對應原始索引。
 *   給 diarizeAudio 與 propagateSpeakers 共同使用，避免重覆邏輯。
 *   回傳 { embeddings: Array<Array<number>|null>, validIndices: Array<number> }
 *   其中 validIndices[i] = 原 segments 陣列中第幾個 segment；embeddings[i] 為 null 表示該段
 *   PCM 太短或抽取失敗。
 */
async function _extractAllEmbeddings(audioPath, segments, progressCallback) {
  const total = segments.length
  const audioDuration = await audioChunker.getAudioDuration(audioPath)
  let tmpDir = null
  let useChunks = false
  let chunkList = []
  let chunkAudioDuration = audioDuration

  if (audioDuration >= LONG_AUDIO_THRESHOLD_SEC) {
    try {
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
      }
    } catch (e) {
      console.error(`[voiceprint] 切片失敗，將直接處理完整音檔: ${e.message}`)
      tmpDir = null
      useChunks = false
    }
  }

  const findChunksForSegment = (seg) => {
    if (!useChunks) return []
    const result = []
    for (let i = 0; i < chunkList.length; i++) {
      const c = chunkList[i]
      if (seg.end > c.startOffset && seg.start < c.endOffset) result.push(i)
    }
    return result
  }

  const embeddings = []
  const validIndices = []
  let processedCount = 0
  const reportProgress = () => {
    if (progressCallback) progressCallback(Math.round((processedCount / total) * 100))
  }

  for (let i = 0; i < total; i++) {
    const seg = segments[i]
    let pcm = null
    if (useChunks) {
      const chunkIndices = findChunksForSegment(seg)
      const pcmChunks = []
      for (const ci of chunkIndices) {
        const c = chunkList[ci]
        const localStart = Math.max(0, seg.start - c.startOffset)
        const localEnd = Math.min(c.endOffset - c.startOffset, seg.end - c.startOffset)
        const subPcm = await extractSegmentPcm(c.file, localStart, localEnd, chunkAudioDuration)
        if (subPcm && subPcm.length > 0) pcmChunks.push(subPcm)
      }
      if (pcmChunks.length > 0) pcm = Buffer.concat(pcmChunks)
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
    if (processedCount % 5 === 0 || processedCount === total) reportProgress()
  }

  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
  }

  return { embeddings, validIndices, total }
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
    // v1.20.12: campplus ONNX 的 input key 是 'feats'、output key 是 'embs'。
    // 舊版寫死用 { input: ... } 對到模型而 silent return null，造成 diarize 全部 segment 被 fallback 為 Speaker_1。
    // 改用 session.inputNames / outputNames 動態讀取，避免這類名稱 drift。
    const inputName = session.inputNames[0]
    const outputName = session.outputNames[0]
    const results = await session.run({ [inputName]: inputTensor })
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
    console.error('[voiceprint] extractEmbedding 失敗:', e && e.message ? e.message : e)
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
 * 載入聲紋模型，供 diarizeAudio / propagateSpeakers 共用。
 * v1.22.0: 支援指定 modelKey
 */
async function _ensureModelLoaded(modelKey) {
  if (!modelKey) modelKey = currentModelKey
  const mp = modelPath(modelKey)
  if (!fs.existsSync(mp)) {
    throw new Error(`聲紋模型檔不存在 (${mp})，請先在設定中下載/匯入模型`)
  }
  const stat = fs.statSync(mp)
  if (stat.size < modelMinSize(modelKey)) {
    resetModel(modelKey)
    throw new Error(`聲紋模型檔不完整 (大小: ${(stat.size / 1024 / 1024).toFixed(2)} MB)，已自動重設。請重新下載模型。`)
  }
  if (!await loadModel(modelKey)) {
    throw new Error(`聲紋模型檔已下載但 InferenceSession 建立失敗 (檔案大小: ${(stat.size / 1024 / 1024).toFixed(1)} MB)；請檢查 onnxruntime-node native binary 是否被 asar 打包、或是 CPU 不支援。建議到開發者控制台查看完整錯誤。`)
  }
}

/**
 * 主流程：對音檔進行說話者標註 (無監督聚類)
 * v1.21.0: 重構為使用 _ensureModelLoaded + _extractAllEmbeddings 共用 helper
 */
async function diarizeAudio(audioPath, segments, progressCallback) {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`音檔不存在: ${audioPath}`)
  }
  await _ensureModelLoaded()
  const { embeddings, validIndices } = await _extractAllEmbeddings(audioPath, segments, progressCallback)

  // 對有 embedding 的 segment 進行聚類
  const validEmbeddings = embeddings.filter(e => e !== null)
  let speakerLabels = []
  if (validEmbeddings.length > 0) {
    speakerLabels = clusterEmbeddings(validEmbeddings, CLUSTER_THRESHOLD)
  }

  // v1.21.3: 計算每個 segment 對所屬群組 centroid 的 cosine similarity 作為 score
  // 先收集 group centroids (與 clusterEmbeddings 內部邏輯一致) — 重新計算以取出
  const groupCentroids = {}
  const groupCounts = {}
  for (let i = 0; i < validEmbeddings.length; i++) {
    const g = speakerLabels[i] || 'Speaker_1'
    if (!groupCentroids[g]) { groupCentroids[g] = new Float32Array(validEmbeddings[i].length); groupCounts[g] = 0 }
    const c = groupCentroids[g]
    const e = validEmbeddings[i]
    for (let d = 0; d < e.length; d++) c[d] += e[d]
    groupCounts[g]++
  }
  Object.keys(groupCentroids).forEach((g) => {
    const c = groupCentroids[g]
    for (let d = 0; d < c.length; d++) c[d] /= groupCounts[g]
    let norm = 0; for (let d = 0; d < c.length; d++) norm += c[d] * c[d]; norm = Math.sqrt(norm)
    if (norm > 0) for (let d = 0; d < c.length; d++) c[d] /= norm
  })

  const result = segments.map((seg) => ({ ...seg, speaker: '', score: 0 }))
  let labelIdx = 0
  for (let i = 0; i < validIndices.length; i++) {
    const g = speakerLabels[labelIdx] || 'Speaker_1'
    result[validIndices[i]].speaker = g
    // 計算該 segment 對群組 centroid 的 cosine similarity
    const e = validEmbeddings[i]
    if (e && groupCentroids[g]) {
      result[validIndices[i]].score = cosineSimilarity(e, groupCentroids[g])
    }
    labelIdx++
  }
  // 填補無 embedding 的 segment：繼承前後 speaker
  let lastSpeaker = ''
  let lastScore = 0
  for (let i = 0; i < result.length; i++) {
    if (result[i].speaker) { lastSpeaker = result[i].speaker; lastScore = result[i].score }
    else if (lastSpeaker) { result[i].speaker = lastSpeaker; result[i].score = lastScore }
  }
  let nextSpeaker = ''
  let nextScore = 0
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].speaker) { nextSpeaker = result[i].speaker; nextScore = result[i].score }
    else if (nextSpeaker) { result[i].speaker = nextSpeaker; result[i].score = nextScore }
  }
  for (let i = 0; i < result.length; i++) {
    if (!result[i].speaker) result[i].speaker = 'Speaker_1'
  }
  return result
}

/**
 * v1.21.0 半監督式 speaker propagation:
 *   對音檔抽取所有 segments 的 embedding，然後對使用者「已標註的 seeds」取每個 speaker 的
 *   centroid embedding，再對所有未標註 segment 計算與每個 centroid 的 cosine similarity，
 *   最高者若 ≥ PROPAGATE_MIN_THRESHOLD 則標為該 speaker name；低於則標 '__uncertain__'。
 *   結構與 diarizeAudio 一致，回傳同樣的 segments 陣列 (含 .speaker)。
 *   參數:
 *     audioPath: 音檔絕對路徑
 *     segments:  Array<{ start, end, text, speaker? }>  全部 segments
 *     seeds:     Array<{ idx: number, name: string }>   使用者已標註的種子 (idx 為 segments 索引)
 *     options:   { progressCallback?: (percent: number) => void, threshold?: number }
 */
async function propagateSpeakers(audioPath, segments, seeds, options = {}) {
  const { progressCallback, threshold = PROPAGATE_MIN_THRESHOLD } = options
  if (!fs.existsSync(audioPath)) throw new Error(`音檔不存在: ${audioPath}`)
  if (!Array.isArray(seeds) || seeds.length === 0) {
    throw new Error('seeds 不可為空 — 至少需標註一句才能推算')
  }
  if (!segments || segments.length === 0) return segments

  await _ensureModelLoaded()
  const { embeddings, validIndices } = await _extractAllEmbeddings(audioPath, segments, progressCallback)

  // 為每個 seed 找其對應的 embedding (可能 null = 該段太短無法抽出)
  // 建立 name → centroids 陣列 (一個 speaker 可能有多個 seed)
  const nameToEmbeddings = {}
  for (const seed of seeds) {
    const segIdx = seed.idx
    const name = seed.name
    const localIdx = validIndices.indexOf(segIdx)
    if (localIdx < 0) continue
    const emb = embeddings[localIdx]
    if (!emb) continue
    if (!nameToEmbeddings[name]) nameToEmbeddings[name] = []
    nameToEmbeddings[name].push(emb)
  }

  const speakerNames = Object.keys(nameToEmbeddings)
  if (speakerNames.length === 0) {
    throw new Error('所有 seeds 都無法抽取有效 embedding (segments 太短)')
  }

  // v1.21.4: 為每個 speaker 取 trimmed mean centroid
  //   - 3 個以上 seeds：去掉最高 / 最低 cosine 的 outliers，取中間值的平均 (robust)
  //   - 1-2 個 seeds：取所有 seeds 的 simple mean
  //   - 這個改進解決了「同一句重覆標記的 seed 拉偏 centroid」與「無關句子（背景音、咳嗽）拉偏 centroid」兩個問題
  //   - 對大多數實際場景，3-5 個乾淨的 seeds 已足夠，10+ 個 seeds 的邊際效益遞減
  const centroids = {} // name → Float32Array
  const centroidInfo = {} // name → { seedCount, usedCount, droppedCount, internalCoherence }
  for (const name of speakerNames) {
    const embs = nameToEmbeddings[name]
    const seedCount = embs.length
    let used = embs
    let dropped = 0
    let internalCoherence = 1.0
    if (seedCount >= 3) {
      // trimmed mean：對所有 seed embeddings 兩兩算 cosine，取每個 seed 與其他 seed 的平均相似度
      //   去掉平均相似度最低與最高各一個 (outlier)
      const avgSimPerEmb = embs.map((e, i) => {
        let s = 0; let c = 0
        for (let j = 0; j < embs.length; j++) { if (i === j) continue; s += cosineSimilarity(e, embs[j]); c++ }
        return c > 0 ? s / c : 1
      })
      // 計算內部一致性：全體 seed 與 mean 的平均 cosine
      let ssum = 0; for (let i = 0; i < embs.length; i++) ssum += avgSimPerEmb[i]
      internalCoherence = ssum / embs.length
      // 排序取中間部分
      const sorted = avgSimPerEmb.map((s, i) => ({ s, i })).sort((a, b) => a.s - b.s)
      const dropN = Math.min(1, Math.floor(seedCount / 4)) // 取上四分之一個 outliers
      const dropSet = new Set([...sorted.slice(0, dropN).map(x => x.i), ...sorted.slice(-dropN).map(x => x.i)])
      used = embs.filter((_, i) => !dropSet.has(i))
      dropped = dropSet.size
    }
    const dim = embs[0].length
    const avg = new Float32Array(dim)
    for (const e of used) for (let i = 0; i < dim; i++) avg[i] += e[i]
    let norm = 0
    for (let i = 0; i < dim; i++) norm += avg[i] * avg[i]
    norm = Math.sqrt(norm)
    if (norm > 0) for (let i = 0; i < dim; i++) avg[i] /= norm
    centroids[name] = avg
    centroidInfo[name] = { seedCount, usedCount: used.length, droppedCount: dropped, internalCoherence }
  }

  // 對每個 segment 計算最高 cosine，>= threshold 標為該 speaker name；否則留空字串
  // 同時保留使用者原本標註的 seeds (idx in seeds)，不覆蓋
  // v1.21.3: 同時把 cosine 相似度存入 .score 給前端 UI 顯示
  const seedIdxSet = new Set(seeds.map(s => s.idx))
  const seedNameByIdx = new Map(seeds.map(s => [s.idx, s.name]))
  const result = segments.map((seg, idx) => {
    if (seedIdxSet.has(idx)) {
      // 保留使用者原標註 (且確保有 name 字串) — seed 本身的 score 設為 1.0 (與自己完全匹配)
      return { ...seg, speaker: seedNameByIdx.get(idx) || seg.speaker || '', score: 1.0 }
    }
    const localIdx = validIndices.indexOf(idx)
    const emb = localIdx >= 0 ? embeddings[localIdx] : null
    if (!emb) return { ...seg, speaker: '', score: 0 }
    let bestName = ''
    let bestSim = -1
    for (const name of speakerNames) {
      const sim = cosineSimilarity(emb, centroids[name])
      if (sim > bestSim) { bestSim = sim; bestName = name }
    }
    return { ...seg, speaker: bestSim >= threshold ? bestName : '', score: Math.max(0, bestSim) }
  })

  // 填補無 embedding / 低於閾值的 segment：繼承前後已標的 speaker (常見情境)
  let lastSpeaker = ''
  let lastScore = 0
  for (let i = 0; i < result.length; i++) {
    if (result[i].speaker) { lastSpeaker = result[i].speaker; lastScore = result[i].score }
    else if (lastSpeaker) { result[i].speaker = lastSpeaker; result[i].score = lastScore }
  }
  let nextSpeaker = ''
  let nextScore = 0
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].speaker) { nextSpeaker = result[i].speaker; nextScore = result[i].score }
    else if (nextSpeaker) { result[i].speaker = nextSpeaker; result[i].score = nextScore }
  }
  for (let i = 0; i < result.length; i++) {
    if (!result[i].speaker) result[i].speaker = 'Speaker_1'
  }

  // v1.21.4: 回傳 segments + centroidInfo（讓 UI 看到 internalCoherence / droppedCount / seedCount）
  return { segments: result, centroidInfo }
}

/**
 * v1.23.0: 從一組 embeddings 建立 speaker profile 的 trimmed mean centroid
 *   與 propagateSpeakers 內的 centroid 計算邏輯相同
 *   但回傳 profile 物件供 speakerProfile.js 持久化
 */
function _computeCentroidFromEmbeddings(embs) {
  if (!embs || embs.length === 0) return null
  const seedCount = embs.length
  let used = embs
  let dropped = 0
  let internalCoherence = 1.0
  if (seedCount >= 3) {
    const avgSimPerEmb = embs.map((e, i) => {
      let s = 0, c = 0
      for (let j = 0; j < embs.length; j++) { if (i === j) continue; s += cosineSimilarity(e, embs[j]); c++ }
      return c > 0 ? s / c : 1
    })
    let ssum = 0; for (let i = 0; i < embs.length; i++) ssum += avgSimPerEmb[i]
    internalCoherence = ssum / embs.length
    const sorted = avgSimPerEmb.map((s, i) => ({ s, i })).sort((a, b) => a.s - b.s)
    const dropN = Math.min(1, Math.floor(seedCount / 4))
    const dropSet = new Set([...sorted.slice(0, dropN).map(x => x.i), ...sorted.slice(-dropN).map(x => x.i)])
    used = embs.filter((_, i) => !dropSet.has(i))
    dropped = dropSet.size
  }
  const dim = embs[0].length
  const avg = new Float32Array(dim)
  for (const e of used) for (let i = 0; i < dim; i++) avg[i] += e[i]
  let norm = 0
  for (let i = 0; i < dim; i++) norm += avg[i] * avg[i]
  norm = Math.sqrt(norm)
  if (norm > 0) for (let i = 0; i < dim; i++) avg[i] /= norm
  return {
    centroid: Array.from(avg),
    samples: embs.length,
    usedCount: used.length,
    droppedCount: dropped,
    internalCoherence,
    dim,
  }
}

/**
 * v1.23.0: 從 seeds 建立 speaker profile
 *   與 propagateSpeakers 共享 trimmed mean centroid 邏輯
 *   回傳的 profile 物件可直接傳給 speakerProfile.saveProfile()
 */
async function buildProfile(audioPath, segments, seeds, modelKey) {
  if (!fs.existsSync(audioPath)) throw new Error(`音檔不存在: ${audioPath}`)
  if (!Array.isArray(seeds) || seeds.length === 0) {
    throw new Error('seeds 不可為空')
  }
  if (!modelKey) modelKey = currentModelKey
  await _ensureModelLoaded(modelKey)
  const { embeddings, validIndices } = await _extractAllEmbeddings(audioPath, segments, null)

  // 收集該 name 的所有 seed embeddings
  const nameToEmbeddings = {}
  for (const seed of seeds) {
    const segIdx = seed.idx
    const name = seed.name
    if (!name) continue
    const localIdx = validIndices.indexOf(segIdx)
    if (localIdx < 0) continue
    const emb = embeddings[localIdx]
    if (!emb) continue
    if (!nameToEmbeddings[name]) nameToEmbeddings[name] = []
    nameToEmbeddings[name].push(emb)
  }
  if (Object.keys(nameToEmbeddings).length === 0) {
    throw new Error('所有 seeds 都無法抽取有效 embedding')
  }
  // 為每個 name 各自建 profile
  const results = []
  for (const [name, embs] of Object.entries(nameToEmbeddings)) {
    if (embs.length < 2) {
      console.warn(`[voiceprint] buildProfile: ${name} 只有 ${embs.length} 個樣本，可能不可靠`)
    }
    const result = _computeCentroidFromEmbeddings(embs)
    results.push({
      name,
      modelKey,
      dim: result.dim,
      centroid: result.centroid,
      samples: result.samples,
      usedCount: result.usedCount,
      droppedCount: result.droppedCount,
      internalCoherence: result.internalCoherence,
      source: `recording:${path.basename(audioPath)}`,
    })
  }
  return results
}

/**
 * v1.23.0: 從獨立短音檔建立 profile
 *   整段音檔視為單一 speaker
 *   回傳單一 profile
 */
async function buildProfileFromAudioFile(audioPath, name, modelKey) {
  if (!fs.existsSync(audioPath)) throw new Error(`音檔不存在: ${audioPath}`)
  if (!name || !name.trim()) throw new Error('name 不可為空')
  if (!modelKey) modelKey = currentModelKey
  await _ensureModelLoaded(modelKey)
  const pcm = await extractSegmentPcm(audioPath, 0, 999999, null)
  if (!pcm || pcm.length < 4800) {
    throw new Error('音檔太短（< 0.3 秒），無法抽取 embedding')
  }
  const emb = await extractEmbedding(pcm)
  if (!emb) throw new Error('embedding 抽取失敗')
  return {
    name: name.trim(),
    modelKey,
    dim: emb.length,
    centroid: emb,
    samples: 1,
    usedCount: 1,
    droppedCount: 0,
    internalCoherence: 1.0,
    source: `audio_file:${path.basename(audioPath)}`,
  }
}

/**
 * v1.23.0: 有監督式 speaker identification
 *   對 audioPath 抽取所有 segment embeddings，與 profiles 比對
 *   profiles: [{ id, name, centroid, dim, modelKey }, ...]
 *   options: { progressCallback, threshold }
 *   回傳 { segments: [{ start, end, speaker, score }], matches: [...] }
 */
async function identifySpeakers(audioPath, segments, profiles, options = {}) {
  const { progressCallback, threshold = PROPAGATE_MIN_THRESHOLD } = options
  if (!fs.existsSync(audioPath)) throw new Error(`音檔不存在: ${audioPath}`)
  if (!segments || segments.length === 0) return { segments: [], matches: [] }
  if (!Array.isArray(profiles) || profiles.length === 0) {
    return { segments: segments.map(s => ({ ...s, speaker: '', score: 0 })), matches: [] }
  }
  // 用第一個 profile 的 modelKey 決定要載入哪個模型
  const modelKey = profiles[0].modelKey || currentModelKey
  await _ensureModelLoaded(modelKey)
  const { embeddings, validIndices } = await _extractAllEmbeddings(audioPath, segments, progressCallback)

  // 過濾出同 modelKey 的 profiles
  const validProfiles = profiles.filter(p => p.modelKey === modelKey)
  if (validProfiles.length === 0) {
    console.warn(`[voiceprint] identifySpeakers: 沒有 modelKey=${modelKey} 的 profile`)
    return { segments: segments.map(s => ({ ...s, speaker: '', score: 0 })), matches: [] }
  }

  const result = segments.map((seg) => ({ ...seg, speaker: '', score: 0 }))
  const matches = []  // 統計：每個 profile 匹配幾個 segments
  for (let i = 0; i < validIndices.length; i++) {
    const localIdx = validIndices.indexOf(validIndices[i])
    const emb = embeddings[localIdx]
    if (!emb) continue
    let bestName = ''
    let bestSim = -1
    for (const p of validProfiles) {
      if (!Array.isArray(p.centroid) || p.centroid.length !== emb.length) continue
      const sim = cosineSimilarity(emb, p.centroid)
      if (sim > bestSim) { bestSim = sim; bestName = p.name }
    }
    if (bestSim >= threshold) {
      result[validIndices[i]].speaker = bestName
      result[validIndices[i]].score = Math.max(0, bestSim)
      matches.push({ idx: validIndices[i], profile: bestName, score: bestSim })
    }
  }
  // 填補
  let lastSpeaker = '', lastScore = 0
  for (let i = 0; i < result.length; i++) {
    if (result[i].speaker) { lastSpeaker = result[i].speaker; lastScore = result[i].score }
    else if (lastSpeaker) { result[i].speaker = lastSpeaker; result[i].score = lastScore }
  }
  let nextSpeaker = '', nextScore = 0
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].speaker) { nextSpeaker = result[i].speaker; nextScore = result[i].score }
    else if (nextSpeaker) { result[i].speaker = nextSpeaker; result[i].score = nextScore }
  }
  return { segments: result, matches, modelKey }
}

module.exports = {
  // v1.22.0: 多模型 API
  listModels,
  importModel,
  setActiveModel,
  getCurrentModel,
  isModelCached,
  downloadModel,
  loadModel,
  resetModel,
  diarizeAudio,
  propagateSpeakers,
  extractEmbedding,
  extractSegmentPcm,
  clusterEmbeddings,
  cosineSimilarity,
  getAudioDuration,
  MODEL_REGISTRY,  // v1.22.0: 暴露 registry 供 IPC handler 訪問模型元資料
  // v1.21.0: exported for IPC handlers' sanity check
  PROPAGATE_MIN_THRESHOLD,
  // v1.23.0: 有監督 speaker recognition
  buildProfile,
  buildProfileFromAudioFile,
  identifySpeakers,
  _computeCentroidFromEmbeddings,  // 內部 helper，給 buildProfile 用
}
