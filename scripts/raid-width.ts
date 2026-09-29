// «Ширина поля» — раздел отчёта `raid-hiring:report`: прибор пачки 2 боя по образцу EU4 (docs/battle_eu4.md,
// раздел 8).
//
// Решение владельца (26.09.2026): ширина фронта W — одно число, медиана фронта меньшей стороны в боях,
// которые игра играет. Бои здесь — все записи боя из прогонов «Найма», которые отчёт уже сделал
// (`Hired`: лестница мерки, партия с первой секунды, уведённые люди): второй раз они не гоняются. Что такое
// фронт меньшей стороны, решает `lib/front.ts`; раздел только раскладывает бои по частям и печатает.
//
// Ширина из этого раздела — вывод, а не выбор: W — медиана по всем боям выборки, и другой строкой её не
// подменяют. Строки по частям и по видам стоят рядом, чтобы было видно, чей бой тянет медиану.
//
// Бои у ворот по событиям — волки и разбойники — в выборку не входят (слово владельца, docs/battle_eu4.md, 14.29):
// тогда их сила была долей обороны, числом руками; с шага 5 пересмотра баланса (14.35) она — таблица по уровню посёлка, а
// вернуть ли их в выборку, решает владелец вместе с выводом W (П5). Их число печатается строкой отдельно.
import { FRONT } from '@/battle';
import { pad, pct, q } from './raid-common';
import { median, widthOf, widthSample, type Front } from './lib/front';
import type { Out } from './raid-live';
import type { Hired } from './raid-hiring';

/** Вид отчёта мира словами (`Report.kind`). */
const KIND: Record<string, string> = { defense: 'оборона', raid: 'наш удар', support: 'выручка', scout: 'разведка' };

const every = (outs: Out[]): Front[] => outs.flatMap((o) => o.l.fronts);
/** Бои выборки W: без боёв у ворот по событиям. */
const fronts = (outs: Out[]): Front[] => widthSample(every(outs));

const cut = (xs: number[]): string =>
  xs.length ? [0.1, 0.25].map((p) => q(xs, p).toFixed(1)).join('…') + `…${median(xs).toFixed(1)}…` + [0.75, 0.9].map((p) => q(xs, p).toFixed(1)).join('…') : '—';

function row(label: string, fs: Front[]): void {
  const small = fs.map((f) => f.small);
  const big = fs.map((f) => f.big);
  console.log(` ${label.padEnd(36)} ${pad(fs.length, 5)}  ${pad(cut(small), 38)}  ${pad(big.length ? median(big).toFixed(1) : '—', 15)}`);
}

export function widthSection(hired: Hired): void {
  console.log('');
  console.log('=== Ширина поля: фронт меньшей стороны в боях отчёта (docs/battle_eu4.md, раздел 8) ===');
  console.log('Бои — каждая запись боя в отчётах мира из прогонов разделов А, Б и В выше; бой у стены «сухим прогоном» (садиться ли в осаду) записи не пишет.');
  console.log(`Меньшая сторона — по всем, кто вышел в бой (фронт, тыл и резерв); фронт полосы — её первая линия без ширины (пешие и конные, где бы ни встали) на ${FRONT.length} полосы,`);
  console.log('в бойцах строя — единицах ядра боя (вес вида — по цене, price.battleWeight). W — медиана по всем боям выборки (решение владельца 26.09.2026).');
  console.log('Бои у ворот по событиям (волки, разбойники) в выборку не входят (слово владельца, 14.29): их сила была долей обороны, числом руками; с шага 5');
  console.log('пересмотра баланса она — таблица по уровню посёлка (data/events.GATE_POWER), а вернуть ли их в выборку — решение вместе с выводом W (П5, 14.35).');
  console.log(' бои                                   боёв  фронт полосы меньшей: 10-я…25-я…медиана…75-я…90-я  большей: медиана');
  const ladder = Object.entries(hired.ladder);
  const levels = [...new Set(ladder.map(([k]) => Number(k.split(':')[1])))].sort((a, b) => a - b);
  for (const level of levels) row(`А. лестница мерки, ур. ${level}`, fronts(ladder.filter(([k]) => Number(k.split(':')[1]) === level).flatMap(([, outs]) => outs)));
  row('Б. партия с первой секунды', fronts(Object.values(hired.fresh).flat()));
  row('В. уведённые люди', fronts(hired.captives));
  const outs = [...ladder.flatMap(([, o]) => o), ...Object.values(hired.fresh).flat(), ...hired.captives];
  const all = fronts(outs);
  for (const kind of [...new Set(all.map((f) => f.kind))].sort()) row(`вид отчёта: ${KIND[kind] ?? kind}`, all.filter((f) => f.kind === kind));
  row('все бои выборки', all);
  console.log(` вне выборки: боёв у ворот по событиям — ${every(outs).length - all.length}`);
  if (all.length === 0) {
    console.log('Боёв нет — W не из чего выводить.');
    return;
  }
  const w = widthOf(all);
  const share = (f: (x: Front) => boolean): string => pct(all.filter(f).length / all.length);
  console.log(`W = ${w} бойцов строя на полосу — медиана фронта меньшей стороны по всем ${all.length} боям выборки.`);
  console.log(
    `При W = ${w}: фронт меньшей стороны шире W в ${share((x) => x.small > w)} боёв, большей — в ${share((x) => x.big > w)}, обеих разом — в ${share((x) => x.small > w && x.big > w)}.`,
  );
}
