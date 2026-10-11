// Осадные машины из древесины лагеря (docs/siege_v2.md, 4.3–4.4; этап 2в): лестницы, таран, осадная башня, камнемёт.
//
// Модуль чистый, того же рода, что `works.ts` и `siegecraft.ts`: ни состояния мира, ни часов, ни случайности — **считаем
// при чтении, не тикаем**. В окне осады лежит очередь заказанных машин (`SiegeWindow.engines`: что и в какую минуту
// заказано, когда истрачено), а доля древесины машинам — в плане древесины (`WoodPlan.engines`). Готова машина тогда,
// когда древесины машин нарублено на неё и на всё, что заказано раньше неё (`works.engineWood`), — очередь, а не склад:
// истраченная машина свою древесину не возвращает.
//
// Одна дверь на лагерь под логовом (мир на клиенте) и под городом игрока (сервер войны). Без `@/`: его собирает сервер.
import { CAMP_WORKS_RIPE } from './data/tuning';
import { ENGINE_HOLD, ENGINE_IDS, ENGINE_WOOD, STORM_ENGINES, type EngineId } from './data/engines';
import { engineShare, engineWood, engineWoodAt, type WoodPlan } from './works';
import type { Assault } from './wall';

export type { EngineId } from './data/engines';

/** Заказанная машина: что, в какую минуту заказана и, если пошла на штурм, когда истрачена. */
export interface EngineOrder {
  id: EngineId;
  at: number;
  spent?: number;
}

/** Что нужно двери от окна осады. */
export interface EngineWindow {
  startedAt: number;
  sinceAt?: number;
  wood?: WoodPlan;
  engines?: EngineOrder[];
}

const sinceOf = (w: EngineWindow): number => w.sinceAt ?? w.startedAt;

/** Машина в очереди глазами минуты `at`. */
export interface EngineState extends EngineOrder {
  /** Когда готова: древесина дошла до неё и прошла минута заказа. Бесконечность — не будет: машинам ничего не отдано. */
  readyAt: number;
  /** Стоит готовая и не истраченная к минуте `at`. */
  ready: boolean;
}

/** Очередь машин окна к минуте `at`, по порядку заказа. */
export function enginesAt(w: EngineWindow, at: number): EngineState[] {
  const since = sinceOf(w);
  const list = [...(w.engines ?? [])].sort((a, b) => a.at - b.at);
  let need = 0;
  return list.map((o) => {
    need += ENGINE_WOOD[o.id] ?? 0;
    const readyAt = Math.max(o.at, engineWoodAt(since, need, w.wood));
    const spent = o.spent !== undefined && o.spent <= at;
    return { ...o, readyAt, ready: readyAt <= at && !spent };
  });
}

/** Готова ли к минуте `at` машина этого рода (не истраченная). */
export const engineReady = (w: EngineWindow, id: EngineId, at: number): boolean =>
  enginesAt(w, at).some((e) => e.id === id && e.ready);

/** Стоит ли в лагере камнемёт к минуте `at` — +1 к кости фазы (`siegeroll.modsOf`). */
export const catapultAt = (w: EngineWindow, at: number): boolean => engineReady(w, 'catapult', at);

/** Сколько машин этого рода в очереди, не истраченных к минуте `at`: готовых и строящихся. */
const held = (w: EngineWindow, id: EngineId, at: number): number =>
  enginesAt(w, at).filter((e) => e.id === id && !(e.spent !== undefined && e.spent <= at)).length;

/**
 * Почему машину не заказать в минуту `at`; null — можно. `walls` — есть ли у цели стена: у логова и двора мира её нет, и
 * лестницы, таран и башню строить не к чему (решение 7 docs/siegecraft.md) — камнемёт бьёт по кости фазы и там.
 */
export function engineBlock(w: EngineWindow, id: EngineId, at: number, walls: boolean): string | null {
  if (!ENGINE_IDS.includes(id)) return 'Такой машины нет.';
  if (!walls && STORM_ENGINES.includes(id)) return `${ENGINE_NAME[id]}: у них нет стены — лезть не на что.`;
  if (held(w, id, at) >= ENGINE_HOLD) return `${ENGINE_NAME[id]}: уже ${engineReady(w, id, at) ? 'стоит' : 'строится'} — вторая не нужна.`;
  return null;
}

/** Очередь после заказа машины в минуту `at`. */
export const engineAfter = (w: EngineWindow, id: EngineId, at: number): EngineOrder[] => [...(w.engines ?? []), { id, at }];

/** Какие машины пошли бы на штурм в минуту `at`: из названных — готовые, только штурмовые. Нет списка — все готовые. */
export function stormEngines(w: EngineWindow, at: number, use?: readonly EngineId[]): EngineId[] {
  const ready = new Set(enginesAt(w, at).filter((e) => e.ready).map((e) => e.id));
  return STORM_ENGINES.filter((id) => ready.has(id) && (!use || use.includes(id)));
}

/** Проёмы штурма из машин и проломов: то, что получает стена-проход (`wall.wallFront`). */
export const assaultOf = (breaches: number, engines: readonly EngineId[]): Assault => ({
  breaches,
  ...(engines.includes('ladders') ? { ladders: true } : {}),
  ...(engines.includes('ram') ? { ram: true } : {}),
  ...(engines.includes('tower') ? { tower: true } : {}),
});

/** Очередь после штурма в минуту `at`: пущенные машины истрачены — по одной каждого рода, первая готовая. */
export function enginesSpent(w: EngineWindow, at: number, used: readonly EngineId[]): EngineOrder[] {
  const ready = enginesAt(w, at);
  // Тратятся только штурмовые: камнемёт стоит всю осаду.
  const left = new Set(used.filter((id) => STORM_ENGINES.includes(id)));
  const sorted = [...(w.engines ?? [])].sort((a, b) => a.at - b.at);
  return sorted.map((o, i) => {
    if (!left.has(o.id) || !ready[i].ready) return o;
    left.delete(o.id);
    return { ...o, spent: at };
  });
}

/** Как машина называется. */
export const ENGINE_NAME: Record<EngineId, string> = {
  ladders: 'Лестницы',
  ram: 'Таран',
  tower: 'Осадная башня',
  catapult: 'Камнемёт',
};

/** Что машина даёт — строкой устройства, без прогноза. */
export const ENGINE_USE: Record<EngineId, string> = {
  ladders: 'лестницы на весь фронт, кость −2 грани',
  ram: 'ворота после первого круга боя, без штрафа',
  tower: 'пролёт стены без штрафа, конница не пройдёт',
  catapult: '+1 к кости каждой фазы',
};

/** Сколько фаз строится машина, если весь лес лагеря — ей: срок той же выработкой, что у рогаток. */
export const buildSpan = (id: EngineId, plan: WoodPlan | undefined): number => {
  const rate = Math.max(0, plan?.engines ?? 0);
  return rate > 0 ? (ENGINE_WOOD[id] / rate) * CAMP_WORKS_RIPE : Infinity;
};

/** Доля древесины машинам — проценты словами, для окна. */
export const engineShareWords = (plan: WoodPlan | undefined): string => `${Math.round(engineShare(plan) * 100)} %`;

/** Нарублено машинам к минуте `at` сверх заказанного — в сторонах (запас под следующий заказ). */
export function engineStock(w: EngineWindow, at: number): number {
  const all = engineWood(sinceOf(w), at, w.wood);
  const used = (w.engines ?? []).reduce((n, o) => n + (ENGINE_WOOD[o.id] ?? 0), 0);
  return Math.max(0, all - used);
}

/**
 * Машины лагеря словами — их видно со стены (docs/siege_v2.md, 4.3): что стоит готовым и что строится. Пусто — машин нет.
 * Окно защитника и донесение говорят это одной строкой.
 */
export function enginesNote(w: EngineWindow, at: number): string {
  const live = enginesAt(w, at).filter((e) => !(e.spent !== undefined && e.spent <= at));
  const ready = live.filter((e) => e.ready).map((e) => ENGINE_NAME[e.id].toLowerCase());
  const building = live.filter((e) => !e.ready).map((e) => ENGINE_NAME[e.id].toLowerCase());
  const parts = [
    ready.length ? `У лагеря готовы: ${ready.join(', ')}.` : '',
    building.length ? `Строят: ${building.join(', ')}.` : '',
  ].filter(Boolean);
  return parts.join(' ');
}

