// test_e2e_save.js
// E2E test for v1.20.14 recording-history UI refresh bug fix.
//
// Root cause that we are guarding against:
//   saveRecordingMeta wrote metadata JSON to disk via recoSaveMeta IPC,
//   but no code path called loadHistory() afterward, so the UI list
//   stayed stale until manual refresh.
//
// Scope: this file documents the diagnostic and verification plan.
// It is intentionally NOT auto-run because saveRecordingMeta is bound
// to a running Vue + Electron renderer (requires ipcRenderer + Vue
// reactivity), which is awkward to instantiate from plain Node.
//
// Manual reproduction steps (preferred over an automated test):
//   1. Launch the Recorder-1.20.14-portable.exe
//   2. Open devtools and watch the console for saveRecordingMeta logs
//   3. Import a new audio file and click Transcribe
//   4. Wait for the "已轉錄 N 句" status
//   5. Switch to the History tab without manually pressing refresh
//   Expected: the new record appears at the top of historyList
//   Console log: "[saveRecordingMeta] saved metadata: <id> (segments=N, audioPath=...)"
//
// If audioInfo becomes empty mid-flight, the warning fires:
//   console.warn('[saveRecordingMeta] skipped: audioInfo is empty ...')
// and the save is bypassed safely without breaking the outer flow.

module.exports = {
  name: 'test_e2e_save',
  description: 'E2E plan for v1.20.14 recording-history UI refresh bug fix',
  manual: true,
}