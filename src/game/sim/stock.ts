// Склад — одна дверь на всё, что кладёт добро на склад или снимает его разом (docs/audit/OWNER-DECISIONS.md, п. 1,
// решение владельца; ECO-1 аудита).
//
// Правило одно: запас никогда не выше вместимости и не ниже нуля (`stockrules.fitStock`, одно на игру и на книгу запасов
// сервера). Прежде его копий было восемь — выработка, задания, возврат цены, караван, трофеи у ворот, последствие похода,
// вести, ежедневка, промысел, — а лавка алмазов с указом админа держали лежащее сверх вместимости, и следующий шаг
// выработки срезал его молча.
//
//  · `addStock` — прибавка или убавка; возвращает, сколько легло на самом деле.
//  · предпросмотр — `sim/stockview` (`overflowOf`, `overflowOfAct`): что из обещанного не влезет. Его спрашивает интерфейс
//    перед действием игрока, и окно «Склад заполнен» встаёт только тогда, когда список не пуст. Живёт отдельно: читает его
//    только окно, и в первую загрузку он не едет.
//  · `trimStock` — вместимость упала (склад потерял уровень) или сохранение старое: излишек сгорает, и игрок узнаёт об этом
//    строкой летописи. Тихих потерь нет.
import type { GameState, ResourceId } from '../types';
import { RESOURCE_IDS, RESOURCE_META } from '../constants';
import { storageCap } from '../derived';
import { fitStock } from '../stockrules';
import { roamDoor } from '../roamlazy';
import { log } from './log';

export type Gains = Partial<Record<ResourceId, number>>;

/** Сухой прогон действия: сколько прибавок обещано и сколько из них легло бы (целыми, как их видит игрок), по видам. */
export type Probe = Partial<Record<ResourceId, { wanted: number; fits: number }>>;

/**
 * Разовая трата — склад или казна убыли разом (`stats.outlays`). Её зовёт каждая дверь, которая убавляет склад или
 * казну мимо расхода и разовых дел: без неё книга запасов сервера сочла бы честную трату спрятанным добром (docs/security.md,
 * ЗЩ-2). Какие двери, держит тест (`sim/outlays.test.ts`). Сгоревший излишек — тоже трата (`trimStock`).
 */
export function outlay(s: GameState): void {
  s.stats.outlays = (s.stats.outlays ?? 0) + 1;
}

/** Запись прибавок сухого прогона: ставит и снимает `stockview.overflowOfAct`; вне прогона — `null`. */
export const PROBE: { on: Probe | null } = { on: null };

/**
 * Где лежит добро: склад города (`s.resources`, вместимость — на каждый вид) или обоз отряда бродяги (`s.roam.cargo`, ПН-1:
 * вместимость — на всё добро разом, `sim/roam.cargoCap`). Правило одно — `fitStock`.
 */
export type StockKey = 'resources' | 'cargo';

/**
 * Положить на склад `n` (со знаком): прибавка — не выше вместимости, убавка — не ниже нуля. Возвращает, сколько легло на
 * самом деле (со знаком). Запас выше вместимости (склад только что потерял уровень) сперва сгорает строкой летописи
 * (`trimStock`): срезать его молча прибавка не вправе.
 *
 * Ключ `cargo` — обоз отряда (ГДД 3.3.5): `cap` — вместимость всего обоза (её считает зовущий, `sim/roam.cargoCap`), и вид
 * ложится не выше того, что осталось свободным от прочего добра (`sim/cargo.addCargo`). За выключателем Пути меча (`roamOn`) обоз не пишется
 * вовсе: его половина двери докачивается только тому, кому путь открыт (`game/roamlazy`).
 */
export function addStock(s: GameState, r: ResourceId, n: number, cap?: number): number;
export function addStock(s: GameState, r: ResourceId, n: number, cap: number, key: StockKey): number;
export function addStock(s: GameState, r: ResourceId, n: number, cap: number = storageCap(s), key: StockKey = 'resources'): number {
  // Обоз — половина двери в кусок пути (`sim/cargo`, ПН-5, хвост а): путь закрыт игроку или ещё не докачан — не пишется.
  if (key === 'cargo') return roamDoor()?.addCargo(s, r, n, cap) ?? 0;
  if ((s.resources[r] ?? 0) > cap) trimStock(s, cap);
  const before = s.resources[r] ?? 0;
  const after = fitStock(before, n, cap);
  s.resources[r] = after;
  if (PROBE.on && n > 0) {
    const p = (PROBE.on[r] ??= { wanted: 0, fits: 0 });
    p.wanted += n;
    p.fits += Math.floor(after) - Math.floor(before);
  }
  return after - before;
}

/** Добро словами для летописи: «древесина 120, камень 40» (`plus` — «еда +106»); целыми, доли единицы не называются. */
export function stockWords(m: Gains, plus = ''): string {
  return RESOURCE_IDS.filter((r) => Math.floor(m[r] ?? 0) >= 1)
    .map((r) => `${RESOURCE_META[r].name.toLowerCase()} ${plus}${Math.floor(m[r] ?? 0)}`)
    .join(', ');
}

/**
 * Привести склад к вместимости: что лежит сверх неё, сгорает — разовой тратой (`outlay`, иначе книга запасов сервера сочла бы
 * убыль спрятанным добром) и строкой летописи «Склад повреждён: пропало — …». Зовут шаг племени (вместимость могла упасть
 * между шагами), падение уровней (`sim/expedition`) и прибавка (`addStock`). Загрузка старого сохранения (`load`) строку не
 * пишет, а возвращает: в летопись при входе пишет одна дверь `save.tell`. Ничего сверх — `null`, и партия не тронута.
 */
export function trimStock(s: GameState, cap: number = storageCap(s), load = false): string | null {
  const lost: Gains = {};
  let any = false;
  for (const r of RESOURCE_IDS) {
    const have = s.resources[r] ?? 0;
    if (!(have > cap)) continue;
    s.resources[r] = fitStock(have, 0, cap);
    lost[r] = have - s.resources[r];
    any = true;
  }
  if (!any) return null;
  outlay(s);
  const words = stockWords(lost);
  const line = words && `${load ? 'Склад приведён к вместимости' : 'Склад повреждён'}: пропало — ${words}.`;
  if (line && !load) log(s, line, 'bad');
  return line || null;
}
