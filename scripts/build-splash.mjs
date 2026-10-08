// Заставка экрана загрузки, герб игры и картинки для бота — из одних исходников:
//
//   assets-src/splash/city-full.jpg — кадр города самой игры (стенд `city:shots`, закат, вертикальный);
//   assets-src/splash/city-wide.jpg — тот же город, тот же час, кадр 16:9 (картинки бота);
//   assets-src/brand/crest.svg      — герб: щит, на поле золотая башня с воротами (как на стягах города).
//
// Что кладёт:
//
//   public/assets/splash/boot.webp — заставка экрана загрузки и стартового экрана;
//   index.html, правило `#boot-blur` — крошечный размытый предпросмотр той же заставки строкой (`data:`);
//   public/favicon.svg, apple-touch-icon.png (180), icon-192.png, icon-512.png — значок вкладки и телефона;
//   docs/bot-assets/ — аватар бота 640×640, картинка описания и обложка мини-приложения 640×360 (в сборку не едут).
//
// Как сняты кадры и почему этот ракурс и час — assets-src/splash/README.md. Руками `public/assets/splash/`,
// значки в `public/` и строку предпросмотра не править — скрипт их перезапишет. Большие исходники в клиент не едут:
// они лежат в assets-src, как и музыкальные паки.
//
// Запуск: node scripts/build-splash.mjs (npm run splash:build)
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

const at = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const SRC = at('assets-src/splash');
const PUB = at('public');
const BOT = at('docs/bot-assets');

// ---------- заставка экрана загрузки ----------
//
// Кадр вертикальный (0.6) и лежит фоном `object-fit: cover`: телефон (0.46) подрежет его по бокам и оставит
// середину — ворота внизу, собор, донжон вверху; широкое окно — сверху и снизу, и куда тогда смотреть, говорит
// `object-position` в index.html (числа — там же, рядом с CSS: подрезает браузер, а не скрипт).
//
// Ширина 900 при качестве 36 — подобрано на крышах и зубцах стен в масштабе показа: 720 при 40 заметно мягче,
// 1080 при 30 тяжелее на 11 КБ без видимой разницы. Вес печатает скрипт; записан в docs/loading.md.
const BOOT = { name: 'city', width: 900, quality: 36 };
const BOOT_CAP_KB = 60;

// Предпросмотр: тот же кадр в 12 точек шириной. Строкой в index.html он стоит меньше полукилобайта и виден с
// первого кадра экрана — браузер растягивает его, `filter: blur` в index.html прячет квадраты. Потолок держит
// тест (src/boot/boot.test.ts): строка больше — первый кадр экрана опять ждёт картинку.
const LQIP = { width: 12, quality: 40 };

const boot = await sharp(`${SRC}/${BOOT.name}-full.jpg`).resize(BOOT.width).webp({ quality: BOOT.quality, effort: 6 }).toBuffer();
await writeFile(`${PUB}/assets/splash/boot.webp`, boot);
const meta = await sharp(boot).metadata();
const bootKb = boot.length / 1024;
console.log(`boot.webp  ${meta.width}×${meta.height}  ${bootKb.toFixed(1)} КБ`);
if (bootKb > BOOT_CAP_KB) {
  console.error(`заставка не влезла в потолок ${BOOT_CAP_KB} КБ`);
  process.exit(1);
}

{
  const tiny = await sharp(boot).resize(LQIP.width).webp({ quality: LQIP.quality }).toBuffer();
  const uri = `data:image/webp;base64,${tiny.toString('base64')}`;
  const file = at('index.html');
  const html = await readFile(file, 'utf8');
  const rule = /(#boot-blur \{[^}]*background-image: url\()[^)]*(\))/;
  if (!rule.test(html)) throw new Error('в index.html нет правила #boot-blur с background-image: url(…)');
  await writeFile(file, html.replace(rule, `$1${uri}$2`));
  console.log(`предпросмотр  ${uri.length} знаков строкой в index.html`);
}

// ---------- герб: значок вкладки и телефона ----------
//
// Значок вкладки — сам рисунок листа (сетка 32, только заливки, свет с 11 часов, docs/ui_audit.md): SVG без фона.
// Телефону нужен квадрат без прозрачности — щит на тёмном поле игры (`--bg`), занимает 64 % стороны: и iOS, и
// «маскируемый» значок Android (безопасный круг — 80 %) режут углы, щит остаётся целым.
const crest = await readFile(at('assets-src/brand/crest.svg'));
const BG = '#1a1410';
await writeFile(`${PUB}/favicon.svg`, crest.toString('utf8').trim() + '\n');

/** Щит на квадрате: ровный цвет `background` или, без него, тёплое поле аватара. */
async function crestOn(size, share, background) {
  const s = Math.round(size * share);
  const art = await sharp(crest, { density: Math.ceil((72 * s) / 32) }).resize(s, s).png().toBuffer();
  const base = background
    ? sharp({ create: { width: size, height: size, channels: 3, background } })
    : sharp(radial(size, size));
  return base.composite([{ input: art, left: Math.round((size - s) / 2), top: Math.round((size - s) / 2) }]);
}

for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  const png = await (await crestOn(size, 0.64, BG)).png({ palette: true, quality: 90, effort: 10 }).toBuffer();
  await writeFile(`${PUB}/${name}`, png);
  console.log(`${name.padEnd(20)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} КБ`);
}

// ---------- картинки для бота (docs/bot-assets, в сборку не едут) ----------
//
// Куда и как их загрузить в @BotFather — docs/bot-assets/README.md.

/** Тёплое тёмное поле аватара: свет заката из середины к краям. */
function radial(w, h) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<defs><radialGradient id="g" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#5a3a1e"/>` +
      `<stop offset="0.55" stop-color="#2a1d14"/><stop offset="1" stop-color="${BG}"/></radialGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  );
}

/**
 * Название игры тем же начертанием, что на экране загрузки: жирное, вразрядку, светлое с тенью; сверху и снизу
 * кадр притемнён, как под строками экрана загрузки. Шрифт — первый найденный из списка (на машине, где снимали, —
 * Inter): картинки бота лежат готовыми в docs/bot-assets, пересобирать их на другой машине незачем.
 */
function title(w, h, { x, y, size, anchor = 'middle', sub }) {
  const font = "Inter, Roboto, 'Segoe UI', Arial, sans-serif";
  const line = (t, yy, px, wt, sp, op) =>
    `<text x="${x}" y="${yy}" text-anchor="${anchor}" font-family="${font}" font-size="${px}" font-weight="${wt}" ` +
    `letter-spacing="${sp}" fill="#f3e9d8" fill-opacity="${op}" filter="url(#s)">${t}</text>`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<defs><filter id="s" x="-20%" y="-50%" width="140%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="5" ` +
      `flood-color="#000" flood-opacity="0.75"/></filter>` +
      `<linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BG}" stop-opacity="0.72"/>` +
      `<stop offset="0.45" stop-color="${BG}" stop-opacity="0"/><stop offset="0.7" stop-color="${BG}" stop-opacity="0"/>` +
      `<stop offset="1" stop-color="${BG}" stop-opacity="0.55"/></linearGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#v)"/>` +
      line('TRIBE', y, size, 700, size * 0.22, 1) +
      (sub ? line(sub, y + size * 0.62, size * 0.3, 600, size * 0.06, 0.88) : '') +
      `</svg>`,
  );
}

await mkdir(BOT, { recursive: true });
{
  // Аватар: Telegram режет его в круг — щит занимает 62 % стороны, и круг его не задевает.
  const png = await (await crestOn(640, 0.62)).png().toBuffer();
  await writeFile(`${BOT}/avatar-640.png`, png);
  console.log(`bot-assets/avatar-640.png  640×640  ${(png.length / 1024).toFixed(1)} КБ`);
}
{
  const city = await sharp(`${SRC}/city-wide.jpg`).resize(640, 360).png().toBuffer();
  // Картинка описания: город на закате, название сверху посередине.
  const desc = await sharp(city)
    .composite([{ input: title(640, 360, { x: 320, y: 70, size: 48, sub: 'Город. Дружина. Поход.' }) }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  await writeFile(`${BOT}/description-640x360.jpg`, desc);
  console.log(`bot-assets/description-640x360.jpg  ${(desc.length / 1024).toFixed(1)} КБ`);
  // Обложка мини-приложения: тот же кадр, герб слева от названия.
  const shield = await sharp(crest, { density: 72 * 3 }).resize(84, 84).png().toBuffer();
  const cover = await sharp(city)
    .composite([
      { input: title(640, 360, { x: 214, y: 76, size: 50, anchor: 'start' }) },
      { input: shield, left: 116, top: 22 },
    ])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  await writeFile(`${BOT}/app-cover-640x360.jpg`, cover);
  console.log(`bot-assets/app-cover-640x360.jpg  ${(cover.length / 1024).toFixed(1)} КБ`);
}
