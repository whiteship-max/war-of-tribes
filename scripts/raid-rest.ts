// «Мораль между боями» — раздел отчёта `raid-hiring:report` (поставка 4 боя, docs/battle_eu4.md, 14.30–14.31).
//
// Бои — те же записи боя из прогонов «Найма», что у «Ширины поля» (`Hired`): второй раз они не гоняются. На каждый бой —
// с какой долей полной морали вошла и вышла каждая сторона (`lib/rested.ts`). Раздел отвечает на два вопроса: как часто
// армия идёт в бой уставшей — дралась недавно, — и с какой долей выходят из боя победитель и проигравший. Своих чисел
// у раздела нет: доля на входе — событие журнала, на выходе — поле итога ядра.
import { pad, pct, q } from './raid-common';
import { median } from './lib/front';
import type { Rested } from './lib/rested';
import type { Out } from './raid-live';
import type { Hired } from './raid-hiring';

const every = (outs: Out[]): Rested[] => outs.flatMap((o) => o.l.rests);

const cut = (xs: number[]): string => (xs.length ? `${q(xs, 0.1).toFixed(2)}…${median(xs).toFixed(2)}…${q(xs, 0.9).toFixed(2)}` : '—');

function row(label: string, rs: Rested[]): void {
  const tiredUs = rs.filter((r) => r.inUs < 1);
  const tiredFoe = rs.filter((r) => r.inFoe < 1);
  const winOut = rs.map((r) => (r.won ? r.outUs : r.outFoe));
  const loseOut = rs.map((r) => (r.won ? r.outFoe : r.outUs));
  console.log(
    ` ${label.padEnd(26)} ${pad(rs.length, 5)}  ${pad(`${tiredUs.length} (${rs.length ? pct(tiredUs.length / rs.length) : '—'})`, 12)}  ${pad(cut(tiredUs.map((r) => r.inUs)), 16)}  ${pad(`${tiredFoe.length} (${rs.length ? pct(tiredFoe.length / rs.length) : '—'})`, 12)}  ${pad(cut(tiredFoe.map((r) => r.inFoe)), 16)}  ${pad(cut(winOut), 16)}  ${pad(cut(loseOut), 16)}`,
  );
}

export function restSection(hired: Hired): void {
  console.log('');
  console.log('=== Мораль между боями: с какой долей полной морали стороны входят в бой и выходят из него (docs/battle_eu4.md, 14.31) ===');
  console.log('Бои — те же записи боя, что у «Ширины поля». «Уставшими» — сторона вошла в бой не в полной морали (дралась недавно); доля — от полной.');
  console.log('Выход — с какой долей полной морали уцелевшие выходят из боя (итог ядра); медиана с 10-й и 90-й долями.');
  console.log(' бои                         боёв  наши уставшими  их доля на входе  чужие уставшими  их доля на входе  победитель выходит  проигравший выходит');
  const outs = [...Object.values(hired.ladder).flat(), ...Object.values(hired.fresh).flat(), ...hired.captives];
  const all = every(outs);
  const KIND: Record<string, string> = { defense: 'оборона', raid: 'наш удар', support: 'выручка', scout: 'разведка' };
  for (const kind of [...new Set(all.map((r) => r.kind))].sort()) {
    const of = all.filter((r) => r.kind === kind);
    row(`${KIND[kind] ?? kind}: с отрядами мира`, of.filter((r) => !r.gate));
    if (of.some((r) => r.gate)) row(`${KIND[kind] ?? kind}: у ворот по событиям`, of.filter((r) => r.gate));
  }
  row('все бои', all);
}
