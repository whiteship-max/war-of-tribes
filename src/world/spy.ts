// Лазутчик: шанс, донесение и бунт.
//
// Модуль чистый, как и `diplomacy.ts`: ни состояния мира, ни часов, ни
// `Math.random`. Всё, что он умеет, — считать по таблицам из `data/tuning.ts`.
// И то же правило второго порядка: **считаем при чтении, не тикаем**. Бунт
// хранится одним окном времени, а вставшее производство и просевший гарнизон
// выводятся из него в момент вопроса.
import { seeded } from '@/game/sim/random';
import { hashId } from './diplomacy';
import type { RivalDeedId, SpyActionId } from './types';
import { RIVAL_DEED_BY_ID } from './data/spy';
import {
  REVOLT_DURATION,
  REVOLT_POWER_LOSS,
  SPY_CHANCE_MAX,
  SPY_CHANCE_MIN,
  SPY_GUARD_CASTLE,
  SPY_GUARD_POWER,
  SPY_PROBE_BASE,
  SPY_REACH,
  SPY_REVOLT_HARDER,
  SPY_SPREAD_MAX,
  SPY_SPREAD_MIN,
} from './data/tuning';

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/**
 * Насколько цель стережёт себя. Своей «дозорной башни» у чужого поселения в мире
 * нет и завести её нельзя: мир не знает про здания — он знает мощь и то, замок
 * это или нет. Отсюда стража и считается, а не из выдуманного строения.
 */
export function guardOf(power: number, castle: boolean): number {
  return (1 + Math.max(0, power) / SPY_GUARD_POWER) * (castle ? SPY_GUARD_CASTLE : 1);
}

export interface SpyContext {
  /** Дело: у логова (`SpyActionId`) или у города игрока (`RivalDeedId`, docs/spy_pvp.md) — одна формула шанса. */
  action: SpyActionId | RivalDeedId;
  /** Во сколько раз лучше работает разведка игрока: уровень Дозора. */
  keen: number;
  /** Стража цели — `guardOf`. */
  guard: number;
  /** Расстояние от дома до цели, клеток. */
  distance: number;
}

/**
 * Во сколько раз дело труднее пробы гарнизона. Бунт — `SPY_REVOLT_HARDER`; дела против игрока — своей строкой
 * таблицы (`data/spy.RIVAL_DEEDS`). Одна мерка трудности на оба списка дел.
 */
export function spyHard(action: SpyActionId | RivalDeedId): number {
  if (action === 'probe') return 1;
  if (action === 'revolt') return SPY_REVOLT_HARDER;
  return RIVAL_DEED_BY_ID[action].hard;
}

/**
 * Шанс. Три входа и ровно три: уровень лазутчика (Дозор), стража цели и
 * расстояние. Верного дела не бывает, безнадёжного тоже — иначе приказ
 * превращается либо в кнопку, либо в запрет.
 */
export function spyChance(ctx: SpyContext): number {
  const base = SPY_PROBE_BASE * spyHard(ctx.action);
  const reach = 1 / (1 + Math.max(0, ctx.distance) / SPY_REACH);
  const raw = (base * Math.max(0.1, ctx.keen) * reach) / Math.max(0.1, ctx.guard);
  return clamp(raw, SPY_CHANCE_MIN, SPY_CHANCE_MAX);
}

/**
 * Зерно броска. В нём условия дела, а не счётчик обращений: переспросить и
 * получить другой ответ нельзя — можно только изменить условия (поднять Дозор,
 * подойти ближе, разбить гарнизон). То же правило, что у приказов дипломата.
 *
 * Отношение входит в зерно нарочно: пойманный лазутчик роняет его, и следующая
 * попытка — уже другое дело, а не то же самое во второй раз.
 *
 * Номер человека входит тоже, но **только когда он больше нуля**: отношение у логова
 * упирается в `ATTITUDE_MIN` и перестаёт двигаться, и новый лазутчик на месте погибшего получил
 * бы ту же кость — и погиб бы там же. У того, с кем партия началась, номер ноль, и зёрна
 * сегодняшних партий не меняются ни на бит.
 */
export function spySeed(
  seed: number,
  id: string,
  action: SpyActionId,
  chance: number,
  attitude: number,
  person = 0,
): number {
  const who = person > 0 ? `|p${Math.floor(person)}` : '';
  return hashId(`${seed}|${id}|spy:${action}|${Math.round(chance * 100)}|${Math.round(attitude)}${who}`);
}

/**
 * Кость гибели лазутчика — своя, и шанса дела в её зерне нет нарочно: иначе Дозор,
 * поднявший шанс, перебрасывал бы и гибель, и «Дозор не трогает гибель» было бы правдой
 * только в среднем. В зерне — цель, минута дела и номер человека: каждая попытка
 * бросает гибель заново, а при тех же условиях и в ту же минуту — одинаково при любом
 * Дозоре. Решает её `peril.diesAt`.
 */
export function spyDeathRoll(seed: number, id: string, at: number, person = 0): number {
  return seeded(hashId(`${seed}|${id}|spy:death|${Math.floor(at / 1000)}|p${Math.max(0, Math.floor(person))}`))();
}

export interface SpyOutcome {
  success: boolean;
  /**
   * Ширина вилки донесения, доля. Считается из того, насколько уверенно прошло
   * дело: еле удалось — числа приблизительные, прошло гладко — вилка узкая.
   * У провала нулевая: доносить нечего.
   */
  spread: number;
  /**
   * Где легла кость в зоне провала, 0..1: ноль — у самой черты шанса, единица —
   * в дальнем углу. У удачи ноль. Им скрытность решает, заметили ли провал
   * (`world/agents.slipped`), — тем же броском, без второго.
   */
  miss: number;
  text: string;
}

/** Исход дела — чистая функция от шанса и зерна. */
export function spyOutcome(chance: number, seed: number, action: SpyActionId): SpyOutcome {
  const roll = seeded(seed)();
  const success = roll < chance;
  if (!success) {
    return {
      success: false,
      spread: 0,
      miss: chance >= 1 ? 0 : clamp((roll - chance) / (1 - chance), 0, 1),
      text:
        action === 'probe'
          ? 'Лазутчика заметили у ворот. Он вернулся ни с чем, и его запомнили.'
          : 'Сговор раскрыли. Лазутчик едва ушёл, и его запомнили.',
    };
  }
  // Запас, с которым дело прошло: 0 — на волоске, 1 — как по маслу.
  const margin = chance <= 0 ? 0 : clamp((chance - roll) / chance, 0, 1);
  const spread = SPY_SPREAD_MAX - (SPY_SPREAD_MAX - SPY_SPREAD_MIN) * margin;
  return {
    success: true,
    spread: action === 'probe' ? spread : 0,
    miss: 0,
    text:
      action === 'probe'
        ? margin > 0.5
          ? 'Лазутчик сосчитал гарнизон спокойно, числа близки к правде.'
          : 'Лазутчик считал наспех, числа примерные.'
        : 'В городе бунт. Работы встали, гарнизон занят своими.',
  };
}

/** Слова провала, которого не заметили (скрытность лазутчика). */
export const SPY_SLIP_TEXT: Record<SpyActionId, string> = {
  probe: 'Сосчитать гарнизон не вышло, но лазутчик ушёл тихо. У ворот теперь смотрят внимательнее.',
  revolt: 'Сговор не сложился, но лазутчика не выдали. Там насторожились.',
};

/** Окно бунта от момента, когда он начался. */
export const revoltWindow = (at: number): { since: number; until: number } => ({
  since: at,
  until: at + REVOLT_DURATION,
});

/** Бунт идёт прямо сейчас? Считается при чтении, а не отмечается тиком. */
export const revoltActive = (window: { until: number } | undefined, now: number): boolean =>
  Boolean(window && now < window.until);

/**
 * Сколько времени поселение уже простояло в бунте к моменту `now`. Этим временем
 * и «встало производство»: рост мощи и населения, как и накопление добра,
 * считаются от прошедшего времени, а бунт из него вычитается.
 */
export function revoltElapsed(window: { since: number; until: number } | undefined, now: number): number {
  if (!window) return 0;
  return Math.max(0, Math.min(now, window.until) - window.since);
}

/** Во сколько раз слабее гарнизон, пока идёт бунт. */
export const revoltPower = (active: boolean): number => (active ? 1 - REVOLT_POWER_LOSS : 1);
