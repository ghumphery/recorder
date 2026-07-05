// ModelScope 官方 + 其他公開 ONNX 模型
const https = require('https');
const http = require('http');

const urls = [
  // ModelScope 官方 - 3D Speaker 系列
  ['ms_eres2net', 'https://www.modelscope.cn/models/iic/speech_eres2net_sv_zh-cn_16k-common/resolve/master/embedding_model.onnx'],
  ['ms_eres2net_200k', 'https://www.modelscope.cn/models/iic/speech_eres2net_sv_zh-cn_16k-common/resolve/master/2pass/embedding_model.onnx'],
  ['ms_campplus_v2', 'https://www.modelscope.cn/models/iic/speech_campplus_sv_zh_en_16k-common/resolve/master/campplus_cn_en_common_200k.onnx'],
  ['ms_ecapa_tdnn', 'https://www.modelscope.cn/models/iic/speech_ecapa-tdnn_sv_en_voxceleb100/resolve/master/ecapa_tdnn.onnx'],
  // ModelScope 上其他 3D-Speaker 模型
  ['ms_3dspeaker_eres2net', 'https://www.modelscope.cn/models/iic/speech_3D-speaker/resolve/master/eres2net.onnx'],
];

let completed = 0;
const startTime = Date.now();

const followRedirects = (url, depth = 5) => {
  return new Promise((resolve) => {
    if (depth <= 0) { resolve({ status: 0, size: 0, loc: 'too-many-redirects', url }); return; }
    const lib = url.startsWith('https:') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'Recorder-test' } }, (res) => {
      // 跳過前 1024 bytes 來跳過 HTML 錯誤頁
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (received > 1024) { res.destroy(); }
      });
      res.on('end', () => {
        const total = parseInt(res.headers['content-length'] || '0', 10);
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          followRedirects(next, depth - 1).then(resolve);
        } else {
          resolve({ status: res.statusCode, size: total, loc: res.headers.location, url });
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
    console.log(`[${i}] ${name}: status=${r.status} size=${r.size} ${r.loc ? '->' + r.loc.substring(0, 80) : ''} ${r.error ? 'err=' + r.error : ''}`);
    completed++;
  }
  console.log(`Total: ${urls.length} URLs checked in ${Date.now() - startTime}ms`);
  process.exit(0);
})();

setTimeout(() => { console.log('Timeout'); process.exit(0); }, 30000);