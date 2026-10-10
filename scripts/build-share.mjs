// Картинки «Поделиться» для историй Telegram (docs/feed.md, раздел 3): фон истории под итог боя, взятый город и место в
// рейтинге. Собираются из того же кадра города на закате и герба, что заставка и картинки бота (`build-splash.mjs`):
//
//   assets-src/splash/city-full.jpg — город сверху, 1080×1800;
//   assets-src/brand/crest.svg      — герб.
//
// Пишет public/assets/share/<вид>.jpg — 1080×1920 (9:16, размер истории Telegram). В первую загрузку не входят: их
// забирает сам Telegram по адресу, когда игрок жмёт «В историю» (`WebApp.shareToStory` берёт картинку только адресом).
// Что именно случилось — город, враг, потери — едет подписью истории, а не картинкой: картинку по бою собрать нечем,
// сервер картинок не рисует, а адреса у картинки из холста игры нет.
//
// Запуск: npm run share:build. Шрифт — Inter, как у картинок бота; на машине без него librsvg возьмёт похожий.
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

const at = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const OUT = at('public/assets/share');
const W = 1080;
const H = 1920;
/** Фон экрана загрузки и интерфейса — им же залит низ истории под кадром. */
const BG = '#1a120c';
const GOLD = '#d9a441';

/** Вид — заголовок истории. Слова — те же, что на кнопке и в карточке (`ui/share/shareCard.ts`). */
const KINDS = [
  { id: 'battle', head: 'ИТОГ БОЯ', sub: 'Донесение с поля' },
  { id: 'city', head: 'ГОРОД ВЗЯТ', sub: 'Война между игроками' },
  { id: 'rating', head: 'РЕЙТИНГ', sub: 'Место среди соседей' },
];

function overlay({ head, sub }) {
  const font = "Inter, Roboto, 'Segoe UI', Arial, sans-serif";
  const text = (t, y, px, wt, sp, fill, op = 1) =>
    `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${font}" font-size="${px}" font-weight="${wt}" ` +
    `letter-spacing="${sp}" fill="${fill}" fill-opacity="${op}" filter="url(#s)">${t}</text>`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
      `<defs><filter id="s" x="-20%" y="-50%" width="140%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="8" ` +
      `flood-color="#000" flood-opacity="0.8"/></filter>` +
      `<linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BG}" stop-opacity="0.85"/>` +
      `<stop offset="0.28" stop-color="${BG}" stop-opacity="0"/><stop offset="0.55" stop-color="${BG}" stop-opacity="0.1"/>` +
      `<stop offset="0.8" stop-color="${BG}" stop-opacity="0.9"/><stop offset="1" stop-color="${BG}" stop-opacity="1"/></linearGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#v)"/>` +
      text('TRIBE', 300, 120, 700, 26, '#f3e9d8') +
      text('Город. Дружина. Поход.', 372, 40, 600, 4, '#f3e9d8', 0.85) +
      `<rect x="${W / 2 - 160}" y="1430" width="320" height="4" rx="2" fill="${GOLD}"/>` +
      text(head, 1560, 104, 800, 10, GOLD) +
      text(sub, 1640, 44, 600, 3, '#f3e9d8', 0.85) +
      `</svg>`,
  );
}

await mkdir(OUT, { recursive: true });
const crest = await readFile(at('assets-src/brand/crest.svg'));
const shield = await sharp(crest, { density: 72 * 6 }).resize(150, 150).png().toBuffer();
// Кадр 1080×1800 — сверху, ниже — поле цвета фона: низ всё равно уходит в тень под заголовком.
const city = await sharp(at('assets-src/splash/city-full.jpg')).resize(W, 1800).png().toBuffer();
for (const k of KINDS) {
  const jpg = await sharp({ create: { width: W, height: H, channels: 3, background: BG } })
    .composite([{ input: city, left: 0, top: 0 }, { input: overlay(k) }, { input: shield, left: (W - 150) / 2, top: 60 }])
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  await writeFile(`${OUT}/${k.id}.jpg`, jpg);
  console.log(`public/assets/share/${k.id}.jpg  ${W}×${H}  ${(jpg.length / 1024).toFixed(1)} КБ`);
}
