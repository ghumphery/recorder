// 一次性 script: 在 main.js 末尾前插入 v1.23.0 全部新 IPC handlers
const fs = require('fs')
const path = 'c:/Users/humphery/coding/recoder/frontend/electron/main.js'
let src = fs.readFileSync(path, 'utf8')

// 找錨點: voiceprint:reset handler 結尾 (在 registerRecoFileProtocol 之前)
const anchor = `// ── 聲紋說話者標註 ──`
const ipcBlock = `// v1.23.0: Speaker Profile Database CRUD
ipcMain.handle('voiceprint:profileList', async () => {
  try {
    const profiles = speakerProfile.listProfiles()
    const stats = speakerProfile.getStats()
    return { success: true, profiles, stats }
  } catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('voiceprint:profileSave', async (event, profile) => {
  try { return speakerProfile.saveProfile(profile) }
  catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('voiceprint:profileRename', async (event, { id, newName }) => {
  try { return speakerProfile.renameProfile(id, newName) }
  catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('voiceprint:profileDelete', async (event, { id }) => {
  try { return speakerProfile.deleteProfile(id) }
  catch (e) { return { success: false, error: e.message } }
})

ipcMain.handle('voiceprint:profileStats', async () => {
  try { return { success: true, ...speakerProfile.getStats() } }
  catch (e) { return { success: false, error: e.message } }
})

// v1.23.0: 從 seeds 建立 profile
ipcMain.handle('voiceprint:profileBuildFromSeeds', async (event, { audioPath, segments, seeds, modelKey }) => {
  appLog('INFO', 'voiceprint', `buildProfile: ${audioPath} (${seeds.length} seeds, modelKey=${modelKey})`)
  try {
    const profiles = await voiceprint.buildProfile(audioPath, segments, seeds, modelKey)
    // 自動儲存到 profile DB
    const savedIds = []
    for (const p of profiles) {
      const r = speakerProfile.saveProfile(p)
      if (r.success) savedIds.push(r.id)
    }
    appLog('INFO', 'voiceprint', `建立 ${savedIds.length}/${profiles.length} 個 profile`)
    return { success: true, profiles, savedIds, count: savedIds.length }
  } catch (e) {
    appLog('ERROR', 'voiceprint', `buildProfile 失敗: ${e.message}`)
    return { success: false, error: e.message }
  }
})

// v1.23.0: 從獨立短音檔建立 profile
ipcMain.handle('voiceprint:profileBuildFromAudioFile', async (event, { audioPath, name, modelKey }) => {
  appLog('INFO', 'voiceprint', `buildProfileFromAudioFile: ${audioPath} name=${name} modelKey=${modelKey}`)
  try {
    const p = await voiceprint.buildProfileFromAudioFile(audioPath, name, modelKey)
    const r = speakerProfile.saveProfile(p)
    if (r.success) return { success: true, profile: { ...p, id: r.id }, id: r.id }
    return r
  } catch (e) {
    appLog('ERROR', 'voiceprint', `buildProfileFromAudioFile 失敗: ${e.message}`)
    return { success: false, error: e.message }
  }
})

// v1.23.0: 開啟檔案選擇器選擇音檔 (用於 profile 建立)
ipcMain.handle('voiceprint:openAudioDialog', async () => {
  try {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '選擇音檔',
      properties: ['openFile'],
      filters: [
        { name: '音訊檔案', extensions: ['wav', 'mp3', 'opus', 'ogg', 'flac', 'm4a', 'webm'] },
        { name: '所有檔案', extensions: ['*'] }
      ]
    })
    if (r.canceled || r.filePaths.length === 0) return { success: false, cancelled: true }
    return { success: true, path: r.filePaths[0] }
  } catch (e) { return { success: false, error: e.message } }
})

// v1.23.0: 有監督式 speaker identification
ipcMain.handle('voiceprint:identifySpeakers', async (event, { audioPath, segments, modelKey, threshold }) => {
  appLog('INFO', 'voiceprint', `identifySpeakers: ${audioPath} (${segments.length} 句, modelKey=${modelKey})`)
  try {
    const profiles = speakerProfile.getProfilesByModel(modelKey || 'camplus')
    if (profiles.length === 0) {
      return { success: false, error: `沒有 modelKey=${modelKey} 的 profile，請先建立 speaker profile`, profiles: [] }
    }
    const opts = {}
    if (typeof threshold === 'number') opts.threshold = threshold
    const r = await voiceprint.identifySpeakers(audioPath, segments, profiles, opts)
    appLog('INFO', 'voiceprint', `辨識完成: ${r.matches.length} 個 segment 匹配到 profiles`)
    return { success: true, segments: r.segments, matches: r.matches, modelKey: r.modelKey }
  } catch (e) {
    appLog('ERROR', 'voiceprint', `identifySpeakers 失敗: ${e.message}`)
    return { success: false, error: e.message }
  }
})

// v1.23.0: 批次對所有歷史錄音套用所有 profiles
ipcMain.handle('voiceprint:backfillAll', async (event, { modelKey, threshold } = {}) => {
  appLog('INFO', 'voiceprint', `backfillAll: 對所有歷史錄音套用 profiles (modelKey=${modelKey})`)
  try {
    const profiles = speakerProfile.getProfilesByModel(modelKey || 'camplus')
    if (profiles.length === 0) return { success: false, error: '無 profile', processed: 0 }
    const dir = recoDataPath()
    if (!fs.existsSync(dir)) return { success: true, processed: 0 }
    const files = scanJsonFiles(dir)
    const metaFiles = files.filter(f => f.endsWith('.json'))
    let processed = 0
    let matched = 0
    const startTime = Date.now()
    for (let i = 0; i < metaFiles.length; i++) {
      const metaPath = metaFiles[i]
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        if (!meta.segments || meta.segments.length === 0 || !meta.audioPath) continue
        if (!fs.existsSync(meta.audioPath)) continue
        // 推播進度
        if (mainWindow) mainWindow.webContents.send('voiceprint:backfill-progress', {
          current: i + 1, total: metaFiles.length, recordingId: meta.id
        })
        const opts = {}
        if (typeof threshold === 'number') opts.threshold = threshold
        const r = await voiceprint.identifySpeakers(meta.audioPath, meta.segments, profiles, opts)
        // 寫回 metadata
        for (let j = 0; j < r.segments.length && j < meta.segments.length; j++) {
          meta.segments[j].speaker = r.segments[j].speaker || meta.segments[j].speaker || ''
          if (r.segments[j].score !== undefined) meta.segments[j].score = r.segments[j].score
        }
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
        processed++
        matched += r.matches.length
      } catch (e) {
        appLog('WARN', 'voiceprint', `backfill 跳過 ${metaPath}: ${e.message}`)
      }
    }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    appLog('INFO', 'voiceprint', `backfillAll 完成: ${processed} 個錄音, ${matched} 個匹配, ${elapsed}s`)
    return { success: true, processed, matched, elapsed }
  } catch (e) {
    appLog('ERROR', 'voiceprint', `backfillAll 失敗: ${e.message}`)
    return { success: false, error: e.message }
  }
})

// v1.23.0: 跨錄音 speaker-aware 搜尋
ipcMain.handle('reco:searchBySpeaker', async (event, { speakerName, keyword }) => {
  appLog('INFO', 'reco', `searchBySpeaker: speakerName="${speakerName}" keyword="${keyword || ''}"`)
  try {
    const dir = recoDataPath()
    if (!fs.existsSync(dir)) return { success: true, results: [] }
    const files = scanJsonFiles(dir)
    const results = []
    for (const metaPath of files) {
      try {
        const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        if (!Array.isArray(data.segments)) continue
        for (let i = 0; i < data.segments.length; i++) {
          const seg = data.segments[i]
          if (seg.speaker !== speakerName) continue
          // 若有 keyword 過濾文字
          if (keyword && !seg.text.toLowerCase().includes(keyword.toLowerCase())) continue
          results.push({
            recordingId: data.id,
            filename: data.filename,
            recordedAt: data.recordedAt,
            start: seg.start,
            end: seg.end,
            text: seg.text,
            speaker: seg.speaker,
            score: seg.score || 0,
            source: 'original',
          })
        }
      } catch {}
    }
    appLog('INFO', 'reco', `searchBySpeaker 完成: ${results.length} 個結果`)
    return { success: true, results, count: results.length }
  } catch (e) {
    appLog('ERROR', 'reco', `searchBySpeaker 失敗: ${e.message}`)
    return { success: false, error: e.message }
  }
})

// v1.23.0: 列出所有 speaker 名稱 (從 profile DB + 所有錄音 metadata)
ipcMain.handle('voiceprint:listAllSpeakerNames', async () => {
  try {
    const nameSet = new Set()
    // 從 profiles
    for (const p of speakerProfile.listProfiles()) nameSet.add(p.name)
    // 從所有錄音 metadata 的 segments[].speaker
    const dir = recoDataPath()
    if (fs.existsSync(dir)) {
      for (const metaPath of scanJsonFiles(dir)) {
        try {
          const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          if (Array.isArray(data.segments)) {
            for (const seg of data.segments) {
              if (seg.speaker && seg.speaker.startsWith('Speaker_') === false) {
                nameSet.add(seg.speaker)
              }
            }
          }
        } catch {}
      }
    }
    return { success: true, names: Array.from(nameSet).sort() }
  } catch (e) { return { success: false, error: e.message } }
})

`

if (src.includes('voiceprint:profileList')) {
  console.log('SKIP: v1.23.0 IPC handlers already present')
} else {
  src = src.replace(anchor, ipcBlock + '\n' + anchor)
  fs.writeFileSync(path, src, 'utf8')
  console.log('OK: appended v1.23.0 IPC handlers')
}