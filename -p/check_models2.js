// 追蹤 401 的 welcomyou 帳號底下的 ECAPA-TDNN 模型
const https = require('https');

const urls = [
  // 候選 1: welcomyou 帳號下可能的 ECAPA-TDNN
  ['ecapa_v1', 'https://huggingface.co/welcomyou/3dspeaker-ecapa-tdnn-en/resolve/main/ecapa_tdnn.onnx'],
  ['ecapa_v2', 'https://huggingface.co/welcomyou/3dspeaker-ecapa-tdnn-cn/resolve/main/ecapa_tdnn.onnx'],
  ['ecapa_v3', 'https://huggingface.co/welcomyou/ecapa-tdnn-voxceleb/resolve/main/ecapa_tdnn.onnx'],
  ['ecapa_v4', 'https://huggingface.co/welcomyou/3dspeaker-ecapa-tdnn/resolve/main/ecapa_tdnn.onnx'],
  // ModelScope 中文社群常用模型
  ['ms_campplus', 'https://www.modelscope.cn/api/v1/models/iic/speech_campplus_sv_zh_en_16k-common/repo?Revision=master&FilePath=campplus_cn_en_common_200k.onnx'],
  // 國際版 webrtcvad + resnet 候選
  ['resnet_omran', 'https://huggingface.co/OmranBoustany/3D_Speaker_resnet/resolve/main/resnet.onnx'],
  // pyannote/NeMo
  ['titanet', 'https://huggingface.co/colingniemann/TitaNet/resolve/main/titanet.onnx'],
];

let completed = 0;
const startTime = Date.now();
urls.forEach(([name, url], i) => {
  https.get(url, { headers: { 'User-Agent': 'Recorder-test' } }, (res) => {
    const total = parseInt(res.headers['content-length'] || '0', 10);
    const loc = res.headers.location || '';
    console.log(`[${i}] ${name}: status=${res.statusCode} size=${total} ${loc ? '->' + loc.substring(0, 100) : ''}`);
    res.destroy();
    completed++;
    if (completed === urls.length) {
      console.log(`Total: ${urls.length} URLs checked in ${Date.now() - startTime}ms`);
      process.exit(0);
    }
  }).on('error', (e) => {
    console.log(`[${i}] ${name}: ERROR ${e.message}`);
    completed++;
    if (completed === urls.length) {
      console.log(`Total: ${urls.length} URLs checked in ${Date.now() - startTime}ms`);
      process.exit(0);
    }
  });
});
setTimeout(() => { console.log('Timeout - exiting'); process.exit(0); }, 30000);