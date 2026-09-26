// Что навык агента делает в мире — одно правило на мир и на карточку.
//
// Мир получает от племени три прибавки (`PlayerProfile.pips`, `sightBonus`,
// `stealth`) и кладёт каждую туда, где у неё своя дверь:
//
// - отметки полководца — в кость фазы боя (`ArmySetup.pips`), и только в боях,
//   которые он ведёт, да у своих стен, пока его дружина стоит у ворот
//   (`LocalWorld.generalPips`, `homePips`); стойкость стороны — один обряд;
// - зоркость — в радиус, которым разведчик открывает землю (`revealSight`);
//   живого обзора она не даёт, его держит `sight.liveSight`, и он её не читает;
// - скрытность — в то, заметили ли провал (`slipped`); шанс дела не трогает.
//
// Чего здесь нет и не должно быть никогда: вместимости дружины (Статуя), старения
// разведданных, предупреждения и шанса лазутчика (Дозор), обороны (частокол,
// башня, казармы, храм). Держит это `game/data/agents.owners.test.ts`, читая этот
// модуль целиком.
//
// Модуль чистый: ни состояния, ни часов.
import { DICE, PIP_IDS, phaseLuck, pipOf, type ArmySetup, type PipId, type Pips, type UnitKind } from '@/battle';
import { gearOf, type TroopStack } from '@/game/battle/kinds';
import { FIGURE_BY_ID } from './data/figures';
import type { FigureId } from './types';

/**
 * Отметки полководца у своих стен: всё, кроме манёвра, — стена не движется, обходить некого и
 * некуда (решение владельца 26.09.2026, docs/battle_eu4.md, вопрос 5). Вылазка идёт в поле — в неё
 * отметки идут все.
 */
export const wallPips = (pips: Pips | undefined): Pips => {
  const out: Pips = { ...(pips ?? {}) };
  delete out.maneuver;
  return out;
};

/** Что даёт одна отметка фазы. */
export interface PipRow {
  pip: PipId;
  /** Сколько отметок этой фазы у полководца. */
  n: number;
  /**
   * На сколько в среднем вырастает урон его стороны в фазах этой отметки, доля: замер той же
   * функцией ядра, которой бой множит урон (`phaseLuck`), на середине кости с отметками и без.
   */
  gain: number;
}

/**
 * Отметки полководца строками для карточки — **замером** функцией ядра, а не пересказом числа:
 * отметка сдвигает кость фазы на грань, и во что эта грань обходится уроном, говорит `phaseLuck`.
 */
export function pipRows(pips: Pips | undefined): PipRow[] {
  const mid = (DICE.faces - 1) / 2;
  const setup = { pips } as ArmySetup;
  return PIP_IDS.map((pip) => {
    const n = pipOf(setup, pip);
    return { pip, n, gain: phaseLuck(mid, n) - phaseLuck(mid, 0) };
  });
}

/**
 * Снаряжение нашего отряда: кузница по видам бойцов. Ступени «от конюшни» здесь больше нет —
 * её место занял второй конный род: доспех на всаднике теперь вид, а не прибавка зданием
 * (docs/stable.md, решение 7).
 */
export function ownGearOf(troops: TroopStack): Partial<Record<UnitKind, number>> {
  return gearOf(troops);
}

/**
 * Радиус, которым фигура открывает **землю**, клеток. Зоркость прибавляется
 * только разведчику: у остальных она не читается вовсе.
 */
export const revealSight = (id: FigureId, sightBonus: number): number =>
  FIGURE_BY_ID[id].sight + (id === 'scout' ? Math.max(0, Math.round(sightBonus)) : 0);

/**
 * Провал лазутчика прошёл незамеченным? Решает тот же бросок, что решил провал,
 * — второго броска нет. `miss` — где легла кость в зоне провала: 0 у самой черты
 * шанса, 1 в самом дальнем углу (`spy.spyOutcome`). Провал, легший ближе к
 * черте, чем доля скрытности, — незамеченный: неудача на волоске уходит тихо.
 * При скрытности ноль не проходит ни один — первый уровень ведёт себя по-прежнему.
 */
export const slipped = (miss: number, stealth: number): boolean => miss < Math.max(0, Math.min(1, stealth));

/**
 * Какая доля провалов проходит незамеченной — **замером**, а не пересказом числа:
 * решение `slipped` прогоняется по всей зоне провала равными шагами.
 */
export function slipShare(stealth: number, steps = 1000): number {
  let n = 0;
  for (let i = 0; i < steps; i++) if (slipped((i + 0.5) / steps, stealth)) n++;
  return n / steps;
}
