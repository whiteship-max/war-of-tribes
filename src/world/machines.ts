// Осадные машины из древесины лагеря (docs/siege_v2.md, 4.3–4.4; этап 2в): лестницы, таран, осадная башня, камнемёт.
//
// Модуль чистый, того же рода, что `works.ts` и `siegecraft.ts`: ни состояния мира, ни часов, ни случайности — **считаем
// при чтении, не тикаем**. В окне осады лежит очередь заказанных машин (`SiegeWindow.machines`: что и в какую минуту
// заказано, когда истрачено), а доля древесины машинам — в плане древесины (`WoodPlan.machines`). Готова машина тогда,
// когда древесины машин нарублено на неё и на всё, что заказано раньше неё (`works.machineWood`), — очередь, а не склад:
// истраченная машина свою древесину не возвращает.
//
// Одна дверь на лагерь под логовом (мир на клиенте) и под городом игрока (сервер войны). Без `@/`: его собирает сервер.
import { CAMP_WORKS_RIPE } from './data/tuning';
import { MACHINE_HOLD, MACHINE_IDS, MACHINE_WOOD, STORM_MACHINES, type MachineId } from './data/machines';
import { machineShare, machineWood, machineWoodAt, type WoodPlan } from './works';
import type { Assault } from './wall';

export type { MachineId } from './data/machines';

/** Заказанная машина: что, в какую минуту заказана и, если пошла на штурм, когда истрачена. */
export interface MachineOrder {
  id: MachineId;
  at: number;
  spent?: number;
}

/** Что нужно двери от окна осады. */
export interface MachineWindow {
  startedAt: number;
  sinceAt?: number;
  wood?: WoodPlan;
  machines?: MachineOrder[];
}

const sinceOf = (w: MachineWindow): number => w.sinceAt ?? w.startedAt;

/** Машина в очереди глазами минуты `at`. */
export interface MachineState extends MachineOrder {
  /** Когда готова: древесина дошла до неё и прошла минута заказа. Бесконечность — не будет: машинам ничего не отдано. */
  readyAt: number;
  /** Стоит готовая и не истраченная к минуте `at`. */
  ready: boolean;
}

/** Очередь машин окна к минуте `at`, по порядку заказа. */
export function machinesAt(w: MachineWindow, at: number): MachineState[] {
  const since = sinceOf(w);
  const list = [...(w.machines ?? [])].sort((a, b) => a.at - b.at);
  let need = 0;
  return list.map((o) => {
    need += MACHINE_WOOD[o.id] ?? 0;
    const readyAt = Math.max(o.at, machineWoodAt(since, need, w.wood));
    const spent = o.spent !== undefined && o.spent <= at;
    return { ...o, readyAt, ready: readyAt <= at && !spent };
  });
}

/** Готова ли к минуте `at` машина этого рода (не истраченная). */
export const machineReady = (w: MachineWindow, id: MachineId, at: number): boolean =>
  machinesAt(w, at).some((e) => e.id === id && e.ready);

/** Стоит ли в лагере камнемёт к минуте `at` — +1 к кости фазы (`siegeroll.modsOf`). */
export const mangonelAt = (w: MachineWindow, at: number): boolean => machineReady(w, 'mangonel', at);

/** Сколько машин этого рода в очереди, не истраченных к минуте `at`: готовых и строящихся. */
const held = (w: MachineWindow, id: MachineId, at: number): number =>
  machinesAt(w, at).filter((e) => e.id === id && !(e.spent !== undefined && e.spent <= at)).length;

/**
 * Почему машину не заказать в минуту `at`; null — можно. `walls` — есть ли у цели стена: у логова и двора мира её нет, и
 * лестницы, таран и башню строить не к чему (решение 7 docs/siegecraft.md) — камнемёт бьёт по кости фазы и там.
 */
export function machineBlock(w: MachineWindow, id: MachineId, at: number, walls: boolean): string | null {
  if (!MACHINE_IDS.includes(id)) return 'Такой машины нет.';
  if (!walls && STORM_MACHINES.includes(id)) return `${MACHINE_NAME[id]}: у них нет стены — лезть не на что.`;
  if (held(w, id, at) >= MACHINE_HOLD) return `${MACHINE_NAME[id]}: уже ${machineReady(w, id, at) ? 'стоит' : 'строится'} — вторая не нужна.`;
  return null;
}

/** Очередь после заказа машины в минуту `at`. */
export const machineAfter = (w: MachineWindow, id: MachineId, at: number): MachineOrder[] => [...(w.machines ?? []), { id, at }];

/** Какие машины пошли бы на штурм в минуту `at`: из названных — готовые, только штурмовые. Нет списка — все готовые. */
export function stormMachines(w: MachineWindow, at: number, use?: readonly MachineId[]): MachineId[] {
  const ready = new Set(machinesAt(w, at).filter((e) => e.ready).map((e) => e.id));
  return STORM_MACHINES.filter((id) => ready.has(id) && (!use || use.includes(id)));
}

/** Проёмы штурма из машин и проломов: то, что получает стена-проход (`wall.wallFront`). */
export const assaultOf = (breaches: number, machines: readonly MachineId[]): Assault => ({
  breaches,
  ...(machines.includes('ladders') ? { ladders: true } : {}),
  ...(machines.includes('ram') ? { ram: true } : {}),
  ...(machines.includes('tower') ? { tower: true } : {}),
});

/** Очередь после штурма в минуту `at`: пущенные машины истрачены — по одной каждого рода, первая готовая. */
export function machinesSpent(w: MachineWindow, at: number, used: readonly MachineId[]): MachineOrder[] {
  const ready = machinesAt(w, at);
  // Тратятся только штурмовые: камнемёт стоит всю осаду.
  const left = new Set(used.filter((id) => STORM_MACHINES.includes(id)));
  const sorted = [...(w.machines ?? [])].sort((a, b) => a.at - b.at);
  return sorted.map((o, i) => {
    if (!left.has(o.id) || !ready[i].ready) return o;
    left.delete(o.id);
    return { ...o, spent: at };
  });
}

/** Как машина называется. */
export const MACHINE_NAME: Record<MachineId, string> = {
  ladders: 'Лестницы',
  ram: 'Таран',
  tower: 'Осадная башня',
  mangonel: 'Камнемёт',
};

/** Что машина даёт — строкой устройства, без прогноза. */
export const MACHINE_USE: Record<MachineId, string> = {
  ladders: 'лестницы на весь фронт, кость −2 грани',
  ram: 'ворота после первого круга боя, без штрафа',
  tower: 'пролёт стены без штрафа, конница не пройдёт',
  mangonel: '+1 к кости каждой фазы',
};

/** Сколько фаз строится машина, если весь лес лагеря — ей: срок той же выработкой, что у рогаток. */
export const buildSpan = (id: MachineId, plan: WoodPlan | undefined): number => {
  const rate = Math.max(0, plan?.machines ?? 0);
  return rate > 0 ? (MACHINE_WOOD[id] / rate) * CAMP_WORKS_RIPE : Infinity;
};

/** Доля древесины машинам — проценты словами, для окна. */
export const machineShareWords = (plan: WoodPlan | undefined): string => `${Math.round(machineShare(plan) * 100)} %`;

/** Нарублено машинам к минуте `at` сверх заказанного — в сторонах (запас под следующий заказ). */
export function machineStock(w: MachineWindow, at: number): number {
  const all = machineWood(sinceOf(w), at, w.wood);
  const used = (w.machines ?? []).reduce((n, o) => n + (MACHINE_WOOD[o.id] ?? 0), 0);
  return Math.max(0, all - used);
}

/**
 * Машины лагеря словами — их видно со стены (docs/siege_v2.md, 4.3): что стоит готовым и что строится. Пусто — машин нет.
 * Окно защитника и донесение говорят это одной строкой.
 */
export function machinesNote(w: MachineWindow, at: number): string {
  const live = machinesAt(w, at).filter((e) => !(e.spent !== undefined && e.spent <= at));
  const ready = live.filter((e) => e.ready).map((e) => MACHINE_NAME[e.id].toLowerCase());
  const building = live.filter((e) => !e.ready).map((e) => MACHINE_NAME[e.id].toLowerCase());
  const parts = [
    ready.length ? `У лагеря готовы: ${ready.join(', ')}.` : '',
    building.length ? `Строят: ${building.join(', ')}.` : '',
  ].filter(Boolean);
  return parts.join(' ');
}

