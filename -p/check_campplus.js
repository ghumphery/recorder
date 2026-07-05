// 只追蹤 campplus 的完整 redirect 鏈以理解 HF 下載機制
const https = require('https');
const http = require('http');

const followRedirects = (url, depth = 5) => {
  return new Promise((resolve) => {
    if (depth <= 0) { resolve({ status: 0, chain: 'too-deep', url }); return; }
    const lib = url.startsWith('https:') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'Recorder-test' } }, (res) => {
      // 只讀 headers 與前 1KB，然後 destroy
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (received > 1024) res.destroy();
      });
      res.on('end', () => {
        const total = parseInt(res.headers['content-length'] || '0', 10);
        console.log(`  → status=${res.statusCode} size=${total} (${(total/1024/1024).toFixed(2)}MB) loc=${(res.headers.location || '').substring(0, 80)}`);
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          followRedirects(next, depth - 1).then(resolve);
        } else {
          resolve({ status: res.statusCode, finalSize: total, url });
        }
      });
      res.on('error', (e) => { resolve({ status: 0, error: e.message, url }); });
    }).on('error', (e) => { resolve({ status: 0, error: e.message, url }); });
  });
};

(async () => {
  console.log('=== campplus ===');
  const r = await followRedirects('https://huggingface.co/welcomyou/campplus-3dspeaker-200k-onnx/resolve/main/campplus_cn_en_common_200k.onnx');
  console.log('Final:', r);
  process.exit(0);
})();
setTimeout(() => process.exit(0), 25000);