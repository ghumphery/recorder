// v1.20.9: 共用音檔切片模組
// - 提供 getAudioDuration() 與 splitLongAudio()，給 whisper (main.js) 與 voiceprint (voiceprint.js) 共用
// - 支援自訂門檻、chunk 大小、輸出目錄
// - chunk 跑完後由呼叫端負責 fs.rmSync 刪除

const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn } = require('child_process')

// 取得 ffmpeg/ffprobe 路徑（dev + 打包後環境）
function getFfmpegPath() {
  const ffmpeg = path.join(path.dirname(require.main?.filename || __dirname), '..', '..', 'ffmpeg', 'ffmpeg.exe')
  const resourceFfmpeg = path.join(process.resourcesPath || '', 'ffmpeg', 'ffmpeg.exe')
  if (fs.existsSync(ffmpeg)) return ffmpeg
  if (fs.existsSync(resourceFfmpeg)) return resourceFfmpeg
  return 'ffmpeg.exe'
}

/**
 * 取得音檔時長（透過 ffmpeg stderr 的 Duration: HH:MM:SS.xx）
 * @param {string} audioPath
 * @returns {Promise<number>} 秒數（無法取得回傳 0）
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
 * 計算單一 chunk 檔的時長（透過 ffmpeg stderr）
 */
function getChunkDuration(fp) {
  return new Promise((resolve) => {
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
  })
}

/**
 * 將長音檔切成多個 WAV chunks
 * @param {string} audioPath
 * @param {Object} options
 * @param {number} options.segmentSec 每個 chunk 的最大秒數（預設 3000 = 50 分鐘）
 * @param {string} [options.outputDir] 輸出目錄（預設 mkdtempSync 在 os.tmpdir()）
 * @param {string} [options.prefix] chunk 檔名前綴（預設 'chunk'）
 * @returns {Promise<{tmpDir: string, files: string[], durations: number[]}>}
 */
function splitLongAudio(audioPath, options = {}) {
  const segmentSec = options.segmentSec || 3000
  const prefix = options.prefix || 'chunk'
  const outputDir = options.outputDir || fs.mkdtempSync(path.join(os.tmpdir(), 'recoder-chunks-'))
  const pattern = path.join(outputDir, `${prefix}_%03d.wav`)
  return new Promise((resolve, reject) => {
    const ffmpegPath = getFfmpegPath()
    const proc = spawn(ffmpegPath, [
      '-y', '-i', audioPath,
      '-ar', '16000', '-ac', '1', '-sample_fmt', 's16',
      '-f', 'segment',
      '-segment_time', String(segmentSec),
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
      const files = fs.readdirSync(outputDir)
        .filter(f => f.startsWith(prefix) && f.endsWith('.wav'))
        .map(f => path.join(outputDir, f))
        .sort()
      if (files.length === 0) {
        reject(new Error('ffmpeg 切片完成但未產生任何 chunk'))
        return
      }
      Promise.all(files.map(getChunkDuration)).then((durations) => {
        resolve({ tmpDir: outputDir, files, durations })
      }).catch(reject)
    })
    proc.on('error', (e) => reject(e))
  })
}

/**
 * 將 chunks 與時長陣列配對成 [{file, startOffset, endOffset}] 結構
 * @param {string[]} files chunk 檔路徑
 * @param {number[]} durations 每個 chunk 的時長
 */
function pairChunks(files, durations) {
  const list = []
  let offset = 0
  for (let i = 0; i < files.length; i++) {
    const dur = durations[i] || 0
    list.push({ file: files[i], startOffset: offset, endOffset: offset + dur })
    offset += dur
  }
  return list
}

/**
 * 依設定判斷是否需要切片；若需要就切片並回傳 chunkList；不需要則回傳 null
 * @param {string} audioPath
 * @param {Object} options
 * @param {number} options.thresholdSec 超過此秒數才切片（0 或 undefined 表示不切片）
 * @param {number} options.segmentSec 每個 chunk 的最大秒數
 * @param {string} [options.prefix] chunk 檔名前綴
 * @returns {Promise<null | {chunks: Array, totalDuration: number, wasSplit: boolean, tmpDir: string}>}
 */
async function chunkLongAudioIfNeeded(audioPath, options = {}) {
  const thresholdSec = options.thresholdSec || 0
  const segmentSec = options.segmentSec || 3000
  const prefix = options.prefix || 'chunk'

  const totalDuration = await getAudioDuration(audioPath)
  if (!thresholdSec || totalDuration < thresholdSec) {
    return null
  }
  const split = await splitLongAudio(audioPath, { segmentSec, prefix })
  const chunks = pairChunks(split.files, split.durations)
  return { chunks, totalDuration, wasSplit: true, tmpDir: split.tmpDir }
}

/**
 * 安全刪除 chunk 暫存目錄
 * @param {string|null} dir
 */
function cleanupChunkDir(dir) {
  if (!dir) return
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch (e) {
    console.error('[audioChunker] 清理 chunk 目錄失敗: ' + e.message)
  }
}

/**
 * 啟動時清掉所有殘留的 recoder-chunks-* / voiceprint-chunk-* 暫存目錄
 */
function cleanupStaleChunks() {
  const tmp = os.tmpdir()
  try {
    const entries = fs.readdirSync(tmp)
    for (const e of entries) {
      if (/^(recoder-chunks-|voiceprint-chunk-)/.test(e)) {
        try {
          fs.rmSync(path.join(tmp, e), { recursive: true, force: true })
        } catch (_) {}
      }
    }
  } catch (e) {
    console.error('[audioChunker] 清理 stale chunks 失敗: ' + e.message)
  }
}

module.exports = {
  getFfmpegPath,
  getAudioDuration,
  splitLongAudio,
  chunkLongAudioIfNeeded,
  cleanupChunkDir,
  cleanupStaleChunks,
  pairChunks,
}