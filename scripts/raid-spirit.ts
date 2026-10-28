// «Дух дружины» — раздел отчёта `raid-hiring:report` (ДР-1, docs/siege_v2.md, 24.1, Д5): с какой моралью и дисциплиной наша
// сторона входит в бой и какие причины их сложили.
//
// Бои — те же записи боя из прогонов «Найма», что у «Ширины поля» (`Hired`): второй раз они не гоняются. Дух — слепок перед
// пульсом (`lib/spirited.ts`): тот же, что мост везёт в мир. Своих чисел у раздела нет.
//
// Цель весов причин духа (решение владельца 26.10.2026): **армия обычного города держит мораль около 70** — нейтрали боя
// (`SPIRIT.even`). Обычный город — партии «Найма», из боёв которых выводится W (набор правила 16: бои выборки W, наша сторона
// на входе). Мера — медиана **потолка** морали по этим боям: веса причин (`spiritrules`, Д5) складывают потолок шкалы, а
// значение — это путь от дна к потолку, который держат жалованье и терпение (Д3), и его не сдвигает ни один вес. Значение
// печатается рядом — сколько боёв идёт с долгом по жалованью, видно по строке «терпение». Тот же разбор печатает шаг вывода W
// (`npm run derive -- w`).
import { SPIRIT } from '@/battle';
import type { SpiritLineId } from '@/game/spiritrules';
import { pad, q } from './raid-common';
import { median } from './lib/front';
import type { Spirited } from './lib/spirited';
import { NAME, STYLES, type Out, type Style } from './raid-live';
import type { Hired } from './raid-hiring';

const every = (outs: Out[]): Spirited[] => outs.flatMap((o) => o.l.spirits);
const hiredOuts = (hired: Hired): Out[] => [...Object.values(hired.ladder).flat(), ...Object.values(hired.fresh).flat(), ...hired.captives];

/** Бои выборки W — без боёв у ворот по событиям (как `lib/front.widthSample`). */
const sample = (ss: readonly Spirited[]): Spirited[] => ss.filter((s) => !s.gate);

const cut = (xs: number[]): string => (xs.length ? [0.1, 0.25].map((p) => q(xs, p).toFixed(1)).join('…') + `…${median(xs).toFixed(1)}…` + [0.75, 0.9].map((p) => q(xs, p).toFixed(1)).join('…') : '—');

/** Дух в боях выборки W: сколько боёв, медианы морали и дисциплины. Боёв нет — `null`. */
export function spiritOfHired(
  hired: Hired,
): { fights: number; morale: number; discipline: number; low: number; high: number; moraleCeil: number; disciplineCeil: number } | null {
  const all = sample(every(hiredOuts(hired)));
  if (all.length === 0) return null;
  const m = all.map((s) => s.morale);
  return {
    fights: all.length,
    morale: median(m),
    discipline: median(all.map((s) => s.discipline)),
    low: q(m, 0.1),
    high: q(m, 0.9),
    moraleCeil: median(all.map((s) => s.moraleCeil)),
    disciplineCeil: median(all.map((s) => s.disciplineCeil)),
  };
}

/** Порядок строк причин — как в окне «Дружины» (`parts/spiritWords`). */
const LINES: readonly [SpiritLineId, string][] = [
  ['base', 'основа'],
  ['stab', 'ступень стабильности'],
  ['glory', 'память боёв'],
  ['hunger', 'голод'],
  ['rite', 'обряд'],
  ['marshal', 'Воевода'],
  ['knights', 'рыцари'],
  ['merchants', 'купцы'],
  ['general', 'полководец'],
  ['barracks', 'казармы'],
  ['cap', 'край шкалы'],
  ['wage', 'жалованье'],
  ['patience', 'терпение'],
];

function row(label: string, ss: Spirited[], ceil = false): void {
  const mo = ss.map((s) => (ceil ? s.moraleCeil : s.morale));
  const di = ss.map((s) => (ceil ? s.disciplineCeil : s.discipline));
  console.log(` ${label.padEnd(30)} ${pad(ss.length, 5)}  ${pad(cut(mo), 32)}  ${pad(cut(di), 32)}`);
}

/** Строки по частям «Найма»: значение или потолок. */
function parts(hired: Hired, ceil: boolean): void {
  const ladder = Object.entries(hired.ladder);
  const levels = [...new Set(ladder.map(([k]) => Number(k.split(':')[1])))].sort((a, b) => a - b);
  for (const level of levels) row(`А. лестница мерки, ур. ${level}`, sample(ladder.filter(([k]) => Number(k.split(':')[1]) === level).flatMap(([, outs]) => every(outs))), ceil);
  row('Б. партия с первой секунды', sample(every(Object.values(hired.fresh).flat())), ceil);
  row('В. уведённые люди', sample(every(hired.captives)), ceil);
  const all = every(hiredOuts(hired));
  row('все бои выборки W', sample(all), ceil);
  row('у ворот по событиям (вне W)', all.filter((s) => s.gate), ceil);
}

export function spiritSection(hired: Hired): void {
  console.log('');
  console.log('=== Дух дружины: с какой моралью и дисциплиной наша сторона входит в бой (ДР-1, docs/siege_v2.md, 24.1) ===');
  console.log(`Бои — те же записи боя, что у «Ширины поля»; дух — слепок перед пульсом, тот же, что мост везёт в бой (sim/spirit). Нейтраль боя — ${SPIRIT.even}.`);
  console.log('Цель весов причин (решение владельца 26.10.2026): армия обычного города держит мораль около нейтрали — медиана потолка морали');
  console.log('боёв выборки W (потолок — основа и причины, его задают веса; значение — путь от дна к потолку, его держат жалованье и терпение).');
  console.log('Значение на входе в бой:');
  console.log(' бои                             боёв  мораль: 10-я…25-я…медиана…75-я…90-я  дисциплина: 10-я…25-я…медиана…75-я…90-я');
  parts(hired, false);
  console.log('Потолок (без жалованья и терпения):');
  console.log(' бои                             боёв  мораль: 10-я…25-я…медиана…75-я…90-я  дисциплина: 10-я…25-я…медиана…75-я…90-я');
  parts(hired, true);
  const inW = sample(every(hiredOuts(hired)));
  if (inW.length === 0) return;
  console.log('Причины в боях выборки W — среднее по боям, мораль / дисциплина (сумма строк — дух на входе):');
  for (const [id, name] of LINES) {
    const got = inW.map((s) => s.lines[id] ?? { morale: 0, discipline: 0 });
    const mo = got.reduce((n, l) => n + l.morale, 0) / inW.length;
    const di = got.reduce((n, l) => n + l.discipline, 0) / inW.length;
    const seen = inW.filter((s) => s.lines[id] !== undefined).length;
    if (id !== 'base' && seen === 0) continue;
    console.log(`  ${name.padEnd(22)} ${pad(mo.toFixed(2), 7)} / ${pad(di.toFixed(2), 7)}   в ${pad(seen, 5)} боях из ${inW.length}`);
  }
  byStyle(hired);
}

/** Бой с долгом по жалованью или голодом войска на входе: строка «терпение» отняла мораль. */
const patient = (s: Spirited): boolean => (s.lines.patience?.morale ?? 0) < 0;

/**
 * Дух по поведениям игрока (ПБ-1, п. 4; docs/siege_v2.md, «Решения ПБ-1»): чьи бои идут с долгом или голодом — строка «терпение».
 * Лестница (А) и партия с первой секунды (Б) — по поведению из ключа прогона; уведённые люди (В) — «по средствам».
 */
function byStyle(hired: Hired): void {
  const by = new Map<Style, Spirited[]>();
  const put = (style: Style, outs: Out[]): void => {
    by.set(style, [...(by.get(style) ?? []), ...sample(every(outs))]);
  };
  for (const [k, outs] of Object.entries(hired.ladder)) put(k.split(':')[0] as Style, outs);
  for (const [style, outs] of Object.entries(hired.fresh) as [Style, Out[]][]) put(style, outs);
  put('means', hired.captives);
  const inW = [...by.values()].flat();
  console.log('По поведениям (ПБ-1, п. 4) — сколько боёв выборки W идут с долгом по жалованью или голодом войска (строка «терпение»):');
  console.log(' поведение                       боёв  с терпением  мораль: медиана');
  for (const style of STYLES) {
    const ss = by.get(style) ?? [];
    if (ss.length === 0) continue;
    const n = ss.filter(patient).length;
    console.log(` ${NAME[style].padEnd(30)} ${pad(ss.length, 5)}  ${pad(`${n} (${((100 * n) / ss.length).toFixed(1)} %)`, 11)}  ${pad(median(ss.map((s) => s.morale)).toFixed(1), 15)}`);
  }
  const n = inW.filter(patient).length;
  console.log(` ${'все бои выборки W'.padEnd(30)} ${pad(inW.length, 5)}  ${pad(`${n} (${inW.length ? ((100 * n) / inW.length).toFixed(1) : '0.0'} %)`, 11)}  ${pad(inW.length ? median(inW.map((s) => s.morale)).toFixed(1) : '—', 15)}`);
}
