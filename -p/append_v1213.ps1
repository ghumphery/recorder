$content = @"

## [2026-07-01 09:00] v1.21.3 — 逐字稿講者標籤顯示每一句的聲紋值

- **version**: 1.21.2 → 1.21.3（minor: 新功能）
- **修改要求**: 使用者反映「在逐字稿講者標記顯示每一句的聲紋值」— 希望除了「誰說的」之外還能看出「這句與該 speaker 的相似度有多高」，方便判斷標註可信度。
- **背景**: v1.20.2 `diarizeAudio` 與 v1.21.0 `propagateSpeakers` 演算法都會對每個 segment 計算 cosine similarity（`diarize` 算 vs 群組 centroid；`propagate` 算 vs 種子 centroid），但之前只回傳 `.speaker` 標籤而把 score 丟掉了。
- **修正方案**:
  1. `frontend/electron/voiceprint.js`：
     - `diarizeAudio()`：重新計算每個群組的 centroid，再對每個 segment 用 `cosineSimilarity()` 算對其群組 centroid 的相似度，存入 `result[i].score`。原本 algorithm 已將 centroid 算出來過，但因沒回傳就直接丟了，現在手動重建以取出每群組的 centroid。
     - `propagateSpeakers()`：本來就已經在算 `bestSim`，改為直接存入 `result[i].score`（取 `Math.max(0, bestSim)` 保證非負）。
     - 兩者都對無效的 segment（null embedding）回傳 `score: 0`。
  2. `frontend/src/App.vue`：
     - `initJobListener` 的 voiceprint completed 分支：把 `data.segments[i].score` 同步寫入 `transcriptionResults[i].score`。
     - `doPropagateSpeakers`：同樣寫入 `transcriptionResults[i].score`。
     - 逐字稿 speaker tag 旁邊增加 `<span class="speaker-score">{{ (seg.score * 100).toFixed(0) }}</span>`，用半透明背景呈現百分比（例：`👤 張三 85`），hover 顯示完整 1 位小數。
  3. 新增 `.speaker-score` CSS：白色半透明背景、9px 字、6px radius，與 `.speaker-tag` 並列顯示。
  4. `frontend/package.json`: version 1.21.2 → 1.21.3
  5. 三語 modify_record 新增本條目
  6. `Product_Design_Guidelines.md` 版本號更新
- **修改結果**:
  - 執行 👥 標註說話者 或 🪄 依標註推算 後，每一句的 speaker tag 後方多了一個 0~100 的相似度數字
  - 高於 80% = 高可信度、50-80% = 中等、< 50% = 低（該 segment 跟所屬 speaker 群的 centroid 相似度不高，可能需要重新編輯或加 seed）
  - score 與 speaker 一起持久化到 metadata，重新開啟逐字稿後仍可見
- **備份檔名**: 將於備份步驟產生
"@
Add-Content -Path "c:\Users\humphery\coding\recoder\modify_record.md" -Value $content -Encoding utf8
Add-Content -Path "c:\Users\humphery\coding\recoder\modify_record_en.md" -Value $content -Encoding utf8
Add-Content -Path "c:\Users\humphery\coding\recoder\modify_record_ja.md" -Value $content -Encoding utf8
Write-Host "Done appending v1.21.3 entries"