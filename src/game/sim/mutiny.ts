// Ропот и мятеж.
//
// Порядок считается при чтении (`derived.orderBreakdown`), и тика у него нет. Здесь
// живёт только то, что порядку нужно сверх числа: срок. Упал порядок ниже порога —
// идёт ропот; ропот дошёл до `MUTINY_FUSE` — поднимается мятеж, событием в общей
// таблице событий, с выбором, как раскол в приходе. Третьей системы под мятеж не
// заведено: у деревни нет бунта ни в каком виде (`revolts` мира — окно на **чужом**
// поселении, его поднимает лазутчик), и мятеж лёг туда же, куда легла ересь, —
// в строку тревоги и в событие.
//
// **Срок идёт только при игроке.** Офлайн-догон ропот не двигает, а окно мятежа не
// разрешается само, пока игру не открыли. У чужих это правило снято: набег и осада
// приходят, в игре хозяин или нет (docs/DEFEAT_LADDER.md), — довод там был «иначе
// лучшая игра — закрыть приложение». У мятежа этот довод не работает: закрытое
// приложение ропот не гасит, а замораживает, и вернувшийся игрок застаёт тот же
// ропот с тем же сроком. Выиграть он может ровно столько выработки, сколько дал бы
// офлайн без всякого ропота. Разбор — docs/order.md.
import type { GameState, ResourceId } from '../types';
import { MUTINY_ANSWER, MUTINY_CARRY, MUTINY_FUSE, MUTINY_SUPPRESS_MORALE, RESOURCE_IDS } from '../constants';
import { ORDER_TEXT } from '../data/order';
import { bondedTotal, hiddenStash, mutinyForecast, mutinyOpen, orderState } from '../derived';
import { plunder } from '@/world/spoils';
import { loseBonded, losePop } from './population';
import { log } from './log';
import { recordRaidLoss } from '@/profile/stats';

/** Что шаг ропота велит сделать тику: поднять мятеж, разрешить его молчанием или ничего. */
export type UnrestStep = 'raise' | 'silence' | null;

/**
 * Шаг ропота. `present` — игрок при игре (живой шаг, а не догон отлучки).
 *
 * - Порядок выше порога — ропот тает вдвое быстрее, чем копился: короткий провал
 *   не копится вечно, но и не забывается мгновенно.
 * - Порядок ниже порога — ропот копится. **Зреет он по времени, а не по присутствию**
 *   (docs/time.md, раздел 14): при игроке и в догоне отлучки одинаково. Дошёл до срока —
 *   мятеж ложится на стол.
 * - Мятеж на столе — идёт срок ответа, и это **единственное, что идёт только при игроке**:
 *   окно ответа существует затем, чтобы игрок выбрал, а без игрока выбирать некому. Мятеж,
 *   созревший в отлучке, ждёт хозяина на столе; его молчание — «стража выходит сама» —
 *   случается только при нём. Самая жёсткая потеря в игре во сне не приходит.
 */
export function unrestTick(s: GameState, dt: number, present: boolean): UnrestStep {
  const unrest = Math.max(0, s.unrest ?? 0);
  if (mutinyOpen(s)) {
    if (!present) return null;
    s.unrest = Math.min(MUTINY_FUSE + MUTINY_ANSWER, unrest + dt);
    return s.unrest >= MUTINY_FUSE + MUTINY_ANSWER ? 'silence' : null;
  }
  if (orderState(s) !== 'unrest') {
    s.unrest = Math.max(0, unrest - dt * 2);
    return null;
  }
  s.unrest = Math.min(MUTINY_FUSE, unrest + dt);
  return s.unrest >= MUTINY_FUSE ? 'raise' : null;
}

/** Мятеж кончился — чем бы ни кончился, ропот начинается заново с нуля. */
const settle = (s: GameState): void => {
  s.unrest = 0;
};

/**
 * Стража не удержала город. Это и есть самая жёсткая потеря в игре, и цена её
 * объявлена заранее — строкой под сроком ропота и в окне мятежа:
 *
 * - уходит `MUTINY_TOWN_LEAVE` горожан (последний человек не уходит никогда, как
 *   и при голоде);
 * - со склада уносят добро тем же правилом, что у набега и павшего города:
 *   всё, кроме тайника, сколько унесут уходящие (`world/spoils.plunder`).
 *   Четвёртого способа делить склад в игре нет;
 * - уходят все невольники.
 *
 * Здания, дружина, казна и снаряжение остаются: мятеж уносит людей и добро, а не
 * посёлок.
 */
export function mutinyFalls(s: GameState): string {
  const f = mutinyForecast(s);
  const left = losePop(s, Math.min(f.leave, Math.max(0, s.pop - 1)));
  s.stats.died += left;
  const stock: Partial<Record<ResourceId, number>> = {};
  for (const r of RESOURCE_IDS) stock[r] = Math.max(0, Math.floor(s.resources[r]));
  const spoils = plunder(stock, hiddenStash(s), (left + f.bonded) * MUTINY_CARRY);
  const taken: Partial<Record<ResourceId, number>> = {};
  for (const r of RESOURCE_IDS) {
    const n = spoils.taken[r] ?? 0;
    if (n <= 0) continue;
    s.resources[r] = Math.max(0, s.resources[r] - n);
    taken[r] = n;
  }
  recordRaidLoss(s, taken);
  const bonded = loseBonded(s, f.bonded);
  settle(s);
  return ORDER_TEXT.mutiny.fell({ left, bonded, taken: spoils.takenTotal, hidden: spoils.hiddenTotal });
}

/**
 * «Подавить силой». Исход решает не кость, а числа, которые игрок видел заранее:
 * стража дома против поднявшихся невольников (`derived.mutinyForecast`). Хватает —
 * мятеж подавлен, часть невольников сбегает, мораль проседает. Не хватает — город
 * не удержан (`mutinyFalls`).
 */
export function mutinySuppress(s: GameState): string {
  const f = mutinyForecast(s);
  if (!f.holds) return mutinyFalls(s);
  const fled = loseBonded(s, f.flee);
  s.morale = Math.max(0, s.morale - MUTINY_SUPPRESS_MORALE);
  settle(s);
  return ORDER_TEXT.mutiny.held(fled);
}

/** «Отпустить невольников»: все уходят своей дорогой, горожане остаются, склад цел. */
export function mutinyRelease(s: GameState): string {
  const n = loseBonded(s, bondedTotal(s));
  settle(s);
  return ORDER_TEXT.mutiny.released(n);
}

/**
 * «Раздать хлеб и золото». Плату снимает само событие (`payEventCost`), здесь
 * только гаснет ропот. Надзор при этом прежний — поэтому, если порядок не поднять,
 * ропот начнётся снова и через тот же срок снова дойдёт до мятежа.
 */
export function mutinyPay(s: GameState): string {
  settle(s);
  return ORDER_TEXT.mutiny.paid;
}

/**
 * Отпустить часть невольников — рычаг против мятежа без всякого мятежа. Уходят
 * своей дорогой: жителями посёлка они не становятся, иначе «купить и отпустить»
 * было бы покупкой населения за золото. Первыми уходят те, кто без места.
 */
export function releaseBonded(s: GameState, count: number): string | null {
  const n = Math.max(1, Math.floor(count));
  if (bondedTotal(s) < n) return ORDER_TEXT.market.noBonded;
  const gone = loseBonded(s, n);
  log(s, ORDER_TEXT.releaseLog(gone), 'info', 'bonded:release');
  return null;
}
