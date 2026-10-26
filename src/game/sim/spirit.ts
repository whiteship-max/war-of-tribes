// Дух дружины (ДР-1, docs/siege_v2.md, «Решения ДР-1») — единственная дверь: мораль и дисциплина войска с причинами строками.
// Числа и формулы — `game/spiritrules` (одни на игру и сервер); здесь — откуда они берутся в партии и память боёв, которую
// пишет только `noteBattle`. Режим жалованья пишет дверь содержания войска (`sim/upkeep.setWageMode`): жалованье — её дело,
// дух его только читает.
//
// **Строится поверх, а не рядом** (Д2): терпение дружины — полоса войска стабильности (`sim/stability.armyBar`), стойкость —
// обряд, Воевода и сословия (`derived.fervour`, `councilGift`, `estatesNow` — те же числа, что прежде шли в бой прибавкой
// `armyResolve`), голод — нехватка войска (`derived.foodShortfall`), ступень — `sim/stability.stabLevel`. Второго счёта ни у
// чего нет. В бой дух едет слепком моста (`world/bridge`, `PlayerProfile.spirit`), на сервер — описью (`WatchCard.spirit`).
import type { GameState, SpiritState } from '../types';
import type { Spirit } from '@/battle';
import { realMs } from '../pace';
import { buildingOfType, councilGift, estatesNow, fervour, foodShortfall, troopsEat } from '../derived';
import { FERVOUR_SCALE } from '../estaterules';
import { gloryAfter, gloryAt, payShareAt, spiritNumbers, spiritOfIn, type SpiritIn, type SpiritView, type WageMode } from '../spiritrules';
import { armyBar, stabLevel } from './stability';
import { agentLevel, seated } from './agents';

/** Жалованье дружине: режим, минута смены и доля восстановления в неё. Нет поля — полное и давно (доля 1). */
export function wageTrack(s: GameState): { mode: WageMode; since: number; from: number } {
  const w = s.pay?.wage;
  return w ? { mode: w.mode, since: w.since, from: w.from } : { mode: 'full', since: 0, from: 1 };
}

/** Режим жалованья сейчас. */
export const wageMode = (s: GameState): WageMode => s.pay?.wage?.mode ?? 'full';

/** Доля восстановления духа жалованьем сейчас, 0…1 (`spiritrules.payShareAt` по настоящему времени со смены). */
export function payShare(s: GameState): number {
  const w = wageTrack(s);
  return payShareAt(w.mode, w.from, realMs(Math.max(0, s.time - w.since)));
}

/** Память боёв сейчас: отметка, растаявшая за настоящее время с боя. */
export function gloryNow(s: GameState): number {
  const g = s.spirit;
  return g ? gloryAt(g.glory, realMs(Math.max(0, s.time - g.at))) : 0;
}

/** Готовые числа духа из партии — одной функцией на раздел «Дружины», мост и опись. */
export function spiritIn(s: GameState): SpiritIn {
  const n = estatesNow(s);
  return {
    stab: stabLevel(s),
    patience: armyBar(s),
    // Бойцы, что не едят (ВРЕМЕННО ДЛЯ ТЕСТА, `derived.troopsEat`), и не голодают.
    unfed: troopsEat(s) ? foodShortfall(s).army : 0,
    glory: gloryNow(s),
    rite: fervour(s),
    marshal: councilGift(s, 'marshal'),
    knights: FERVOUR_SCALE * n.knights.plus,
    merchants: n.merchants.minus,
    general: seated(s, 'general') ? agentLevel(s, 'general') : null,
    barracks: buildingOfType(s, 'barracks')?.level ?? 0,
    pay: payShare(s),
  };
}

/** Мораль и дисциплина сейчас: значение, потолок и строки «что влияет». */
export const spiritView = (s: GameState): SpiritView => spiritOfIn(spiritIn(s));

/** Дух числами — то, что едет в бой (`ArmySetup.spirit`) и в опись. */
export const spiritOf = (s: GameState): Spirit => spiritNumbers(spiritView(s));

/**
 * Дух отряда, накормленного обозом (ДР-2, docs/siege_v2.md, 25.1, М5б): тот же расчёт без строки голода. Голода нет — нет и
 * отдельного духа (`undefined`): сытый совпадает с `spiritOf`.
 */
export function spiritFedOf(s: GameState): Spirit | undefined {
  const inn = spiritIn(s);
  return inn.unfed > 0 ? spiritNumbers(spiritOfIn({ ...inn, unfed: 0 })) : undefined;
}

/**
 * Бой кончился: память духа — победа прибавляет, поражение отнимает (`spiritrules.gloryAfter`). Зовёт его та же минута, что
 * пишет счёт битв (`sim/expedition`, рядом с `recordBattle`): бой — одним итогом.
 */
export function noteBattle(s: GameState, won: boolean): void {
  s.spirit = { glory: gloryAfter(gloryNow(s), won), at: s.time };
}

/** Память из сохранения: только целая запись с числами; иначе — нет памяти. */
export function mergeSpirit(saved: unknown): SpiritState | undefined {
  if (!saved || typeof saved !== 'object') return undefined;
  const r = saved as Record<string, unknown>;
  const glory = typeof r.glory === 'number' && Number.isFinite(r.glory) ? r.glory : null;
  const at = typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : null;
  return glory === null || at === null ? undefined : { glory, at };
}
