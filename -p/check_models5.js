// 嘗試 nvidia 帳號下的公開 ECAPA-TDNN 模型
const https = require('https');
const http = require('http');

const urls = [
  // NVIDIA Riva TitaNet (公開的 ECAPA-TDNN 變體)
  ['nvidia_titanet', 'https://huggingface.co/nvidia/titanet-l/resolve/main/onnx/model.onnx'],
  ['nvidia_titanet_alt', 'https://huggingface.co/nvidia/titanet-l/resolve/main/onnx/encoder.onnx'],
  // 國際版
  ['webrtc_ecapa', 'https://huggingface.co/anton-l/webrtcvad/resolve/main/model.onnx'],
  // pyannote.audio
  ['pyannote_emb', 'https://huggingface.co/pyannote/embedding/resolve/main/embedding_model.onnx'],
  // DeepFace / 通用
  ['insightface', 'https://huggingface.co/buffalo/insightface/resolve/main/model.onnx'],
  // 試試 welcomyou 另一個已知模型
  ['welcomyou_cn', 'https://huggingface.co/welcomyou/3dspeaker-cn/resolve/main/embedding_model.onnx'],
  // 試試 FBK
  ['fbk_ecapa', 'https://huggingface.co/facebook/wav2vec2-base/resolve/main/pytorch_model.bin'],
];

let completed = 0;
const startTime = Date.now();

const followRedirects = (url, depth = 5) => {
  return new Promise((resolve) => {
    if (depth <= 0) { resolve({ status: 0, chain: 'too-deep', url }); return; }
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