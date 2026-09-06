// Лазутчик: шанс, донесение и бунт.
//
// Модуль чистый, как и `diplomacy.ts`: ни состояния мира, ни часов, ни
// `Math.random`. Всё, что он умеет, — считать по таблицам из `data/tuning.ts`.
// И то же правило второго порядка: **считаем при чтении, не тикаем**. Бунт
// хранится одним окном времени, а вставшее производство и просевший гарнизон
// выводятся из него в момент вопроса.
import { seeded } from '@/game/sim/random';
import { hashId } from './diplomacy';
import type { SpyActionId } from './types';
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
  action: SpyActionId;
  /** Во сколько раз лучше работает разведка игрока: уровень Дозора. */
  keen: number;
  /** Стража цели — `guardOf`. */
  guard: number;
  /** Расстояние от дома до цели, клеток. */
  distance: number;
}

/**
 * Шанс. Три входа и ровно три: уровень лазутчика (Дозор), стража цели и
 * расстояние. Верного дела не бывает, безнадёжного тоже — иначе приказ
 * превращается либо в кнопку, либо в запрет.
 */
export function spyChance(ctx: SpyContext): number {
  const base = SPY_PROBE_BASE * (ctx.action === 'revolt' ? SPY_REVOLT_HARDER : 1);
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
 */
export function spySeed(
  seed: number,
  id: string,
  action: SpyActionId,
  chance: number,
  attitude: number,
): number {
  return hashId(`${seed}|${id}|spy:${action}|${Math.round(chance * 100)}|${Math.round(attitude)}`);
}

export interface SpyOutcome {
  success: boolean;
  /**
   * Ширина вилки донесения, доля. Считается из того, насколько уверенно прошло
   * дело: еле удалось — числа приблизительные, прошло гладко — вилка узкая.
   * У провала нулевая: доносить нечего.
   */
  spread: number;
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
    text:
      action === 'probe'
        ? margin > 0.5
          ? 'Лазутчик пересчитал войско спокойно: числа близки к правде.'
          : 'Лазутчик считал наспех: числа приблизительные.'
        : 'В поселении бунт. Работы встали, гарнизон занят своими.',
  };
}

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
