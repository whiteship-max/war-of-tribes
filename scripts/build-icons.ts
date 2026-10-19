// Сборка набора значков ЗН-1 (docs/icons.md): рисунки `scripts/icons/set.ts` → два листа символов.
//
//   • первый экран (`FIRST_SCREEN` в `src/ui/icons/alias.ts`) — строкой в `src/ui/icons/generated.ts`: едет с кодом первой
//     загрузки и стоит в документе к первому кадру;
//   • остальное — файлом `public/assets/icons/sprite.svg`, который игра тянет после первого кадра (`ui/icons/sheet.ts`).
//
// Проверки, ни одной на глаз (`checkSet` — их же зовёт тест `icons.test.ts`):
//   • у каждого имени накладной (`registry.ICON_MANIFEST`) и у каждой ссылки (`alias.ALIAS`) есть рисунок;
//   • ссылка не прячет рисунок с тем же именем и не ведёт на ссылку;
//   • рисунок — в поле 32×32 с запасом на контур, контур одной толщины, линия гравюры не тоньше `MIN_LINE`;
//   • вес: первый экран — не больше `FIRST_CAP_GZIP`, лист — не больше `SHEET_CAP_GZIP`.
//
//   npm run icons:build            — собрать
//   npm run icons:build -- --check — только проверить
import { gzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON_MANIFEST } from '@/ui/icons/registry';
import { ALIAS, FIRST_SCREEN } from '@/ui/icons/alias';
import { GRID, OUTLINE, TINCT, pointsOf, symbolSvg, type Art } from './icons/kit';
import { ART } from './icons/set';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHEET = path.join(ROOT, 'public', 'assets', 'icons', 'sprite.svg');
export const GENERATED = path.join(ROOT, 'src', 'ui', 'icons', 'generated.ts');

/** Потолок первого экрана по сети: столько ЗН-1 позволяет прибавить к первой загрузке (6 КБ) с запасом на код. */
export const FIRST_CAP_GZIP = 6000;
/** Потолок ленивого листа по сети (прежний потолок листа художника, техзадание 3.3). */
export const SHEET_CAP_GZIP = 60 * 1024;
/** Тоньше линия на 16 px — меньше 0,6 px, и она тает в полутон: такую гравюру не рисуем. */
export const MIN_LINE = 1.1;
/** Рисунок с контуром не выходит за поле: контур виден наполовину — полторы единицы за край пути. */
const FIELD = { min: -0.6, max: GRID + 0.6 };

export interface SetFault {
  name: string;
  why: string;
}

/** Проверка набора целиком: накладная, ссылки, поле, вес линий. Пустой список — набор годен. */
export function checkSet(art: Record<string, () => Art> = ART): SetFault[] {
  const out: SetFault[] = [];
  const drawn = new Set(Object.keys(art));
  const alias = ALIAS as Record<string, string>;
  for (const name of ICON_MANIFEST) {
    const to = alias[name] ?? name;
    if (!drawn.has(to)) out.push({ name, why: alias[name] ? `ссылка на ${to}, а его нет` : 'нет рисунка' });
  }
  for (const [from, to] of Object.entries(alias)) {
    if (drawn.has(from)) out.push({ name: from, why: `ссылка прячет рисунок с тем же именем (ведёт на ${to})` });
    if (!drawn.has(to)) out.push({ name: from, why: `ссылка ведёт на ${to}, а он не нарисован` });
  }
  for (const name of FIRST_SCREEN) if (!drawn.has(alias[name] ?? name)) out.push({ name, why: 'первый экран без рисунка' });
  for (const [name, make] of Object.entries(art)) {
    const shapes = make();
    if (shapes.length === 0) out.push({ name, why: 'пустой рисунок' });
    if (!/^[a-z]+-[a-z0-9_-]+$/.test(name)) out.push({ name, why: 'имя не по образцу «группа-имя»' });
    for (const sh of shapes) {
      for (const [x, y] of pointsOf(sh.d)) {
        if (x < FIELD.min || x > FIELD.max || y < FIELD.min || y > FIELD.max) {
          out.push({ name, why: `точка (${x.toFixed(1)}, ${y.toFixed(1)}) за полем ${GRID}×${GRID}` });
          break;
        }
      }
      if (sh.tint !== 'ink' && !(sh.tint in TINCT)) out.push({ name, why: `тинктура «${String(sh.tint)}» не из набора` });
      if (sh.role === 'line' && (sh.w ?? 0) < MIN_LINE) out.push({ name, why: `линия ${sh.w} тоньше ${MIN_LINE}` });
    }
  }
  return out;
}

/** Набор листами: разметка первого экрана и ленивого листа. */
export function sheets(art: Record<string, () => Art> = ART): { first: string; rest: string; firstNames: string[]; restNames: string[] } {
  const alias = ALIAS as Record<string, string>;
  const firstSet = new Set(FIRST_SCREEN.map((n) => alias[n] ?? n));
  const names = Object.keys(art).sort();
  const firstNames = names.filter((n) => firstSet.has(n));
  const restNames = names.filter((n) => !firstSet.has(n));
  const sym = (n: string): string => symbolSvg(n, art[n]());
  return {
    first: firstNames.map(sym).join(''),
    rest: `<svg xmlns="http://www.w3.org/2000/svg">${restNames.map(sym).join('')}</svg>\n`,
    firstNames,
    restNames,
  };
}

const kb = (n: number): string => `${(n / 1000).toFixed(1)} КБ`;

function main(): void {
  const faults = checkSet();
  if (faults.length > 0) {
    console.error(`набор значков не годен (${faults.length}):`);
    for (const f of faults) console.error(`  ${f.name}: ${f.why}`);
    process.exit(1);
  }
  const { first, rest, firstNames, restNames } = sheets();
  const firstGz = gzipSync(first).length;
  const restGz = gzipSync(rest).length;
  console.log(`значки: нарисовано ${firstNames.length + restNames.length}, ссылок ${Object.keys(ALIAS).length}, накладная ${ICON_MANIFEST.length} имён`);
  console.log(`  первый экран: ${firstNames.length} значков, ${kb(Buffer.byteLength(first))} → ${kb(firstGz)} по сети (потолок ${kb(FIRST_CAP_GZIP)})`);
  console.log(`  лист после первого кадра: ${restNames.length} значков, ${kb(Buffer.byteLength(rest))} → ${kb(restGz)} по сети (потолок ${kb(SHEET_CAP_GZIP)})`);
  console.log(`  контур ${OUTLINE} единицы сетки ${GRID}×${GRID}`);
  const errors: string[] = [];
  if (firstGz > FIRST_CAP_GZIP) errors.push(`первый экран весит ${kb(firstGz)} при потолке ${kb(FIRST_CAP_GZIP)}`);
  if (restGz > SHEET_CAP_GZIP) errors.push(`лист весит ${kb(restGz)} при потолке ${kb(SHEET_CAP_GZIP)}`);
  if (errors.length > 0) {
    for (const e of errors) console.error(e);
    process.exit(1);
  }
  if (process.argv.includes('--check')) return;

  writeFileSync(SHEET, rest);
  const list = (xs: string[]): string => xs.map((n) => `  '${n}',`).join('\n');
  writeFileSync(
    GENERATED,
    `// Файл сгенерирован scripts/build-icons.ts — руками не править. Пересобрать: npm run icons:build
//
// Набор ЗН-1 (docs/icons.md): ${firstNames.length + restNames.length} рисунков. Первый экран — ${firstNames.length} символов строкой
// ниже (${kb(firstGz)} по сети, едет с кодом первой загрузки); остальные ${restNames.length} — лист ICON_SHEET после первого кадра
// (${kb(restGz)} по сети).

export const ICON_SHEET = '/assets/icons/sprite.svg';

/** Все нарисованные значки. */
export const DRAWN_ICONS = [
${list([...firstNames, ...restNames].sort())}
] as const;

export type DrawnIcon = (typeof DRAWN_ICONS)[number];

/** Значки первого экрана: они в \`FIRST_SHEET\`. */
export const FIRST_ICONS: readonly DrawnIcon[] = [
${list(firstNames)}
];

/** Символы первого экрана — разметкой, без запроса по сети. */
export const FIRST_SHEET =
  ${JSON.stringify(first)};
`,
  );
  console.log(`записано: ${path.relative(ROOT, SHEET)}, ${path.relative(ROOT, GENERATED)}`);
}

// Тест (`icons.test.ts`) зовёт проверки, но не сборку.
if (!process.env.VITEST) main();
