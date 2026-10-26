// Дух войска в бою (ДР-1, docs/siege_v2.md, «Решения ДР-1», Д4): сила армии с моралью и дисциплиной и вывод точек `SPIRIT`.
// Сила — во сколько раз армия с духом стоит ровной по числу людей: армию с духом ставят против той же армии без духа, растянутой
// в k раз, и ищут k, при котором победы делятся поровну. Бои — той же дверью, что у мира и сервера (`world/battle.resolveField`),
// обе стороны по очереди нападают (чётный сид — с духом нападает, нечётный — обороняется): место боя силы не решает.
import { SPIRIT, type Spirit } from '@/battle';
import { resolveField } from '@/world/battle';
import { kindsOf } from '@/game/battle/price';
import { TROOP_IDS } from '@/game/data/troops';
import type { TroopStack } from '@/game/battle/kinds';

/** Ориентир владельца (задание ДР-1): обе шкалы на дне — около −25 % силы, обе на верху — около +10 %. */
export const SPIRIT_AIM = { low: 0.75, high: 1.1 };

/** Каждая шкала берёт половину ориентира (в произведении): на дне √0,75, на верху √1,1 — сила обеих вместе — их произведение. */
export const AXIS_AIM = { low: Math.sqrt(SPIRIT_AIM.low), high: Math.sqrt(SPIRIT_AIM.high) };

/** Состав мерки вывода: копейщики, лучники и латники в долях армии мерки (`raid-mix`). */
export const SPIRIT_MIX: TroopStack = { spearman: 200, archer: 80, legionary: 60 };

/** Отряд в `k` раз больше: каждый вид к ближнему целому. */
export function scaled(t: TroopStack, k: number): TroopStack {
  const out: TroopStack = {};
  for (const id of TROOP_IDS) {
    const n = Math.round((t[id] ?? 0) * k);
    if (n > 0) out[id] = n;
  }
  return out;
}

/** Доля побед армии с духом `spirit` против той же армии в `k` раз без духа, на сидах `1…seeds` (ничья — половина). */
export function winShare(troops: TroopStack, spirit: Spirit, k: number, seeds: number): number {
  const us = kindsOf(troops);
  const them = kindsOf(scaled(troops, k));
  let won = 0;
  for (let i = 1; i <= seeds; i++) {
    const seed = i * 7919;
    const ours = { kinds: us, spirit };
    const theirs = { kinds: them };
    const atk = i % 2 === 0;
    const f = resolveField({ seed, attacker: atk ? ours : theirs, defender: atk ? theirs : ours });
    const w = f.result?.winner;
    if (w === 'draw') won += 0.5;
    else if ((w === 'attacker') === atk) won += 1;
  }
  return won / seeds;
}

/** Сила духа `spirit`: k, при котором армия с ним бьётся с той же армией в k раз ровно (бисекция, 12 шагов). */
export function strengthOf(troops: TroopStack, spirit: Spirit, seeds: number, lo = 0.4, hi = 1.8): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < 12; i++) {
    const m = (a + b) / 2;
    if (winShare(troops, spirit, m, seeds) > 0.5) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** Точка шкалы, при которой сила `axis` — ровно `aim` (бисекция по точке `edge` шкалы `axis`, 8 шагов). */
function solvePoint(troops: TroopStack, seeds: number, axis: 'morale' | 'discipline', edge: 'low' | 'high', aim: number): number {
  const v = edge === 'low' ? 0 : SPIRIT.top;
  const spirit: Spirit = axis === 'morale' ? { morale: v, discipline: SPIRIT.even } : { morale: SPIRIT.even, discipline: v };
  let a = edge === 'low' ? 0.5 : 1;
  let b = edge === 'low' ? 1 : 1.5;
  const was = SPIRIT[axis][edge];
  for (let i = 0; i < 8; i++) {
    const m = (a + b) / 2;
    SPIRIT[axis][edge] = m;
    if (strengthOf(troops, spirit, seeds) < aim) a = m;
    else b = m;
  }
  SPIRIT[axis][edge] = was;
  return Math.round(((a + b) / 2) * 1000) / 1000;
}

export interface SpiritDerived {
  morale: { low: number; high: number };
  discipline: { low: number; high: number };
}

/**
 * Угол `edge` (обе шкалы на дне или на верху) — ровно в ориентир: отклонения обеих точек от единицы множатся на общий k
 * (бисекция, 8 шагов). Доли шкал при этом те, что дал первый шаг: каждая — поровну.
 */
function fitCorner(troops: TroopStack, seeds: number, edge: 'low' | 'high', first: SpiritDerived): { morale: number; discipline: number } {
  const v = edge === 'low' ? 0 : SPIRIT.top;
  const spirit: Spirit = { morale: v, discipline: v };
  const aim = SPIRIT_AIM[edge];
  const was = { morale: SPIRIT.morale[edge], discipline: SPIRIT.discipline[edge] };
  const at = (k: number): { morale: number; discipline: number } => ({
    morale: 1 + (first.morale[edge] - 1) * k,
    discipline: 1 + (first.discipline[edge] - 1) * k,
  });
  let a = 0.5;
  let b = 1.5;
  for (let i = 0; i < 8; i++) {
    const m = (a + b) / 2;
    const p = at(m);
    SPIRIT.morale[edge] = p.morale;
    SPIRIT.discipline[edge] = p.discipline;
    const s = strengthOf(troops, spirit, seeds);
    // Сила на дне падает с k, на верху растёт: ищем k, при котором угол — ориентир.
    if (edge === 'low' ? s > aim : s < aim) a = m;
    else b = m;
  }
  SPIRIT.morale[edge] = was.morale;
  SPIRIT.discipline[edge] = was.discipline;
  const p = at((a + b) / 2);
  return { morale: Math.round(p.morale * 1000) / 1000, discipline: Math.round(p.discipline * 1000) / 1000 };
}

/**
 * Вывод четырёх точек в два шага. Первый — форма: каждая шкала на своём краю при другой в нейтрали даёт половину ориентира
 * (√ угла). Второй — углы: шкалы на краю вместе бьют сильнее произведения своих половин, и отклонения обеих точек края множатся на
 * общий k, пока угол (обе на дне, обе на верху) не станет ориентиром.
 */
export function deriveSpirit(troops: TroopStack, seeds: number): SpiritDerived {
  const first: SpiritDerived = {
    morale: { low: solvePoint(troops, seeds, 'morale', 'low', AXIS_AIM.low), high: solvePoint(troops, seeds, 'morale', 'high', AXIS_AIM.high) },
    discipline: {
      low: solvePoint(troops, seeds, 'discipline', 'low', AXIS_AIM.low),
      high: solvePoint(troops, seeds, 'discipline', 'high', AXIS_AIM.high),
    },
  };
  const low = fitCorner(troops, seeds, 'low', first);
  const high = fitCorner(troops, seeds, 'high', first);
  return { morale: { low: low.morale, high: high.morale }, discipline: { low: low.discipline, high: high.discipline } };
}

/** Сила по углам и сторонам шкал при записанных точках — проверка ориентира и монотонности. */
export const SPIRIT_CHECKS: readonly { name: string; spirit: Spirit }[] = [
  { name: 'обе на дне (0, 0)', spirit: { morale: 0, discipline: 0 } },
  { name: 'мораль 0, дисциплина 70', spirit: { morale: 0, discipline: SPIRIT.even } },
  { name: 'мораль 70, дисциплина 0', spirit: { morale: SPIRIT.even, discipline: 0 } },
  { name: 'обе 35', spirit: { morale: 35, discipline: 35 } },
  { name: 'нейтраль (70, 70)', spirit: { morale: SPIRIT.even, discipline: SPIRIT.even } },
  { name: 'обе 85', spirit: { morale: 85, discipline: 85 } },
  { name: 'мораль 100, дисциплина 70', spirit: { morale: SPIRIT.top, discipline: SPIRIT.even } },
  { name: 'мораль 70, дисциплина 100', spirit: { morale: SPIRIT.even, discipline: SPIRIT.top } },
  { name: 'обе на верху (100, 100)', spirit: { morale: SPIRIT.top, discipline: SPIRIT.top } },
];
