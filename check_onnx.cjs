const ort = require('onnxruntime-node');
const path = 'c:/Users/humphery/coding/recoder/-p/cnceleb_resnet34.onnx';
ort.InferenceSession.create(path).then(s => {
  console.log('inputNames:', s.inputNames);
  console.log('outputNames:', s.outputNames);
  s.release();
}).catch(e => { console.error('ERR', e.message); process.exit(1); });