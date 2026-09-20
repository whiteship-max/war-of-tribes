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
import { gameRate, gameSeconds, realSec } from '../pace';
import { startUpgrade } from './actions';
import { log } from './log';

/**
 * Нормативная скорость стройки, работа в секунду. Цена достройки считается от
 * оставшейся работы, приведённой к этой скорости, а не от настоящей: иначе цена
 * прыгала бы каждый раз, когда игрок снимает человека с площади, и её нельзя
 * было бы повторить на сервере.
 */
export const GEM_REF_RATE = gameRate(20);

/**
 * Какую долю **настоящих суток** нормативного ожидания снимает один алмаз. Долей, а не числом
 * игровых секунд (решение владельца, docs/time.md, раздел 16): алмаз покупает время игрока, а
 * время игрока — настоящее. Записанный игровыми секундами, после поворота шкалы тот же алмаз
 * снимал бы в тридцать раз больше ожидания.
 *
 * Доля не выбрана, а выведена из нынешней цены: алмаз снимал десять секунд при дне в минуту, то
 * есть десять настоящих секунд из 86 400 (`npm run time:report`, раздел 5, печатает вывод и цены
 * достройки при обеих шкалах). Сутки — та же мерка настоящего времени, что у почты и ежедневки.
 */
export const GEM_DAY_SHARE = 1 / 8640;
/** Настоящих секунд в сутках — мерка, от которой берётся доля алмаза. */
const REAL_DAY_SECONDS = 24 * 3600;
/** Сколько **настоящих** секунд нормативного ожидания снимает один алмаз. */
export const GEM_REAL_SECONDS = realSec(GEM_DAY_SHARE * REAL_DAY_SECONDS);
/** То же игровыми секундами — при нынешней шкале времени: труд стройки идёт игровым временем. */
export const gemSeconds = (): number => gameSeconds(GEM_REAL_SECONDS);

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
  // Малый допуск — против хвоста деления: 10 / (1 / 8640 × 86 400) обязано быть ровно единицей.
  return Math.max(GEM_MIN_PRICE, Math.ceil(seconds / gemSeconds() - 1e-9));
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
