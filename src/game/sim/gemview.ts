// Почему лавка и ускорение за алмазы сейчас недоступны — слова под кнопками сокровищницы и ускорения (docs/gems.md). Только
// чтение: двери дел алмазов — `sim/gems` (`applyGemDeeds`) и `sim/rush` (`rushFree`). Живёт отдельно: читают его только окна куска нового
// вида (`ui/next/Treasury`, `Rush`), и в первую загрузку он не едет.
import type { Building, GameState, ResourceId } from '../types';
import { isSite, storageCap, underSiege } from '../derived';
import { RESOURCE_META, SIEGE_NO_TRADE } from '../constants';
import { rushPrice } from './gems';

/**
 * Почему ускорить за алмазы нельзя прямо сейчас; `null` — можно. `balance` — баланс с сервера, `null` — сервера не
 * слышно (без сети траты алмазов нет); `offline` — причина словами, если сервера не слышно.
 */
export function rushBlocked(b: Building, balance: number | null, offline: string | null): string | null {
  if (!isSite(b)) return 'Здесь ничего не строится.';
  if (rushPrice(b) === 0) return null;
  if (offline !== null || balance === null) return offline ?? 'Нет связи: алмазы тратятся только при связи.';
  if (balance < rushPrice(b)) return 'Не хватает алмазов.';
  return null;
}

// ------------------------------------------------ лавка ---

/** Сколько места на складе под этот припас. */
export const shopRoom = (s: GameState, r: ResourceId): number => Math.max(0, Math.floor(storageCap(s) - (s.resources[r] ?? 0)));

/**
 * Почему купить в лавке нельзя прямо сейчас; `null` — можно. Влезает не всё — покупку не гасит: перед приказом окно «Склад
 * заполнен» спрашивает игрока (`ui/room`, решение владельца — OWNER-DECISIONS, п. 1). Не влезает ни единицы — гаснет: купить
 * за алмазы одно «пропадёт» нечего.
 */
export function shopBlocked(s: GameState, r: ResourceId, price: number, balance: number | null, left: number, offline: string | null): string | null {
  // В осаде торговли нет (`SIEGE_NO_TRADE`): лавка — тот же обоз к городу, и купленное снимало бы голод осады.
  if (underSiege(s)) return SIEGE_NO_TRADE;
  if (shopRoom(s, r) < 1) return `Склад полон: ${RESOURCE_META[r].name.toLowerCase()} не поместится.`;
  if (offline !== null || balance === null) return offline ?? 'Нет связи: алмазы тратятся только при связи.';
  if (left <= 0) return 'На сегодня покупки кончились.';
  if (balance < price) return 'Не хватает алмазов.';
  return null;
}
