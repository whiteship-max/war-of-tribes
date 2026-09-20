// Изучение округи. Дозор шлёт разъезды, и открытая ими земля остаётся открытой.
//
// Здесь два правила, и оба структурные, а не на слово.
//
// 1. **Ступень доводится из времени начала, а не из работы.** В состоянии лежит
//    отметка `until`, и всё, что делает `surveyTick`, — сверяет её с часами.
//    Поэтому вернувшийся после долгого отсутствия игрок застаёт ступень пройденной, а
//    офлайн-догон ничего не доигрывает: он просто проходит мимо этой отметки.
// 2. **Уровень Дозора — потолок, а не источник.** Ступень N требует Дозора N
//    уровня; здание даёт право, изучение даёт результат. Второй шкалы «уровень
//    сам открывает карту» быть не должно.
import type { GameState } from '../types';
import { SURVEY_MAX, surveyStep, type SurveyStep } from '../data/survey';
import { buildingOfType, canAfford, faithTilt } from '../derived';
import { log } from './log';
import { pay, refund } from './pay';
import { asGame, type GameSec } from '../pace';

export interface SurveyInfo {
  /** Сколько ступеней уже изучено. */
  done: number;
  /** Следующая ступень. null — изучено всё. */
  next: SurveyStep | null;
  /** Ступень, которая изучается прямо сейчас. null — Дозор свободен. */
  running: SurveyStep | null;
  /** Секунд до конца текущей ступени. 0 — не идёт. */
  left: GameSec;
  /** Доля пройденного, 0..1. */
  progress: number;
  /** Уровень Дозора: он же потолок ступени. */
  level: number;
  /**
   * Во сколько раз быстрее идут разъезды из-за веры. Единица — как у всех.
   * Число здесь, а не в панели: срок ступени считает `startSurvey`, и второй
   * правды о нём быть не должно.
   */
  learning: number;
  /** Радиус открытой земли сейчас, клеток. */
  radius: number;
  /** Почему следующую ступень нельзя начать; null — можно. */
  blocked: string | null;
}

/**
 * Всё, что нужно знать про изучение, считается здесь и при чтении. Панель своих
 * формул не держит: срок, доля и причина отказа приходят отсюда готовыми.
 */
export function surveyInfo(s: GameState): SurveyInfo {
  const st = s.survey ?? { done: 0, startedAt: 0, until: 0 };
  const watch = buildingOfType(s, 'watch');
  const level = watch?.level ?? 0;
  const done = Math.max(0, Math.min(SURVEY_MAX, st.done));
  const running = st.until > 0 ? surveyStep(done + 1) : null;
  const next = running ? null : surveyStep(done + 1);
  const span = Math.max(1, st.until - st.startedAt);
  const left = running ? Math.max(0, st.until - s.time) : 0;
  const radius = surveyStep(done)?.radius ?? 0;

  let blocked: string | null = null;
  if (running) blocked = 'Разъезды в поле: Дозор занят.';
  else if (!next) blocked = 'Округа изучена вся.';
  else if (!watch) blocked = 'Дозора в посёлке нет.';
  else if (next.n > level) blocked = `Нужен Дозор ${next.n} уровня — сейчас ${level}.`;
  else if (!canAfford(s, next.cost)) blocked = 'Не хватает припаса на разъезды.';

  return {
    done,
    next,
    running,
    left: asGame(left),
    progress: running ? Math.max(0, Math.min(1, (s.time - st.startedAt) / span)) : 0,
    level,
    learning: Math.max(0.1, faithTilt(s).learning),
    radius,
    blocked,
  };
}

/**
 * Сколько секунд идёт ступень у этой деревни: срок ступени, делённый на ускорение
 * от веры. Одна формула на постановку ступени и на панель Дозора — прежде панель
 * писала срок без веры, и у мечети десятого уровня обещала 90 с там, где ставилось 62.
 */
export const surveySeconds = (step: SurveyStep, learning: number): GameSec =>
  asGame(Math.max(1, Math.round(step.seconds / learning)));

/** Ставит следующую ступень в работу. Плата снимается сразу — как за стройку. */
export function startSurvey(s: GameState): string | null {
  const info = surveyInfo(s);
  if (info.blocked) return info.blocked;
  const step = info.next as SurveyStep;
  pay(s, step.cost);
  // Медресе учит счёту и письму, и разъезды возвращаются с грамотой быстрее.
  // Делится это здесь, при постановке ступени, а не при чтении: ступень
  // доводится из отметки `until`, и менять её задним числом было бы враньём —
  // уклад мог смениться, пока разъезды в поле.
  const seconds = surveySeconds(step, info.learning);
  s.survey = { done: info.done, startedAt: s.time, until: s.time + seconds };
  log(s, `Дозор: разъезды пошли изучать округу (ступень ${step.n}).`);
  return null;
}

/**
 * Отмена изучения. Возвращается половина припаса — та же цена отказа, что и у
 * брошенного улучшения (`cancelUpgrade`): разъезды уже в поле, съеденного не
 * вернуть, а сбрую и вешки привезут обратно. На полный склад сверх вместимости
 * не ложится ничего — тем же правилом (`pay.refund`).
 */
export function cancelSurvey(s: GameState): string | null {
  const st = s.survey;
  if (!st || st.until <= 0) return 'Изучение не идёт.';
  const step = surveyStep(st.done + 1);
  if (step) refund(s, step.cost, 0.5);
  s.survey = { done: st.done, startedAt: 0, until: 0 };
  log(s, 'Дозор: разъезды отозваны, округа осталась неизученной.', 'bad');
  return null;
}

/**
 * Шаг изучения: одна сверка отметки с часами. Работы здесь нет и быть не может —
 * иначе ступень перестала бы доводиться из времени начала, и офлайн разошёлся бы
 * с непрерывной игрой.
 */
export function surveyTick(s: GameState): void {
  const st = s.survey;
  if (!st || st.until <= 0 || s.time < st.until) return;
  const step = surveyStep(st.done + 1);
  s.survey = { done: Math.min(SURVEY_MAX, st.done + 1), startedAt: 0, until: 0 };
  log(
    s,
    step
      ? `Дозор: округа изучена на ${step.radius} клеток вокруг. ${step.effect}`
      : 'Дозор: округа изучена.',
    'good',
  );
}
