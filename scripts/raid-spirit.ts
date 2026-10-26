// «Дух дружины» — раздел отчёта `raid-hiring:report` (ДР-1, docs/siege_v2.md, 24.1, Д5): с какой моралью и дисциплиной наша
// сторона входит в бой и какие причины их сложили.
//
// Бои — те же записи боя из прогонов «Найма», что у «Ширины поля» (`Hired`): второй раз они не гоняются. Дух — слепок перед
// пульсом (`lib/spirited.ts`): тот же, что мост везёт в мир. Своих чисел у раздела нет.
//
// Цель весов причин духа (решение владельца 26.10.2026): **армия обычного города держит мораль около 70** — нейтрали боя
// (`SPIRIT.even`). Обычный город — партии «Найма», из боёв которых выводится W (набор правила 16 назван один раз: бои выборки
// W, наша сторона на входе); мера — медиана морали по этим боям. Её же печатает шаг вывода W (`npm run derive -- w`).
import { SPIRIT } from '@/battle';
import type { SpiritLineId } from '@/game/spiritrules';
import { pad, q } from './raid-common';
import { median } from './lib/front';
import type { Spirited } from './lib/spirited';
import type { Out } from './raid-live';
import type { Hired } from './raid-hiring';

const every = (outs: Out[]): Spirited[] => outs.flatMap((o) => o.l.spirits);
const hiredOuts = (hired: Hired): Out[] => [...Object.values(hired.ladder).flat(), ...Object.values(hired.fresh).flat(), ...hired.captives];

/** Бои выборки W — без боёв у ворот по событиям (как `lib/front.widthSample`). */
const sample = (ss: readonly Spirited[]): Spirited[] => ss.filter((s) => !s.gate);

const cut = (xs: number[]): string => (xs.length ? [0.1, 0.25].map((p) => q(xs, p).toFixed(1)).join('…') + `…${median(xs).toFixed(1)}…` + [0.75, 0.9].map((p) => q(xs, p).toFixed(1)).join('…') : '—');

/** Дух в боях выборки W: сколько боёв, медианы морали и дисциплины. Боёв нет — `null`. */
export function spiritOfHired(hired: Hired): { fights: number; morale: number; discipline: number; low: number; high: number } | null {
  const all = sample(every(hiredOuts(hired)));
  if (all.length === 0) return null;
  const m = all.map((s) => s.morale);
  return { fights: all.length, morale: median(m), discipline: median(all.map((s) => s.discipline)), low: q(m, 0.1), high: q(m, 0.9) };
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

function row(label: string, ss: Spirited[]): void {
  console.log(` ${label.padEnd(30)} ${pad(ss.length, 5)}  ${pad(cut(ss.map((s) => s.morale)), 32)}  ${pad(cut(ss.map((s) => s.discipline)), 32)}`);
}

export function spiritSection(hired: Hired): void {
  console.log('');
  console.log('=== Дух дружины: с какой моралью и дисциплиной наша сторона входит в бой (ДР-1, docs/siege_v2.md, 24.1) ===');
  console.log(`Бои — те же записи боя, что у «Ширины поля»; дух — слепок перед пульсом, тот же, что мост везёт в бой (sim/spirit). Нейтраль боя — ${SPIRIT.even}.`);
  console.log('Цель весов причин (решение владельца 26.10.2026): армия обычного города держит мораль около нейтрали — медиана морали боёв выборки W.');
  console.log(' бои                             боёв  мораль: 10-я…25-я…медиана…75-я…90-я  дисциплина: 10-я…25-я…медиана…75-я…90-я');
  const ladder = Object.entries(hired.ladder);
  const levels = [...new Set(ladder.map(([k]) => Number(k.split(':')[1])))].sort((a, b) => a - b);
  for (const level of levels) row(`А. лестница мерки, ур. ${level}`, sample(ladder.filter(([k]) => Number(k.split(':')[1]) === level).flatMap(([, outs]) => every(outs))));
  row('Б. партия с первой секунды', sample(every(Object.values(hired.fresh).flat())));
  row('В. уведённые люди', sample(every(hired.captives)));
  const outs = hiredOuts(hired);
  const all = every(outs);
  const inW = sample(all);
  row('все бои выборки W', inW);
  row('у ворот по событиям (вне W)', all.filter((s) => s.gate));
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
}
