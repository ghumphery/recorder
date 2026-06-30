const { app, BrowserWindow, dialog, ipcMain, session, desktopCapturer } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')
const https = require('https')
const http = require('http')
const os = require('os')
const OpenCC = require('opencc-js')
const fetch = require('node-fetch')
const voiceprint = require('./voiceprint')
const audioChunker = require('./audioChunker') // v1.20.9: 共用音檔切片模組
// v1.20.9: 啟動時清掉殘留的 recoder-chunks-* / voiceprint-chunk-* 暫存
audioChunker.cleanupStaleChunks()

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

// ffmpeg 序列化佇列
let ffmpegQueue = Promise.resolve()

function convertAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ext = path.extname(inputPath).toLowerCase()
    if (ext === '.wav') { resolve(inputPath); return }
    const ffmpeg = resourcePath('ffmpeg', 'ffmpeg.exe')
    const out = outputPath || path.join(os.tmpdir(), `recoder_${Date.now()}_converted.wav`)
    const args = ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', '-sample_fmt', 's16', out]
    appLog('INFO', 'ffmpeg', `轉換開始: ${inputPath} → ${out}`)
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

const LLM_SLOT_TIME = 2000 // 時槽時間 2 秒（CSMA/CD 風格 exponential backoff）
const LLM_MAX_RETRIES = 16 // 最大重試次數

async function _llmFetch(provider, apiKey, model, prompt, systemPrompt, signal) {
  const cfg = LLM_PROVIDERS[provider]
  if (provider === 'ollama') {
    const res = await fetch(`${cfg.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model || cfg.defaultModel, prompt, system: systemPrompt, stream: false }),
      signal,
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
      signal,
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
    signal,
  })
  if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error(`${cfg.name} HTTP ${res.status}: ${body.slice(0, 200)}`) }
  const data = await res.json()
  if (data.error) throw new Error(`${cfg.name} 錯誤: ${data.error.message || JSON.stringify(data.error)}`)
  return data.choices?.[0]?.message?.content || ''
}

async function callLLM(provider, apiKey, model, prompt, systemPrompt) {
  const cfg = LLM_PROVIDERS[provider]
  if (!cfg) throw new Error(`不支援的提供商: ${provider}`)
  if (provider !== 'ollama' && (!apiKey || apiKey.trim() === '')) {
    throw new Error(`使用 ${cfg.name} 需要在設定中輸入 API Key`)
  }
  let lastError = null
  for (let attempt = 0; attempt < LLM_MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120000)
    try {
      const result = await _llmFetch(provider, apiKey, model, prompt, systemPrompt, controller.signal)
      return result
    } catch (e) {
      clearTimeout(timeout)
      lastError = e
      // 只有 AbortError（timeout）才進行 retry，其他錯誤直接拋出
      if (e.name !== 'AbortError') throw e
      // 最後一次嘗試失敗後不再等待，直接拋出
      if (attempt >= LLM_MAX_RETRIES - 1) break
      // CSMA/CD exponential backoff：等待時間 = Random(0, 2^k - 1) × Slot Time
      const k = Math.min(attempt + 1, 10)
      const maxSlots = (1 << k) - 1
      const waitMs = Math.floor(Math.random() * (maxSlots + 1)) * LLM_SLOT_TIME
      appLog('WARN', 'llm', `LLM timeout (attempt ${attempt + 1}/${LLM_MAX_RETRIES})，等待 ${waitMs}ms 後重試...`)
      await new Promise(resolve => setTimeout(resolve, waitMs))
    } finally { clearTimeout(timeout) }
  }
  throw new Error(`LLM 請求連續失敗 ${LLM_MAX_RETRIES} 次（timeout）：${lastError.message}`)
}

// ── Token 估算與模型 Context Limit ──

const KNOWN_MODEL_CONTEXTS = {
  // Ollama 常見模型
  'llama3': 8192,
  'llama3.2': 8192,
  'llama3.1': 8192,
  'llama2': 4096,
  'mistral': 8192,
  'mixtral': 32768,
  'codellama': 16384,
  'qwen2.5': 32768,
  'qwen2': 32768,
  'gemma2': 8192,
  'gemma': 8192,
  'phi3': 4096,
  'phi': 4096,
  'deepseek': 4096,
  'nomic-embed-text': 8192,
  // OpenRouter 常見模型
  'google/gemma-2-9b-it': 8192,
  'google/gemma-2-27b-it': 8192,
  'meta-llama/llama-3.2-3b-instruct': 8192,
  'meta-llama/llama-3.2-11b-vision-instruct': 8192,
  'meta-llama/llama-3.1-8b-instruct': 8192,
  'meta-llama/llama-3.1-70b-instruct': 8192,
  'mistralai/mistral-7b-instruct': 8192,
  'mistralai/mixtral-8x7b-instruct': 32768,
  'qwen/qwen-2.5-7b-instruct': 32768,
  'qwen/qwen-2.5-72b-instruct': 32768,
  // SiliconFlow 常見模型
  'Qwen/Qwen2.5-7B-Instruct': 32768,
  'Qwen/Qwen2.5-14B-Instruct': 32768,
  'Qwen/Qwen2.5-72B-Instruct': 32768,
  'THUDM/glm-4-9b-chat': 8192,
  '01-ai/Yi-1.5-9B-Chat': 4096,
  // Gemini
  'gemini-2.0-flash': 1048576,
  'gemini-2.0-flash-lite': 1048576,
  'gemini-1.5-flash': 1048576,
  'gemini-1.5-pro': 1048576,
}

function estimateTokens(text) {
  if (!text) return 0
  let tokens = 0
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (code > 0x4E00 && code < 0x9FFF) {
      // CJK Unified Ideographs: ~1.5 tokens per character
      tokens += 1.5
    } else if (code >= 0x3040 && code <= 0x30FF) {
      // Hiragana + Katakana: ~1.5 tokens
      tokens += 1.5
    } else if (code >= 0xAC00 && code <= 0xD7AF) {
      // Hangul: ~1.5 tokens
      tokens += 1.5
    } else {
      // ASCII and others: ~0.25 tokens per character
      tokens += 0.25
    }
  }
  return Math.ceil(tokens)
}

async function getModelContextLimit(provider, model) {
  const modelKey = (model || '').toLowerCase().trim()
  // 1. Check known model table
  for (const [key, limit] of Object.entries(KNOWN_MODEL_CONTEXTS)) {
    if (modelKey.includes(key.toLowerCase())) return limit
  }
  // 2. For Ollama, try to query model info
  if (provider === 'ollama') {
    try {
      const res = await fetch(`http://127.0.0.1:11434/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || 'llama3' }),
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.modelfile) {
          const match = data.modelfile.match(/num_ctx\s+(\d+)/i)
          if (match) return parseInt(match[1])
        }
        if (data.model_info) {
          // Try to find context length in model_info
          for (const [k, v] of Object.entries(data.model_info)) {
            if (k.includes('context_length') && typeof v === 'number') return v
          }
        }
      }
    } catch (e) {
      appLog('WARN', 'llm', `無法查詢 Ollama 模型資訊: ${e.message}`)
    }
  }
  // 3. Fallback
  return 4096
}

// ── LLM Job Manager ──

class LlmJobManager {
  constructor() {
    this.jobQueue = []
    this.activeJob = null
    this.jobHistory = []
    this.maxHistory = 50
    this.jobCounter = 0
  }

  setMainWindow(win) {
    this.mainWindow = win
  }

  _generateId() {
    this.jobCounter++
    const now = new Date()
    return `job_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}_${String(this.jobCounter).padStart(3,'0')}`
  }

  _log(job, message) {
    const time = new Date().toTimeString().slice(0, 8)
    job.log.push(`[${time}] ${message}`)
    appLog('INFO', 'llm-job', `[${job.id}] ${message}`)
  }

  _sendUpdate(job) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('llm:jobUpdate', {
        id: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        log: job.log.slice(-20),
        error: job.error,
      })
    }
  }

  addJob(type, params) {
    const job = {
      id: this._generateId(),
      type,
      status: 'pending',
      progress: { batch: 0, totalBatches: 0, percent: 0 },
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      error: null,
      result: null,
      log: [],
      params,
    }
    this._log(job, `Job created: ${type}`)
    this.jobQueue.push(job)
    this._sendUpdate(job)
    this.processNext()
    return job.id
  }

  async processNext() {
    if (this.activeJob || this.jobQueue.length === 0) return
    this.activeJob = this.jobQueue.shift()
    this.activeJob.status = 'running'
    this.activeJob.startedAt = new Date().toISOString()
    this._log(this.activeJob, 'Job started')
    this._sendUpdate(this.activeJob)
    try {
      await this._executeJob(this.activeJob)
      this.activeJob.status = 'completed'
      this.activeJob.completedAt = new Date().toISOString()
      this._log(this.activeJob, 'Job completed')
      this._sendUpdate(this.activeJob)
    } catch (e) {
      this.activeJob.status = 'failed'
      this.activeJob.error = e.message
      this.activeJob.completedAt = new Date().toISOString()
      this._log(this.activeJob, `Job failed: ${e.message}`)
      this._sendUpdate(this.activeJob)
    }
    this.jobHistory.unshift(this.activeJob)
    if (this.jobHistory.length > this.maxHistory) this.jobHistory.pop()
    this.activeJob = null
    this.processNext()
  }

  cancelJob(jobId) {
    const idx = this.jobQueue.findIndex(j => j.id === jobId)
    if (idx >= 0) {
      const job = this.jobQueue.splice(idx, 1)[0]
      job.status = 'cancelled'
      job.completedAt = new Date().toISOString()
      this._log(job, 'Job cancelled')
      this._sendUpdate(job)
      this.jobHistory.unshift(job)
      if (this.jobHistory.length > this.maxHistory) this.jobHistory.pop()
      return true
    }
    if (this.activeJob && this.activeJob.id === jobId) {
      this.activeJob.status = 'cancelled'
      this.activeJob.completedAt = new Date().toISOString()
      this._log(this.activeJob, 'Job cancelled')
      this._sendUpdate(this.activeJob)
      this.jobHistory.unshift(this.activeJob)
      if (this.jobHistory.length > this.maxHistory) this.jobHistory.pop()
      this.activeJob = null
      this.processNext()
      return true
    }
    return false
  }

  getJobStatus(jobId) {
    // Check active
    if (this.activeJob && this.activeJob.id === jobId) {
      return { ...this.activeJob, log: this.activeJob.log.slice(-20) }
    }
    // Check queue
    const queued = this.jobQueue.find(j => j.id === jobId)
    if (queued) return { ...queued, log: queued.log.slice(-20) }
    // Check history
    const hist = this.jobHistory.find(j => j.id === jobId)
    if (hist) return { ...hist, log: hist.log.slice(-20) }
    return null
  }

  listJobs() {
    const all = [
      ...(this.activeJob ? [{ ...this.activeJob, log: this.activeJob.log.slice(-5) }] : []),
      ...this.jobQueue.map(j => ({ ...j, log: j.log.slice(-5) })),
      ...this.jobHistory.slice(0, 20).map(j => ({ ...j, log: j.log.slice(-5) })),
    ]
    return all
  }

  deleteJob(jobId) {
    // 1) active job：標記 cancelled、移入 history
    if (this.activeJob && this.activeJob.id === jobId) {
      this.activeJob.status = 'cancelled'
      this.activeJob.completedAt = new Date().toISOString()
      this._log(this.activeJob, 'Job deleted (was active)')
      this._sendUpdate(this.activeJob)
      this.jobHistory.unshift(this.activeJob)
      if (this.jobHistory.length > this.maxHistory) this.jobHistory.pop()
      this.activeJob = null
      this.processNext()
      return true
    }
    // 2) queued job：直接從 queue 移除
    const qIdx = this.jobQueue.findIndex(j => j.id === jobId)
    if (qIdx >= 0) {
      const job = this.jobQueue.splice(qIdx, 1)[0]
      job.status = 'cancelled'
      job.completedAt = new Date().toISOString()
      this._log(job, 'Job deleted (was queued)')
      this._sendUpdate(job)
      this.jobHistory.unshift(job)
      if (this.jobHistory.length > this.maxHistory) this.jobHistory.pop()
      return true
    }
    // 3) history job：直接從歷史移除
    const hIdx = this.jobHistory.findIndex(j => j.id === jobId)
    if (hIdx >= 0) {
      this.jobHistory.splice(hIdx, 1)
      return true
    }
    return false
  }

  async _executeJob(job) {
    const { type } = job
    if (type === 'optimize') await this._executeOptimize(job)
    else if (type === 'translate') await this._executeTranslate(job)
    else if (type === 'summary') await this._executeSummary(job)
    else if (type === 'aiQuery') await this._executeAiQuery(job)
    else throw new Error(`Unknown job type: ${type}`)
  }

  _parseOptimizedResult(llmOutput, originalSegments) {
    const lines = llmOutput.split('\n').filter(l => l.trim())
    const result = []
    for (const line of lines) {
      const match = line.match(/^\[(\d+)\]\s*(.*)/)
      if (match) {
        const idx = parseInt(match[1]) - 1
        const text = match[2].trim()
        if (idx >= 0 && idx < originalSegments.length) {
          result.push({
            ...originalSegments[idx],
            optimizedText: text,
          })
        }
      }
    }
    // If parsing failed, return original segments with empty optimizedText
    if (result.length === 0) {
      return originalSegments.map(s => ({ ...s, optimizedText: '' }))
    }
    return result
  }

  _splitIntoBatches(segments, maxInputTokens, systemPrompt) {
    const batches = []
    let currentBatch = []
    let currentTokens = estimateTokens(systemPrompt)

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const lineTokens = estimateTokens(`[${currentBatch.length + 1}] ${seg.text}\n`)
      if (currentTokens + lineTokens > maxInputTokens && currentBatch.length > 0) {
        batches.push(currentBatch)
        currentBatch = []
        currentTokens = estimateTokens(systemPrompt)
      }
      currentBatch.push(seg)
      currentTokens += lineTokens
    }
    if (currentBatch.length > 0) batches.push(currentBatch)
    return batches
  }

  async _executeOptimize(job) {
    const { provider, apiKey, model, segments } = job.params
    if (!segments || segments.length === 0) throw new Error('無逐字稿內容')

    const numberedInput = segments.map((s, i) => `[${i+1}] ${s.text}`).join('\n')
    const systemPrompt = '你是一個專業的會議記錄編輯。以下是逐字稿的每個句子（含編號）。請對每個句子進行優化：修正口語化表達、改善語句流暢度、保留原意。輸出格式：每行一個優化後的句子，以 "[編號] 優化文字" 格式輸出，編號必須與輸入一致。不要合併或拆分句子，不要額外說明。'

    const totalInput = systemPrompt + '\n\n' + numberedInput
    const estimatedTokens = estimateTokens(totalInput)
    const contextLimit = await getModelContextLimit(provider, model)
    const outputBudget = Math.floor(contextLimit * 0.2)
    const maxInputTokens = contextLimit - outputBudget

    this._log(job, `Token 估算: ${estimatedTokens}, 模型上限: ${contextLimit}, 輸入上限: ${maxInputTokens}`)

    if (estimatedTokens <= maxInputTokens) {
      job.progress = { batch: 1, totalBatches: 1, percent: 0 }
      this._sendUpdate(job)
      const result = await callLLM(provider, apiKey, model, numberedInput, systemPrompt)
      job.progress = { batch: 1, totalBatches: 1, percent: 100 }
      job.result = this._parseOptimizedResult(result, segments)
      this._log(job, `優化完成: ${job.result.length} 句`)
    } else {
      const batches = this._splitIntoBatches(segments, maxInputTokens, systemPrompt)
      job.progress = { batch: 0, totalBatches: batches.length, percent: 0 }
      this._log(job, `分批處理: ${batches.length} 批`)
      this._sendUpdate(job)

      const allResults = []
      for (let i = 0; i < batches.length; i++) {
        if (job.status === 'cancelled') throw new Error('Job 已取消')
        const batch = batches[i]
        const batchInput = batch.map((s, j) => `[${j+1}] ${s.text}`).join('\n')
        job.progress = { batch: i + 1, totalBatches: batches.length, percent: Math.round(((i) / batches.length) * 100) }
        this._log(job, `處理第 ${i+1}/${batches.length} 批 (${batch.length} 句)`)
        this._sendUpdate(job)

        const batchResult = await callLLM(provider, apiKey, model, batchInput, systemPrompt)
        const parsed = this._parseOptimizedResult(batchResult, batch)
        allResults.push(...parsed)
      }
      job.progress = { batch: batches.length, totalBatches: batches.length, percent: 100 }
      job.result = allResults
      this._log(job, `分批優化完成: ${allResults.length} 句`)
    }
  }

  async _executeTranslate(job) {
    const { provider, apiKey, model, text, target } = job.params
    if (!text) throw new Error('無逐字稿內容')

    let systemPrompt
    if (target === 'ja') {
      systemPrompt = '你是一個專業的翻譯。請將以下中文逐字稿逐句翻譯為日文。輸出格式為每行「[中文] 原文\n[日文] 翻譯」，句與句之間空一行。保留原意，不要額外說明。'
    } else if (target === 'en') {
      systemPrompt = 'You are a professional translator. Translate the following Chinese transcript into English sentence by sentence. Output format: each line pair "[中文] original text\n[English] translation", with a blank line between sentence pairs. Preserve the original meaning, no extra commentary.'
    } else {
      systemPrompt = '你是一個專業的翻譯。請將以下逐字稿逐句翻譯為繁體中文。輸出格式為每行「[原文] 原文\n[中文] 翻譯」，句與句之間空一行。保留原意，不要額外說明。'
    }

    const totalInput = systemPrompt + '\n\n' + text
    const estimatedTokens = estimateTokens(totalInput)
    const contextLimit = await getModelContextLimit(provider, model)
    const outputBudget = Math.floor(contextLimit * 0.3)
    const maxInputTokens = contextLimit - outputBudget

    this._log(job, `Token 估算: ${estimatedTokens}, 模型上限: ${contextLimit}`)

    if (estimatedTokens <= maxInputTokens) {
      job.progress = { batch: 1, totalBatches: 1, percent: 0 }
      this._sendUpdate(job)
      const result = await callLLM(provider, apiKey, model, text, systemPrompt)
      job.progress = { batch: 1, totalBatches: 1, percent: 100 }
      job.result = result
      this._log(job, '翻譯完成')
    } else {
      // For translation, split by character count (rough estimate)
      const maxChars = Math.floor((maxInputTokens - estimateTokens(systemPrompt)) / 1.5)
      const chunks = []
      let current = ''
      for (const line of text.split('\n')) {
        if (current.length + line.length > maxChars && current.length > 0) {
          chunks.push(current)
          current = line + '\n'
        } else {
          current += line + '\n'
        }
      }
      if (current.trim()) chunks.push(current.trim())

      job.progress = { batch: 0, totalBatches: chunks.length, percent: 0 }
      this._log(job, `分批翻譯: ${chunks.length} 批`)
      this._sendUpdate(job)

      let fullResult = ''
      for (let i = 0; i < chunks.length; i++) {
        if (job.status === 'cancelled') throw new Error('Job 已取消')
        job.progress = { batch: i + 1, totalBatches: chunks.length, percent: Math.round(((i) / chunks.length) * 100) }
        this._log(job, `翻譯第 ${i+1}/${chunks.length} 批`)
        this._sendUpdate(job)
        const chunkResult = await callLLM(provider, apiKey, model, chunks[i], systemPrompt)
        fullResult += chunkResult + '\n\n'
      }
      job.progress = { batch: chunks.length, totalBatches: chunks.length, percent: 100 }
      job.result = fullResult.trim()
      this._log(job, '分批翻譯完成')
    }
  }

  async _executeSummary(job) {
    const { provider, apiKey, model, text } = job.params
    if (!text) throw new Error('無逐字稿內容')

    const systemPrompt = '你是一個專業的會議記錄分析師。請根據以下逐字稿，提取：\n1. 會議摘要（3-5句話）\n2. 重要決策\n3. 待辦事項\n4. 關鍵時間點\n\n使用繁體中文輸出，條列式呈現。'

    const totalInput = systemPrompt + '\n\n' + text
    const estimatedTokens = estimateTokens(totalInput)
    const contextLimit = await getModelContextLimit(provider, model)
    const outputBudget = Math.floor(contextLimit * 0.3)
    const maxInputTokens = contextLimit - outputBudget

    this._log(job, `Token 估算: ${estimatedTokens}, 模型上限: ${contextLimit}`)

    if (estimatedTokens <= maxInputTokens) {
      job.progress = { batch: 1, totalBatches: 1, percent: 0 }
      this._sendUpdate(job)
      const result = await callLLM(provider, apiKey, model, text, systemPrompt)
      job.progress = { batch: 1, totalBatches: 1, percent: 100 }
      job.result = result
      this._log(job, '摘要完成')
    } else {
      // For long text, take first portion that fits
      const maxChars = Math.floor((maxInputTokens - estimateTokens(systemPrompt)) / 1.5)
      const truncated = text.length > maxChars ? text.slice(0, maxChars) + '\n\n[注意：原文過長，已截斷處理]' : text
      this._log(job, `原文過長 (${text.length} 字)，截斷為 ${maxChars} 字`)
      job.progress = { batch: 1, totalBatches: 1, percent: 0 }
      this._sendUpdate(job)
      const result = await callLLM(provider, apiKey, model, truncated, systemPrompt)
      job.progress = { batch: 1, totalBatches: 1, percent: 100 }
      job.result = result
      this._log(job, '摘要完成（截斷）')
    }
  }

  async _executeAiQuery(job) {
    const { provider, apiKey, model, question, context } = job.params
    if (!question) throw new Error('無查詢問題')

    const systemPrompt = '你是一個專業的會議記錄分析師。根據提供的逐字稿內容回答問題，並標註資訊來源（錄音檔名、時間戳）。使用繁體中文。'
    const prompt = `以下是多筆會議錄音的逐字稿內容：\n\n${context}\n\n請根據以上內容回答使用者的問題。請引用來源錄音檔名和時間戳。\n\n問題：${question}`

    const totalInput = systemPrompt + '\n\n' + prompt
    const estimatedTokens = estimateTokens(totalInput)
    const contextLimit = await getModelContextLimit(provider, model)
    const outputBudget = Math.floor(contextLimit * 0.3)
    const maxInputTokens = contextLimit - outputBudget

    this._log(job, `Token 估算: ${estimatedTokens}, 模型上限: ${contextLimit}`)

    if (estimatedTokens <= maxInputTokens) {
      job.progress = { batch: 1, totalBatches: 1, percent: 0 }
      this._sendUpdate(job)
      const result = await callLLM(provider, apiKey, model, prompt, systemPrompt)
      job.progress = { batch: 1, totalBatches: 1, percent: 100 }
      job.result = result
      this._log(job, 'AI 查詢完成')
    } else {
      // Truncate context to fit
      const maxContextChars = Math.floor((maxInputTokens - estimateTokens(systemPrompt + `\n\n問題：${question}`)) / 1.5)
      const truncatedContext = context.length > maxContextChars ? context.slice(0, maxContextChars) + '\n\n[注意：部分錄音內容因長度限制已省略]' : context
      const truncatedPrompt = `以下是多筆會議錄音的逐字稿內容：\n\n${truncatedContext}\n\n請根據以上內容回答使用者的問題。請引用來源錄音檔名和時間戳。\n\n問題：${question}`
      this._log(job, `Context 過長，截斷為 ${maxContextChars} 字`)
      job.progress = { batch: 1, totalBatches: 1, percent: 0 }
      this._sendUpdate(job)
      const result = await callLLM(provider, apiKey, model, truncatedPrompt, systemPrompt)
      job.progress = { batch: 1, totalBatches: 1, percent: 100 }
      job.result = result
      this._log(job, 'AI 查詢完成（截斷）')
    }
  }
}

const llmJobManager = new LlmJobManager()

// ── Voiceprint Job Manager（v1.20.2 新增） ──

class VoiceprintJobManager {
  constructor() {
    this.jobQueue = []
    this.activeJob = null
    this.jobHistory = []
    this.maxHistory = 50
    this.jobCounter = 0
  }

  setMainWindow(win) { this.mainWindow = win }

  _generateId() {
    this.jobCounter++
    const now = new Date()
    return `vp_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}_${String(this.jobCounter).padStart(3,'0')}`
  }

  _log(job, message) {
    const time = new Date().toTimeString().slice(0, 8)
    job.log.push(`[${time}] ${message}`)
    appLog('INFO', 'voiceprint-job', `[${job.id}] ${message}`)
  }

  _sendUpdate(job) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('voiceprint:jobUpdate', {
        id: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        log: job.log.slice(-20),
        error: job.error,
        audioPath: job.audioPath,
      })
    }
  }

  addJob({ audioPath, segments, recordingId }) {
    const job = {
      id: this._generateId(),
      type: 'voiceprint',
      status: 'pending',
      progress: { percent: 0 },
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      error: null,
      result: null,
      audioPath,
      recordingId: recordingId || null,
      params: { segments: segments || [] },
      log: [],
    }
    this._log(job, `Job created (${(segments || []).length} segments)`)
    this.jobQueue.push(job)
    this._sendUpdate(job)
    this.processNext()
    return job.id
  }

  async processNext() {
    if (this.activeJob || this.jobQueue.length === 0) return
    this.activeJob = this.jobQueue.shift()
    this.activeJob.status = 'running'
    this.activeJob.startedAt = new Date().toISOString()
    this._log(this.activeJob, 'Job started')
    this._sendUpdate(this.activeJob)
    try {
      await this._executeJob(this.activeJob)
      this.activeJob.status = 'completed'
      this.activeJob.completedAt = new Date().toISOString()
      this._log(this.activeJob, 'Job completed')
      this._sendUpdate(this.activeJob)
    } catch (e) {
      this.activeJob.status = 'failed'
      this.activeJob.error = e.message
      this.activeJob.completedAt = new Date().toISOString()
      this._log(this.activeJob, `Job failed: ${e.message}`)
      this._sendUpdate(this.activeJob)
    }
    this.jobHistory.unshift(this.activeJob)
    if (this.jobHistory.length > this.maxHistory) this.jobHistory.pop()
    this.activeJob = null
    this.processNext()
  }

  async _executeJob(job) {
    const audioPath = job.audioPath
    const segments = (job.params && job.params.segments) || []
    const result = await voiceprint.diarizeAudio(audioPath, segments, (percent) => {
      job.progress.percent = percent
      this._sendUpdate(job)
    })
    job.result = { segments: result }

    // 如果有 recordingId，自動寫回 metadata 的 segments[].speaker
    if (job.recordingId) {
      try {
        const metaPath = path.join(recoDataPath(), `${job.recordingId}.json`)
        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          if (Array.isArray(meta.segments)) {
            for (let i = 0; i < result.length && i < meta.segments.length; i++) {
              meta.segments[i].speaker = result[i].speaker || meta.segments[i].speaker || ''
            }
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
            this._log(job, '已寫回 metadata')
          }
        }
      } catch (e) {
        this._log(job, `寫回 metadata 失敗: ${e.message}`)
      }
    }
  }

  cancelJob(jobId) {
    const idx = this.jobQueue.findIndex(j => j.id === jobId)
    if (idx >= 0) {
      const job = this.jobQueue.splice(idx, 1)[0]
      job.status = 'cancelled'
      job.completedAt = new Date().toISOString()
      this._log(job, 'Job cancelled')
      this._sendUpdate(job)
      this.jobHistory.unshift(job)
      if (this.jobHistory.length > this.maxHistory) this.jobHistory.pop()
      return true
    }
    if (this.activeJob && this.activeJob.id === jobId) {
      this.activeJob.status = 'cancelled'
      this.activeJob.completedAt = new Date().toISOString()
      this._log(this.activeJob, 'Job cancelled')
      this._sendUpdate(this.activeJob)
      this.jobHistory.unshift(this.activeJob)
      if (this.jobHistory.length > this.maxHistory) this.jobHistory.pop()
      this.activeJob = null
      this.processNext()
      return true
    }
    return false
  }

  getJobStatus(jobId) {
    if (this.activeJob && this.activeJob.id === jobId) return { ...this.activeJob, log: this.activeJob.log.slice(-20) }
    const queued = this.jobQueue.find(j => j.id === jobId)
    if (queued) return { ...queued, log: queued.log.slice(-20) }
    const hist = this.jobHistory.find(j => j.id === jobId)
    if (hist) return { ...hist, log: hist.log.slice(-20) }
    return null
  }

  listJobs() {
    const all = [
      ...(this.activeJob ? [{ ...this.activeJob, log: this.activeJob.log.slice(-5) }] : []),
      ...this.jobQueue.map(j => ({ ...j, log: j.log.slice(-5) })),
      ...this.jobHistory.slice(0, 20).map(j => ({ ...j, log: j.log.slice(-5) })),
    ]
    return all
  }

  deleteJob(jobId) {
    if (this.activeJob && this.activeJob.id === jobId) {
      this.activeJob.status = 'cancelled'
      this.activeJob.completedAt = new Date().toISOString()
      this._log(this.activeJob, 'Job deleted (was active)')
      this.jobHistory.unshift(this.activeJob)
      if (this.jobHistory.length > this.maxHistory) this.jobHistory.pop()
      this.activeJob = null
      this.processNext()
      return true
    }
    const qIdx = this.jobQueue.findIndex(j => j.id === jobId)
    if (qIdx >= 0) {
      const job = this.jobQueue.splice(qIdx, 1)[0]
      job.status = 'cancelled'
      job.completedAt = new Date().toISOString()
      this._log(job, 'Job deleted (was queued)')
      this.jobHistory.unshift(job)
      if (this.jobHistory.length > this.maxHistory) this.jobHistory.pop()
      return true
    }
    const hIdx = this.jobHistory.findIndex(j => j.id === jobId)
    if (hIdx >= 0) {
      this.jobHistory.splice(hIdx, 1)
      return true
    }
    return false
  }
}

const voiceprintJobManager = new VoiceprintJobManager()

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

// ── Whisper Job Manager ──

class WhisperJobManager {
  constructor() {
    this.jobQueue = []
    this.activeJob = null
    this.jobHistory = []
    this.maxHistory = 50
    this.jobCounter = 0
    this.persistPath = userDataPath('jobs.json')
    this._loadFromDisk()
  }

  setMainWindow(win) { this.mainWindow = win }

  _generateId() {
    this.jobCounter++
    const now = new Date()
    return `tx_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}_${String(this.jobCounter).padStart(3,'0')}`
  }

  _log(job, message) {
    const time = new Date().toTimeString().slice(0, 8)
    job.log.push(`[${time}] ${message}`)
    appLog('INFO', 'whisper-job', `[${job.id}] ${message}`)
  }

  _sendUpdate(job) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('transcribe:event', {
        id: job.id,
        type: 'transcribe',
        status: job.status,
        progress: job.progress,
        log: job.log.slice(-20),
        error: job.error,
        audioPath: job.audioPath,
        source: job.source,
      })
    }
  }

  _persist() {
    try {
      const data = {
        version: 1,
        savedAt: new Date().toISOString(),
        transcribeJobs: this.jobHistory.slice(0, 50).map(j => ({
          id: j.id, type: 'transcribe', audioPath: j.audioPath,
          source: j.source, modelSize: j.modelSize, useGpu: j.useGpu,
          status: j.status, progress: j.progress,
          createdAt: j.createdAt, startedAt: j.startedAt, completedAt: j.completedAt,
          error: j.error, log: j.log.slice(-10),
        })),
      }
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true })
      fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (e) { appLog('WARN', 'whisper-job', `持久化失敗: ${e.message}`) }
  }

  _loadFromDisk() {
    try {
      if (fs.existsSync(this.persistPath)) {
        const data = JSON.parse(fs.readFileSync(this.persistPath, 'utf-8'))
        if (data.transcribeJobs) this.jobHistory = data.transcribeJobs
      }
    } catch (e) { appLog('WARN', 'whisper-job', `讀取持久化失敗: ${e.message}`) }
  }

  addJob({ audioPath, modelSize, useGpu, gpuDevice, source }) {
    // 同檔案 in-flight 防護
    const inFlight = this.jobQueue.find(j => j.audioPath === audioPath && (j.status === 'pending' || j.status === 'running'))
    if (inFlight) return { success: false, error: '此音檔已在辨識中', jobId: inFlight.id }
    if (this.activeJob && this.activeJob.audioPath === audioPath && this.activeJob.status === 'running') {
      return { success: false, error: '此音檔已在辨識中', jobId: this.activeJob.id }
    }
    const job = {
      id: this._generateId(),
      type: 'transcribe',
      status: 'pending',
      progress: { percent: 0, elapsed: '0s' },
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      error: null,
      result: null,
      log: [],
      audioPath,
      modelSize,
      useGpu,
      gpuDevice,
      source: source || 'manual',
    }
    this._log(job, `Job created: ${audioPath} (model=${modelSize}, gpu=${useGpu})`)
    this.jobQueue.push(job)
    this._sendUpdate(job)
    this._persist()
    this.processNext()
    return { success: true, jobId: job.id }
  }

  async processNext() {
    if (this.activeJob || this.jobQueue.length === 0) return
    this.activeJob = this.jobQueue.shift()
    this.activeJob.status = 'running'
    this.activeJob.startedAt = new Date().toISOString()
    this._log(this.activeJob, 'Job started')
    this._sendUpdate(this.activeJob)
    this._persist()
    try {
      await this._executeTranscribe(this.activeJob)
      this.activeJob.status = 'completed'
      this.activeJob.completedAt = new Date().toISOString()
      this._log(this.activeJob, 'Job completed')
      this._sendUpdate(this.activeJob)
    } catch (e) {
      this.activeJob.status = 'failed'
      this.activeJob.error = e.message
      this.activeJob.completedAt = new Date().toISOString()
      this._log(this.activeJob, `Job failed: ${e.message}`)
      this._sendUpdate(this.activeJob)
    }
    this.jobHistory.unshift({
      id: this.activeJob.id, type: 'transcribe',
      audioPath: this.activeJob.audioPath, source: this.activeJob.source,
      modelSize: this.activeJob.modelSize, useGpu: this.activeJob.useGpu,
      status: this.activeJob.status, progress: this.activeJob.progress,
      createdAt: this.activeJob.createdAt, startedAt: this.activeJob.startedAt,
      completedAt: this.activeJob.completedAt, error: this.activeJob.error,
      result: this.activeJob.result, log: this.activeJob.log.slice(-10),
    })
    if (this.jobHistory.length > this.maxHistory) this.jobHistory.pop()
    this.activeJob = null
    this._persist()
    this.processNext()
  }

  async _executeTranscribe(job) {
    // v1.20.9: 長音檔切片 + 非同步 whisper 整合
    // 若設定 whisperChunkMinutes > 0 且音檔 >= 60min 門檻，自動切片各別 runWhisper
    const { audioPath, modelSize, useGpu, gpuDevice } = job
    const settings = this._loadSettings()
    const chunkMinutes = settings.whisperChunkMinutes || 0
    const thresholdSec = 60 * 60 // 60 分鐘門檻
    const segmentSec = chunkMinutes > 0 ? chunkMinutes * 60 : 3000

    // 取得音檔時長以判斷是否需要切片
    const totalDuration = await audioChunker.getAudioDuration(audioPath)
    const shouldChunk = chunkMinutes > 0 && totalDuration > 0 && totalDuration >= thresholdSec

    if (!shouldChunk) {
      // 原本路徑：直接 runWhisper
      return await this._runSingleTranscribe(job, audioPath, modelSize, useGpu, gpuDevice)
    }

    // 長音檔切片路徑
    this._log(job, `長音檔 ${Math.round(totalDuration)}s >= ${thresholdSec}s，使用 ${chunkMinutes} 分鐘/chunk 切片`)
    const tmpDir = path.join(os.tmpdir(), `recoder-chunks-${job.id}`)
    fs.mkdirSync(tmpDir, { recursive: true })
    let chunkInfo = null
    try {
      chunkInfo = await audioChunker.splitLongAudio(audioPath, { segmentSec, outputDir: tmpDir, prefix: 'wchunk' })
    } catch (e) {
      this._log(job, `切片失敗，降級為直接辨識: ${e.message}`)
      audioChunker.cleanupChunkDir(tmpDir)
      return await this._runSingleTranscribe(job, audioPath, modelSize, useGpu, gpuDevice)
    }

    const chunks = audioChunker.pairChunks(chunkInfo.files, chunkInfo.durations)
    const total = chunks.length
    job.progress = { percent: 0, elapsed: '0s', currentChunk: 0, totalChunks: total, message: `準備切片 ${total} 段` }
    this._sendUpdate(job)
    this._log(job, `已切成 ${total} 個 chunks`)

    const allSegments = []
    for (let i = 0; i < total; i++) {
      if (job.status === 'cancelled') {
        this._log(job, '使用者取消，中斷切片辨識')
        throw new Error('Job 已取消')
      }
      const chunk = chunks[i]
      const basePercent = Math.round((i / total) * 100)
      this._log(job, `切片 ${i+1}/${total} 辨識中...`)
      job.progress = { percent: basePercent, elapsed: '0s', currentChunk: i + 1, totalChunks: total, message: `切片 ${i+1}/${total} 辨識中...` }
      this._sendUpdate(job)

      const chunkResult = await this._runSingleTranscribe(
        job,
        chunk.file,
        modelSize,
        useGpu,
        gpuDevice,
        // onProgress：將單一 chunk 進度映射到整體百分比
        (percent) => {
          const overall = basePercent + Math.round((percent / 100) * (100 / total))
          job.progress = { percent: overall, elapsed: job.progress.elapsed, currentChunk: i + 1, totalChunks: total, message: `切片 ${i+1}/${total} 辨識中...` }
          this._sendUpdate(job)
        }
      )

      if (chunkResult && chunkResult.success && chunkResult.segments) {
        // 時間偏移加回原檔座標
        for (const seg of chunkResult.segments) {
          seg.start += chunk.startOffset
          seg.end += chunk.startOffset
        }
        allSegments.push(...chunkResult.segments)
      } else {
        const errMsg = (chunkResult && chunkResult.error) || '切片辨識失敗'
        this._log(job, `切片 ${i+1}/${total} 失敗: ${errMsg}`)
        // 拋出例外
        throw new Error(`切片 ${i+1}/${total} 辨識失敗: ${errMsg}`)
      }
    }

    // 清理 chunks
    audioChunker.cleanupChunkDir(tmpDir)
    job.progress = { percent: 100, elapsed: job.progress.elapsed, currentChunk: total, totalChunks: total, message: '完成' }
    this._sendUpdate(job)
    job.result = { success: true, segments: allSegments }
  }

  /**
   * 執行單一 runWhisper（含 GPU 自動 fallback 到 CPU）
   * v1.20.9: 供 _executeTranscribe 在「不切片」與「切片後逐 chunk」兩種路徑使用
   */
  async _runSingleTranscribe(job, audioPath, modelSize, useGpu, gpuDevice, onProgress) {
    const procWatchTimer = setInterval(() => {
      const entry = activeWhisperProcs.get(audioPath)
      if (entry && entry.proc) {
        job._proc = entry.proc
        clearInterval(procWatchTimer)
      }
    }, 100)
    const progressCallback = onProgress || ((percent, elapsed, fallback) => {
      job.progress = { ...(job.progress || {}), percent, elapsed: `${elapsed}s` }
      if (fallback) job.progress.fallback = true
      this._sendUpdate(job)
    })
    try {
      const result = await runWhisper(audioPath, modelSize, useGpu, gpuDevice, progressCallback)
      // GPU 卡住時自動降級為 CPU 重試
      if (!result.success && result.gpuStalled && useGpu !== false) {
        appLog('WARN', 'whisper', `GPU 辨識卡住，自動降級為 CPU 重試: ${audioPath}`)
        job.progress = { ...(job.progress || {}), percent: 0, elapsed: '0s', fallback: true, message: 'GPU 辨識無回應，自動改用 CPU...' }
        this._sendUpdate(job)
        const retryResult = await runWhisper(audioPath, modelSize, false, '', progressCallback)
        if (retryResult.success) return retryResult
        throw new Error(retryResult.error || 'CPU 辨識也失敗')
      }
      if (!result.success) throw new Error(result.error || '辨識失敗')
      return result
    } finally {
      clearInterval(procWatchTimer)
    }
  }

  /**
   * 讀取設定檔（whisperChunkMinutes 等）
   */
  _loadSettings() {
    try {
      const p = getSettingsPath()
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
    } catch (e) {}
    return {}
  }

  cancelJob(jobId) {
    const idx = this.jobQueue.findIndex(j => j.id === jobId)
    if (idx >= 0) {
      const job = this.jobQueue.splice(idx, 1)[0]
      job.status = 'cancelled'
      job.completedAt = new Date().toISOString()
      this._log(job, 'Job cancelled')
      this._sendUpdate(job)
      this.jobHistory.unshift({ id: job.id, type: 'transcribe', audioPath: job.audioPath, source: job.source, modelSize: job.modelSize, useGpu: job.useGpu, status: 'cancelled', createdAt: job.createdAt, completedAt: job.completedAt, log: job.log.slice(-10) })
      if (this.jobHistory.length > this.maxHistory) this.jobHistory.pop()
      this._persist()
      return true
    }
    if (this.activeJob && this.activeJob.id === jobId) {
      this.activeJob.status = 'cancelled'
      this.activeJob.completedAt = new Date().toISOString()
      this._log(this.activeJob, 'Job cancelled')
      this._sendUpdate(this.activeJob)
      // kill 子進程
      if (this.activeJob._proc) { try { this.activeJob._proc.kill('SIGTERM') } catch {} }
      this.jobHistory.unshift({ id: this.activeJob.id, type: 'transcribe', audioPath: this.activeJob.audioPath, source: this.activeJob.source, modelSize: this.activeJob.modelSize, useGpu: this.activeJob.useGpu, status: 'cancelled', createdAt: this.activeJob.createdAt, completedAt: this.activeJob.completedAt, log: this.activeJob.log.slice(-10) })
      if (this.jobHistory.length > this.maxHistory) this.jobHistory.pop()
      this.activeJob = null
      this._persist()
      this.processNext()
      return true
    }
    return false
  }

  getStatus(jobId) {
    if (this.activeJob && this.activeJob.id === jobId) return { ...this.activeJob, log: this.activeJob.log.slice(-20) }
    const queued = this.jobQueue.find(j => j.id === jobId)
    if (queued) return { ...queued, log: queued.log.slice(-20) }
    const hist = this.jobHistory.find(j => j.id === jobId)
    if (hist) return { ...hist, log: hist.log ? hist.log.slice(-20) : [] }
    return null
  }

  listJobs() {
    const all = [
      ...(this.activeJob ? [{ ...this.activeJob, log: this.activeJob.log.slice(-5) }] : []),
      ...this.jobQueue.map(j => ({ ...j, log: j.log.slice(-5) })),
      ...this.jobHistory.slice(0, 20).map(j => ({ ...j, log: j.log ? j.log.slice(-5) : [] })),
    ]
    return all
  }

  cancelAll() {
    // 取消所有 in-flight jobs
    for (const job of this.jobQueue) {
      job.status = 'cancelled'
      job.completedAt = new Date().toISOString()
      this._sendUpdate(job)
    }
    if (this.activeJob) {
      this.activeJob.status = 'cancelled'
      this.activeJob.completedAt = new Date().toISOString()
      if (this.activeJob._proc) { try { this.activeJob._proc.kill('SIGTERM') } catch {} }
      this._sendUpdate(this.activeJob)
      this.activeJob = null
    }
    this.jobQueue = []
    this._persist()
  }

  clearHistory() {
    this.jobHistory = []
    this._persist()
  }

  deleteJob(jobId) {
    // 1) active job：先 kill 子進程、標記 cancelled、移入 history
    if (this.activeJob && this.activeJob.id === jobId) {
      if (this.activeJob._proc) { try { this.activeJob._proc.kill('SIGTERM') } catch {} }
      this.activeJob.status = 'cancelled'
      this.activeJob.completedAt = new Date().toISOString()
      this._log(this.activeJob, 'Job deleted (was active)')
      this.jobHistory.unshift({
        id: this.activeJob.id, type: 'transcribe',
        audioPath: this.activeJob.audioPath, source: this.activeJob.source,
        modelSize: this.activeJob.modelSize, useGpu: this.activeJob.useGpu,
        status: 'cancelled', createdAt: this.activeJob.createdAt,
        completedAt: this.activeJob.completedAt, log: this.activeJob.log.slice(-10),
      })
      if (this.jobHistory.length > this.maxHistory) this.jobHistory.pop()
      this._sendUpdate({ ...this.activeJob })
      this.activeJob = null
      this._persist()
      this.processNext()
      return true
    }
    // 2) queued job：直接從 queue 移除
    const qIdx = this.jobQueue.findIndex(j => j.id === jobId)
    if (qIdx >= 0) {
      const job = this.jobQueue.splice(qIdx, 1)[0]
      job.status = 'cancelled'
      job.completedAt = new Date().toISOString()
      this._log(job, 'Job deleted (was queued)')
      this._sendUpdate(job)
      this._persist()
      return true
    }
    // 3) history job：直接從歷史移除
    const hIdx = this.jobHistory.findIndex(j => j.id === jobId)
    if (hIdx >= 0) {
      this.jobHistory.splice(hIdx, 1)
      this._persist()
      return true
    }
    return false
  }
}

const whisperJobManager = new WhisperJobManager()

// ── 語音辨識通用函式 ──

// 追蹤正在執行的 whisper 子進程（保留給 runWhisper 內部使用）
const activeWhisperProcs = new Map() // key: audioPath, value: { proc, startTime, lastStderrTime, timer }

const WHISPER_MAX_DURATION_MS = 90 * 60 * 1000  // 絕對超時 90 分鐘（適用所有模式）
const WHISPER_PROGRESS_INTERVAL_MS = 10000       // 每 10 秒推送進度（降低開銷）

/**
 * 根據 WAV 檔案大小估算音檔時長（秒）
 * 16kHz mono s16pcm: 1 byte = 1 sample (2 bytes per sample), 32000 bytes/s
 */
function estimateAudioDuration(audioPath) {
  try {
    const stat = fs.statSync(audioPath)
    if (stat.size < 44) return 0 // 太小的 WAV
    // WAV 16kHz mono s16 = 32000 bytes/sec payload (exclude 44-byte header)
    const payloadBytes = stat.size - 44
    return Math.floor(payloadBytes / 32000)
  } catch { return 0 }
}

/**
 * 計算 GPU 停滯 timeout
 * GPU 模式：min(audioDuration * 0.5, 30min)，最少 5 分鐘，最多 30 分鐘
 * CPU 模式：回傳 null（不停滯 kill）
 */
function getStallTimeoutMs(audioPath, useGpu) {
  if (useGpu === false) return null // CPU 模式：不停滯 kill，只靠絕對超時
  const durationSec = estimateAudioDuration(audioPath)
  const durationMin = durationSec / 60
  // GPU：音檔時長的 50% 作為停滯上限，最少 5 分鐘，最多 30 分鐘
  const stallMin = Math.max(5, Math.min(Math.round(durationMin * 0.5), 30))
  return stallMin * 60 * 1000
}

function runWhisper(audioPath, modelSize, useGpu, gpuDevice, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const modelPath = userDataPath('model', `ggml-${modelSize}.bin`)
      const whisperDir = resourcePath('whisper_cli')
      const whisperExe = path.join(whisperDir, 'whisper-cli.exe')
      if (!fs.existsSync(whisperExe)) return resolve({ success: false, error: 'whisper-cli.exe 不存在' })
      if (!fs.existsSync(modelPath)) return resolve({ success: false, error: `模型 ${modelSize} 尚未下載` })
      const outputJson = path.join(os.tmpdir(), `recoder_result_${Date.now()}.json`)
      const args = ['-m', modelPath, '-f', audioPath, '--output-json', '-oj', outputJson, '-l', 'auto', '-t', String(os.cpus().length), '-bs', '1', '-bo', '1']
      if (useGpu === false) args.push('--no-gpu')
      else if (gpuDevice !== undefined && gpuDevice !== '') args.push('-dev', String(gpuDevice))
      const totalDurationSec = estimateAudioDuration(audioPath)
      const startTime = Date.now()
      const proc = spawn(whisperExe, args, { cwd: whisperDir, windowsHide: true })
      let stderr = ''
      let lastStderrTime = Date.now()
      let lastProgressPercent = 0
      let resolved = false
      let anySegmentOutput = false // 是否有任何分段被輸出（判斷 GPU 是否真正 hang）

      // 註冊到 active map
      activeWhisperProcs.set(audioPath, { proc, startTime, lastStderrTime: lastStderrTime })

      // 進度推送定時器
      const progressTimer = setInterval(() => {
        if (resolved) return
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
        // 若尚未有時間戳輸出，用已耗時 / 音檔總長度估算進度
        let percent = lastProgressPercent
        if (percent === 0 && totalDurationSec > 0) {
          const elapsedSec = parseInt(elapsed)
          percent = Math.min(Math.round((elapsedSec / totalDurationSec) * 100), 99)
        }
        // v1.20.9: 送給外部 onProgress (若有)
        if (onProgress) onProgress(percent, elapsed, false)
        // 向後相容：保留舊版 transcribe:progress 事件
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('transcribe:progress', {
            audioPath,
            percent,
            elapsed: `${elapsed}s`,
          })
        }
      }, WHISPER_PROGRESS_INTERVAL_MS)

      // 絕對超時保護
      const maxTimer = setTimeout(() => {
        if (resolved) return
        appLog('WARN', 'whisper', `辨識超時 (${WHISPER_MAX_DURATION_MS / 60000} 分鐘): ${audioPath}`)
        try { proc.kill('SIGTERM') } catch {}
        resolved = true
        clearInterval(progressTimer)
        activeWhisperProcs.delete(audioPath)
        const isGpuStall = useGpu !== false && !anySegmentOutput
        resolve({ success: false, gpuStalled: isGpuStall, error: `辨識超時（超過 ${WHISPER_MAX_DURATION_MS / 60000} 分鐘），已自動終止` })
      }, WHISPER_MAX_DURATION_MS)

      // stderr 停滯偵測
      const stallTimeoutMs = getStallTimeoutMs(audioPath, useGpu)
      const stallCheckTimer = setInterval(() => {
        if (resolved) return
        if (stallTimeoutMs === null) return // CPU 模式：不停滯 kill
        const now = Date.now()
        if (now - lastStderrTime > stallTimeoutMs) {
          const stallMin = Math.round(stallTimeoutMs / 60000)
          appLog('WARN', 'whisper', `GPU 辨識停滯 (${stallMin} 分鐘無輸出): ${audioPath}`)
          try { proc.kill('SIGTERM') } catch {}
          resolved = true
          clearInterval(progressTimer)
          clearInterval(stallCheckTimer)
          clearTimeout(maxTimer)
          activeWhisperProcs.delete(audioPath)
          const isGpuStall = useGpu !== false && !anySegmentOutput
          resolve({ success: false, gpuStalled: isGpuStall, error: `GPU 辨識無回應（${stallMin} 分鐘無輸出），已自動終止` })
        }
      }, 30000) // 每 30 秒檢查一次

      proc.stderr.on('data', d => {
        const chunk = d.toString()
        stderr += chunk
        lastStderrTime = Date.now()
        // 嘗試從 stderr 解析進度（whisper-cli 輸出格式: [00:00:00.000 --> 00:00:05.000] text...）
        const lines = chunk.split('\n')
        for (const line of lines) {
          const match = line.match(/\[(\d{2}):(\d{2}):(\d{2})\.\d{3}\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.\d{3}\]/)
          if (match) {
            anySegmentOutput = true
            const endH = parseInt(match[4]), endM = parseInt(match[5]), endS = parseInt(match[6])
            const endSec = endH * 3600 + endM * 60 + endS
            // 計算真實進度：目前處理到的秒數 / 音檔總長度
            lastProgressPercent = Math.min(Math.round((endSec / Math.max(totalDurationSec, 1)) * 100), 99)
          }
        }
      })

      proc.on('close', code => {
        if (resolved) return
        resolved = true
        clearInterval(progressTimer)
        clearInterval(stallCheckTimer)
        clearTimeout(maxTimer)
        activeWhisperProcs.delete(audioPath)
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        appLog('INFO', 'whisper', `辨識完成: ${audioPath} (${elapsed}s, exit=${code})`)
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
      proc.on('error', e => {
        if (resolved) return
        resolved = true
        clearInterval(progressTimer)
        clearInterval(stallCheckTimer)
        clearTimeout(maxTimer)
        activeWhisperProcs.delete(audioPath)
        resolve({ success: false, error: e.message })
      })
    } catch (e) { reject(e) }
  })
}

// ── 安全檢查輔助函式 ──

function isPathSafe(targetPath) {
  const recoDir = path.resolve(recoDataPath())
  const resolved = path.resolve(targetPath)
  return resolved.startsWith(recoDir)
}

// ── 遞迴掃描 JSON 檔案（支援子目錄） ──

function scanJsonFiles(dir) {
  const results = []
  if (!fs.existsSync(dir)) return results
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    const fullPath = path.join(dir, e.name)
    if (e.isDirectory()) {
      results.push(...scanJsonFiles(fullPath))
    } else if (e.isFile() && e.name.endsWith('.json')) {
      results.push(fullPath)
    }
  }
  return results
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
    const sizeMB = name === 'tiny' ? 77 : (name === 'base' ? 148 : 488)
    models.push({ name, sizeMB, cached })
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

ipcMain.handle('model:delete', async (event, modelSize) => {
  appLog('INFO', 'model', `刪除模型: ${modelSize}`)
  try {
    const modelDir = userDataPath('model')
    const p = path.join(modelDir, `ggml-${modelSize}.bin`)
    if (!fs.existsSync(p)) return { success: false, error: '模型檔案不存在' }
    fs.unlinkSync(p)
    appLog('INFO', 'model', `模型已刪除: ${modelSize}`)
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('llm:providers', () => {
  const list = Object.entries(LLM_PROVIDERS).map(([k, v]) => ({ key: k, name: v.name, defaultModel: v.defaultModel }))
  return { providers: list }
})

// ── LLM Job IPC Handlers ──

ipcMain.handle('llm:jobSubmit', async (event, { type, params }) => {
  try {
    const jobId = llmJobManager.addJob(type, params)
    return { success: true, jobId }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('llm:jobStatus', async (event, { jobId }) => {
  try {
    const status = llmJobManager.getJobStatus(jobId)
    return { success: true, job: status }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('llm:jobList', async () => {
  try {
    const jobs = llmJobManager.listJobs()
    return { success: true, jobs }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('llm:jobCancel', async (event, { jobId }) => {
  try {
    const cancelled = llmJobManager.cancelJob(jobId)
    return { success: true, cancelled }
  } catch (e) { return { success: false, error: e.message } }
})

// ── 向後相容的舊 LLM IPC（直接呼叫，無 job 機制） ──

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
    else { systemPrompt = '你是一個專業的翻譯。請將以下逐字稿逐句翻譯為繁體中文。輸出格式為每行「[原文] 原文\n[中文] 翻譯」，句與句之間空一行。保留原意，不要額外說明。' }
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
  // 同檔案 in-flight 防護
  if (activeWhisperProcs.has(audioPath)) {
    appLog('WARN', 'whisper', `同檔案已在辨識中，拒絕重複請求: ${audioPath}`)
    return { success: false, error: '此音檔已在辨識中，請稍候或取消現有辨識' }
  }
  try {
    let result = await runWhisper(audioPath, modelSize, useGpu, gpuDevice)
    // GPU 卡住時自動降級為 CPU 重試
    if (!result.success && result.gpuStalled && useGpu !== false) {
      appLog('WARN', 'whisper', `GPU 辨識卡住，自動降級為 CPU 重試: ${audioPath}`)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('transcribe:progress', {
          audioPath, percent: 0, elapsed: '0s',
          fallback: true, message: 'GPU 辨識無回應，自動改用 CPU...',
        })
      }
      result = await runWhisper(audioPath, modelSize, false, '')
    }
    return result
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

// ── 取消辨識（舊版，保留向後相容） ──
ipcMain.handle('transcribe:cancel', async (event, { audioPath }) => {
  appLog('INFO', 'whisper', `取消辨識: ${audioPath}`)
  const entry = activeWhisperProcs.get(audioPath)
  if (!entry) return { success: false, error: '找不到正在執行的辨識程序' }
  try {
    entry.proc.kill('SIGTERM')
    activeWhisperProcs.delete(audioPath)
    appLog('INFO', 'whisper', `辨識已取消: ${audioPath}`)
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
})

// ── Whisper Job IPC Handlers（非同步） ──
ipcMain.handle('transcribe:submit', async (event, { audioPath, modelSize, useGpu, gpuDevice, source }) => {
  appLog('INFO', 'whisper', `提交辨識 job: ${audioPath} (model=${modelSize}, gpu=${useGpu})`)
  const result = whisperJobManager.addJob({ audioPath, modelSize, useGpu, gpuDevice, source })
  return result
})

ipcMain.handle('transcribe:jobStatus', async (event, { jobId }) => {
  const status = whisperJobManager.getStatus(jobId)
  return { success: true, job: status }
})

ipcMain.handle('transcribe:jobList', async () => {
  const jobs = whisperJobManager.listJobs()
  return { success: true, jobs }
})

ipcMain.handle('transcribe:jobCancel', async (event, { jobId }) => {
  const cancelled = whisperJobManager.cancelJob(jobId)
  return { success: true, cancelled }
})

ipcMain.handle('transcribe:jobClear', async () => {
  whisperJobManager.clearHistory()
  return { success: true }
})

ipcMain.handle('transcribe:jobDelete', async (event, { jobId }) => {
  const deleted = whisperJobManager.deleteJob(jobId)
  return { success: true, deleted }
})

ipcMain.handle('llm:jobDelete', async (event, { jobId }) => {
  const deleted = llmJobManager.deleteJob(jobId)
  return { success: true, deleted }
})

ipcMain.handle('transcribe:getResult', async (event, { jobId }) => {
  const job = whisperJobManager.getStatus(jobId)
  if (!job) return { success: false, error: '找不到 job' }
  if (job.status !== 'completed') return { success: false, error: 'job 尚未完成', status: job.status }
  return { success: true, result: job.result }
})

// ── 錄音歷史與全文檢索（支援樹狀目錄） ──

ipcMain.handle('reco:saveMeta', async (event, { recordingId, filename, recordingMode, recordedAt, duration, modelSize, segments, llmResults, audioPath, labels, folder, documents }) => {
  appLog('INFO', 'reco', `儲存 metadata: ${recordingId}`)
  try {
    const fullText = segments.map(s => s.text).join(' ')
    const meta = { id: recordingId, filename, recordingMode, recordedAt, duration, modelSize, segments, fullText, llmResults: llmResults || {}, audioPath: audioPath || '', labels: labels || [], documents: documents || [] }
    const baseDir = folder ? recoDataPath(folder) : recoDataPath()
    fs.mkdirSync(baseDir, { recursive: true })
    const metaPath = path.join(baseDir, `${recordingId}.json`)
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('reco:list', async (event, { labelFilter, folder } = {}) => {
  try {
    const baseDir = folder ? recoDataPath(folder) : recoDataPath()
    if (!fs.existsSync(baseDir)) return { success: true, folders: [], recordings: [] }
    const entries = fs.readdirSync(baseDir, { withFileTypes: true })
    const folders = entries.filter(e => e.isDirectory()).map(e => e.name).sort()
    const recordings = entries
      .filter(e => e.isFile() && e.name.endsWith('.json'))
      .map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(baseDir, f.name), 'utf-8'))
          const audioPath = data.audioPath || ''
          const hasAudio = audioPath ? fs.existsSync(audioPath) : false
          const labels = data.labels || []
          return { id: data.id, filename: data.filename, recordingMode: data.recordingMode, recordedAt: data.recordedAt, duration: data.duration, modelSize: data.modelSize, segmentCount: data.segments?.length || 0, hasAudio, audioPath, labels, folder: folder || '' }
        } catch { return null }
      }).filter(Boolean)
    let filtered = recordings
    if (labelFilter && labelFilter.trim()) {
      const lf = labelFilter.trim().toLowerCase()
      filtered = filtered.filter(item => item.labels.some(l => l.toLowerCase() === lf))
    }
    filtered.sort((a, b) => (b.recordedAt || '').localeCompare(a.recordedAt || ''))
    return { success: true, folders, recordings: filtered }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('reco:search', async (event, { keyword }) => {
  appLog('INFO', 'reco', `全文檢索: "${keyword}"`)
  try {
    const dir = recoDataPath()
    if (!fs.existsSync(dir)) return { success: true, results: [] }
    const files = scanJsonFiles(dir)
    const results = []
    for (const metaPath of files) {
      try {
        const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        const lowerKw = keyword.toLowerCase()
        const labels = data.labels || []
        const labelMatch = labels.some(l => l.toLowerCase().includes(lowerKw))
        const lowerFull = data.fullText.toLowerCase()
        if (lowerFull.includes(lowerKw) || labelMatch) {
          for (const seg of data.segments) {
            if (labelMatch || seg.text.toLowerCase().includes(lowerKw)) {
              results.push({ recordingId: data.id, filename: data.filename, recordedAt: data.recordedAt, start: seg.start, end: seg.end, text: seg.text, source: 'original', labels })
            }
          }
        }
        if (data.llmResults) {
          for (const [type, text] of Object.entries(data.llmResults)) {
            if (text && text.toLowerCase().includes(lowerKw)) {
              const typeLabels = { optimized: '✨ 優化', translated: '🌐 翻譯', summary: '📋 重點整理' }
              results.push({ recordingId: data.id, filename: data.filename, recordedAt: data.recordedAt, start: 0, end: 0, text: text.substring(0, 200) + (text.length > 200 ? '...' : ''), source: typeLabels[type] || type, labels })
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
    const files = scanJsonFiles(dir)
    let context = ''
    for (const metaPath of files) {
      try {
        const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        const labels = data.labels || []
        const labelStr = labels.length > 0 ? ` (標籤: ${labels.join(', ')})` : ''
        context += `--- 錄音: ${data.filename}${labelStr} (${data.recordedAt}) ---\n${data.fullText}\n\n`
      } catch {}
    }
    const prompt = `以下是多筆會議錄音的逐字稿內容：\n\n${context}\n\n請根據以上內容回答使用者的問題。請引用來源錄音檔名和時間戳。\n\n問題：${question}`
    const result = await callLLM(provider, apiKey, model, prompt,
      '你是一個專業的會議記錄分析師。根據提供的逐字稿內容回答問題，並標註資訊來源（錄音檔名、時間戳）。使用繁體中文。')
    return { success: true, result }
  } catch (e) { return { success: false, error: e.message } }
})

// ── Label 管理 ──

ipcMain.handle('reco:updateLabels', async (event, { recordingId, labels }) => {
  appLog('INFO', 'reco', `更新標籤: ${recordingId} labels=${JSON.stringify(labels)}`)
  try {
    const dir = recoDataPath()
    const files = scanJsonFiles(dir)
    let found = false
    for (const metaPath of files) {
      try {
        const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        if (data.id === recordingId) {
          data.labels = labels || []
          fs.writeFileSync(metaPath, JSON.stringify(data, null, 2), 'utf-8')
          found = true
          break
        }
      } catch {}
    }
    if (!found) return { success: false, error: `找不到記錄: ${recordingId}` }
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('reco:listLabels', async () => {
  try {
    const dir = recoDataPath()
    if (!fs.existsSync(dir)) return { success: true, labels: [] }
    const files = scanJsonFiles(dir)
    const labelSet = new Set()
    for (const metaPath of files) {
      try {
        const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        const labels = data.labels || []
        for (const l of labels) labelSet.add(l)
      } catch {}
    }
    const sorted = Array.from(labelSet).sort()
    return { success: true, labels: sorted }
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
    const dir = recoDataPath()
    const files = scanJsonFiles(dir)
    for (const metaPath of files) {
      try {
        const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        if (data.id === recordingId) return { success: true, meta: data }
      } catch {}
    }
    return { success: false, error: `找不到記錄: ${recordingId}` }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('reco:llmProcess', async (event, { recordingId, provider, apiKey, model, type }) => {
  appLog('INFO', 'reco', `LLM 處理: ${recordingId} type=${type}`)
  try {
    const dir = recoDataPath()
    const files = scanJsonFiles(dir)
    let metaPath = null, meta = null
    for (const mp of files) {
      try {
        const d = JSON.parse(fs.readFileSync(mp, 'utf-8'))
        if (d.id === recordingId) { metaPath = mp; meta = d; break }
      } catch {}
    }
    if (!meta) return { success: false, error: `找不到記錄: ${recordingId}` }
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
    const dir = recoDataPath()
    const files = scanJsonFiles(dir)
    for (const metaPath of files) {
      try {
        const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        if (data.id === recordingId) {
          fs.unlinkSync(metaPath)
          appLog('INFO', 'reco', `metadata 已刪除: ${recordingId}`)
          return { success: true }
        }
      } catch {}
    }
    return { success: false, error: `找不到記錄: ${recordingId}` }
  } catch (e) { return { success: false, error: e.message } }
})

// ── 批次刪除錄音記錄 ──

ipcMain.handle('reco:batchDelete', async (event, { recordingIds }) => {
  appLog('INFO', 'reco', `批次刪除: ${recordingIds.length} 筆`)
  try {
    const dir = recoDataPath()
    const files = scanJsonFiles(dir)
    let deleted = 0
    for (const metaPath of files) {
      try {
        const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        if (recordingIds.includes(data.id)) {
          // 刪除音檔
          if (data.audioPath && fs.existsSync(data.audioPath) && isPathSafe(data.audioPath)) {
            try { fs.unlinkSync(data.audioPath) } catch {}
          }
          fs.unlinkSync(metaPath)
          deleted++
        }
      } catch {}
    }
    appLog('INFO', 'reco', `批次刪除完成: ${deleted} 筆`)
    return { success: true, deleted }
  } catch (e) { return { success: false, error: e.message } }
})

// ── 刪除音檔（安全檢查） ──

ipcMain.handle('reco:deleteAudio', async (event, { audioPath }) => {
  appLog('INFO', 'reco', `刪除音檔: ${audioPath}`)
  try {
    if (!audioPath) return { success: false, error: '未指定音檔路徑' }
    if (!isPathSafe(audioPath)) {
      appLog('WARN', 'reco', `嘗試刪除目錄外的檔案: ${audioPath}`)
      return { success: false, error: '不允許刪除目錄外的檔案' }
    }
    if (!fs.existsSync(audioPath)) return { success: false, error: '音檔不存在' }
    fs.unlinkSync(audioPath)
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

// ── 取得音檔 URL ──

ipcMain.handle('reco:getAudioUrl', async (event, { audioPath }) => {
  try {
    if (!audioPath) return { success: false, error: '未指定音檔路徑' }
    const recoDir = recoDataPath()
    const resolved = path.resolve(audioPath)
    if (!resolved.startsWith(path.resolve(recoDir))) {
      return { success: false, error: '不允許存取目錄外的檔案' }
    }
    if (!fs.existsSync(resolved)) return { success: false, error: '音檔不存在' }
    const relativePath = path.relative(recoDir, resolved)
    const url = `reco-file:///${relativePath.replace(/\\/g, '/')}`
    return { success: true, url }
  } catch (e) { return { success: false, error: e.message } }
})

// ── 樹狀目錄管理 ──

ipcMain.handle('reco:createFolder', async (event, { folderName, parentFolder }) => {
  appLog('INFO', 'reco', `建立目錄: ${parentFolder || ''}/${folderName}`)
  try {
    const baseDir = parentFolder ? recoDataPath(parentFolder) : recoDataPath()
    const newDir = path.join(baseDir, folderName)
    if (!isPathSafe(newDir)) return { success: false, error: '不允許的路徑' }
    if (fs.existsSync(newDir)) return { success: false, error: '目錄已存在' }
    fs.mkdirSync(newDir, { recursive: true })
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('reco:deleteFolder', async (event, { folderPath }) => {
  appLog('INFO', 'reco', `刪除目錄: ${folderPath}`)
  try {
    const targetDir = recoDataPath(folderPath)
    if (!isPathSafe(targetDir)) return { success: false, error: '不允許的路徑' }
    if (!fs.existsSync(targetDir)) return { success: false, error: '目錄不存在' }
    // 遞迴刪除（含所有內容）
    fs.rmSync(targetDir, { recursive: true, force: true })
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('reco:renameFolder', async (event, { folderPath, newName }) => {
  appLog('INFO', 'reco', `重新命名目錄: ${folderPath} → ${newName}`)
  try {
    const parentDir = path.dirname(recoDataPath(folderPath))
    const oldDir = recoDataPath(folderPath)
    const newDir = path.join(parentDir, newName)
    if (!isPathSafe(oldDir) || !isPathSafe(newDir)) return { success: false, error: '不允許的路徑' }
    if (!fs.existsSync(oldDir)) return { success: false, error: '目錄不存在' }
    if (fs.existsSync(newDir)) return { success: false, error: '新名稱已存在' }
    fs.renameSync(oldDir, newDir)
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('reco:deleteLlmDoc', async (event, { recordingId, docId }) => {
  appLog('INFO', 'reco', `刪除 LLM 文件: ${recordingId} docId=${docId}`)
  try {
    const dir = recoDataPath()
    const files = scanJsonFiles(dir)
    for (const metaPath of files) {
      try {
        const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        if (data.id === recordingId) {
          const docs = data.documents || []
          const idx = docs.findIndex(d => d.id === docId)
          if (idx === -1) return { success: false, error: '找不到該文件' }
          const removed = docs.splice(idx, 1)[0]
          data.documents = docs
          // 若該類型的最新版 llmResults 與被刪除文件內容相同，一併清除
          if (data.llmResults && data.llmResults[removed.type] === removed.content) {
            data.llmResults[removed.type] = ''
          }
          fs.writeFileSync(metaPath, JSON.stringify(data, null, 2), 'utf-8')
          return { success: true }
        }
      } catch {}
    }
    return { success: false, error: `找不到記錄: ${recordingId}` }
  } catch (e) { return { success: false, error: e.message } }
})

// ── 聲紋說話者標註 ──

ipcMain.handle('voiceprint:status', async () => {
  return { success: true, cached: voiceprint.isModelCached() }
})

ipcMain.handle('voiceprint:download', async (event) => {
  appLog('INFO', 'voiceprint', '下載聲紋模型開始')
  try {
    await voiceprint.downloadModel((percent) => {
      if (mainWindow) mainWindow.webContents.send('voiceprint:download-progress', { percent })
    })
    appLog('INFO', 'voiceprint', '聲紋模型下載完成')
    return { success: true }
  } catch (e) {
    appLog('ERROR', 'voiceprint', `下載失敗: ${e.message}`)
    return { success: false, error: e.message }
  }
})

ipcMain.handle('voiceprint:diarize', async (event, { audioPath, segments }) => {
  appLog('INFO', 'voiceprint', `說話者標註開始: ${audioPath} (${segments.length} 句)`)
  try {
    const result = await voiceprint.diarizeAudio(audioPath, segments, (percent) => {
      if (mainWindow) mainWindow.webContents.send('voiceprint:progress', { percent })
    })
    appLog('INFO', 'voiceprint', `說話者標註完成: ${result.length} 句`)
    return { success: true, segments: result }
  } catch (e) {
    appLog('ERROR', 'voiceprint', `說話者標註失敗: ${e.message}`)
    return { success: false, error: e.message }
  }
})

// ── Voiceprint Job IPC Handlers（v1.20.2） ──
ipcMain.handle('voiceprint:jobSubmit', async (event, { audioPath, segments, recordingId }) => {
  try {
    const jobId = voiceprintJobManager.addJob({ audioPath, segments, recordingId })
    return { success: true, jobId }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('voiceprint:jobStatus', async (event, { jobId }) => {
  try {
    const job = voiceprintJobManager.getJobStatus(jobId)
    return { success: true, job }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('voiceprint:jobList', async () => {
  try {
    const jobs = voiceprintJobManager.listJobs()
    return { success: true, jobs }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('voiceprint:jobCancel', async (event, { jobId }) => {
  try {
    const cancelled = voiceprintJobManager.cancelJob(jobId)
    return { success: true, cancelled }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('voiceprint:jobDelete', async (event, { jobId }) => {
  try {
    const deleted = voiceprintJobManager.deleteJob(jobId)
    return { success: true, deleted }
  } catch (e) { return { success: false, error: e.message } }
})

// ── Voiceprint 重設（清除損壚的模型檔案，v1.20.2） ──
ipcMain.handle('voiceprint:reset', async () => {
  appLog('INFO', 'voiceprint', '重設聲紋模型檔案')
  try {
    const ok = voiceprint.resetModel()
    return { success: ok }
  } catch (e) {
    appLog('ERROR', 'voiceprint', `重設失敗: ${e.message}`)
    return { success: false, error: e.message }
  }
})

ipcMain.handle('reco:listAllFolders', async () => {
  appLog('INFO', 'reco', '列出所有子目錄')
  try {
    const dir = recoDataPath()
    if (!fs.existsSync(dir)) return { success: true, folders: [] }
    const folders = []
    function scanDirs(currentPath, relativePath) {
      try {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true })
        for (const e of entries) {
          if (e.isDirectory()) {
            const subRel = relativePath ? `${relativePath}/${e.name}` : e.name
            folders.push(subRel)
            scanDirs(path.join(currentPath, e.name), subRel)
          }
        }
      } catch {}
    }
    scanDirs(dir, '')
    folders.sort()
    return { success: true, folders }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('reco:moveRecordings', async (event, { recordingIds, targetFolder }) => {
  appLog('INFO', 'reco', `移動 ${recordingIds.length} 筆記錄到: ${targetFolder || '根目錄'}`)
  try {
    const targetDir = targetFolder ? recoDataPath(targetFolder) : recoDataPath()
    fs.mkdirSync(targetDir, { recursive: true })
    if (!isPathSafe(targetDir)) return { success: false, error: '不允許的路徑' }
    const dir = recoDataPath()
    const files = scanJsonFiles(dir)
    let moved = 0
    for (const metaPath of files) {
      try {
        const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        if (recordingIds.includes(data.id)) {
          // 移動 JSON
          const newMetaPath = path.join(targetDir, path.basename(metaPath))
          fs.renameSync(metaPath, newMetaPath)
          // 移動音檔
          if (data.audioPath && fs.existsSync(data.audioPath) && isPathSafe(data.audioPath)) {
            const newAudioPath = path.join(targetDir, path.basename(data.audioPath))
            try { fs.renameSync(data.audioPath, newAudioPath) } catch {}
            // 更新 JSON 中的 audioPath
            data.audioPath = newAudioPath
            fs.writeFileSync(newMetaPath, JSON.stringify(data, null, 2), 'utf-8')
          }
          moved++
        }
      } catch {}
    }
    appLog('INFO', 'reco', `移動完成: ${moved} 筆`)
    return { success: true, moved }
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

// ── 自訂 protocol ──

function registerRecoFileProtocol() {
  const recoDir = recoDataPath()
  try { fs.mkdirSync(recoDir, { recursive: true }) } catch {}
  session.defaultSession.protocol.registerFileProtocol('reco-file', (request, callback) => {
    try {
      const relativePath = decodeURIComponent(request.url.replace('reco-file:///', ''))
      const fullPath = path.resolve(recoDir, relativePath)
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
  llmJobManager.setMainWindow(mainWindow)
  whisperJobManager.setMainWindow(mainWindow)
  voiceprintJobManager.setMainWindow(mainWindow)
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