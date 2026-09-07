// Стенд экрана загрузки. Раздаёт собранный dist/ тремя способами на трёх портах:
//
//   4180 — как есть (быстро, из кэша: экран не должен показаться вовсе);
//   4181 — медленно (SLOW мс на каждый чанк — телефон в метро);
//   4182 — сломано (главный чанк отвечает 500: экран поломки и кнопка).
//
// Нужен для приёмки: без него ни быстрый путь, ни поломку кадром не показать.
// В игру не входит, в бандл не попадает — это скрипт, а не модуль.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const SLOW = Number(process.env.SLOW ?? 1500);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve(port, mode) {
  createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const isChunk = path.endsWith('.js') || path.endsWith('.css');
    const isMain = path.includes('/index-') && path.endsWith('.js');

    if (mode === 'broken' && isMain) {
      res.statusCode = 500;
      res.end('нет');
      return;
    }
    if (mode === 'slow' && isChunk) await sleep(SLOW);

    let file = join(DIST, path === '/' ? 'index.html' : path.slice(1));
    try {
      const st = await stat(file);
      if (st.isDirectory()) throw new Error('dir');
    } catch {
      file = join(DIST, 'index.html'); // одностраничное приложение
    }
    try {
      const body = await readFile(file);
      res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.end(body);
    } catch (e) {
      res.statusCode = 404;
      res.end(String(e));
    }
  }).listen(port, () => console.log(`${mode} → http://localhost:${port}`));
}

serve(4180, 'fast');
serve(4181, 'slow');
serve(4182, 'broken');
