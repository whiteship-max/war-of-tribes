// Сетка прихода вестей (docs/time.md, раздел 14; `sim/mail.mailArrive`) — своим маленьким модулем: её читает и почта партии, и книга
// отряда сервера (ПН-6: просящиеся приходят на этой же сетке, и сервер сверяет номер прихода с сидом партии,
// `netlify/lib/roambook.ts`). Почту целиком сервер не собирает — она тянет все вести игры. Без `@/`.
//
// Шаг — середина `LETTER_PAUSE_MIN`…`LETTER_PAUSE_MAX` (8 ч), приход ложится в начало своего шага со сдвигом до половины их разницы
// (0–2 ч), поэтому соседние приходы лежат в 6–10 ч друг от друга — ровно паузы писем. Приход k стоит в абсолютном времени и зависит
// только от сида партии и k.
import { LETTER_PAUSE_MAX, LETTER_PAUSE_MIN } from '../world/data/tuning';
import { hashId } from '../world/diplomacy';

export const AWAY_STEP = (LETTER_PAUSE_MIN + LETTER_PAUSE_MAX) / 2;
export const AWAY_JITTER = (LETTER_PAUSE_MAX - LETTER_PAUSE_MIN) / 2;

/** Минута k-го прихода вести, мс настоящего времени. */
export const awayArrival = (seed: number, k: number): number => k * AWAY_STEP + (hashId(`${seed}|mail|${k}`) / 2 ** 32) * AWAY_JITTER;

/** Номер первого прихода, который может лечь позже `t` (мс): с него перебирают окно. */
export const firstArrival = (t: number): number => Math.floor((t - AWAY_JITTER) / AWAY_STEP);
