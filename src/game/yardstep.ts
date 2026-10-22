/**
 * Ступень сохранения 23 → 24 партии (ЗД-1, docs/city_v3.md, «Решения ЗД-1») — своей докачкой: её зовёт только партия младше
 * 24-й (`save.loadFold`), и первая загрузка не растёт ради тех, у кого старой партии нет. Правило перехода — общая дверь
 * `game/yardmerge.ts` (одна на партию, сервер и мир); здесь — что ступень делает в самой партии после слияния: возврат цены
 * стройки, которую не на что перенести, дверью склада (`sim/pay.refund`, разовое дело описи) и слова игроку.
 */
import type { BuildingTypeId, GameState, LogEntry } from './types';
import { jobsOf } from './data/buildings';
import { YARD_BY_JOB } from './data/yards';
import { buildingOfType, buildingTitle } from './derived';
import { refund } from './sim/pay';
import { MERGED_PAIRS, foldParty, oldUpgradeCost, type PartyFold } from './yardmerge';

export { foldParty };

/**
 * Конец ступени 23 → 24: возврат цены и слова игроку (`tell` — дверь ступеней сохранения, строка ляжет при входе). Двор
 * назван своим именем и делами, уровень — больший из двух прежних, и сказано, что люди остались на своих делах: молча
 * переход не делается.
 */
export function settleParty(s: GameState, fold: PartyFold, tell: (text: string, kind: LogEntry['kind']) => void): void {
  for (const r of fold.refunds) refund(s, oldUpgradeCost(r.type, r.level), 1);
  const deeds = (type: BuildingTypeId): string =>
    jobsOf(type)
      .map((job) => YARD_BY_JOB.get(job)?.deed.toLowerCase())
      .filter(Boolean)
      .join(' и ');
  const yards = MERGED_PAIRS.map(({ kept }) => `${buildingTitle(s, kept)} (${deeds(kept)}) — ур. ${buildingOfType(s, kept)?.level ?? 1}`).join(', ');
  tell(`Дворы за стеной собраны по два дела: ${yards}. Уровень — больший из двух прежних, люди остались на своих делах.`, 'info');
  if (fold.refunds.length > 0) {
    tell(`Стройка ${fold.refunds.length === 1 ? 'прежнего двора отменена' : 'прежних дворов отменена'}, цена вернулась на склад целиком.`, 'info');
  }
}
