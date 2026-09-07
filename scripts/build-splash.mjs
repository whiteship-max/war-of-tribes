// Арты перехода между посёлком и картой мира и заставка экрана загрузки.
//
// Из `assets-src/splash/camp-640.png` (640×360, 16:9) режет полосу и кладёт
// WebP в `src/ui/art/`. Руками файлы в `src/ui/art/` не править — скрипт их
// перезапишет.
//
// Что и почему режется:
//
// * Верх с надписью «War of Tribes» уходит нарочно. Занавес показывается по
//   несколько раз за партию, и логотип на нём читается как «игра
//   перезапустилась», а не как «идёт переход». Заодно это правило раздела 3.6
//   docs/ART_HANDOFF.md: в картинке нет текста, потому что весь текст пишет
//   интерфейс — его переводят и правят, а вшитый не переведёшь.
// * Полосы у двух артов разной высоты: у похода логотип висит ниже, и обрезать
//   его вровень с костровым значило бы отрезать вождя по плечи. Высота — свойство
//   картинки, разметка её не знает: <img> стоит на всю ширину, высота своя.
// * Большие версии (1672×941) в клиент не едут вовсе: они лежат в assets-src
//   исходниками, как и музыкальные паки.
//
// Заставка экрана загрузки — там же, но по своим правилам: она вертикальная во
// весь экран, режется из большого исходника (1672×941) и кладётся в
// `public/assets/splash/`, а не в бандл. Почему отдельным файлом, а не строкой
// внутри index.html, — замер в docs/loading.md: вложенная задерживает первый кадр
// экрана загрузки на полсекунды на 3G, а появляется в тот же момент.
//
// Запуск: node scripts/build-splash.mjs
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

const SRC = fileURLToPath(new URL('../assets-src/splash', import.meta.url));
const OUT = fileURLToPath(new URL('../src/ui/art', import.meta.url));
const BOOT_OUT = fileURLToPath(new URL('../public/assets/splash', import.meta.url));

/**
 * Качество 72 — там, где кривая «вес против артефактов» ломается: на 80 файл
 * тяжелее на треть, а разницы на тёмном ночном арте не видно; на 65 в пламени
 * и на дымном небе проступают ступеньки.
 */
const QUALITY = 72;

/** Потолок веса: занавес не должен стоить дороже, чем весь экран загрузки ×10. */
const CAP_KB = 60;

// Занавес один, и он один нужен: первый вход на карту. «Поход» отсюда убран не
// потому, что плох, а потому, что занят заставкой запуска, — а собирать полосу,
// которую никто не импортирует, значит заводить мёртвый файл.
const PLAN = [
  // Первый вход на карту: племя у костра решает, куда идти.
  { name: 'camp', top: 118, height: 242 },
];

let total = 0;
for (const p of PLAN) {
  const src = await readFile(`${SRC}/${p.name}-640.png`);
  const img = sharp(src);
  const meta = await img.metadata();
  if (meta.width !== 640 || meta.height !== 360) {
    throw new Error(`${p.name}-640.png должен быть 640×360, а он ${meta.width}×${meta.height}`);
  }
  const buf = await img
    .extract({ left: 0, top: p.top, width: 640, height: p.height })
    .webp({ quality: QUALITY, effort: 6 })
    .toBuffer();
  await writeFile(`${OUT}/curtain-${p.name}.webp`, buf);
  total += buf.length;
  console.log(`curtain-${p.name}.webp  640×${p.height}  ${(buf.length / 1024).toFixed(1)} КБ`);
}

const kb = total / 1024;
console.log(`занавесы: всего ${kb.toFixed(1)} КБ`);
if (kb > CAP_KB) {
  console.error(`не влезло в потолок ${CAP_KB} КБ`);
  process.exit(1);
}

// ---------- заставка экрана загрузки ----------
//
// Кадр вертикальный: экран 390×844, арт 16:9. Логотип уходит из кадра целиком —
// по тому же правилу, что и у занавесов (в картинке нет текста), и потому что
// при любом вертикальном кадрировании он режется на полуслове.
//
// Ширина 585 — полтора экрана. Двойная (780) весит 43 КБ вместо 26 и на мягком
// живописном арте, лежащем фоном под текстом, неотличима глазом.
//
// Качество 40 подобрано глазом, а не числом: при 38 на ночном небе ещё нет
// ступенек, при 58 файл на 6 КБ тяжелее без видимой разницы. Ниже 38 сыплется
// пламя.
// Арта два, и каждый занят ровно одним делом: «поход» — заставка запуска,
// «костёр» — занавес первого входа на карту. Один и тот же кадр дважды за минуту
// читается поломкой, а не стилем.
//
// Дракон в исходнике сидит в правой верхней четверти (≈0.75 ширины, ≈0.06–0.19
// высоты) и в кадр не попадает дважды: кадр берётся ниже логотипа и по центру.
// Драконов в игре нет, обещать их первым кадром нечестно, — поэтому это не
// счастливая случайность, а условие кадрирования.
const BOOT = { name: 'march', logoBottom: 0.42, cx: 0.53, width: 585, quality: 40 };
const SCREEN = { w: 390, h: 844 };
const BOOT_CAP_KB = 30;

{
  const src = `${SRC}/${BOOT.name}-full.png`;
  const meta = await sharp(src).metadata();
  // Масштаб — наименьший, при котором кадр целиком помещается ниже логотипа.
  const scale = Math.max(SCREEN.h / (meta.height * (1 - BOOT.logoBottom)), SCREEN.w / meta.width) * 3;
  const sw = Math.round(meta.width * scale);
  const sh = Math.round(meta.height * scale);
  const cropW = SCREEN.w * 3;
  const cropH = SCREEN.h * 3;
  const crop = await sharp(src)
    .resize(sw, sh)
    .extract({
      left: Math.min(Math.max(Math.round(BOOT.cx * sw - cropW / 2), 0), sw - cropW),
      top: Math.round(BOOT.logoBottom * sh),
      width: cropW,
      height: cropH,
    })
    .png()
    .toBuffer();
  const boot = await sharp(crop).resize(BOOT.width).webp({ quality: BOOT.quality, effort: 6 }).toBuffer();
  await writeFile(`${BOOT_OUT}/boot.webp`, boot);
  const bootKb = boot.length / 1024;
  const h = Math.round((BOOT.width * SCREEN.h) / SCREEN.w);
  console.log(`boot.webp  ${BOOT.width}×${h}  ${bootKb.toFixed(1)} КБ`);
  if (bootKb > BOOT_CAP_KB) {
    console.error(`заставка не влезла в потолок ${BOOT_CAP_KB} КБ`);
    process.exit(1);
  }
}
