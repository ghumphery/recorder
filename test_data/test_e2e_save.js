// test_data/test_e2e_save.js
// E2E test: 模擬前端在 transcription 完成後呼叫 saveRecordingMeta 的 IPC 路徑
// 用途：驗證 reco:saveMeta 是否能正確寫入 metadata 並能被 reco:list 讀回
//
// 用法：在 frontend/ 目錄下執行 `node ../test_data/test_e2e_save.js`
//
// 流程：
// 1. 直接呼叫後端 IPC handler 等價函式（呼叫內部 helper，不啟動 Electron）
// 2. 模擬三種情境：
//    a. 正常匯入 → 設定 audioInfo → submit job → 完成 → saveMeta → list
//    b. 使用者中途切換分頁（audioInfo 仍在）→ saveMeta 應成功
//    c. audioInfo 被清空（模擬） → saveMeta 應跳過（early return）

const path = require('path')
const fs = require('fs')
const os = require('os')

// 直接 require main.js 中的 helper（避開 Electron 啟動）
// 改為：直接呼叫 ipcMain handler 等價邏輯
const main = require('../frontend/electron/main.js')