// Командиры флангов в бою (ДР-3, docs/siege_v2.md, «Решения ДР-3», К4): сила армии с командирами и вывод вершины тактики
// `TACTICS_TOP`. Сила — та же мерка, что у духа ДР-1 (`spirit.ts`): во сколько раз армия стоит той же армии без них по числу
// людей — армию с командирами ставят против той же, растянутой в k раз, и ищут k, при котором победы делятся поровну. Бои — той
// же дверью, что у мира и сервера (`world/battle.resolveField`), стороны по очереди нападают.
import type { Flanks, Pips } from '@/battle';
import { resolveField, type FieldSide } from '@/world/battle';
import { kindsOf } from '@/game/battle/price';
import type { TroopStack } from '@/game/battle/kinds';
import { MAX_AGENT_LEVEL } from '@/game/data/agents';
import { MAX_ADVISOR_LEVEL } from '@/game/councilrules';
import { TACTICS_TOP, tacticsOf } from '@/game/commandrules';
import { PIP_IDS } from '@/battle/types';
import { scaled } from './spirit';

/** Что ведёт армию: отметки полководца и командиры флангов — поля стороны боя. */
export type Lead = Pick<FieldSide, 'pips' | 'flanks'>;

/** Лучший полководец (К4): вершина лестницы — четыре отметки сверх первого кружка, по одной в каждую. */
export const BEST_GENERAL: Pips = Object.fromEntries(PIP_IDS.map((p) => [p, (MAX_AGENT_LEVEL - 1) / PIP_IDS.length])) as Pips;

/** Двое командиров с тактикой `t` на обоих флангах. */
export const bothFlanks = (t: number): Flanks => ({ A: t, C: t });

/** Доля побед армии с ведущим `lead` против той же армии в `k` раз без ведущих, на сидах `1…seeds` (ничья — половина). */
export function leadShare(troops: TroopStack, lead: Lead, k: number, seeds: number): number {
  const us = kindsOf(troops);
  const them = kindsOf(scaled(troops, k));
  let won = 0;
  for (let i = 1; i <= seeds; i++) {
    const seed = i * 7919;
    const ours: FieldSide = { kinds: us, ...lead };
    const theirs: FieldSide = { kinds: them };
    const atk = i % 2 === 0;
    const f = resolveField({ seed, attacker: atk ? ours : theirs, defender: atk ? theirs : ours });
    const w = f.result?.winner;
    if (w === 'draw') won += 0.5;
    else if ((w === 'attacker') === atk) won += 1;
  }
  return won / seeds;
}

/** Сила ведущего `lead`: k, при котором армия с ним бьётся с той же армией в k раз ровно (бисекция, 12 шагов). */
export function leadStrength(troops: TroopStack, lead: Lead, seeds: number, lo = 0.4, hi = 1.8): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < 12; i++) {
    const m = (a + b) / 2;
    if (leadShare(troops, lead, m, seeds) > 0.5) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

export interface FlankDerived {
  /** Сила лучшего полководца. */
  general: number;
  /** Сила двух командиров с тактикой t на обоих флангах, t = 1…4. */
  both: { t: number; strength: number }[];
  /** Наибольшая t, при которой двое не сильнее лучшего полководца (не меньше одной). */
  top: number;
}

/**
 * Вывод `TACTICS_TOP` (К4): наибольшая тактика, при которой двое лучших тактиков на обоих флангах не сильнее лучшего полководца
 * — подчинённые не сильнее того, кому подчинены. Тактик ищется от одной отметки вверх; сила с отметкой не убывает
 * (монотонность — из устройства, `battle/flank.test.ts`), поэтому первая, что сильнее полководца, кончает поиск.
 */
export function deriveFlank(troops: TroopStack, seeds: number): FlankDerived {
  const general = leadStrength(troops, { pips: BEST_GENERAL }, seeds);
  const both: FlankDerived['both'] = [];
  let top = 1;
  for (let t = 1; t <= MAX_AGENT_LEVEL - 1; t++) {
    const strength = leadStrength(troops, { flanks: bothFlanks(t) }, seeds);
    both.push({ t, strength });
    if (strength > general) break;
    top = t;
  }
  return { general, both, top };
}

/** Сила одного командира каждого рода и уровня на левом фланге при записанной вершине — проверка лестницы и монотонности. */
export function flankChecks(troops: TroopStack, seeds: number): { name: string; tactics: number; strength: number }[] {
  const out: { name: string; tactics: number; strength: number }[] = [];
  for (const birth of ['noble', 'low'] as const) {
    for (let level = 1; level <= MAX_ADVISOR_LEVEL; level++) {
      const t = tacticsOf(birth, level);
      out.push({ name: `${birth === 'low' ? 'безродный' : 'лорд'} ур. ${level}`, tactics: t, strength: leadStrength(troops, { flanks: { A: t } }, seeds) });
    }
  }
  out.push({ name: `двое безродных вершины (${TACTICS_TOP})`, tactics: TACTICS_TOP, strength: leadStrength(troops, { flanks: bothFlanks(TACTICS_TOP) }, seeds) });
  out.push({ name: 'двое лордов ур. 1', tactics: tacticsOf('noble', 1), strength: leadStrength(troops, { flanks: bothFlanks(tacticsOf('noble', 1)) }, seeds) });
  return out;
}
