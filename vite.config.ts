import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Снимки стенда-витрины. Только dev-сервер: страница `?showcase=…&snap=имя`
 * отправляет PNG кадра на POST /__snap?name=имя, и он ложится в snaps/имя.png.
 * Иначе скриншот графики не сохранить в файл: буфер WebGL снаружи страницы недоступен.
 */
function snapPlugin(): Plugin {
  return {
    name: 'tribe-snap',
    apply: 'serve',
    configureServer(server) {
      const dir = fileURLToPath(new URL('./snaps', import.meta.url));
      // Замеры частоты кадров со стенда (?perf=…): строка JSON на замер, в snaps/perf.jsonl.
      server.middlewares.use('/__perf', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          mkdirSync(dir, { recursive: true });
          appendFileSync(join(dir, 'perf.jsonl'), Buffer.concat(chunks).toString('utf8').replace(/\s+$/, '') + '\n');
          res.setHeader('Content-Type', 'text/plain');
          res.end('ok');
        });
      });
      server.middlewares.use('/__snap', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const raw = new URL(req.url ?? '/', 'http://localhost').searchParams.get('name') ?? 'snap';
        const name = raw.replace(/[^\w.-]+/g, '_');
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          mkdirSync(dir, { recursive: true });
          const file = join(dir, `${name}.png`);
          writeFileSync(file, Buffer.concat(chunks));
          res.setHeader('Content-Type', 'text/plain');
          res.end(file);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), snapPlugin()],
  base: '/',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: true,
    // Порт можно задать через PORT: так несколько dev-серверов не дерутся за 5173.
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    allowedHosts: ['.trycloudflare.com'],
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'], react: ['react', 'react-dom'] },
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
