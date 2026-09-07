// Арты перехода между посёлком и картой мира.
//
// Из `assets-src/splash/<имя>-640.png` (640×360, 16:9) режет полосу и кладёт
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
// Запуск: node scripts/build-splash.mjs
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

const SRC = fileURLToPath(new URL('../assets-src/splash', import.meta.url));
const OUT = fileURLToPath(new URL('../src/ui/art', import.meta.url));

/**
 * Качество 72 — там, где кривая «вес против артефактов» ломается: на 80 файл
 * тяжелее на треть, а разницы на тёмном ночном арте не видно; на 65 в пламени
 * и на дымном небе проступают ступеньки.
 */
const QUALITY = 72;

/** Потолок веса: занавес не должен стоить дороже, чем весь экран загрузки ×10. */
const CAP_KB = 60;

const PLAN = [
  // Уход на карту: дружина перед чужой крепостью. Логотип ниже, чем у костра.
  { name: 'march', top: 140, height: 220 },
  // Возвращение домой: племя у костра.
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
console.log(`всего ${kb.toFixed(1)} КБ`);
if (kb > CAP_KB) {
  console.error(`не влезло в потолок ${CAP_KB} КБ`);
  process.exit(1);
}
