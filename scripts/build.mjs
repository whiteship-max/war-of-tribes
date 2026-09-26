/**
 * Релизная сборка. Единственная команда, которой собирается то, что уезжает на Netlify:
 *
 *     npm run build
 *
 * Раньше это была строка `npm run icons:build && tsc --noEmit && vite build` в package.json,
 * и на Windows она изредка падала ассертом libuv сразу после отчёта о значках — то есть уже
 * после того, как лист был записан, но до `vite build`. По половинам всё проходило, и с этого
 * начиналась беда: собрать половину вручную легко, а понять по папке dist, что она собрана
 * половиной, нельзя — стоит один раз пропустить icons:build, и на сайт уедет вчерашний лист
 * значков при сегодняшнем коде.
 *
 * Здесь убраны обе причины и заведена третья вещь — приёмка результата:
 *
 *   1. Ступени запускаются напрямую (`node <бинарь>`), а не через вложенный `npm run`.
 *      Вложенный npm на Windows — это ещё пара процессов через cmd-шимы поверх каждой
 *      ступени, и гонок на их выходе тем больше, чем их больше.
 *   2. Сам scripts/build-icons.ts теперь выходит явно, не досиживая до разборки libuv
 *      поверх потоков sharp (причина и объяснение — в хвосте того файла).
 *   3. После сборки папка dist проверяется: каждая ссылка из index.html обязана указывать
 *      на существующий файл, а обязательные семейства ассетов — быть на месте и не быть
 *      пустыми. Половинчатая сборка не проходит молча: она не проходит вовсе.
 *
 * В конце печатается опись сборки — коммит, имена чанков с хешами и вес по сети. Хеш в имени
 * чанка и есть подпись сборки: открыв на сайте исходник index.html, по этим именам видно,
 * тот ли билд там лежит. Это не украшение отчёта, а способ поймать выкладку, отставшую на
 * полсотни коммитов.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PUBLIC = path.join(ROOT, 'public');

const bin = (...parts) => path.join(ROOT, 'node_modules', ...parts);

/** Ступени идут по порядку, и первая же неудача останавливает сборку. */
const STAGES = [
  { name: 'значки', args: [bin('vite-node', 'vite-node.mjs'), 'scripts/build-icons.ts'] },
  { name: 'типы', args: [bin('typescript', 'bin', 'tsc'), '--noEmit'] },
  // Функции лежат вне src и своим проектом: у них Node без DOM. Без этой
  // ступени серверная часть уезжала бы на хостинг непроверенной — её собирает
  // esbuild, а он типов не смотрит.
  { name: 'типы сервера', args: [bin('typescript', 'bin', 'tsc'), '-p', 'netlify', '--noEmit'] },
  { name: 'бандл', args: [bin('vite', 'bin', 'vite.js'), 'build'] },
];

/**
 * Что обязано лежать в dist. Список короткий нарочно: сюда попадает только то,
 * чего не видно по ссылкам из index.html, — файлы, которые игра просит по адресу
 * уже во время партии (лист значков, музыка, лица), и потому в бандл не входят.
 */
const REQUIRED = [
  { file: 'index.html', min: 3000 },
  { file: '_redirects', min: 10 },
  { file: 'assets/icons/sprite.svg', min: 10000 },
  { file: 'assets/splash/boot.webp', min: 5000 },
];

/**
 * Папки, которые копируются из public целиком: в dist их содержимое обязано совпасть по счёту.
 * Текстуры предыстории (`assets/prologue`) — такие же: их собирает `npm run textures:build`, и
 * файл, не доехавший до dist, оставил бы поляну без коры и снега молча.
 */
const MIRRORED = ['assets/music', 'assets/avatars', 'assets/prologue'];

function run(stage) {
  process.stdout.write(`\n=== ${stage.name} ===\n`);
  const r = spawnSync(process.execPath, stage.args, { cwd: ROOT, stdio: 'inherit' });
  if (r.error) fail(`ступень «${stage.name}» не запустилась: ${r.error.message}`);
  if (r.signal) fail(`ступень «${stage.name}» убита сигналом ${r.signal}`);
  if (r.status !== 0) fail(`ступень «${stage.name}» вернула код ${r.status}`);
}

function fail(msg) {
  console.error(`\nсборка не сошлась: ${msg}`);
  console.error('Папка dist сборкой не считается — выкладывать нечего.');
  process.exit(1);
}

/** Локальные ссылки из index.html: каждая обязана указывать на файл в dist. */
function linksOf(html) {
  const out = new Set();
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = m[1];
    if (url.startsWith('http') || url.startsWith('data:') || url.startsWith('#')) continue;
    out.add(url.replace(/^\//, '').split(/[?#]/)[0]);
  }
  return [...out];
}

function verify() {
  process.stdout.write('\n=== приёмка dist ===\n');
  const bad = [];

  for (const req of REQUIRED) {
    const file = path.join(DIST, req.file);
    if (!existsSync(file)) bad.push(`нет ${req.file}`);
    else if (statSync(file).size < req.min) bad.push(`${req.file} подозрительно мал (${statSync(file).size} Б)`);
  }

  for (const dir of MIRRORED) {
    const from = path.join(PUBLIC, dir);
    const to = path.join(DIST, dir);
    if (!existsSync(from)) continue;
    const want = readdirSync(from).length;
    const got = existsSync(to) ? readdirSync(to).length : 0;
    if (got !== want) bad.push(`${dir}: в public ${want} файлов, в dist ${got}`);
  }

  const indexFile = path.join(DIST, 'index.html');
  if (existsSync(indexFile)) {
    const html = readFileSync(indexFile, 'utf8');
    for (const link of linksOf(html)) {
      if (!existsSync(path.join(DIST, link))) bad.push(`index.html ссылается на ${link}, а его нет`);
    }
    // Экран загрузки живёт в index.html целиком, без единого внешнего запроса.
    // Пустой <script> или <style> здесь значил бы, что он потерялся на минификации.
    if (!/<script>[^]{200,}<\/script>/.test(html)) bad.push('в index.html нет встроенного кода экрана загрузки');
    if (!/<style>[^]{200,}<\/style>/.test(html)) bad.push('в index.html нет встроенных стилей экрана загрузки');
  }

  // Лист значков в dist обязан быть тем самым, который только что собрала первая ступень.
  const a = path.join(PUBLIC, 'assets', 'icons', 'sprite.svg');
  const b = path.join(DIST, 'assets', 'icons', 'sprite.svg');
  if (existsSync(a) && existsSync(b) && !readFileSync(a).equals(readFileSync(b))) {
    bad.push('лист значков в dist не совпадает с только что собранным');
  }

  if (bad.length > 0) fail(bad.join('; '));
  console.log('всё на месте: ссылки, значки, заставка, музыка, лица, экран загрузки');
}

/** Опись сборки: по этим именам проверяется, тот ли билд лежит на сайте. */
function manifest() {
  const git = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  const commit = git.status === 0 ? git.stdout.trim() : '?';
  // Спрашиваем про содержимое, а не про `git status`: тот на Windows держит файл изменённым,
  // когда на диске CRLF, а в коммите LF, — при полностью совпадающем тексте. Пометка, которая
  // горит всегда, ничего не значит, а значить она должна ровно одно: собрано не то, что в коммите.
  const changed = spawnSync('git', ['diff', '--quiet', 'HEAD', '--'], { cwd: ROOT }).status !== 0;
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  const extra = untracked.status === 0 && untracked.stdout.trim() !== '';
  const clean = !changed && !extra;

  // Килобайт здесь — 1000 байт, как их считает сам vite: числа отчёта обязаны сходиться
  // с числами его вывода и с теми, что записаны в CLAUDE.md, иначе сверять их нечем.
  const kb = (n) => `${(n / 1000).toFixed(1)} КБ`;

  // Что качает первый заход в игру. Код и стили считаются, а не угадываются по имени:
  // первая загрузка — это то, на что ссылается index.html, и всё, что оттуда достижимо
  // статическим `import` (ленивые куски — стенды, ролик о бое, предыстория с её стилями —
  // сюда не попадают сами). Что они не протекли в первую загрузку модулями, держит сборка
  // (`lazyDoorsPlugin` в vite.config.ts). Остальное — по месту: музыка и лица качаются по
  // ходу партии, текстуры предыстории — по её кнопке, заставка входит — её тянет экран
  // загрузки, пусть и после первого кадра.
  const LATER = [/^assets\/(music|avatars|prologue)\//];
  const html = readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const firstCode = new Set();
  const reach = (rel) => {
    if (firstCode.has(rel) || !existsSync(path.join(DIST, rel))) return;
    firstCode.add(rel);
    if (!rel.endsWith('.js')) return;
    const code = readFileSync(path.join(DIST, rel), 'utf8');
    // Статический импорт в собранном чанке: `import{a as b}from"./x.js"` или `import"./x.js"`.
    // `import("./x.js")` сюда не подходит — после `import` стоит скобка.
    for (const m of code.matchAll(/\bimport\s*(?:[\w$*{}\s,]+from\s*)?"\.\/([^"]+\.js)"/g)) reach(`assets/${m[1]}`);
  };
  for (const link of linksOf(html)) if (/\.(js|css)$/.test(link)) reach(link);

  const rows = [];
  const walk = (dir, base) => {
    for (const name of readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) {
        walk(file, `${base}${name}/`);
        continue;
      }
      const rel = `${base}${name}`;
      const buf = readFileSync(file);
      // По сети сжимаемое едет gzip'ом, картинки и звук — как есть.
      const wire = /\.(js|css|html|svg|md)$/.test(name) ? gzipSync(buf).length : buf.length;
      const first = /\.(js|css)$/.test(name) ? firstCode.has(rel) : !LATER.some((re) => re.test(rel));
      rows.push({ name: rel, size: buf.length, gz: /\.(js|css|html|svg)$/.test(name) ? wire : 0, wire, first });
    }
  };
  walk(DIST, '');

  // Музыка, лица и текстуры — десятки файлов, поимённо их читать незачем: показываем папку строкой.
  const folded = [];
  for (const dir of MIRRORED) {
    const inside = rows.filter((r) => r.name.startsWith(`${dir}/`));
    if (inside.length === 0) continue;
    folded.push({ name: `${dir}/ (${inside.length} файлов)`, size: inside.reduce((s, r) => s + r.size, 0), gz: 0, first: false });
  }
  const shown = [...rows.filter((r) => !MIRRORED.some((d) => r.name.startsWith(`${d}/`))), ...folded];

  process.stdout.write('\n=== опись сборки ===\n');
  console.log(`коммит: ${commit}${clean ? '' : '  (в дереве есть несохранённые правки)'}`);
  console.log('');
  const w = Math.max(...shown.map((r) => r.name.length));
  for (const r of shown.sort((x, y) => Number(y.first) - Number(x.first) || y.size - x.size)) {
    const tail = r.gz ? `  gzip ${kb(r.gz).padStart(9)}` : '';
    console.log(`  ${r.first ? '·' : ' '} ${r.name.padEnd(w)}  ${kb(r.size).padStart(9)}${tail}`);
  }
  const first = rows.filter((r) => r.first).reduce((s, r) => s + r.wire, 0);
  const disk = rows.reduce((s, r) => s + r.size, 0);
  console.log(`\n· первая загрузка: ${kb(first)} по сети`);
  console.log(`  вся папка:       ${kb(disk)} на диске`);
  console.log(`\nвыкладывать: ${DIST}`);
}

// Чистим сами: vite перезаписывает, но не удаляет — чанк с прежним хешем остался бы лежать
// и приёмку прошёл бы, а на сайте оказались бы два билда вперемешку.
rmSync(DIST, { recursive: true, force: true });
for (const stage of STAGES) run(stage);
verify();
manifest();
