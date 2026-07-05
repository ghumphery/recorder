// 檢查多個候選 ONNX 模型 URL 的可用性
const https = require('https');

const urls = [
  // 現有 campplus
  ['campplus(現有)', 'https://huggingface.co/welcomyou/campplus-3dspeaker-200k-onnx/resolve/main/campplus_cn_en_common_200k.onnx'],
  // 候選 ECAPA-TDNN
  ['ecapa_tdnn_funASR', 'https://huggingface.co/funasr/eres2net/resolve/main/eres2net.onnx'],
  ['ecapa_3dspeaker', 'https://huggingface.co/welcomyou/3dspeaker-ecapa-tdnn/resolve/main/ecapa_tdnn.onnx'],
  // 候選 ResNet
  ['resnet_voxceleb', 'https://huggingface.co/speechbrain/spkrec-resnet-voxceleb/resolve/main/embedding_model.onnx'],
  // ModelScope 鏡像
  ['modelscope_test', 'https://www.modelscope.cn/models/iic/speech_campplus_sv_zh_en_16k-common/resolve/master/campplus_cn_en_common_200k.onnx'],
  // 國際版
  ['intl_speechbrain', 'https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb/resolve/main/embedding_model.onnx'],
  // ModelScope 標準鏡像（中文社群常用）
  ['modelscope_ecapa', 'https://www.modelscope.cn/models/iic/speech_ecapa-tdnn_sv_en_voxceleb/resolve/master/ecapa_tdnn.onnx'],
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