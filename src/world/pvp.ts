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
import { GAIT_SPEED, gaitSpeed, type Gait } from './gait';

/** Скорость полководца в режиме марша (ДР-2, М3): одна мерка на мир и на сервер войны. */
export const generalSpeed = (g?: Gait): number => FIGURE_BY_ID.general.speed * gaitSpeed(g);

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
