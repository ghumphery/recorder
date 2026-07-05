// 嘗試 GitHub 上的公開 ONNX 鏡像 + ModelScope 公開鏡像
const https = require('https');
const http = require('http');

const urls = [
  // github 公開 ONNX
  ['gh_onnx', 'https://github.com/onnx/models/raw/refs/heads/main/validated/vision/body_analysis/emotion_ferplus/model/emotion-ferplus-8.onnx'],
  // ONNX model zoo 不同分類
  ['gh_arcface', 'https://github.com/onnx/models/raw/refs/heads/main/validated/vision/body_analysis/arcface/model/arcfaceresnet100-8.onnx'],
  // raw.githubusercontent.com
  ['gh_onnx_raw', 'https://raw.githubusercontent.com/onnx/models/main/validated/vision/body_analysis/arcface/model/arcfaceresnet100-8.onnx'],
  // openvino toolkit
  ['gh_openvino', 'https://github.com/openvinotoolkit/open_model_zoo/raw/master/models/public/ecapa-tdnn/model.py'],
  // 國際版 ONNX 模型常見鏡像
  ['gh_3dspeaker', 'https://github.com/modelscope/3D-Speaker/raw/master/onnx_inference/eres2net.onnx'],
  ['gh_3dspeaker_2', 'https://github.com/modelscope/3D-Speaker/raw/master/onnx_inference/ecapa-tdnn.onnx'],
  // ModelScope GitHub 公開
  ['gh_ms_campplus', 'https://github.com/modelscope/3D-Speaker/raw/master/pretrained/sv/campplus/campplus_cn_en_common_200k.onnx'],
  ['gh_ms_campplus_alt', 'https://github.com/modelscope/3D-Speaker/raw/master/egs/3dspeaker/sv-campplus/campplus_cn_en_common_200k.onnx'],
];

let completed = 0;
const startTime = Date.now();

const followRedirects = (url, depth = 5) => {
  return new Promise((resolve) => {
    if (depth <= 0) { resolve({ status: 0, url }); return; }
    const lib = url.startsWith('https:') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'Recorder-test' } }, (res) => {
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (received > 2048) res.destroy();
      });
      res.on('end', () => {
        const total = parseInt(res.headers['content-length'] || '0', 10);
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          followRedirects(next, depth - 1).then(resolve);
        } else {
          resolve({ status: res.statusCode, size: total, ct: res.headers['content-type'], url });
        }
      });
      res.on('error', (e) => { resolve({ status: 0, error: e.message, url }); });
    }).on('error', (e) => { resolve({ status: 0, error: e.message, url }); });
  });
};

(async () => {
  for (let i = 0; i < urls.length; i++) {
    const [name, url] = urls[i];
    const r = await followRedirects(url);
    const sizeMB = r.size > 0 ? (r.size / 1024 / 1024).toFixed(1) : '?';
    console.log(`[${i}] ${name.padEnd(20)} status=${String(r.status).padEnd(4)} size=${sizeMB}MB ct=${(r.ct || '').padEnd(20)} ${r.error ? 'err=' + r.error : ''}`);
    completed++;
  }
  console.log(`Total: ${urls.length} URLs checked in ${Date.now() - startTime}ms`);
  process.exit(0);
})();

setTimeout(() => { console.log('Timeout'); process.exit(0); }, 25000);