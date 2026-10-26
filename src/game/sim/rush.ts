// Ускорить даром — последние пять минут ожидания (docs/gems.md) — и правило «ускоряется только строящееся» (СТ-1,
// docs/ui_v2.md, 5.13). Зовёт их только окно ускорения (`ui/next/Rush`): живут отдельно от двери дел алмазов (`sim/gems`), и в
// первую загрузку не едут. Достройка — та же, что у дела ускорения с сервера (`gems.finish`).
import type { Building, GameState } from '../types';
import { buildingById, buildingTitle, currentSite, isSite } from '../derived';
import { finish, rushPrice } from './gems';
import { log } from './log';

/**
 * Ускорить даром — последние пять минут ожидания. Приказа серверу нет и сеть не нужна: алмазы не тратятся. Дороже —
 * только приказом (`net/gems.orderRush`), и тогда стройку достраивает дело с сервера (`applyGemDeeds`).
 */
export function rushFree(s: GameState, buildingId: number): string | null {
  const b = buildingById(s, buildingId);
  if (!b) return 'Здание не найдено.';
  if (!isSite(b)) return 'Здесь ничего не строится.';
  const queued = rushQueued(s, b);
  if (queued) return queued;
  if (rushPrice(b) > 0) return 'Даром ускоряются только последние пять минут.';
  finish(b);
  log(s, `${buildingTitle(s, b.type)}: ур. ${b.level}, ускорено даром.`, 'good', undefined, 'build');
  return null;
}

/**
 * Ускоряется только строящееся — первое в очереди стройки (СТ-1, docs/ui_v2.md): ждущие в очереди ещё не строятся, и
 * ускорить их — то же, что строить два разом. Сервер отказывает в ускорении ждущего по своей книге (`town.rushFloor`).
 */
export function rushQueued(s: GameState, b: Building): string | null {
  return isSite(b) && currentSite(s)?.id !== b.id ? 'Ускоряется только строящееся — первое в очереди.' : null;
}
