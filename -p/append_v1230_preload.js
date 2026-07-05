const fs = require('fs')
const path = 'c:/Users/humphery/coding/recoder/frontend/electron/preload.js'
let src = fs.readFileSync(path, 'utf8')

const anchor = '  voiceprintGetCurrentModel: () => ipcRenderer.invoke(\'voiceprint:getCurrentModel\'),\n})'

if (src.includes('voiceprintProfileList')) {
  console.log('SKIP: v1.23.0 preload already present')
} else {
  const lines = [
    '  voiceprintGetCurrentModel: () => ipcRenderer.invoke(\'voiceprint:getCurrentModel\'),',
    '',
    '  // v1.23.0: Speaker Profile Database + 有監督 speaker recognition',
    '  voiceprintProfileList: () => ipcRenderer.invoke(\'voiceprint:profileList\'),',
    '  voiceprintProfileSave: (p) => ipcRenderer.invoke(\'voiceprint:profileSave\', p),',
    '  voiceprintProfileRename: (p) => ipcRenderer.invoke(\'voiceprint:profileRename\', p),',
    '  voiceprintProfileDelete: (p) => ipcRenderer.invoke(\'voiceprint:profileDelete\', p),',
    '  voiceprintProfileStats: () => ipcRenderer.invoke(\'voiceprint:profileStats\'),',
    '  voiceprintProfileBuildFromSeeds: (p) => ipcRenderer.invoke(\'voiceprint:profileBuildFromSeeds\', p),',
    '  voiceprintProfileBuildFromAudioFile: (p) => ipcRenderer.invoke(\'voiceprint:profileBuildFromAudioFile\', p),',
    '  voiceprintOpenAudioDialog: () => ipcRenderer.invoke(\'voiceprint:openAudioDialog\'),',
    '  voiceprintIdentifySpeakers: (p) => ipcRenderer.invoke(\'voiceprint:identifySpeakers\', p),',
    '  voiceprintBackfillAll: (p) => ipcRenderer.invoke(\'voiceprint:backfillAll\', p || {}),',
    '  voiceprintListAllSpeakerNames: () => ipcRenderer.invoke(\'voiceprint:listAllSpeakerNames\'),',
    '  onVoiceprintBackfillProgress: (cb) => {',
    '    const h = (event, data) => cb(data); ipcRenderer.on(\'voiceprint:backfill-progress\', h)',
    '    return () => ipcRenderer.removeListener(\'voiceprint:backfill-progress\', h)',
    '  },',
    '  // v1.23.0: 跨錄音 speaker-aware 搜尋',
    '  recoSearchBySpeaker: (p) => ipcRenderer.invoke(\'reco:searchBySpeaker\', p),',
    '})',
  ]
  const replacement = lines.join('\n')
  src = src.replace(anchor, replacement)
  fs.writeFileSync(path, src, 'utf8')
  console.log('OK: appended v1.23.0 preload')
}