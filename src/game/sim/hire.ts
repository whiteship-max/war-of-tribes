// Найм агента на пустое место — здание владеет тем, как быстро и каким он придёт.
//
// Место пустует, когда человек погиб или ушёл на покой (`sim/agents`). Нанять можно
// всегда, пока хватает золота, — тупика нет, как у мятежа: без разведчика не открыть
// карту, без полководца армия не выходит из ворот, и запирать племя за это нельзя.
//
// Что даёт уровень здания — ровно две вещи, и обе видны на кнопке до найма: срок
// (`HIRE_SECONDS` делится на ту же `levelOutputMult`, которой уровень ускоряет всякую
// работу) и возраст новичка (моложе на `HIRE_YOUNGER` за уровень). Опыта не даёт —
// новичок начинает с нуля.
import type { FigureId } from '@/world/types';
import type { GameState } from '../types';
import { FIGURE_BY_ID, FIGURE_IDS } from '@/world/data/figures';
import { AGENT_AGE0 } from '../data/agents';
import { HIRE_AT, HIRE_GOLD_PER_POP, HIRE_SECONDS, HIRE_YOUNGER } from '../data/hire';
import { buildingOfType, buildingTitle, faithDef, levelOutputMult, population } from '../derived';
import { drawName, nameAgents, seat, titled, yearsWord } from './agents';
import { log } from './log';

/** Как по-русски сказать «нанять где»: «в Дозоре», «в Статуе Героя», «в мечети». */
const TEMPLE_IN: Record<string, string> = {
  Костёл: 'в костёле',
  Храм: 'в храме',
  Мечеть: 'в мечети',
  Капище: 'в капище',
};

export function hireWhere(s: GameState, agent: FigureId): string {
  const type = HIRE_AT[agent];
  if (type === 'watch') return 'в Дозоре';
  if (type === 'statue') return 'в Статуе Героя';
  const temple = faithDef(s)?.temple;
  return (temple && TEMPLE_IN[temple]) ?? 'в храме';
}

export interface HireInfo {
  agent: FigureId;
  /** Где нанимают — название здания, как его видит игрок. */
  building: string;
  /** Уровень этого здания. */
  level: number;
  /** Место пустует, найма нет. */
  vacant: boolean;
  /** Найм идёт: сколько игровых секунд осталось. 0 — не идёт. */
  left: number;
  /** Кто придёт: имя известно с начала найма. */
  coming: string | null;
  /** Золото за найм. */
  gold: number;
  /** Сколько идёт найм, игровых секунд. */
  seconds: number;
  /** Сколько лет будет новичку. */
  age0: number;
  /** Почему нанять нельзя; null — можно. */
  blocked: string | null;
}

/** Всё о найме на это место — одна функция на кнопку, на справку и на действие. */
export function hireInfo(s: GameState, agent: FigureId): HireInfo {
  const type = HIRE_AT[agent];
  const building = buildingOfType(s, type);
  const level = Math.max(1, building?.level ?? 1);
  const p = s.agents[agent];
  const gold = Math.ceil(HIRE_GOLD_PER_POP * population(s));
  const seconds = Math.round(HIRE_SECONDS / levelOutputMult(level));
  const age0 = Math.max(18, AGENT_AGE0 - HIRE_YOUNGER * (level - 1));
  const hiring = p.hiring;
  let blocked: string | null = null;
  if (!p.vacant) blocked = `${FIGURE_BY_ID[agent].name} на месте: нанимают только на пустое.`;
  else if (hiring) blocked = 'Найм уже идёт.';
  else if (s.gold < gold) blocked = `Не хватает золота: нужно ${gold}, в казне ${Math.floor(s.gold)}.`;
  return {
    agent,
    building: buildingTitle(s, type),
    level,
    vacant: p.vacant && !hiring,
    left: hiring ? Math.max(0, hiring.until - s.time) : 0,
    coming: hiring?.name ?? null,
    gold,
    seconds,
    age0,
    blocked,
  };
}

/**
 * Нанять человека на пустое место. Золото списывается сразу, человек приходит по
 * сроку — шагом партии (`settleHires`). Имя выдаётся тут же: оно известно заранее, и
 * игрок видит, кого ждёт.
 */
export function hireAgent(s: GameState, agent: FigureId): string | null {
  const info = hireInfo(s, agent);
  if (info.blocked) return info.blocked;
  s.gold -= info.gold;
  s.agents[agent].hiring = { until: s.time + info.seconds, name: drawName(s), age0: info.age0 };
  log(s, `${info.building}: наняли ${FIGURE_BY_ID[agent].one}${s.agents[agent].hiring?.name ? ` — ${s.agents[agent].hiring?.name}` : ''}. Плата — ${info.gold} золота.`);
  return null;
}

/**
 * Шаг партии для мест агентов: пришёл нанятый — встаёт на место; безымянным дать имя,
 * если вера уже известна. Возвращает, изменилось ли что-нибудь.
 */
export function settleHires(s: GameState): boolean {
  let changed = nameAgents(s);
  for (const id of FIGURE_IDS) {
    const hiring = s.agents[id].hiring;
    if (!hiring || s.time < hiring.until) continue;
    seat(s, id, hiring.until, hiring.age0, hiring.name);
    const p = s.agents[id];
    log(s, `${titled(s, id)} встал на место: ${yearsWord(Math.floor(p.age0))}, первый уровень.`, 'good');
    changed = true;
  }
  return changed;
}
