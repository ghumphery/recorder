const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')

// 全域錯誤處理
process.on('uncaughtException', (err) => {
  console.error(`[FATAL] ${err.message}`)
  console.error(err.stack)
})
process.on('unhandledRejection', (reason) => {
  console.error(`[FATAL] Unhandled Rejection: ${reason}`)
})

let mainWindow = null
let backendProcess = null
const BACKEND_PORT = 5199
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`

function startBackend() {
  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev')

  if (isDev) {
    // 開發模式：啟動 Python 腳本
    const backendScript = path.join(__dirname, '..', '..', 'backend', 'server.py')
    const python = process.platform === 'win32' ? 'python' : 'python3'
    console.log(`[backend] 開發模式: ${python} ${backendScript}`)
    backendProcess = spawn(python, [backendScript], {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, FLASK_PORT: String(BACKEND_PORT) },
      stdio: 'pipe',
    })
  } else {
    // 生產模式：啟動 extraResources 中的後端 exe
    // 嘗試多個可能的路徑（portable exe 解壓到暫存目錄時路徑可能不同）
    const possiblePaths = [
      path.join(process.resourcesPath, 'RecoderBackend'),
      path.join(path.dirname(process.execPath), 'resources', 'RecoderBackend'),
      path.join(process.cwd(), 'resources', 'RecoderBackend'),
    ]
    let backendDir = null
    let backendExe = null
    for (const p of possiblePaths) {
      const exe = path.join(p, 'RecoderBackend.exe')
      if (fs.existsSync(exe)) {
        backendDir = p
        backendExe = exe
        break
      }
    }
    console.log(`[backend] 生產模式`)
    console.log(`[backend] resourcesPath: ${process.resourcesPath}`)
    console.log(`[backend] execPath: ${process.execPath}`)
    console.log(`[backend] cwd: ${process.cwd()}`)
    console.log(`[backend] found backendDir: ${backendDir}`)
    console.log(`[backend] found backendExe: ${backendExe}`)
    if (!backendExe) {
      console.error(`[backend] 找不到 RecoderBackend.exe！嘗試路徑:`)
      possiblePaths.forEach(p => console.error(`  ${p}`))
      return
    }
    // 使用 spawn 啟動後端（detached + unref，確保獨立於 Electron 生命週期）
    console.log(`[backend] 啟動: ${backendExe}`)
    console.log(`[backend] 工作目錄: ${backendDir}`)
    try {
      backendProcess = spawn(backendExe, [], {
        cwd: backendDir,
        env: { ...process.env },
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
      })
      backendProcess.unref()
      console.log(`[backend] PID: ${backendProcess.pid}`)
    } catch (e) {
      console.error(`[backend] spawn 失敗: ${e.message}`)
    }
  }

  if (backendProcess) {
    backendProcess.stdout.on('data', (data) => {
      console.log(`[backend:stdout] ${data.toString().trim()}`)
    })
    backendProcess.stderr.on('data', (data) => {
      console.error(`[backend:stderr] ${data.toString().trim()}`)
    })
    backendProcess.on('error', (err) => {
      console.error(`[backend:error] ${err.message}`)
      backendProcess = null
    })
    backendProcess.on('close', (code, signal) => {
      console.log(`[backend] exited code=${code} signal=${signal}`)
      backendProcess = null
    })
  }
}

function createWindow() {
  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev')

  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 500,
    title: 'Recoder — AI 會議記錄',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// IPC handlers
ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: '音訊檔案', extensions: ['wav', 'mp3', 'opus', 'ogg', 'flac', 'm4a'] },
      { name: '所有檔案', extensions: ['*'] },
    ],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:saveFile', async (event, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || '會議記錄.txt',
    filters: [
      { name: '純文字', extensions: ['txt'] },
      { name: 'Markdown', extensions: ['md'] },
    ],
  })
  return result.canceled ? null : result.filePath
})

ipcMain.handle('get:backendUrl', () => BACKEND_URL)

app.whenReady().then(() => {
  startBackend()
  createWindow()
})

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill()
    backendProcess = null
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})