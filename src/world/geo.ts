// Геометрия мира: координаты, ландшафт по клетке, расстояния и время пути.
// Всё здесь — чистые функции от сида и координат: одинаковый сид даёт одинаковый мир
// и одинаковую дорогу, поэтому расчёт можно будет один в один повторить на сервере.
import type { Coord, MarchView, Terrain, UnitStack } from './types';
import { TERRAIN_ORDER } from './data/terrain';
import { stackSpeed } from './data/units';
import { cellCost, terrainAt } from './geography';
import { MARCH_MIN_SECONDS, PATH_SAMPLES_PER_CELL, TEST_TRAVEL_SPEED, WORLD_ORIGIN, WORLD_SIZE } from './data/tuning';
import { asGame, type GameSec, type RealSecArg } from '../game/pace';

/**
 * Потолок числа замеров на один путь. Он не про баланс, а про то, чтобы поход
 * через всю карту не считался вечно; достаёт его только путь длиннее
 * `PATH_SAMPLES_MAX / PATH_SAMPLES_PER_CELL` клеток.
 */
const PATH_SAMPLES_MAX = 600;

export const coordKey = (x: number, y: number): string => `${x}|${y}`;

export const formatCoord = (c: Coord): string => `${c.x}|${c.y}`;

/** Разбирает «541|822», «541 822» и «541,822». null — не координаты. */
export function parseCoord(text: string): Coord | null {
  const m = text.trim().match(/^(-?\d{1,5})\s*[|,;: ]\s*(-?\d{1,5})$/);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}

export const inWorld = (x: number, y: number): boolean =>
  x >= WORLD_ORIGIN.x &&
  y >= WORLD_ORIGIN.y &&
  x < WORLD_ORIGIN.x + WORLD_SIZE &&
  y < WORLD_ORIGIN.y + WORLD_SIZE;

export const clampToWorld = (c: Coord): Coord => ({
  x: Math.min(WORLD_ORIGIN.x + WORLD_SIZE - 1, Math.max(WORLD_ORIGIN.x, Math.round(c.x))),
  y: Math.min(WORLD_ORIGIN.y + WORLD_SIZE - 1, Math.max(WORLD_ORIGIN.y, Math.round(c.y))),
});

export const distance = (a: Coord, b: Coord): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Румб от одной точки к другой: 0 — север, дальше по часовой стрелке, восемь
 * румбов. Ось `y` растёт на юг — так же, как она растёт вниз по полотну карты, —
 * поэтому север это убывающий `y`.
 *
 * Нужен там, где место назвать словами можно, а показать нельзя: письмо от
 * соседа, чью клетку игрок ещё не разведал, говорит направление и расстояние и
 * не открывает тумана ни на клетку.
 */
export function rhumbOf(from: Coord, to: Coord): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return 0;
  // atan2 от «на север» по часовой: север (0, -1) даёт 0, восток (1, 0) — π/2.
  const a = Math.atan2(dx, -dy);
  const step = (Math.PI * 2) / 8;
  return (Math.round(a / step) + 8) % 8;
}

// ---------- Ландшафт ----------

/* Сам ландшафт, реки, хребты и дороги живут в `geography.ts`: там всё, что
   выводится из сида по клетке. Здесь остаётся только расстояние и время. */
export { terrainAt };

export const terrainIndex = (t: Terrain): number => TERRAIN_ORDER.indexOf(t);

/**
 * Средняя проходимость по прямой между клетками.
 *
 * Замеры идут с постоянным шагом в долю клетки, а не фиксированным числом на
 * весь путь. Разница принципиальная: при постоянном шаге сумма замеров — это
 * настоящий интеграл вдоль линии, и река отнимает одно и то же время что на
 * коротком пути, что на длинном. При фиксированном числе замеров она растворялась
 * бы в длине — преграда переставала быть преградой ровно там, где важнее всего.
 *
 * Концы предварительно приводятся к одному порядку, поэтому путь туда и обратно
 * считается по тем же точкам и время пути симметрично при любой арифметике с
 * плавающей точкой.
 */
export function terrainFactor(seed: number, from: Coord, to: Coord): number {
  const flip = to.x < from.x || (to.x === from.x && to.y < from.y);
  const a = flip ? to : from;
  const b = flip ? from : to;
  const dist = distance(a, b);
  const samples = Math.max(3, Math.min(PATH_SAMPLES_MAX, Math.round(dist * PATH_SAMPLES_PER_CELL)));
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const t = (i + 0.5) / samples;
    const x = Math.round(a.x + (b.x - a.x) * t);
    const y = Math.round(a.y + (b.y - a.y) * t);
    sum += cellCost(seed, x, y);
  }
  return sum / samples;
}

// ---------- Время пути ----------

/**
 * Сколько идти — **в игровых секундах**. Расстояние делится на скорость и правится
 * ландшафтом. Обратный путь считается той же формулой — значит, ровно столько же.
 * Фигуры на карте идут по ней же: своя формула времени у них расходилась бы с походами.
 *
 * Игровыми, а не настоящими, — решение владельца (docs/time.md, раздел 19). Поход был
 * единственным, что двигалось по карте настоящими минутами, пока всё вокруг —
 * хозяйство, ритм угрозы, созревание, лечение, рогатки — шло игровыми днями. После
 * поворота шкалы это сделало игрока в тридцать раз быстрее его же деревни: круг набега
 * на логово ужался с 2.6–7.8 игрового дня до 2.6–7.8 настоящей минуты, добыча логова из
 * надбавки (2–4 % круга) стала заменой хозяйству (61–135 %), а раненый полководца
 * перестал успевать встать между боями (docs/time.md, разделы 18.6 и 18.7).
 *
 * В часы мира отсюда переводит одна дверь — `realMs`; голого `seconds * 1000` больше нет
 * нигде, и держит это тест по исходникам («время пути в часы мира идёт только дверью»).
 * Тип говорит то же самое компилятору: `GameSec` не примет ни один форматтер настоящего
 * времени, поэтому срок пути игроку показывают только через `ui/parts/wait.ts`.
 */
export const travelTime = (dist: number, factor: number, speed: number): GameSec =>
  travelTimeAt(dist, factor, speed, TEST_TRAVEL_SPEED);

/** `travelTime` при множителе скорости `k` (ВРЕМЕННО ×3 ДЛЯ ТЕСТА, `TEST_TRAVEL_SPEED`): при 1 — прежняя формула. */
export function travelTimeAt(dist: number, factor: number, speed: number, k: number): GameSec {
  const base = Math.max(MARCH_MIN_SECONDS, Math.round((dist / speed) * 60 * factor * 100) / 100);
  return asGame(k === 1 ? base : Math.round((base / k) * 100) / 100);
}

/** То же для отряда: скорость берётся по самому медленному в нём. Игровые секунды. */
export const marchSeconds = (dist: number, factor: number, units: UnitStack): GameSec =>
  travelTime(dist, factor, stackSpeed(units));

/** Полное время пути между двумя точками мира, игровые секунды. */
export const travelSeconds = (seed: number, from: Coord, to: Coord, units: UnitStack): GameSec =>
  marchSeconds(distance(from, to), terrainFactor(seed, from, to), units);

/** Где отряд сейчас: доля пройденного пути между началом и целью. */
export function marchPosition(m: Pick<MarchView, 'from' | 'to' | 'departAt' | 'arriveAt'>, now: number): Coord {
  const total = Math.max(1, m.arriveAt - m.departAt);
  const t = Math.min(1, Math.max(0, (now - m.departAt) / total));
  return { x: m.from.x + (m.to.x - m.from.x) * t, y: m.from.y + (m.to.y - m.from.y) * t };
}

/** Секунд до прибытия, не меньше нуля. */
export const secondsLeft = (arriveAt: number, now: number): number => Math.max(0, (arriveAt - now) / 1000);

/** «4:07» — время в интерфейсе всегда в таком виде. */
export function formatLeft(seconds: RealSecArg): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    return `${h}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
