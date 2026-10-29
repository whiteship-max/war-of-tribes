// Обоз отряда бродяги (ГДД 3.3.5, ПН-1) — половина двери склада `sim/stock.addStock` с ключом `cargo`. Своим модулем (ПН-5, хвост а):
// его пишет только Путь меча, а он докачивается тому, кому открыт (`game/roamlazy`). Правило одно с складом города — `fitStock`.
import type { GameState, ResourceId } from '../types';
import { RESOURCE_IDS } from '../constants';
import { fitStock } from '../stockrules';
import { log } from './log';
import { stockWords, type Gains } from './stock';

/**
 * Обоз отряда (ключ `cargo`): груз всего обоза не выше `cap`. Лежит выше (ушли люди, сменился режим марша) — лишнее сперва
 * бросается строкой летописи (`trimCargo`), как сгорает излишек склада. Разовой тратой не считается: книга запасов сервера
 * меряет склад города, а не обоз.
 */
export function addCargo(s: GameState, r: ResourceId, n: number, cap: number): number {
  const roam = s.roam;
  if (!roam) return 0;
  trimCargo(s, cap);
  const before = roam.cargo[r] ?? 0;
  let others = 0;
  for (const id of RESOURCE_IDS) if (id !== r) others += Math.max(0, roam.cargo[id] ?? 0);
  const after = fitStock(before, n, Math.max(0, cap - others));
  if (after > 0) roam.cargo[r] = after;
  else delete roam.cargo[r];
  return after - before;
}

/**
 * Привести обоз к вместимости: что сверх неё, бросается — каждый вид той же долей, строкой летописи «Обоз не поднять: брошено —
 * …». Ничего сверх — `null`, обоз не тронут.
 */
export function trimCargo(s: GameState, cap: number): string | null {
  const roam = s.roam;
  if (!roam) return null;
  let load = 0;
  for (const r of RESOURCE_IDS) load += Math.max(0, roam.cargo[r] ?? 0);
  if (!(load > cap)) return null;
  const keep = cap > 0 ? cap / load : 0;
  const lost: Gains = {};
  for (const r of RESOURCE_IDS) {
    const have = Math.max(0, roam.cargo[r] ?? 0);
    if (have <= 0) continue;
    const left = have * keep;
    lost[r] = have - left;
    if (left > 0) roam.cargo[r] = left;
    else delete roam.cargo[r];
  }
  const words = stockWords(lost);
  const line = words ? `Обоз не поднять: брошено — ${words}.` : null;
  if (line) log(s, line, 'bad');
  return line;
}
