// Алмазы — премиальная валюта. Весь их учёт живёт здесь и больше нигде:
// поле `s.gems` меняют ровно две функции этого модуля, и обе на виду.
//
// Почему так строго. Настоящая оплата в Telegram Mini App идёт через Telegram
// Stars: счёт выставляет бот, подтверждает его вебхук на сервере, и только
// сервер имеет право сказать «алмазы начислены». Сервера у нас пока нет,
// поэтому начисление сделано дверью, в которую сегодня никто не входит:
// `creditGems` требует расписку с источником `server`, а весь клиентский код —
// компоненты интерфейса, сцена, обработчики кнопок — этой двери не касается.
// Договор держит `gems.test.ts`: он читает исходники и проверяет, что ни в
// `src/ui`, ни в `src/render` нет ни начисления, ни присваивания `s.gems`.
//
// Что алмаз покупает. Только время: мгновенная достройка списывает алмазы и —
// как обычная стройка — ресурсы. Пропуска ресурсов не будет: он обнулил бы
// производство, склад и зиму для платящего игрока, а в PvP превратил бы игру
// в чистый pay-to-win.
import type { Building, GameState } from '../types';
import { BUILDING_BY_ID } from '../data/buildings';
import { buildingById, isSite, upgradeInfo, upgradeWork } from '../derived';
import { TEST_GEMS } from '../constants';
import { startUpgrade } from './actions';
import { log } from './log';

/**
 * Нормативная скорость стройки, работа в секунду. Цена достройки считается от
 * оставшейся работы, приведённой к этой скорости, а не от настоящей: иначе цена
 * прыгала бы каждый раз, когда игрок снимает человека с площади, и её нельзя
 * было бы повторить на сервере.
 */
export const GEM_REF_RATE = 20;

/**
 * Сколько секунд нормативного ожидания стоит один алмаз. Десять — так, чтобы
 * ранние улучшения стоили единицы алмазов (тестового запаса хватает на несколько),
 * а десятый уровень рынка — сотни: платят именно за время, и чем его больше,
 * тем дороже.
 */
export const GEM_SECONDS = 10;

/** Дешевле одного алмаза достройки не бывает: даром время не отдают. */
export const GEM_MIN_PRICE = 1;

export const gemsOf = (s: GameState): number => Math.max(0, Math.floor(s.gems ?? 0));

/** Тестовый запас новой партии — он же и помечен в интерфейсе как тестовый. */
export { TEST_GEMS };

/**
 * Сколько работы осталось до конца улучшения. У начатой стройки — остаток,
 * у нетронутого здания — вся работа следующего уровня: кнопка достройки стоит
 * и там, и там.
 */
export function rushWork(b: Building): number {
  if (isSite(b)) return Math.max(0, b.workRequired - b.work);
  const def = BUILDING_BY_ID[b.type];
  return upgradeWork(def, b.level + 1);
}

/**
 * Цена мгновенной достройки в алмазах. Зависит от оставшегося времени, а не от
 * уровня: чем ближе конец, тем дешевле, и на последних процентах достройка
 * стоит один алмаз.
 */
export function rushPrice(b: Building): number {
  const seconds = rushWork(b) / GEM_REF_RATE;
  return Math.max(GEM_MIN_PRICE, Math.ceil(seconds / GEM_SECONDS));
}

/** Почему достроить нельзя прямо сейчас; null — можно. */
export function rushBlocked(s: GameState, b: Building): string | null {
  if (!isSite(b)) {
    const info = upgradeInfo(s, b);
    if (info.blocked) return info.blocked;
  }
  if (gemsOf(s) < rushPrice(b)) return 'Не хватает алмазов.';
  return null;
}

/**
 * Мгновенная достройка за алмазы. Время — единственное, что покупается:
 * ресурсы списываются как за обычное улучшение (нетронутое здание оплачивает
 * их здесь же через `startUpgrade`), а очередь остаётся очередью — достроенное
 * уходит из неё, и следующая стройка становится первой сама.
 */
export function rushUpgrade(s: GameState, buildingId: number): string | null {
  const b = buildingById(s, buildingId);
  if (!b) return 'Здание не найдено.';
  const price = rushPrice(b);
  const blocked = rushBlocked(s, b);
  if (blocked) return blocked;
  if (!isSite(b)) {
    // Ресурсы и работу назначает обычная стройка — отдельной ветки цен нет.
    const err = startUpgrade(s, b.id);
    if (err) return err;
  }
  s.gems = gemsOf(s) - price;
  b.level += 1;
  b.work = 0;
  b.workRequired = 0;
  log(s, `${BUILDING_BY_ID[b.type].name}: уровень ${b.level} — достроено за ${price} ♦.`, 'good');
  return null;
}

/**
 * Расписка о начислении. Клиент такую не выписывает: её приносит ответ сервера
 * на подтверждённый платёж Telegram Stars. Поле `ref` — идентификатор платежа,
 * по нему начисление и не задваивается.
 */
export interface GemGrant {
  source: 'server';
  amount: number;
  ref: string;
}

/**
 * Единственное начисление алмазов в игре. Сегодня его никто не вызывает —
 * и это нормально: место под серверный ответ занято сразу, чтобы потом не
 * искать, куда его вставить. Стартовый запас приходит не отсюда, а из
 * `createInitialState`, и он тестовый.
 */
export function creditGems(s: GameState, grant: GemGrant): string | null {
  if (grant.source !== 'server') return 'Алмазы начисляет только сервер.';
  if (!Number.isFinite(grant.amount) || grant.amount <= 0) return 'Пустое начисление.';
  s.gems = gemsOf(s) + Math.floor(grant.amount);
  log(s, `Алмазы зачислены: +${Math.floor(grant.amount)} ♦.`, 'good');
  return null;
}
