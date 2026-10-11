// Стена-проход (docs/siege_v2.md, 4.1–4.2; этап 2в): стена в бою — не люди, а поле. Узкий фронт через ширину боя и
// штраф кости тем, кто лезет по лестницам; пролом, ворота после тарана и осадная башня открывают долю фронта без штрафа.
//
// Одна модель на все бои у стены (ответ владельца 4): набег логова у ворот города игрока, разбойники события, штурм с
// ходу и штурм из лагеря у войны между игроками. Ядро боя про стену не знает — оно получает ширину (`BattleInput.width`),
// грань (`GroundPenalty.wall`) и проём посреди боя (`BattleInput.widen`), как получает землю. Ополчение (`militiaOf`)
// остаётся: это люди города, а не стена; стрелки башни бьют фазой огня, как прежде.
//
// Модуль чистый: ни состояния мира, ни часов, ни случайности. Его собирает сервер войны — без `@/`.
import { FRONT_WIDTH } from '../battle/config';
import type { Widen } from '../battle/types';
import { GATE_SHARE, LADDER_FACES, RAM_ROUND, SCALING_SHARE, TOWER_SHARE, BREACH_SHARE, WALL_BREACHES } from './data/wall';

/** Чем идут на стену в этом штурме: проломы к его минуте и машины, пущенные в дело (`world/engines`). */
export interface Assault {
  /** Проломов в стене к минуте штурма, 0..3 (`siegeroll.breachesOf`). */
  breaches?: number;
  /** Построенные лестницы — на весь остаток фронта; нет — несли на себе, на треть стены. */
  ladders?: boolean;
  /** Таран — ворота выбиты со второго круга боя. */
  ram?: boolean;
  /** Осадная башня — пролёт стены без штрафа с первого круга. */
  tower?: boolean;
}

/** Проём во фронте штурма. Имена — то, что показывает ролик: пролом, ворота, башня, лестницы. */
export type OpeningId = 'breach' | 'gate' | 'tower' | 'ladders' | 'scaling';
export const OPENING_IDS: readonly OpeningId[] = ['breach', 'gate', 'tower', 'ladders', 'scaling'];

export interface Opening {
  id: OpeningId;
  /** Доля полного фронта, 0..1. */
  share: number;
  /** Штраф кости тем, кто идёт этим проёмом, в гранях: по лестницам — `LADDER_FACES`, остальные — ноль. */
  faces: number;
  /** С какого круга боя проём открыт: 0 — с начала, у ворот — после тарана. */
  round: number;
  /** Пройдёт ли конница: по лестницам и с башни — нет, в пролом и ворота — да. */
  horse: boolean;
}

/** Фронт штурма: что получает ядро и что показывает ролик. */
export interface WallFront {
  openings: Opening[];
  /** Ширина боя на начало, бойцов строя на полосу: полная ширина × открытая доля. Сходятся только в проёмах. */
  width: number;
  /** Ширина стрельбы — полная: лучники обеих сторон стреляют со всей стены и по всей стене, а не только в проёмах. */
  fire: number;
  /** Штраф стены нападающему на начало — средний по его фронту: лестницы −2 на своей доле, проёмы — ноль. */
  wall: number;
  /** Ворота посреди боя: ширина и штраф со второго круга. Нет тарана — нет поля. */
  widen?: Widen;
  /** Идёт ли конница нападающего в бой: только если есть пролом или ворота (docs/battle_tw.md, решение 22). */
  horse: boolean;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const breachCount = (n: number | undefined): number =>
  Math.min(WALL_BREACHES, Math.max(0, Number.isFinite(n) ? Math.floor(n as number) : 0));

/**
 * Проёмы штурма. Свободное без штрафа — проломы и башня (доли складываются, не больше всей стены); ворота — полоса после
 * тарана; лестницы — построенные на весь остаток фронта, а несённые на себе — на треть стены, но не шире остатка.
 */
export function openingsOf(a: Assault): Opening[] {
  const out: Opening[] = [];
  const breach = breachCount(a.breaches) * BREACH_SHARE;
  if (breach > 0) out.push({ id: 'breach', share: clamp01(breach), faces: 0, round: 0, horse: true });
  const tower = a.tower ? Math.min(TOWER_SHARE, 1 - clamp01(breach)) : 0;
  if (tower > 0) out.push({ id: 'tower', share: tower, faces: 0, round: 0, horse: false });
  const clear = clamp01(breach + tower);
  const gate = a.ram ? Math.min(GATE_SHARE, 1 - clear) : 0;
  if (gate > 0) out.push({ id: 'gate', share: gate, faces: 0, round: RAM_ROUND, horse: true });
  const rest = Math.max(0, 1 - clear - gate);
  const ladders = a.ladders ? rest : Math.min(SCALING_SHARE, rest);
  if (ladders > 1e-9) out.push({ id: a.ladders ? 'ladders' : 'scaling', share: ladders, faces: LADDER_FACES, round: 0, horse: false });
  return out;
}

/** Ширина и средний штраф проёмов, открытых к кругу `round`. */
function frontAt(openings: readonly Opening[], round: number, full: number): { width: number; wall: number; open: number } {
  const now = openings.filter((o) => o.round <= round);
  const open = now.reduce((n, o) => n + o.share, 0);
  // Штраф стороны в бою — один на весь её фронт: удача стороны линейна по грани (`battle/sim.luckOf`), и средняя грань
  // по долям фронта даёт ту же сумму урона, что каждая доля со своей гранью.
  const wall = open > 0 ? now.reduce((n, o) => n + o.share * o.faces, 0) / open : 0;
  return { width: full * open, wall, open };
}

/**
 * Фронт штурма для ядра (docs/siege_v2.md, 4.1). Полная ширина — ширина фронта (`FRONT_WIDTH`, W), открытая доля её
 * сужает: в узком проходе тесно обеим сторонам, и стена отнимает у большего его число.
 */
export function wallFront(a: Assault, full: number = FRONT_WIDTH): WallFront {
  const openings = openingsOf(a);
  const start = frontAt(openings, 0, full);
  const late = openings.filter((o) => o.round > 0).map((o) => o.round);
  const round = late.length > 0 ? Math.min(...late) : 0;
  const after = round > 0 ? frontAt(openings, round, full) : null;
  return {
    openings,
    width: start.width,
    fire: full,
    wall: start.wall,
    ...(after ? { widen: { round, width: after.width, wall: after.wall } } : {}),
    horse: openings.some((o) => o.horse),
  };
}

/** Штурм с ходу: проломов нет, машин нет — лестницы, принесённые на себе, на треть стены (docs/siege_v2.md, 1.3). */
export const SCALING: Assault = {};

/** Название проёма словами — для выбора способа штурма и донесения. */
export const OPENING_NAME: Record<OpeningId, string> = {
  breach: 'через пролом',
  gate: 'тараном в ворота',
  tower: 'башней',
  ladders: 'по лестницам',
  scaling: 'по лестницам с ходу',
};

/**
 * Что даёт проём — строкой устройства, без прогноза (docs/siege_v2.md, 4.4): сколько мест строя он открывает и со
 * штрафом ли. Числа — этими же функциями (правило 18).
 */
export function openingWords(o: Opening, full: number = FRONT_WIDTH): string {
  const places = Math.round(o.share * full);
  const when = o.round > 0 ? ' после первого круга боя' : '';
  const faces = o.faces > 0 ? `, кость −${o.faces} грани` : ', без штрафа';
  const horse = o.horse ? '' : ', конница не пройдёт';
  return `${OPENING_NAME[o.id]}: ${places} из ${Math.round(full)} мест строя${when}${faces}${horse}.`;
}
