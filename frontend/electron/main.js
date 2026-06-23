const { app, BrowserWindow, dialog, ipcMain, session, desktopCapturer } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')
const https = require('https')
const http = require('http')
const os = require('os')
const OpenCC = require('opencc-js')
const fetch = require('node-fetch')

let mainWindow = null
const s2tConverter = OpenCC.Converter({ from: 'cn', to: 'tw' })

function resourcePath(...parts) {
  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev')
  const base = isDev ? path.join(__dirname, '..', '..') : process.resourcesPath
  return path.join(base, ...parts)
}

function exeDirPath(...parts) {
  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev')
  const base = isDev ? path.join(__dirname, '..', '..') : path.dirname(app.getPath('userData'))
  return path.join(base, ...parts)
}

function userDataPath(...parts) {
  return path.join(os.homedir(), 'recoder', ...parts)
}

function recoDataPath(...parts) {
  try {
    const p = getSettingsPath()
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'))
      if (raw.recoDir) return path.join(raw.recoDir, ...parts)
    }
  } catch (e) {}
  return path.join(os.homedir(), 'recoder', 'reco_data', ...parts)
}

function appLog(level, module, msg) {
  try {
    const logPath = userDataPath('recorder.log')
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.appendFileSync(logPath, `${new Date().toISOString()} [${level}] [${module}] ${msg}\n`)
  } catch (e) {}
}

// ffmpeg 序列化佇列 — 確保同一時間只有一個 ffmpeg 進程在啟動
let ffmpegQueue = Promise.resolve()

function convertAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ext = path.extname(inputPath).toLowerCase()
    if (ext === '.wav') { resolve(inputPath); return }
    const ffmpeg = resourcePath('ffmpeg', 'ffmpeg.exe')
    const out = outputPath || path.join(os.tmpdir(), `recoder_${Date.now()}_converted.wav`)
    const args = ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', '-sample_fmt', 's16', out]
    appLog('INFO', 'ffmpeg', `轉換開始: ${inputPath} → ${out}`)
    // 透過佇列序列化，避免並行 spawn 造成 ENOENT
    ffmpegQueue = ffmpegQueue.then(() => {
      return new Promise((resolveSpawn, rejectSpawn) => {
        const doSpawn = (attempt) => {
          if (!fs.existsSync(ffmpeg)) {
            const errMsg = `ffmpeg.exe 不存在於: ${ffmpeg}`
            appLog('ERROR', 'ffmpeg', errMsg)
            if (attempt < 3) {
              appLog('WARN', 'ffmpeg', `重試 ${attempt + 1}/3...`)
              setTimeout(() => doSpawn(attempt + 1), 500)
              return
            }
            rejectSpawn(new Error(errMsg))
            return
          }
          const proc = spawn(ffmpeg, args, { windowsHide: true })
          let stderr = ''
          proc.stderr.on('data', d => stderr += d.toString())
          proc.on('close', code => {
            if (code === 0) { appLog('INFO', 'ffmpeg', `轉換完成: ${out}`); resolveSpawn(out) }
            else { appLog('ERROR', 'ffmpeg', `轉換失敗 exit=${code}: ${stderr.slice(-200)}`); rejectSpawn(new Error(`ffmpeg exit=${code}`)) }
          })
          proc.on('error', e => {
            appLog('ERROR', 'ffmpeg', `啟動失敗: ${e.message}`)
            if (attempt < 3 && e.code === 'ENOENT') {
              appLog('WARN', 'ffmpeg', `重試 ${attempt + 1}/3...`)
              setTimeout(() => doSpawn(attempt + 1), 500)
              return
            }
            rejectSpawn(e)
          })
        }
        doSpawn(0)
      })
    }).then(result => {
      resolve(result)
    }).catch(err => {
      reject(err)
    })
  })
}

function downloadFile(url, destPath, progressCallback) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    https.get(url, res => {
      if (res.statusCode >= 300 && res.headers.location) {
        file.close(); fs.unlink(destPath, () => {})
        return downloadFile(res.headers.location, destPath, progressCallback).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) { file.close(); fs.unlink(destPath, () => {}); return reject(new Error(`HTTP ${res.statusCode}`)) }
      const total = parseInt(res.headers['content-length'], 10) || 0
      let received = 0
      res.on('data', chunk => {
        received += chunk.length
        if (total > 0 && progressCallback) progressCallback(Math.min(Math.round((received / total) * 100), 99))
      })
      res.pipe(file)
      file.on('finish', () => { file.close(); if (progressCallback) progressCallback(100); resolve(destPath) })
    }).on('error', err => { file.close(); fs.unlink(destPath, () => {}); reject(err) })
  })
}

// ── LLM 模組 ──

const LLM_PROVIDERS = {
  ollama: { name: 'Ollama (本地)', baseUrl: 'http://127.0.0.1:11434', defaultModel: 'llama3' },
  ollama_cloud: { name: 'Ollama Cloud', baseUrl: 'https://ollama.com/v1', defaultModel: 'llama3.2' },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'google/gemma-2-9b-it' },
  siliconflow: { name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', defaultModel: 'Qwen/Qwen2.5-7B-Instruct' },
  gemini: { name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.0-flash' },
}

async function callLLM(provider, apiKey, model, prompt, systemPrompt) {
  const cfg = LLM_PROVIDERS[provider]
  if (!cfg) throw new Error(`不支援的提供商: ${provider}`)
  if (provider !== 'ollama' && (!apiKey || apiKey.trim() === '')) {
    throw new Error(`使用 ${cfg.name} 需要在設定中輸入 API Key`)
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    if (provider === 'ollama') {
      const res = await fetch(`${cfg.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || cfg.defaultModel, prompt, system: systemPrompt, stream: false }),
        signal: controller.signal,
      })
      if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error(`Ollama HTTP ${res.status}: ${body.slice(0, 200)}`) }
      const data = await res.json()
      if (data.error) throw new Error(`Ollama 錯誤: ${data.error}`)
      return data.response || data.message?.content || ''
    }
    if (provider === 'gemini') {
      const url = `${cfg.baseUrl}/models/${model || cfg.defaultModel}:generateContent?key=${apiKey}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: `${systemPrompt}\n\n${prompt}` }] }] }),
        signal: controller.signal,
      })
      if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 200)}`) }
      const data = await res.json()
      if (data.error) throw new Error(`Gemini 錯誤: ${data.error.message || JSON.stringify(data.error)}`)
      return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    }
    const headers = { 'Content-Type': 'application/json' }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST', headers,
      body: JSON.stringify({
        model: model || cfg.defaultModel,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    })
    if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error(`${cfg.name} HTTP ${res.status}: ${body.slice(0, 200)}`) }
    const data = await res.json()
    if (data.error) throw new Error(`${cfg.name} 錯誤: ${data.error.message || JSON.stringify(data.error)}`)
    return data.choices?.[0]?.message?.content || ''
  } finally { clearTimeout(timeout) }
}

// ── 設定檔持久化 ──

const SETTINGS_VERSION = 2

function getSettingsPath() {
  return path.join(os.homedir(), 'recoder', 'settings.json')
}

function migrateSettings(raw) {
  if (!raw.settingsVersion || raw.settingsVersion < 2) {
    const oldKey = raw.llmApiKey || ''
    if (oldKey && (!raw.apiKeys || Object.keys(raw.apiKeys).length === 0)) {
      const providers = ['openrouter', 'siliconflow', 'gemini', 'ollama_cloud']
      const apiKeys = {}
      for (const p of providers) apiKeys[p] = oldKey
      raw.apiKeys = apiKeys
    }
    delete raw.llmApiKey
    raw.settingsVersion = SETTINGS_VERSION
  }
  return raw
}

ipcMain.handle('settings:load', () => {
  try {
    const p = getSettingsPath()
    if (fs.existsSync(p)) { const raw = JSON.parse(fs.readFileSync(p, 'utf-8')); return migrateSettings(raw) }
    return {}
  } catch (e) { return {} }
})

ipcMain.handle('settings:save', (event, settings) => {
  try {
    settings.settingsVersion = SETTINGS_VERSION
    const p = getSettingsPath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(settings, null, 2), 'utf-8')
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
})

// ── 語音辨識通用函式 ──

function runWhisper(audioPath, modelSize, useGpu, gpuDevice) {
  return new Promise((resolve, reject) => {
    try {
      const modelPath = userDataPath('model', `ggml-${modelSize}.bin`)
      const whisperDir = resourcePath('whisper_cli')
      const whisperExe = path.join(whisperDir, 'whisper-cli.exe')
      if (!fs.existsSync(whisperExe)) return resolve({ success: false, error: 'whisper-cli.exe 不存在' })
      if (!fs.existsSync(modelPath)) return resolve({ success: false, error: `模型 ${modelSize} 尚未下載` })
      const outputJson = path.join(os.tmpdir(), `recoder_result_${Date.now()}.json`)
      const args = ['-m', modelPath, '-f', audioPath, '--output-json', '-oj', outputJson, '-l', 'auto', '-t', String(os.cpus().length)]
      if (useGpu === false) args.push('--no-gpu')
      else if (gpuDevice !== undefined && gpuDevice !== '') args.push('-dev', String(gpuDevice))
      const startTime = Date.now()
      const proc = spawn(whisperExe, args, { cwd: whisperDir, windowsHide: true })
      let stderr = ''
      proc.stderr.on('data', d => stderr += d.toString())
      proc.on('close', code => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        let jf = outputJson
        if (!fs.existsSync(jf)) { const alt = audioPath + '.json'; if (fs.existsSync(alt)) jf = alt }
        if (!fs.existsSync(jf)) { return resolve({ success: false, error: stderr.slice(-500) }) }
        try {
          const data = JSON.parse(fs.readFileSync(jf, 'utf-8'))
          const segments = (data.transcription || []).map(s => ({
            start: (s.offsets?.from || 0) / 1000, end: (s.offsets?.to || 0) / 1000,
            text: s2tConverter((s.text || '').trim()), speaker: '',
          }))
          try { fs.unlinkSync(jf) } catch {}
          resolve({ success: true, segments })
        } catch (e) { resolve({ success: false, error: `JSON 解析失敗: ${e.message}` }) }
      })
      proc.on('error', e => resolve({ success: false, error: e.message }))
    } catch (e) { reject(e) }
  })
}

// ── IPC Handler ──

ipcMain.handle('get:version', () => app.getVersion())

ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: '音訊檔案', extensions: ['wav', 'mp3', 'opus', 'ogg', 'flac', 'm4a'] }, { name: '所有檔案', extensions: ['*'] }],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:openDir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:saveFile', async (event, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || '會議記錄.txt',
    filters: [{ name: '純文字', extensions: ['txt'] }, { name: 'Markdown', extensions: ['md'] }],
  })
  return result.canceled ? null : result.filePath
})

ipcMain.handle('import:audio', async (event, { filePath, outputDir }) => {
  appLog('INFO', 'import', `匯入音檔: ${filePath}`)
  try {
    let wavPath
    if (outputDir) {
      const ext = path.extname(filePath).toLowerCase()
      fs.mkdirSync(outputDir, { recursive: true })
      wavPath = path.join(outputDir, `${path.basename(filePath, ext)}_converted.wav`)
    }
    const outPath = await convertAudio(filePath, wavPath)
    const stat = fs.statSync(outPath)
    return { success: true, path: outPath, filename: path.basename(filePath), size: stat.size }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('save:recorded', async (event, { buffer, ext }) => {
  appLog('INFO', 'record', `儲存錄音 (${buffer.length} bytes, .${ext})`)
  try {
    const recoDir = recoDataPath()
    fs.mkdirSync(recoDir, { recursive: true })
    const timestamp = Date.now()
    const rawPath = path.join(recoDir, `recoder_record_${timestamp}.${ext}`)
    fs.writeFileSync(rawPath, Buffer.from(buffer))
    const wavPath = path.join(recoDir, `recoder_record_${timestamp}.wav`)
    await convertAudio(rawPath, wavPath)
    try { fs.unlinkSync(rawPath) } catch {}
    return { success: true, path: wavPath }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('models:list', async () => {
  const modelDir = userDataPath('model')
  const models = []
  for (const name of ['tiny', 'base', 'small']) {
    const p = path.join(modelDir, `ggml-${name}.bin`)
    const cached = fs.existsSync(p) && fs.statSync(p).size > 0
    models.push({ name, size_mb: name === 'tiny' ? 77 : (name === 'base' ? 148 : 488), cached })
  }
  return { models }
})

ipcMain.handle('model:download', async (event, modelSize) => {
  appLog('INFO', 'model', `下載模型開始: ${modelSize}`)
  try {
    const modelDir = userDataPath('model')
    fs.mkdirSync(modelDir, { recursive: true })
    const dest = path.join(modelDir, `ggml-${modelSize}.bin`)
    await downloadFile(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${modelSize}.bin`, dest, (percent) => {
      if (mainWindow) mainWindow.webContents.send('model:download-progress', { percent })
    })
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('llm:providers', () => {
  const list = Object.entries(LLM_PROVIDERS).map(([k, v]) => ({ key: k, name: v.name, defaultModel: v.defaultModel }))
  return { providers: list }
})

ipcMain.handle('llm:optimize', async (event, { provider, apiKey, model, text }) => {
  try {
    const result = await callLLM(provider, apiKey, model, text,
      '你是一個專業的會議記錄編輯。請優化以下逐字稿：修正口語化表達、改善語句流暢度、保留原意。直接輸出優化後的文字，不要額外說明。')
    return { success: true, result }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('llm:translate', async (event, { provider, apiKey, model, text, target }) => {
  try {
    let systemPrompt
    if (target === 'ja') { systemPrompt = '你是一個專業的翻譯。請將以下中文逐字稿逐句翻譯為日文。輸出格式為每行「[中文] 原文\n[日文] 翻譯」，句與句之間空一行。保留原意，不要額外說明。' }
    else if (target === 'en') { systemPrompt = 'You are a professional translator. Translate the following Chinese transcript into English sentence by sentence. Output format: each line pair "[中文] original text\n[English] translation", with a blank line between sentence pairs. Preserve the original meaning, no extra commentary.' }
    else { systemPrompt = '你是一個專業的翻譯。請將以下逐字稿逐句翻譯為中文。輸出格式為每行「[原文] 原文\n[中文] 翻譯」，句與句之間空一行。保留原意，不要額外說明。' }
    const result = await callLLM(provider, apiKey, model, text, systemPrompt)
    return { success: true, result }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('llm:summary', async (event, { provider, apiKey, model, text }) => {
  try {
    const result = await callLLM(provider, apiKey, model, text,
      '你是一個專業的會議記錄分析師。請根據以下逐字稿，提取：\n1. 會議摘要（3-5句話）\n2. 重要決策\n3. 待辦事項\n4. 關鍵時間點\n\n使用繁體中文輸出，條列式呈現。')
    return { success: true, result }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('transcribe:start', async (event, { audioPath, modelSize, useGpu, gpuDevice }) => {
  appLog('INFO', 'whisper', `辨識開始: ${audioPath} (model=${modelSize}, gpu=${useGpu}, device=${gpuDevice})`)
  try {
    return await runWhisper(audioPath, modelSize, useGpu, gpuDevice)
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('transcribe:segment', async (event, { audioPath, modelSize, useGpu, gpuDevice }) => {
  appLog('INFO', 'whisper', `分段辨識: ${audioPath} (model=${modelSize}, gpu=${useGpu}, device=${gpuDevice})`)
  try {
    const result = await runWhisper(audioPath, modelSize, useGpu, gpuDevice)
    if (result.success) { appLog('INFO', 'whisper', `分段辨識完成: ${result.segments.length} 句`) }
    return result
  } catch (e) { return { success: false, error: e.message } }
})

// ── 錄音歷史與全文檢索 ──

ipcMain.handle('reco:saveMeta', async (event, { recordingId, filename, recordingMode, recordedAt, duration, modelSize, segments, llmResults, audioPath }) => {
  appLog('INFO', 'reco', `儲存 metadata: ${recordingId}`)
  try {
    const fullText = segments.map(s => s.text).join(' ')
    const meta = { id: recordingId, filename, recordingMode, recordedAt, duration, modelSize, segments, fullText, llmResults: llmResults || {}, audioPath: audioPath || '' }
    const metaPath = recoDataPath(`${recordingId}.json`)
    fs.mkdirSync(path.dirname(metaPath), { recursive: true })
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('reco:list', async () => {
  try {
    const dir = recoDataPath()
    if (!fs.existsSync(dir)) return { success: true, list: [] }
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    const list = files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
        const audioPath = data.audioPath || ''
        const hasAudio = audioPath ? fs.existsSync(audioPath) : false
        return { id: data.id, filename: data.filename, recordingMode: data.recordingMode, recordedAt: data.recordedAt, duration: data.duration, modelSize: data.modelSize, segmentCount: data.segments?.length || 0, hasAudio, audioPath }
      } catch { return null }
    }).filter(Boolean)
    list.sort((a, b) => (b.recordedAt || '').localeCompare(a.recordedAt || ''))
    return { success: true, list }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('reco:search', async (event, { keyword }) => {
  appLog('INFO', 'reco', `全文檢索: "${keyword}"`)
  try {
    const dir = recoDataPath()
    if (!fs.existsSync(dir)) return { success: true, results: [] }
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    const results = []
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
        const lowerKw = keyword.toLowerCase()
        // 搜尋原始逐字稿
        const lowerFull = data.fullText.toLowerCase()
        if (lowerFull.includes(lowerKw)) {
          for (const seg of data.segments) {
            if (seg.text.toLowerCase().includes(lowerKw)) {
              results.push({ recordingId: data.id, filename: data.filename, recordedAt: data.recordedAt, start: seg.start, end: seg.end, text: seg.text, source: 'original' })
            }
          }
        }
        // 搜尋 LLM 結果（優化、翻譯、重點整理）
        if (data.llmResults) {
          for (const [type, text] of Object.entries(data.llmResults)) {
            if (text && text.toLowerCase().includes(lowerKw)) {
              const labels = { optimized: '✨ 優化', translated: '🌐 翻譯', summary: '📋 重點整理' }
              results.push({ recordingId: data.id, filename: data.filename, recordedAt: data.recordedAt, start: 0, end: 0, text: text.substring(0, 200) + (text.length > 200 ? '...' : ''), source: labels[type] || type })
            }
          }
        }
      } catch {}
    }
    return { success: true, results }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('reco:aiQuery', async (event, { provider, apiKey, model, question }) => {
  appLog('INFO', 'reco', `AI 查詢: "${question}"`)
  try {
    const dir = recoDataPath()
    if (!fs.existsSync(dir)) return { success: true, result: '尚無任何錄音記錄。' }
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    let context = ''
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
        context += `--- 錄音: ${data.filename} (${data.recordedAt}) ---\n${data.fullText}\n\n`
      } catch {}
    }
    const prompt = `以下是多筆會議錄音的逐字稿內容：\n\n${context}\n\n請根據以上內容回答使用者的問題。請引用來源錄音檔名和時間戳。\n\n問題：${question}`
    const result = await callLLM(provider, apiKey, model, prompt,
      '你是一個專業的會議記錄分析師。根據提供的逐字稿內容回答問題，並標註資訊來源（錄音檔名、時間戳）。使用繁體中文。')
    return { success: true, result }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('export:save', async (event, { format, results, filePath }) => {
  try {
    let content = ''
    if (format === 'md') {
      content = '# Recorder — AI 會議記錄\n\n| 時間 | 內容 |\n|------|------|\n'
      for (const r of results) {
        const s = formatTime(r.start); const e = formatTime(r.end)
        content += `| ${s}~${e} | ${r.text} |\n`
      }
    } else {
      content = 'Recorder — AI 會議記錄\n' + '='.repeat(40) + '\n\n'
      for (const r of results) {
        const s = formatTime(r.start); const e = formatTime(r.end)
        content += `[${s} - ${e}]\n${r.text}\n\n`
      }
    }
    fs.writeFileSync(filePath, content, 'utf-8')
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
})

// ── 音檔列表、載入 Meta、LLM 處理、批次辨識新音檔 ──

ipcMain.handle('reco:listAudioFiles', async () => {
  try {
    const dir = recoDataPath()
    if (!fs.existsSync(dir)) return { success: true, files: [] }
    const audioExts = ['.wav', '.mp3', '.opus', '.ogg', '.flac', '.m4a', '.webm']
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const files = entries
      .filter(e => e.isFile() && audioExts.includes(path.extname(e.name).toLowerCase()))
      .map(e => {
        const fullPath = path.join(dir, e.name)
        const stat = fs.statSync(fullPath)
        return { name: e.name, path: fullPath, size: stat.size, ext: path.extname(e.name).toLowerCase(), mtime: stat.mtime.toISOString() }
      })
    files.sort((a, b) => b.mtime.localeCompare(a.mtime))
    return { success: true, files }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('reco:loadMeta', async (event, { recordingId }) => {
  try {
    const metaPath = recoDataPath(`${recordingId}.json`)
    if (!fs.existsSync(metaPath)) return { success: false, error: `找不到記錄: ${recordingId}` }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    return { success: true, meta }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('reco:llmProcess', async (event, { recordingId, provider, apiKey, model, type }) => {
  appLog('INFO', 'reco', `LLM 處理: ${recordingId} type=${type}`)
  try {
    const metaPath = recoDataPath(`${recordingId}.json`)
    if (!fs.existsSync(metaPath)) return { success: false, error: `找不到記錄: ${recordingId}` }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    const text = meta.fullText || meta.segments.map(s => s.text).join(' ')
    if (!text) return { success: false, error: '無逐字稿內容' }
    let systemPrompt, result
    if (type === 'optimize') {
      systemPrompt = '你是一個專業的會議記錄編輯。請優化以下逐字稿：修正口語化表達、改善語句流暢度、保留原意。直接輸出優化後的文字，不要額外說明。'
      result = await callLLM(provider, apiKey, model, text, systemPrompt)
      meta.llmResults = meta.llmResults || {}
      meta.llmResults.optimized = result
    } else if (type === 'translate') {
      systemPrompt = '你是一個專業的翻譯。請將以下逐字稿逐句翻譯為繁體中文。輸出格式為每行「[原文] 原文\n[中文] 翻譯」，句與句之間空一行。保留原意，不要額外說明。'
      result = await callLLM(provider, apiKey, model, text, systemPrompt)
      meta.llmResults = meta.llmResults || {}
      meta.llmResults.translated = result
    } else if (type === 'summary') {
      systemPrompt = '你是一個專業的會議記錄分析師。請根據以下逐字稿，提取：\n1. 會議摘要（3-5句話）\n2. 重要決策\n3. 待辦事項\n4. 關鍵時間點\n\n使用繁體中文輸出，條列式呈現。'
      result = await callLLM(provider, apiKey, model, text, systemPrompt)
      meta.llmResults = meta.llmResults || {}
      meta.llmResults.summary = result
    } else {
      return { success: false, error: `不支援的類型: ${type}` }
    }
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    appLog('INFO', 'reco', `LLM ${type} 完成: ${recordingId}`)
    return { success: true, result }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('reco:batchTranscribeNew', async (event, { modelSize, useGpu, gpuDevice }) => {
  appLog('INFO', 'reco', '批次辨識新音檔開始')
  try {
    const dir = recoDataPath()
    if (!fs.existsSync(dir)) return { success: true, results: [] }
    const audioExts = ['.wav', '.mp3', '.opus', '.ogg', '.flac', '.m4a', '.webm']
    const allFiles = fs.readdirSync(dir).filter(f => audioExts.includes(path.extname(f).toLowerCase()))
    // 過濾已有 JSON metadata 的音檔
    const existingJson = new Set(fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => path.basename(f, '.json')))
    const newFiles = allFiles.filter(f => {
      const baseName = path.basename(f, path.extname(f))
      return !existingJson.has(baseName)
    })
    if (newFiles.length === 0) return { success: true, results: [], message: '所有音檔已有 metadata，無需辨識' }
    const results = []
    for (let i = 0; i < newFiles.length; i++) {
      const f = newFiles[i]
      const audioPath = path.join(dir, f)
      appLog('INFO', 'reco', `批次辨識 ${i + 1}/${newFiles.length}: ${f}`)
      if (mainWindow) mainWindow.webContents.send('reco:batch-progress', { current: i + 1, total: newFiles.length, file: f })
      try {
        const wavPath = await convertAudio(audioPath)
        const r = await runWhisper(wavPath, modelSize, useGpu, gpuDevice)
        if (r.success && r.segments && r.segments.length > 0) {
          const now = new Date()
          const id = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}_batch`
          const fullText = r.segments.map(s => s.text).join(' ')
          const meta = {
            id, filename: f, recordingMode: 'import', recordedAt: now.toISOString(),
            duration: r.segments.length > 0 ? r.segments[r.segments.length - 1].end : 0,
            modelSize, segments: r.segments, fullText, llmResults: {},
            audioPath: audioPath,
          }
          const metaPath = path.join(dir, `${id}.json`)
          fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
          results.push({ file: f, segments: r.segments.length, id })
          appLog('INFO', 'reco', `批次辨識完成: ${f} (${r.segments.length} 句)`)
        } else {
          results.push({ file: f, error: r.error || '無辨識結果' })
          appLog('WARN', 'reco', `批次辨識失敗: ${f} - ${r.error || '無辨識結果'}`)
        }
        if (wavPath !== audioPath) { try { fs.unlinkSync(wavPath) } catch {} }
      } catch (e) {
        results.push({ file: f, error: e.message })
        appLog('ERROR', 'reco', `批次辨識異常: ${f} - ${e.message}`)
      }
    }
    appLog('INFO', 'reco', `批次辨識新音檔完成: ${results.filter(r => r.id).length}/${newFiles.length} 成功`)
    return { success: true, results }
  } catch (e) { return { success: false, error: e.message } }
})

// ── 刪除錄音記錄 ──

ipcMain.handle('reco:deleteMeta', async (event, { recordingId }) => {
  appLog('INFO', 'reco', `刪除 metadata: ${recordingId}`)
  try {
    const metaPath = recoDataPath(`${recordingId}.json`)
    if (!fs.existsSync(metaPath)) return { success: false, error: `找不到記錄: ${recordingId}` }
    fs.unlinkSync(metaPath)
    appLog('INFO', 'reco', `metadata 已刪除: ${recordingId}`)
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
})

// ── 刪除音檔（安全檢查：僅允許 recoDataPath 下的檔案） ──

ipcMain.handle('reco:deleteAudio', async (event, { audioPath }) => {
  appLog('INFO', 'reco', `刪除音檔: ${audioPath}`)
  try {
    if (!audioPath) return { success: false, error: '未指定音檔路徑' }
    const recoDir = recoDataPath()
    const resolved = path.resolve(audioPath)
    // 安全檢查：確保路徑在 recoDataPath 下
    if (!resolved.startsWith(path.resolve(recoDir))) {
      appLog('WARN', 'reco', `嘗試刪除目錄外的檔案: ${audioPath}`)
      return { success: false, error: '不允許刪除目錄外的檔案' }
    }
    if (!fs.existsSync(resolved)) return { success: false, error: '音檔不存在' }
    fs.unlinkSync(resolved)
    appLog('INFO', 'reco', `音檔已刪除: ${audioPath}`)
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
})

// ── 取得 reco_data 路徑 ──

ipcMain.handle('reco:dataPath', () => {
  try {
    const p = recoDataPath()
    fs.mkdirSync(p, { recursive: true })
    return { success: true, path: p }
  } catch (e) { return { success: false, error: e.message } }
})

// ── 取得音檔 URL（透過自訂 protocol 安全提供本機音檔） ──

ipcMain.handle('reco:getAudioUrl', async (event, { audioPath }) => {
  try {
    if (!audioPath) return { success: false, error: '未指定音檔路徑' }
    const recoDir = recoDataPath()
    const resolved = path.resolve(audioPath)
    // 安全檢查：確保路徑在 recoDataPath 下
    if (!resolved.startsWith(path.resolve(recoDir))) {
      return { success: false, error: '不允許存取目錄外的檔案' }
    }
    if (!fs.existsSync(resolved)) return { success: false, error: '音檔不存在' }
    // 回傳自訂 protocol URL
    const relativePath = path.relative(recoDir, resolved)
    const url = `reco-file:///${relativePath.replace(/\\/g, '/')}`
    return { success: true, url }
  } catch (e) { return { success: false, error: e.message } }
})

// ── 批次轉 txt ──

ipcMain.handle('batch:transcribe', async (event, { modelSize, useGpu, gpuDevice }) => {
  appLog('INFO', 'batch', '批次轉 txt 開始')
  try {
    const dir = recoDataPath()
    if (!fs.existsSync(dir)) return { success: true, results: [] }
    const audioExts = ['.wav', '.mp3', '.opus', '.ogg', '.flac', '.m4a']
    const files = fs.readdirSync(dir).filter(f => audioExts.includes(path.extname(f).toLowerCase()))
    if (files.length === 0) return { success: true, results: [] }
    const results = []
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const audioPath = path.join(dir, f)
      appLog('INFO', 'batch', `處理 ${i + 1}/${files.length}: ${f}`)
      if (mainWindow) mainWindow.webContents.send('batch:transcribe-progress', { current: i + 1, total: files.length, file: f })
      try {
        const wavPath = await convertAudio(audioPath)
        const r = await runWhisper(wavPath, modelSize, useGpu, gpuDevice)
        if (r.success && r.segments.length > 0) {
          const txtPath = path.join(dir, path.basename(f, path.extname(f)) + '.txt')
          let content = ''
          for (const seg of r.segments) {
            const s = formatTime(seg.start); const e = formatTime(seg.end)
            content += `[${s} - ${e}] ${seg.text}\n`
          }
          fs.writeFileSync(txtPath, content, 'utf-8')
          results.push({ file: f, txt: path.basename(txtPath), segments: r.segments.length })
          appLog('INFO', 'batch', `完成: ${f} → ${path.basename(txtPath)} (${r.segments.length} 句)`)
        } else {
          results.push({ file: f, error: r.error || '無辨識結果' })
          appLog('WARN', 'batch', `失敗: ${f} - ${r.error || '無辨識結果'}`)
        }
        if (wavPath !== audioPath) { try { fs.unlinkSync(wavPath) } catch {} }
      } catch (e) {
        results.push({ file: f, error: e.message })
        appLog('ERROR', 'batch', `異常: ${f} - ${e.message}`)
      }
    }
    appLog('INFO', 'batch', `批次轉 txt 完成: ${results.filter(r => r.txt).length}/${files.length} 成功`)
    return { success: true, results }
  } catch (e) { return { success: false, error: e.message } }
})

function formatTime(seconds) {
  const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ── 自訂 protocol：安全提供本機音檔給 renderer ──

function registerRecoFileProtocol() {
  const recoDir = recoDataPath()
  try { fs.mkdirSync(recoDir, { recursive: true }) } catch {}
  session.defaultSession.protocol.registerFileProtocol('reco-file', (request, callback) => {
    try {
      // 解析路徑：reco-file:///relative/path → 完整路徑
      const relativePath = decodeURIComponent(request.url.replace('reco-file:///', ''))
      const fullPath = path.resolve(recoDir, relativePath)
      // 安全檢查：確保在 recoDir 下
      if (!fullPath.startsWith(path.resolve(recoDir))) {
        callback({ statusCode: 403 })
        return
      }
      callback({ path: fullPath })
    } catch (e) {
      callback({ statusCode: 404 })
    }
  })
}

function createWindow() {
  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev')
  registerRecoFileProtocol()
    mainWindow = new BrowserWindow({
    width: 1100, height: 800, minWidth: 720, minHeight: 500,
    title: `Recorder v${app.getVersion()} — AI 會議記錄`,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(['media', 'display-capture'].includes(permission)))
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then(sources => callback({ video: sources[0], audio: 'loopback' })).catch(() => callback({ video: null, audio: null }))
  })
  if (isDev) { mainWindow.loadURL('http://localhost:5173'); mainWindow.webContents.openDevTools() }
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  mainWindow.on('page-title-updated', (event) => { event.preventDefault() })
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (!mainWindow) createWindow() })