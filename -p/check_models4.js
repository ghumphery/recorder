// 嘗試 ModelScope 正確的 resolve URL 格式
const https = require('https');
const http = require('http');

const urls = [
  // 現有 campplus URL 完整 follow redirect
  ['campplus_full', 'https://huggingface.co/welcomyou/campplus-3dspeaker-200k-onnx/resolve/main/campplus_cn_en_common_200k.onnx'],
  // ModelScope 替代格式
  ['ms_format1', 'https://www.modelscope.cn/api/v1/models/iic/speech_campplus_sv_zh_en_16k-common/repo?Revision=master&FilePath=campplus_cn_en_common_200k.onnx'],
  // HF onnx-community 鏡像（官方）
  ['hf_onnx_community_campplus', 'https://huggingface.co/onnx-community/campplus/resolve/main/onnx/model.onnx'],
  // OpenVINO/ONNX 社群鏡像
  ['openvino_zoo', 'https://huggingface.co/OpenVINO/3D-speaker-ecapa-tdnn/resolve/main/onnx/model.onnx'],
  // 純 ONNX 公開模型
  ['onnx_zoo_ecapa', 'https://github.com/onnx/models/raw/main/validated/vision/body_analysis/arcface/model/arcfaceresnet100-8.onnx'],
  // webrtcvad 替代
  ['opensmile', 'https://huggingface.co/funasr/funasr/resolve/main/onnx/embedding_model.onnx'],
];

let completed = 0;
const startTime = Date.now();

const followRedirects = (url, depth = 10) => {
  return new Promise((resolve) => {
    if (depth <= 0) { resolve({ status: 0, size: 0, loc: 'too-many-redirects', url }); return; }
    const lib = url.startsWith('https:') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'Recorder-test' } }, (res) => {
      let received = 0;
      let aborted = false;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (received > 4096 && !aborted) { aborted = true; res.destroy(); }
      });
      res.on('end', () => {
        const total = parseInt(res.headers['content-length'] || '0', 10);
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          followRedirects(next, depth - 1).then(resolve);
        } else {
          resolve({ status: res.statusCode, size: total, loc: res.headers.location, url, contentType: res.headers['content-type'] });
        }
      });
      res.on('error', (e) => { resolve({ status: 0, size: 0, error: e.message, url }); });
    }).on('error', (e) => { resolve({ status: 0, size: 0, error: e.message, url }); });
  });
};

(async () => {
  for (let i = 0; i < urls.length; i++) {
    const [name, url] = urls[i];
    const r = await followRedirects(url);
    const sizeMB = r.size > 0 ? (r.size / 1024 / 1024).toFixed(1) : '0';
    console.log(`[${i}] ${name}: status=${r.status} size=${r.size} (${sizeMB}MB) ct=${r.contentType || '?'} ${r.loc ? '->' + r.loc.substring(0, 60) : ''}`);
    completed++;
  }
  console.log(`Total: ${urls.length} URLs checked in ${Date.now() - startTime}ms`);
  process.exit(0);
})();

setTimeout(() => { console.log('Timeout'); process.exit(0); }, 60000);