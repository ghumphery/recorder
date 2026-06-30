const path = require('path')
const ort = require(path.resolve(__dirname, '..', 'frontend', 'node_modules', 'onnxruntime-node'))
;(async () => {
  const s = await ort.InferenceSession.create('C:\\Users\\humphery\\recoder\\voiceprint\\campplus_cn_en_common_200k.onnx')
  console.log('Input names:', s.inputNames)
  console.log('Input meta 0:', JSON.stringify(s.inputMeta, null, 2))
  console.log('Output names:', s.outputNames)
  console.log('Output meta 0:', JSON.stringify(s.outputMeta, null, 2))
})().catch((e) => { console.error(e); process.exit(1) })