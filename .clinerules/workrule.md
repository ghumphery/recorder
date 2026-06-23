# 開發作業規範 (Development Protocol)

請嚴格遵循以下指令，確保開發流程與紀錄的完整性：

## 1. 執行環境與前置要求
- **版本控制**：使用 git 進行檔案版本管理。 
- **隔離環境**：所有程式執行與編譯必須在 `conda -n airecoder` 虛擬環境中進行（僅限後端 Python 相關作業）。
- **前端環境**：Electron + Vue.js 前端開發需 Node.js 20+，相關依賴在 `frontend/` 目錄下管理。
- **狀態確認**：開始任何修改前，**首要任務**是完整閱讀 `Product_Design_Guidelines.md`，確保掌握最新進度與專案狀態。

## 2. 功能測試與交付標準
- **驗證要求**：程式碼修改後，必須執行完整的功能測試，確認符合預期。
- **資安合規**：程式製作完成，需執行 `security.md` 要求並通過。
- **產出物**：
  - 後端：使用 `pyinstaller` 產出 `RecoderBackend.exe`（已棄用，v1.2.0 後無需 Python 後端）
  - 前端：使用 `electron-builder` 產出 `Recoder-{version}-portable.exe`
- **核心指令**：
  - 每次修改均須更新版本(version)號碼，定義於 `frontend/package.json` 的 `version` 欄位
  - 主版號 (Major)：大幅修改架構或不相容的重大更新時遞增
  - 次版號 (Minor)：向下相容的新增功能或微調時遞增
  - 修訂號 (Patch)：修復 bug 或小幅度調整時遞增
- **原始碼備份**：完成功能測試和交付後需進行原始碼備份。

## 3. 自動化備份規範
每次完成修改任務，立即將原始碼壓縮並存檔：
- **存放目錄**：`backup/`
- **命名規則**：`backup-<YYYYMMDDHHmm>.zip`
- **範例**：`backup-202604291030.zip`
- **備份排除**：備份不包含 AI 模型(model/)、前端依賴(frontend/node_modules/)、編譯輸出(build/、frontend/dist-electron/)。

## 4. 紀錄與文件維護
所有異動必須同步更新於以下 3 個檔案：

### A. 修改日誌 (modify_record.md)
- 使用 append 方式累加紀錄，保留歷史紀錄（不要異動舊記錄），每筆紀錄必須包含：
  - **[時間標記]**：紀錄日期與時間。
  - **版本號碼**: version: x.x.x（對應 `frontend/package.json` 的 version）
  - **修改要求**：描述本次任務的具體問題或目標。
  - **修改規劃**：說明預計更動的邏輯、影響檔案或採用的演算法。
  - **修改結果**：記錄最終實作狀況、測試結論及備份檔名。

### B. 說明文件 (readme.md)
- 更新使用者導向的修改說明，確保使用者能理解本次版本的變更內容。

### C. 產品設計指引 (Product_Design_Guidelines.md)
- 請務必維持並更新以下結構（若新功能涉及新分類，可適度擴充，但核心結構不可混亂）：
  - **產品核心願景與哲學 (Product Vision & Philosophy)**
     - 一句話定義產品核心價值。
     - 開發的核心原則（例如：離線優先、輕量高效、隱私保障等）。
  - **架構與技術規範 (Architecture & Tech Guidelines)**
     - 軟體架構原則（例如：IPC 通訊、CLI 工具整合）。
     - 版本號管理規範（定義於 `frontend/package.json`，視窗標題動態顯示）。
  - **CLI 工具規範 (CLI Tools Guidelines)**
     - whisper-cli.exe 與 ffmpeg.exe 的參數與使用方式。
  - **功能模組與業務邏輯 (Functional Modules & Business Logic)**
     - [條列現有核心模組] 及其核心運作邏輯（每次新功能加入時，需在此處新增或修改邏輯說明）。
     - 避免重複造輪子的模組化指南。
  - **UI/UX 與交互規範 (UI/UX & Interaction Principles)**
     - 介面設計的通用邏輯（例如：錯誤處理提示機制、防呆機制）。
     - 視窗標題格式規範：須包含版本號。
- 輸出限制與要求
  - **不要刪除舊有核心邏輯**：更新是「增量」或「修正」，除非新功能取代了舊功能，否則不可遺漏舊有的規範。
  - **保持簡潔與具體**：寫出具體的技術與設計指導，避免空泛的形容詞。
  - **高可讀性**：使用 Markdown 的標題、粗體、條列式，確保開發者能在 3 分鐘內讀完變更重點。
  - **修改日期**：記錄產品設計指引版本和修改日期。