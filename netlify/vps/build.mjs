/**
 * Сборка своего сервера в один файл: `node netlify/vps/build.mjs <выход.mjs>`.
 *
 * Собирает тот же `vite`, что и игру (он уже в зависимостях — новой не заводится), только в
 * режиме Node: всё, что сервер импортирует, — общие обработчики, договор, правило расселения с
 * атласом земли, клиент Netlify Blobs, — ложится в один файл, а встроенное в Node (`node:http`,
 * `node:sqlite`) остаётся снаружи. В образе поэтому нет `node_modules`: файл и Node.
 *
 * Зовёт её `Dockerfile`; тест `bundle.test.ts` собирает тем же путём и поднимает собранное.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!process.argv[2]) {
  console.error('куда собрать? node netlify/vps/build.mjs <выход.mjs> — вне дерева репозитория или в папке образа');
  process.exit(1);
}
const out = path.resolve(process.argv[2]);

await build({
  configFile: false,
  root: ROOT,
  logLevel: 'warn',
  publicDir: false,
  build: {
    ssr: path.join(ROOT, 'netlify', 'vps', 'main.ts'),
    outDir: path.dirname(out),
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    sourcemap: false,
    copyPublicDir: false,
    rollupOptions: {
      output: { format: 'es', entryFileNames: path.basename(out), inlineDynamicImports: true },
    },
  },
  ssr: { noExternal: true, target: 'node' },
});

console.log(`сервер собран: ${out}`);
