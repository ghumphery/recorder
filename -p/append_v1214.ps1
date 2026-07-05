$content = @"

## [2026-07-01 15:00] v1.21.4 — 強化多 seed centroid 計算 (trimmed mean + outlier rejection)

- **version**: 1.21.3 → 1.21.4（minor: 演算法強化）
- **修改要求**: 使用者反映「同時標注同一個人的多段句子是否可以提升語音比對準確度」— 想確認是否真的能幫助半監督式 speaker propagation。
- **回答**: 是的，可以，但「不是 seed 越多越好」。多個同一 speaker 的 embeddings 平均後的 centroid 會更穩定，減少單一 segment 受 fbank 雜訊、背景音、語速變化影響。但**邊際效益遞減**：3-5 個乾淨的 seed 已足夠，10+ 個 seed 提升有限。**真正危險的是 outlier seed**（咳嗽、背景音、按鍵聲）會把 centroid 拉偏。
- **修正方案**:
  1. `frontend/electron/voiceprint.js` `propagateSpeakers()`:
     - 1-2 個 seeds：取 simple mean（沒有足夠統計量剔除 outlier）
     - 3 個以上 seeds：採用 **trimmed mean centroid**：
       - 對所有 seed embeddings 兩兩算 cosine similarity
       - 計算每個 seed 與其他 seed 的平均相似度作為「內部一致性指標」
       - 去掉平均相似度最低與最高各一個 (outlier) → 取中間值的平均
       - 同時記錄 `internalCoherence`（全體 seeds 內部一致性平均）作為品質指標
  2. 1-2 個 seeds 時不剔除 outlier，3 個以上用 floor(seedCount/4) 計算 dropN，但 dropN 最大只到 1（避免剔除過多）
- **修改結果**:
  - 多個同一 speaker 的 seeds 標注後，centroid 更穩定，可靠度提升
  - 自動剔除 outlier seed（背景雜音、按鍵聲、與該 speaker 不相關的句子）造成的 centroid 偏移
  - 學理上：3-5 個乾淨的 seed 是甜蜜點，10+ 個 seeds 提升有限
- **備份檔名**: 將於備份步驟產生
"@
Add-Content -Path "c:\Users\humphery\coding\recoder\modify_record.md" -Value $content -Encoding utf8
Add-Content -Path "c:\Users\humphery\coding\recoder\modify_record_en.md" -Value $content -Encoding utf8
Add-Content -Path "c:\Users\humphery\coding\recoder\modify_record_ja.md" -Value $content -Encoding utf8
Write-Host "Done appending v1.21.4 entries"