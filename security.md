# 資安合規檢查清單 (Security Checklist)

Recoder 為離線 AI 會議記錄工具，所有資料皆於本地處理，不上傳雲端。每次交付前須確認以下項目。

## 1. 資料隱私
- [ ] 錄音檔僅儲存在使用者本機目錄。
- [ ] 轉譯結果與說話者資料不寫入遠端服務。
- [ ] 不收集使用者行為日誌或遙測資料。

## 2. 網路連線
- [ ] 僅於「首次下載語音模型」時連線 Hugging Face。
- [ ] 模型下載完成後，後續執行無需網路。
- [ ] 下載透過 Node.js `https` 模組，下載到本地 `model/` 目錄。

## 3. 機敏資訊
- [ ] 程式碼與設定檔不含 API key、密碼、私人 token。
- [ ] 除錯日誌不記錄檔案內容、轉譯文字或使用者個資（記錄於 `%TEMP%\recoder-debug.log`）。

## 4. CLI 工具安全
- [ ] `whisper-cli.exe` 從 ggerganov/whisper.cpp 官方原始碼自行編譯，無第三方依賴。
- [ ] `ffmpeg.exe` 來自官方 ffmpeg.org 版本。
- [ ] 不使用來路不明的第三方執行檔。

## 5. 檔案權限
- [ ] 應用程式目錄下的 `model/`、`backup/` 僅供當前使用者寫入。
- [ ] 不嘗試寫入系統目錄或需要管理員權限的路徑。

## 6. 輸入驗證
- [ ] 匯入音檔時檢查副檔名與格式，避免處理非音訊檔案。
- [ ] Vue 狀態機 (`busy` 屬性) 防止重複點擊導致的資源競用。
- [ ] 錯誤處理不暴露底層堆疊給終端使用者（除錯日誌記錄於 `%TEMP%\recoder-debug.log`）。

## 7. 備份與復原
- [ ] 每次修改完成後建立 `backup/backup-YYYYMMDDHHmm.zip`。
- [ ] 原始碼備份不包含 `node_modules`、`build/` 或 `dist/` 目錄。

## 檢查方式
```bash
# 檢視是否有潛在機敏字串
git grep -i "api_key\|token\|password\|secret" -- "*.js" "*.vue" "*.json"

# 檢查 whisper-cli 版本
frontend\dist-electron\win-unpacked\resources\whisper_cli\whisper-cli.exe --version