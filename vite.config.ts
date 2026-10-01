import { defineConfig, transformWithEsbuild, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { budgetCores } from './scripts/lib/budget';

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

/**
 * Ленивые куски обязаны быть ленивыми — и проверяет это сборка, а не глаз на опись.
 *
 * Режим, в который игрок может не зайти ни разу, не имеет права стоить ему ни байта на
 * старте. Но сломать это можно, не тронув ни одного `import()`: модуль попадает в чанк
 * целиком, и одна функция ролика, положенная рядом с тем, что читает мир, тянет в первую
 * загрузку всю режиссуру за собой. Так и было: `castOfRecord` лежал в `faces.ts` рядом с
 * `troopsOfKinds`, а `@/battle` реэкспортировал `./replay` — и ролик ехал каждому игроку,
 * хотя смотрел его никто.
 *
 * Поэтому правило здесь про модули, а не про имена файлов: у каждой двери перечислено,
 * чем она владеет, и ни один такой модуль не может оказаться в статическом замыкании
 * точки входа. Сама дверь обязана остаться динамической точкой входа. Не сошлось —
 * сборка падает и называет модули.
 */
const LAZY_DOORS: { name: string; door: RegExp; owns: RegExp[] }[] = [
  {
    name: 'ролик о бое',
    door: /\/src\/ui\/battle\/BattleReplay\.tsx$/,
    owns: [/\/src\/ui\/battle\/BattleReplay\.tsx$/, /\/src\/battle\/replay\.ts$/, /\/src\/render\/battle\//, /\/src\/game\/battle\/(cast|ground)\.ts$/],
  },
  {
    name: 'предыстория',
    door: /\/src\/prologue\/Prologue\.tsx$/,
    owns: [/\/src\/prologue\//, /\/src\/sound\/howl\.ts$/],
  },
  {
    // Проба окружения посёлка (docs/graphics_world.md): земля, трава, лес и мелочь едут
    // своим куском после первого кадра — в первую загрузку не входят ни байтом.
    name: 'окружение посёлка',
    door: /\/src\/render\/env\/index\.ts$/,
    owns: [/\/src\/render\/env\//],
  },
];

function lazyDoorsPlugin(): Plugin {
  return {
    name: 'tribe-lazy-doors',
    apply: 'build',
    generateBundle(_, bundle) {
      const norm = (id: string): string => id.replace(/\\/g, '/');
      const entries = Object.values(bundle).filter((c) => c.type === 'chunk' && c.isEntry);
      // Статическое замыкание точки входа — ровно то, что качает первый заход.
      const first = new Set<string>();
      const walk = (id: string): void => {
        if (first.has(id)) return;
        first.add(id);
        for (const next of this.getModuleInfo(id)?.importedIds ?? []) walk(next);
      };
      for (const c of entries) if (c.type === 'chunk' && c.facadeModuleId) walk(c.facadeModuleId);
      const dynamic = [...this.getModuleIds()].filter((id) => this.getModuleInfo(id)?.dynamicImporters.length);
      const bad: string[] = [];
      for (const d of LAZY_DOORS) {
        if (!dynamic.some((id) => d.door.test(norm(id)))) bad.push(`${d.name}: дверь больше не грузится лениво`);
        const leaked = [...first].map(norm).filter((id) => d.owns.some((re) => re.test(id)));
        for (const id of leaked) bad.push(`${d.name}: ${id.slice(id.indexOf('/src/') + 1)} — в первой загрузке`);
      }
      if (bad.length > 0) this.error(`ленивые куски протекли в первую загрузку:\n  ${bad.join('\n  ')}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), snapPlugin(), bootMinifyPlugin(), lazyDoorsPlugin()],
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
        // Атлас мира — отдельным чанком нарочно. В первую загрузку он входит
        // всё равно (мир поднимается на старте), но в описи сборки его вес виден
        // отдельно от кода: сорок пять килобайт запечённой земли и двести
        // семьдесят игры — разные числа, и путать их не надо.
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
          atlas: ['./src/world/atlas/data.ts'],
        },
      },
    },
  },
  // Тесты серверных функций живут рядом с ними, а не в src: они про подпись
  // и хранилище, а не про игру. Тесты приёмки отчётами (какие отчёты гнать) —
  // рядом с ней, в scripts/lib. Прогон один — приёмка должна быть одна.
  // Работников у тестов — доля ядер из бюджета (`budgetCores`: треть, 4 из 12; бюджет железа, CLAUDE.md): машина владельца — не сервер. Прогон
  // держит замок машины (`scripts/lib/testlock.ts`): занята чужой тяжёлой работой — тесты ждут.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'netlify/**/*.test.ts', 'scripts/**/*.test.ts'],
    globalSetup: ['./scripts/lib/testlock.ts'],
    maxWorkers: budgetCores(),
    minWorkers: 1,
  },
});
