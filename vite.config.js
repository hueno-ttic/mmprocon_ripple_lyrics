import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// 開発時専用: ページからスクリーンショットを design_refs/ に保存する
// エンドポイント。serve(dev)時のみ有効で、ビルド成果物には一切含まれない。
const saveShotPlugin = () => ({
  name: 'save-shot',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__save_shot', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const { name, dataUrl } = JSON.parse(body);
          const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, '');
          const b64 = dataUrl.split(',')[1];
          const dir = path.resolve('design_refs');
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, safe), Buffer.from(b64, 'base64'));
          res.end('ok:' + safe);
        } catch (e) {
          res.statusCode = 500;
          res.end('err:' + e.message);
        }
      });
    });
  },
});

export default defineConfig({
  base: './',
  root: '.',
  plugins: [saveShotPlugin()],
  server: {
    port: 5173,
    open: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  }
});
