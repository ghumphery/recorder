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
const MODEL_SMALL = 'C:\\Users\\humphery\\recoder\\model\\ggml-small.bin'
// 看 small model 是否在使用者安裝時其他位置
const MODEL_SMALL_FALLBACKS = [
  MODEL_SMALL,
  path.join(os.homedir(), 'recoder', 'model', 'ggml-small.bin'),
  path.join(PROJECT_ROOT, 'model', 'ggml-small.bin'),
]
const _os = require('os')
const _path = require('path')
function resolveSmallModel() {
  for (const p of MODEL_SMALL_FALLBACKS) {
    try { if (_path && require('fs').existsSync(p)) return p } catch (_) {}
  }
  return MODEL_SMALL
}

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

function runWhisperSegments(wavPath, modelPath = MODEL_TINY, suffix = 'tiny') {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(WHISPER_EXE)) return reject(new Error(`找不到 whisper-cli.exe: ${WHISPER_EXE}`))
    if (!fs.existsSync(modelPath)) return reject(new Error(`找不到 whisper 模型: ${modelPath}`))
    const outputJson = path.join(require('os').tmpdir(), `test_diarize_${suffix}_${Date.now()}.json`)
    const proc = spawn(
      WHISPER_EXE,
      ['-m', modelPath, '-f', wavPath, '--output-json', '-oj', outputJson, '-l', 'auto', '-t', String(require('os').cpus().length), '-bs', '1', '-bo', '1'],
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
    console.log('⚠ 只辨識出 1 個 speaker。執行 embedding 兩兩相似度分析診斷')
  } else if (speakers.length >= 2) {
    console.log(`✓ 成功辨識 ${speakers.length} 個不同 speaker`)
  }
  if (speakerSeq.length > 1) {
    console.log(`✓ speaker 依時間序切換了 ${speakerSeq.length} 次`)
  }

  // [Step 6] 深度診斷：以 voiceprint 會用的同一條路 (extractSegmentPcm → extractEmbedding → cosineSimilarity)
  // 對語者長 >=1.5s 的 segment 均勻抽 8 個，計算兩兩相似度矩陣，
  // 並用 clusterEmbeddings 多個 threshold 跑，決定 threshold 該調到哪個數值。
  console.log('\n[Step 6] embedding 兩兩相似度診斷 (拷貝 voiceprint 真實路徑)')
  try {
    const { extractSegmentPcm, extractEmbedding, cosineSimilarity, clusterEmbeddings } = voiceprint
    const audioDuration = await voiceprint.getAudioDuration(tmpWav)
    console.log(`  音檔總長: ${audioDuration.toFixed(1)}s`)

    // 1. 取段的抽取 (跟 diarizeAudio 裡一模一樣)
    const longEnough = diarized
      .map((s, i) => ({ ...s, _idx: i }))
      .filter((s) => (s.end - s.start) >= 1.5)
    if (longEnough.length < 4) throw new Error('太少長段可供診斷')

    // 均勻抽 8 個 segment 的 PCM + embedding
    const targetSamples = Math.min(8, longEnough.length)
    const stride = Math.max(1, Math.floor(longEnough.length / targetSamples))
    const samples = []
    for (let i = 0; i < longEnough.length && samples.length < targetSamples; i += stride) {
      samples.push(longEnough[i])
    }
    console.log(`  抽 ${samples.length} 個 segment的 PCM+embedding`)
    const embs = []
    for (const seg of samples) {
      const t0 = Date.now()
      let pcm
      try {
        pcm = await extractSegmentPcm(tmpWav, seg.start, seg.end, audioDuration)
      } catch (e) {
        console.log(`    [${seg._idx}] ✗ extractSegmentPcm 失敗: ${e.message}`)
        continue
      }
      if (!pcm || pcm.length === 0) {
        console.log(`    [${seg._idx}] ✗ 拿到空 PCM (seg ${fmtTime(seg.start)}-${fmtTime(seg.end)})`)
        continue
      }
      let emb
      try {
        emb = await extractEmbedding(pcm)
      } catch (e) {
        console.log(`    [${seg._idx}] ✗ extractEmbedding 失敗: ${e.message}`)
        continue
      }
      const dt = Date.now() - t0
      if (emb) {
        embs.push({ seg, emb })
        console.log(`    [${seg._idx}] ✓ ${fmtTime(seg.start)}-${fmtTime(seg.end)} (pcm=${pcm.length}B, emb=${emb.length}d, ${dt}ms) ${seg.text.slice(0, 50)}`)
      } else {
        console.log(`    [${seg._idx}] ✗ extractEmbedding 返 null (pcm=${pcm.length}B) ${seg.text.slice(0, 50)}`)
      }
    }

    // 2. 兩兩相似度矩陣
    const cos = (a, b) => (a && b ? cosineSimilarity(a, b) : null)
    const n = embs.length
    console.log('  cosine similarity 矩陣（對角線 =1, 越接近 1 = 越像）:')
    console.log('       ' + embs.map((_, i) => `[${i.toString().padStart(2, '0')}]`).join(' '))
    for (let i = 0; i < n; i++) {
      const row = [`[${i.toString().padStart(2, '0')}] `]
      for (let j = 0; j < n; j++) {
        const v = cos(embs[i].emb, embs[j].emb)
        row.push((i === j ? '  1.00 ' : ` ${(v || 0).toFixed(2)} `))
      }
      console.log('       ' + row.join('').trim())
    }

    // 3. off-diagonal 統計
    let sum = 0, cnt = 0, minVal = 1, maxVal = -1
    const pairs = []
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const v = cos(embs[i].emb, embs[j].emb)
        sum += v; cnt++
        if (v < minVal) minVal = v
        if (v > maxVal) maxVal = v
        pairs.push({ i, j, sim: v })
      }
    }
    const avg = sum / cnt
    console.log(`  off-diagonal 平均: ${avg.toFixed(3)}, 最小: ${minVal.toFixed(3)}, 最大: ${maxVal.toFixed(3)}`)
    console.log('  依序 off-diagonal 相似度:')
    pairs.sort((a, b) => a.sim - b.sim).forEach((p) => console.log(`    [${p.i}-${p.j}] sim=${p.sim.toFixed(3)}`))

    // 4. 用多個 threshold 跑 clusterEmbeddings，找出能正確分辨「一男一女」的 threshold
    const validEmbs = embs.map((e) => e.emb)
    if (validEmbs.length >= 2) {
      console.log('\n  不同 threshold 下的分類數:')
      ;[0.6, 0.5, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15].forEach((thr) => {
        const labels = clusterEmbeddings(validEmbs, thr)
        const unique = new Set(labels).size
        console.log(`    threshold=${thr.toFixed(2)}: ${unique} 群 (${labels.join(', ')})`)
      })
    }

    // 5. 最終判定
    console.log('\n===== 診斷結論 =====')
    if (avg >= 0.55 && minVal >= 0.4) {
      console.log('  樣本間相似度都偏高 → 實際上可能真的只有 1 個人')
    } else if (avg <= 0.4 && minVal <= 0.2 && maxVal >= 0.5) {
      console.log('  相似度分布廣，低低高高都有 → 裡面同時有不同人，threshold 0.5 太鬆')
    } else {
      console.log('  要看上面 pairs 列表，才能判斷是僅一個人還是有多人')
    }
  } catch (e) {
    console.log('  診斷失敗:', e.message)
  }

  // [Step 7] 重試：將 segments 合併到 ≥3s 再餵給 voiceprint.diarizeAudio()
  // 原因：v1.20.12 修了 input name + DML fallback bug 後，發現原問題是 whisper
  // tiny/base 把切割太碎 (1-3s)讓 ONNX AveragePool 在太短的 numFrames 失敗。
  // 根原不是 diarize 路 path，而是 whisper segment 粒度。
  console.log('\n[Step 7] 合併 segments (>=3s) 重試驗證二說話者辨識效果')
  try {
    const mergeSegments = (segs, minSec) => {
      const out = []
      let buf = null
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i]
        if (!buf) {
          buf = { start: seg.start, end: seg.end, text: seg.text, _origIdx: [i] }
        } else {
          buf.end = seg.end
          buf.text += ' ' + seg.text
          buf._origIdx.push(i)
        }
        if (buf.end - buf.start >= minSec) {
          out.push(buf)
          buf = null
        }
      }
      if (buf) out.push(buf)
      return out
    }
    const mergedSegs = mergeSegments(segments, 3)
    console.log(`  合併: ${segments.length} 個 whisper segments → ${mergedSegs.length} 個合併段`)
    console.log('  合併段列表 (前 8 個)：')
    mergedSegs.slice(0, 8).forEach((s, i) => {
      console.log(`    [${i}] ${fmtTime(s.start)}-${fmtTime(s.end)} (${(s.end - s.start).toFixed(1)}s) ${s.text.slice(0, 50).trim()}`)
    })

    const t0 = Date.now()
    const diarized2 = await voiceprint.diarizeAudio(tmpWav, mergedSegs, (p) => {
      if (p % 20 === 0) process.stdout.write(`  重試進度 ${p}%\r`)
    })
    console.log(`\n  ✓ 重試完成：耗時 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    const speakerCounts2 = {}
    const speakerSeq2 = []
    let prev2 = null
    diarized2.forEach((s) => {
      const sp = s.speaker || '?'
      speakerCounts2[sp] = (speakerCounts2[sp] || 0) + 1
      if (sp !== prev2) {
        speakerSeq2.push(`${fmtTime(s.start)}→${sp}`)
        prev2 = sp
      }
    })
    const speakers2 = Object.keys(speakerCounts2).sort()
    console.log(`  總合併段數：${diarized2.length}`)
    console.log(`  不同 speaker 數：${speakers2.length}`)
    console.log('  Speaker 分布：')
    speakers2.forEach((sp) => console.log(`    ${sp}: ${speakerCounts2[sp]} 段 (${((speakerCounts2[sp] / diarized2.length) * 100).toFixed(1)}%)`))
    console.log(`  Speaker 切換序列（${speakerSeq2.length} 次切換）：`)
    speakerSeq2.forEach((l) => console.log(`    ${l}`))
    if (speakers2.length === 1) {
      console.log('  ⚠ 仍是 1 個 speaker。進一深入診斷請加 probe_averagepool_debug.js')
    } else if (speakers2.length >= 2) {
      console.log(`  ✓ 成功辨識 ${speakers2.length} 個不同 speaker`)
    }
  } catch (e) {
    console.log('  重試失敗:', e.message)
  }

  // 清理暫存
  try { fs.unlinkSync(tmpWav) } catch {}
}

main().catch((e) => { console.error('未預期錯誤:', e); process.exit(1) })