// Перехват похода игрока в поле (ПЛ-1, docs/siege_v2.md, «Решения ПЛ-1») — общее для клиента и сервера войны: путь войска войны
// как движущегося, темп погони и точка встречи, одной функцией у окна мира и у приказа сервера. Отдельно от `pvp.ts` нарочно: тот
// лежит в первой загрузке, а встреча нужна только окну перехвата (`world/local/warmeet`, `gaitrows`) и серверу — кусок едет
// докачкой.
//
// Модуль чистый и без DOM: его собирает сервер (`netlify/lib/war.ts`).
import type { Coord } from './types';
import { terrainFactor, travelTime } from './geo';
import { realMs, realTime } from '../game/pace';
import { generalSpeed } from './data/gait';
import { intercept, positionAt, type Meeting, type Moving } from './pursuit';
import { WAR_GROUND_SEED } from './pvp';
import type { Gait } from './gait';

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

/**
 * Насколько встреча, которую видел игрок, может разойтись с посчитанной сервером: срок — запаздыванием приказа (настоящее время:
 * меню и приказ разделяет сеть и палец, а не мир), место — клеткой.
 */
export const MEET_SLACK_MS = realTime(90_000);
export const MEET_SLACK_CELLS = 1.5;

/** Отказы перехвата похода (ПЛ-1) — одни слова у сервера (`war.interceptOrder`) и в окне мира (`LocalWorld.warInterceptPlan`). */
export const MEET_CAMP = 'Отряд уже встал лагерем у стен. Бей по лагерю.';
export const MEET_GONE = 'Этого отряда уже нет в поле.';
export const MEET_STALE = 'Отряд сменил путь: встреча теперь другая. Посмотри снова.';
export const MEET_FAR = 'Не догнать: отряд дойдёт раньше.';
