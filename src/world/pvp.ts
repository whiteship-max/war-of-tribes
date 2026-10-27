// Война между игроками — общее для клиента и сервера (docs/pvp.md): путь войска и часы голода. Бой
// считает `world/fights` (одна дверь с миром), здесь только время и место.
//
// Модуль чистый и без DOM: его собирает сервер (`netlify/lib/war.ts`).
import type { Coord } from './types';
import { distance, terrainFactor, travelTime } from './geo';
import { CELL_COST_MIN } from './geography';
import { FIGURE_BY_ID } from './data/figures';
import { asGame, gameSecondsOfMs, realMs, type GameSec } from '../game/pace';
import { FIRST_RULES, RELIEF_WIN_RULES } from '../battle/config';
import { GAIT_SPEED, type Gait } from './gait';
import { generalSpeed } from './data/gait';
import { intercept, positionAt, type Meeting, type Moving } from './pursuit';

/** Скорость полководца в режиме марша (ДР-2, М3) — объявлена в данных режима (`data/gait.generalSpeed`). */
export { generalSpeed };

/**
 * Сид земли для пути между замками. Переправы и броды выводятся из сида мира, а сид у каждого игрока свой;
 * путь войны один на обе стороны и на сервер, поэтому и сид у него один. Разница с личной картой — броды:
 * минута-другая пути, а не другая дорога.
 */
export const WAR_GROUND_SEED = 0;

/**
 * Сколько войско полководца идёт от замка до замка, мс мира: та же формула, что у фигуры на карте
 * (`geo.travelTime` со скоростью полководца в режиме марша, ДР-2) — поход между игроками не ходит быстрее или медленнее его.
 */
export const warWalkMs = (from: Coord, to: Coord, g?: Gait): number =>
  Math.round(realMs(travelTime(distance(from, to), terrainFactor(WAR_GROUND_SEED, from, to), generalSpeed(g))));

/**
 * Сколько лазутчик идёт от замка до замка, мс мира: та же формула и тот же сид земли, что у похода, со скоростью
 * лазутчика (docs/spy_pvp.md). Путь один на обе стороны и на сервер.
 */
export const spyWalkMs = (from: Coord, to: Coord): number =>
  Math.round(realMs(travelTime(distance(from, to), terrainFactor(WAR_GROUND_SEED, from, to), FIGURE_BY_ID.spy.speed)));

/** Ближе этого (клетки) полководец стоит у ворот: дороги нет, удар — сразу (`LocalWorld.warStrikePlan`, `reliefPlan`). */
export const AT_GATES = 0.5;

/**
 * Дорога полководца из поля к замку, игровые секунды: у ворот — ноль, иначе та же формула, что у фигуры на карте
 * (`geo.travelTime` со скоростью полководца в режиме марша `g`), с ландшафтом `factor`. Одна на удар по лагерю у своих
 * стен и на выручку союзнику — у мира на клиенте (ландшафт личной карты) и у сервера войны (`fieldWalkFloorMs`).
 */
export const fieldWalkSeconds = (from: Coord, to: Coord, factor: number, g?: Gait): GameSec => {
  const dist = distance(from, to);
  return dist < AT_GATES ? asGame(0) : travelTime(dist, factor, generalSpeed(g));
};

/**
 * Самый короткий срок той же дороги, мс мира: весь путь по самой быстрой клетке земли (`geography.CELL_COST_MIN`). Сид
 * личной карты сервер не знает, а честный путь по ней не бывает короче (docs/security.md, ЗЩ-2): срок пути удара и
 * выручки, названный клиентом, сервер не принимает короче этого — в режиме марша, названном приказом (ДР-2).
 */
export const fieldWalkFloorMs = (from: Coord, to: Coord, g?: Gait): number => Math.round(realMs(fieldWalkSeconds(from, to, CELL_COST_MIN, g)));

/**
 * Как далеко полководец мог уйти за `ms` настоящего времени — клеток, той же формулой пути по самой быстрой клетке и в самом
 * быстром режиме марша (ДР-2: слепок режима не несёт, а налегке честный полководец уходит дальше). Место, откуда приказ ведёт
 * удар, сервер сверяет с местом полководца в последнем слепке обороны (`WarSheet.gen`).
 */
export const fieldReach = (ms: number): number => (gameSecondsOfMs(Math.max(0, ms)) * REACH_SPAN) / reachSeconds() + AT_GATES;

/** Мерная дорога для `fieldReach`: путь линеен по длине, а длинная мерка не упирается в наименьший срок пути (`MARCH_MIN_SECONDS`). */
const REACH_SPAN = 1000;
const reachSeconds = (): number => travelTime(REACH_SPAN, CELL_COST_MIN, FIGURE_BY_ID.general.speed * Math.max(...Object.values(GAIT_SPEED)));

/** Где войско на пути из `from` в `to` в минуту `at`. */
export function warAt(from: Coord, to: Coord, departAt: number, arriveAt: number, at: number): Coord {
  const span = Math.max(1, arriveAt - departAt);
  const t = Math.min(1, Math.max(0, (at - departAt) / span));
  return { x: Math.round(from.x + (to.x - from.x) * t), y: Math.round(from.y + (to.y - from.y) * t) };
}

/** Сколько хлеба осталось у осаждённого — дверь окна осады (`siege.foodLeft`); здесь она под прежним именем модуля войны. */
export { foodLeft } from './siege';

/**
 * Бой выручки засчитывается союзнику (АУ-8, п. 4; OWNER-DECISIONS п. 17): по лагерю бил союзник осаждённого, и бой посчитан
 * версией правил не младше `RELIEF_WIN_RULES` (BTL-0: старые бои не пересчитываются). Тогда победа, слава и бой — союзника
 * (`war.battleWinner`, его партия), а осаждённому — «осада снята» без победы (`LocalWorld.warBattle`). Одна проверка на
 * сервер и мир.
 */
export const reliefCredit = (b: { ally?: string; input?: { rules?: number } }): boolean =>
  Boolean(b.ally) && (b.input?.rules ?? FIRST_RULES) >= RELIEF_WIN_RULES;

// ------------------------------------------------ перехват похода в поле (ПЛ-1) ---

/** Поля войны, по которым видно, где идёт её войско: вид игрока (`WarView`) и запись сервера (`WarRow`) — одни. */
export interface WarPath {
  phase: string;
  from: Coord;
  to: Coord;
  sentAt: number;
  arriveAt: number;
  legFrom?: Coord;
  legAt?: number;
  backFrom?: Coord;
  backAt?: number;
  endAt?: number;
}

/**
 * Войско войны как движущееся (`pursuit.Moving`), одной мерой у мира и у сервера: поход — от начала нынешнего отрезка (после
 * смены режима — от места и минуты стоянки, ДР-2) до цели; обратный путь — до дома. Лагерь и конец войны не идут — null.
 * В стоянку смены режима войско стоит у начала отрезка: `positionAt` до выхода — в начале.
 */
export function warMoving(w: WarPath): Moving | null {
  if (w.phase === 'march') return { from: w.legFrom ?? w.from, to: w.to, departAt: w.legAt ?? w.sentAt, arriveAt: w.arriveAt };
  if (w.phase === 'back' && w.backAt !== undefined) return { from: w.backFrom ?? w.to, to: w.from, departAt: w.legAt ?? w.endAt ?? w.backAt, arriveAt: w.backAt };
  return null;
}

/** Мерная дорога темпа погони: путь линеен по длине, а мерка не упирается в пол самого короткого похода (как `fieldReach`). */
const MEET_SPAN = 1000;

/**
 * Темп полководца в погоне за войском войны, клеток за мс мира с темпом войны `pace`: та же формула пути, что у похода
 * (`warWalkMs`: земля пути войны `WAR_GROUND_SEED`, скорость в режиме марша), — путь войны один на обе стороны и на сервер, и
 * встреча у мира и у сервера выходит одной.
 */
export function warPace(from: Coord, to: Coord, g?: Gait, pace = 1): number {
  const ms = realMs(travelTime(MEET_SPAN, terrainFactor(WAR_GROUND_SEED, from, to), generalSpeed(g))) / Math.max(1, pace);
  return ms > 0 ? MEET_SPAN / ms : 0;
}

/**
 * Где и когда полководец из `from` в режиме `g` встретит войско войны (ПЛ-1): уравнение встречи `pursuit.intercept` (MAP-6)
 * с выхода `start` (после стоянки смены режима — с её конца). null — не догнать: войско дойдёт раньше. Одна функция на окно
 * перехвата у мира и на приказ у сервера.
 */
export function warMeet(from: Coord, g: Gait | undefined, path: WarPath, start: number, pace = 1): Meeting | null {
  const m = warMoving(path);
  if (!m) return null;
  return intercept(from, warPace(from, positionAt(m, start), g, pace), m, start);
}

/** Где войско войны в минуту `at` (ПЛ-1): тем же движущимся, что встреча; лагерь — у цели, конец — дома. */
export function warSpotAt(w: WarPath, at: number): Coord {
  const m = warMoving(w);
  if (m) return positionAt(m, at);
  return w.phase === 'done' ? { ...w.from } : { ...w.to };
}

/** Насколько встреча, которую видел игрок, может разойтись с посчитанной сервером: срок — запаздыванием приказа, место — клеткой. */
export const MEET_SLACK_MS = 90_000;
export const MEET_SLACK_CELLS = 1.5;

/** Отказы перехвата похода (ПЛ-1) — одни слова у сервера (`war.interceptOrder`) и в окне мира (`LocalWorld.warInterceptPlan`). */
export const MEET_CAMP = 'Отряд уже встал лагерем у стен. Бей по лагерю.';
export const MEET_GONE = 'Этого отряда уже нет в поле.';
export const MEET_STALE = 'Отряд сменил путь: встреча теперь другая. Посмотри снова.';
export const MEET_FAR = 'Не догнать: отряд дойдёт раньше.';
