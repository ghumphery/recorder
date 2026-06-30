const fs = require('fs')
const path = 'C:\\Users\\humphery\\recoder\\reco_data\\recoder_record_1782110748268.wav.json'
const d = JSON.parse(fs.readFileSync(path, 'utf8'))
const segs = d.transcription
console.log('Total segments:', segs.length)
const stats = segs.map((s) => (s.offsets.to - s.offsets.from) / 1000)
console.log('Mean dur:', (stats.reduce((a, b) => a + b, 0) / stats.length).toFixed(2), 'sec')
console.log('Min dur:', Math.min(...stats).toFixed(2), 'Max dur:', Math.max(...stats).toFixed(2))
const bins = { lt1: 0, '1to2': 0, '2to3': 0, '3to5': 0, gt5: 0 }
stats.forEach((d) => {
  if (d < 1) bins.lt1++
  else if (d < 2) bins['1to2']++
  else if (d < 3) bins['2to3']++
  else if (d < 5) bins['3to5']++
  else bins.gt5++
})
console.log('Length dist:', JSON.stringify(bins))
console.log('segments by length:')
segs.forEach((s, i) => {
  const dur = ((s.offsets.to - s.offsets.from) / 1000).toFixed(2)
  const text = (s.text || '').trim().slice(0, 60)
  console.log(`  [${i.toString().padStart(2,'0')}] ${dur}s  ${text}`)
})