// test_data/test_diarize.js
// v1.20.12: 聲紋測試機制 — 驗證 voiceprint.diarizeAudio() 是否能分辨不同說話人
// 用法：node test_data/test_diarize.js
//      或：node test_data/test_diarize.js <path-to-audio>
//
// 流程：
//   1. 將輸入音檔 (webm/wav/m4a...) 透過 ffmpeg 轉為 16kHz mono WAV (前置必要)
//   2. 用 whisper-cli (tiny 模型) 跑辨識，產出 JSON segments
//   3. 將 segments 餵給 voiceprint.diarizeAudio() 做說話者聚類
//   4. 統計結果：總人數、每個 speaker 的 segment 數、依序的 speaker 序列

const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

const voiceprint = require('../frontend/electron/voiceprint')

const DEFAULT_AUDIO = path.resolve(__dirname, 'recoder_record_1782185376695.webm')
const AUDIO_PATH = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_AUDIO

const PROJECT_ROOT = path.resolve(__dirname, '..')
const FFMPEG_EXE = path.join(PROJECT_ROOT, 'ffmpeg', 'ffmpeg.exe')
const WHISPER_DIR = path.join(PROJECT_ROOT, 'whisper_cli')
const WHISPER_EXE = path.join(WHISPER_DIR, 'whisper-cli.exe')
const MODEL_TINY = path.join(PROJECT_ROOT, 'model', 'ggml-tiny.bin')

function runFfmpegToWav(input, output) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(FFMPEG_EXE)) return reject(new Error(`找不到 ffmpeg.exe: ${FFMPEG_EXE}`))
    const proc = spawn(FFMPEG_EXE, ['-y', '-i', input, '-ar', '16000', '-ac', '1', '-sample_fmt', 's16', output], {
      windowsHide: true,
    })
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve(output)
      else reject(new Error(`ffmpeg exit=${code}: ${stderr.slice(-300)}`))
    })
    proc.on('error', reject)
  })
}

function runWhisperSegments(wavPath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(WHISPER_EXE)) return reject(new Error(`找不到 whisper-cli.exe: ${WHISPER_EXE}`))
    if (!fs.existsSync(MODEL_TINY)) return reject(new Error(`找不到模型: ${MODEL_TINY}`))
    const outputJson = path.join(require('os').tmpdir(), `test_diarize_${Date.now()}.json`)
    const proc = spawn(
      WHISPER_EXE,
      ['-m', MODEL_TINY, '-f', wavPath, '--output-json', '-oj', outputJson, '-l', 'auto', '-t', String(require('os').cpus().length), '-bs', '1', '-bo', '1'],
      { cwd: WHISPER_DIR, windowsHide: true }
    )
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('close', (code) => {
      // try target file then fallback to wav+'.json'
      let jsonPath = outputJson
      if (!fs.existsSync(jsonPath)) {
        const alt = wavPath + '.json'
        if (fs.existsSync(alt)) jsonPath = alt
        else return reject(new Error(`whisper-cli exit=${code}; JSON not found: ${stderr.slice(-300)}`))
      }
      try {
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
        try { fs.unlinkSync(jsonPath) } catch {}
        const segments = (data.transcription || []).map((s) => ({
          start: (s.offsets && s.offsets.from ? s.offsets.from : 0) / 1000,
          end: (s.offsets && s.offsets.to ? s.offsets.to : 0) / 1000,
          text: (s.text || '').trim(),
        }))
        resolve({ segments, raw: data })
      } catch (e) { reject(e) }
    })
    proc.on('error', reject)
  })
}

function fmtTime(sec) {
  if (!isFinite(sec)) return '--:--'
  const m = Math.floor(sec / 60); const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

async function main() {
  console.log('===== 聲紋測試：', AUDIO_PATH, '=====')
  if (!fs.existsSync(AUDIO_PATH)) {
    console.error('找不到輸入音檔:', AUDIO_PATH)
    process.exit(1)
  }
  if (fs.statSync(AUDIO_PATH).size < 1024) {
    console.error('音檔太小 (<1KB)，可能損壞')
    process.exit(1)
  }

  // 預先檢查 whisper 模型
  if (!fs.existsSync(MODEL_TINY)) {
    console.error('找不到 whisper tiny 模型:', MODEL_TINY)
    console.error('請先下載 (在 App 設定面板執行，或自 https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin)')
    process.exit(1)
  }

  // 預先檢查聲紋模型
  if (!voiceprint.isModelCached()) {
    console.log('▶ 聲紋模型未快取，先下載…')
    try {
      await voiceprint.downloadModel((p) => {
        if (p % 20 === 0) process.stdout.write(`  下載進度 ${p}%\r`)
      })
      console.log('\n▶ 聲紋模型下載完成')
    } catch (e) {
      console.error('聲紋模型下載失敗:', e.message)
      process.exit(1)
    }
  } else {
    console.log('▶ 聲紋模型已存在，跳過下載')
  }

  // Step 1: webm/wav → 16k mono WAV
  const tmpWav = path.join(require('os').tmpdir(), `test_diarize_${Date.now()}.wav`)
  console.log('\n[Step 1] ffmpeg 轉檔:', path.basename(AUDIO_PATH), '→', path.basename(tmpWav))
  try {
    await runFfmpegToWav(AUDIO_PATH, tmpWav)
    console.log('  ✓ 轉檔成功')
  } catch (e) {
    console.error('ffmpeg 轉檔失敗:', e.message)
    process.exit(1)
  }

  // Step 2: whisper-cli 跑出 segments
  console.log('\n[Step 2] whisper-cli 跑辨識 (tiny 模型)…')
  let segments = []
  try {
    const t0 = Date.now()
    const result = await runWhisperSegments(tmpWav)
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    segments = result.segments
    console.log(`  ✓ 辨識完成：${segments.length} 句，耗時 ${elapsed}s`)
    if (segments.length === 0) {
      console.error('辨識結果為 0 句，可能是純靜音或過短音檔')
      process.exit(1)
    }
    // 顯示前 3 句
    segments.slice(0, 3).forEach((s, i) => {
      console.log(`    [${i}] ${fmtTime(s.start)}-${fmtTime(s.end)}: ${s.text.slice(0, 60)}`)
    })
    if (segments.length > 3) console.log(`    … 還有 ${segments.length - 3} 句`)
  } catch (e) {
    console.error('whisper 辨識失敗:', e.message)
    process.exit(1)
  }

  // Step 3: voiceprint.diarizeAudio() 聚類
  console.log('\n[Step 3] voiceprint.diarizeAudio() 說話者標註…')
  let diarized = []
  try {
    const t0 = Date.now()
    diarized = await voiceprint.diarizeAudio(tmpWav, segments, (percent) => {
      if (percent % 20 === 0) process.stdout.write(`  進度 ${percent}%\r`)
    })
    console.log(`\n  ✓ 完成：耗時 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  } catch (e) {
    console.error('diarizeAudio 失敗:', e.message)
    process.exit(1)
  }

  // Step 4: 統計結果
  console.log('\n[Step 4] 統計結果')
  const speakerCounts = {}    // Speaker_X => 段數
  const speakerSeq = []       // 依段時間序
  let prev = null
  diarized.forEach((s, i) => {
    const sp = s.speaker || '?'
    speakerCounts[sp] = (speakerCounts[sp] || 0) + 1
    if (sp !== prev) {
      speakerSeq.push(`${fmtTime(s.start)}→${sp}`)
      prev = sp
    }
  })
  const speakers = Object.keys(speakerCounts).sort()
  console.log(`  總段數：${diarized.length}`)
  console.log(`  不同 speaker 數：${speakers.length}`)
  console.log(`  Speaker 分布：`)
  speakers.forEach((sp) => console.log(`    ${sp}: ${speakerCounts[sp]} 段 (${((speakerCounts[sp] / diarized.length) * 100).toFixed(1)}%)`))

  console.log(`  依時間序的 speaker 切換序列（${speakerSeq.length} 次切換）：`)
  speakerSeq.slice(0, 20).forEach((l) => console.log(`    ${l}`))
  if (speakerSeq.length > 20) console.log(`    … 還有 ${speakerSeq.length - 20} 次切換`)

  // 全段詳細列表 (用于人工診斷：看句子內容長短 + 對應 speaker 標籤)
  console.log('\n[Step 5] 每段 speaker 標籤 (可手動判斷同一個人是否重复出現)')
  const maxShow = 50
  diarized.slice(0, maxShow).forEach((s, i) => {
    const tag = (s.speaker || '?').padEnd(12)
    console.log(`    [${i.toString().padStart(2, '0')}] ${fmtTime(s.start)}-${fmtTime(s.end)} ${tag} ${s.text.slice(0, 80)}`)
  })
  if (diarized.length > maxShow) console.log(`    ... 還有 ${diarized.length - maxShow} 段`)

  // 評估
  console.log('\n===== 評估 =====')
  if (speakers.length === 1) {
    console.log('⚠ 只辨識出 1 個 speaker。可能是：(a) 音檔本來只有 1 個人 (b) 有多人但聲紋太接近未能分辨')
    console.log('   對照上方的句子列表手動判斷是否同一個人重複。若明显有兩個不同人聲但都是 Speaker_1，')
    console.log('   表示 clusterEmbeddings 的 threshold=0.5 仍太鬆，需要調低。')
  } else if (speakers.length >= 2) {
    console.log(`✓ 成功辨識 ${speakers.length} 個不同 speaker`)
  }
  if (speakerSeq.length > 1) {
    console.log(`✓ speaker 依時間序切換了 ${speakerSeq.length} 次`)
  }

  // 清理暫存
  try { fs.unlinkSync(tmpWav) } catch {}
}

main().catch((e) => { console.error('未預期錯誤:', e); process.exit(1) })