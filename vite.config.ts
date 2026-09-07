import { defineConfig, transformWithEsbuild, type Plugin } from 'vite';
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

/**
 * Ужимает встроенный экран загрузки.
 *
 * Экран живёт прямо в `index.html` — иначе он появился бы только после бандла,
 * то есть после того самого ожидания, которое закрывает. Но объяснения, зачем
 * там каждое число, писаны нам, а не телефону игрока: несжатыми они стоили
 * четырёх пятых веса файла. Плагин выбрасывает комментарии и отступы на сборке;
 * в исходнике и на dev-сервере всё остаётся как написано, и тест читает именно
 * исходник.
 *
 * Ничего никуда не переезжает: разметка, стили, картинка и код по-прежнему
 * в одном файле и по-прежнему без единого внешнего запроса.
 */
function bootMinifyPlugin(): Plugin {
  return {
    name: 'tribe-boot-minify',
    apply: 'build',
    enforce: 'post',
    async transformIndexHtml(html) {
      let out = html;
      // <style> в шапке — только наш, экрана загрузки: стили игры едут чанком.
      const styles = [...out.matchAll(/<style>([\s\S]*?)<\/style>/g)];
      for (const m of styles) {
        const { code } = await transformWithEsbuild(m[1], 'boot.css', { loader: 'css', minify: true, charset: 'utf8' });
        out = out.replace(m[0], `<style>${code.trim()}</style>`);
      }
      const scripts = [...out.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      for (const m of scripts) {
        const { code } = await transformWithEsbuild(m[1], 'boot.js', { loader: 'js', minify: true, charset: 'utf8' });
        out = out.replace(m[0], `<script>${code.trim()}</script>`);
      }
      // Комментарии разметки и отступы между тегами.
      out = out.replace(/<!--(?!\[if)[\s\S]*?-->/g, '');
      out = out.replace(/\n\s*/g, '\n').replace(/\n{2,}/g, '\n');
      return out;
    },
  };
}

export default defineConfig({
  plugins: [react(), snapPlugin(), bootMinifyPlugin()],
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
