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
// **Срок идёт только при игроке.** Это та же защита отсутствия, что у набега
// (`AWAY_GRACE`: пока игрока не было, никто ничего не громит), только в часах
// племени: офлайн-догон ропот не двигает, а окно мятежа не разрешается само, пока
// игру не открыли. Падению города под осадой защиту не дали, и довод там был —
// «иначе лучшая игра под осадой — закрыть приложение». У мятежа этот довод не
// работает: закрытое приложение ропот не гасит, а замораживает, и вернувшийся
// игрок застаёт тот же ропот с тем же сроком. Выиграть он может ровно столько
// выработки, сколько дал бы офлайн без всякого ропота. Разбор — docs/order.md.
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
 * Шаг ропота. `online` — идёт живая игра, а не офлайн-догон.
 *
 * - Порядок выше порога — ропот тает вдвое быстрее, чем копился: короткий провал
 *   не копится вечно, но и не забывается мгновенно.
 * - Порядок ниже порога — ропот копится, но только при игроке. Дошёл до срока —
 *   пора поднимать мятеж; если на столе другое событие, мятеж ждёт, а срок стоит.
 * - Мятеж на столе — идёт срок ответа, тоже только при игроке. Вышел — стража
 *   выходит сама.
 */
export function unrestTick(s: GameState, dt: number, online: boolean): UnrestStep {
  const unrest = Math.max(0, s.unrest ?? 0);
  if (mutinyOpen(s)) {
    if (!online) return null;
    s.unrest = Math.min(MUTINY_FUSE + MUTINY_ANSWER, unrest + dt);
    return s.unrest >= MUTINY_FUSE + MUTINY_ANSWER ? 'silence' : null;
  }
  if (orderState(s) !== 'unrest') {
    s.unrest = Math.max(0, unrest - dt * 2);
    return null;
  }
  if (!online) {
    s.unrest = Math.min(unrest, MUTINY_FUSE);
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

/** Окно мятежа осталось без ответа: стража выходит сама — тем же боем, что по приказу. */
export function mutinySilence(s: GameState): string {
  return `${ORDER_TEXT.mutiny.silenced} ${mutinySuppress(s)}`;
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
