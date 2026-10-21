// Ухо города: насколько камера близко к улицам. Пишет сцена города при каждом движении камеры, читает фон
// (`sound/epoch/`), docs/audio.md, раздел 4.
//
// Отдельным крошечным файлом, а не вызовом в звук: сцена не должна тянуть кусок звука в свой, а звук — знать о
// three.js. Число одно, и пишет его одна сцена.

let near = 0.5;

/**
 * Близость камеры к улицам: 0 — отдалена до предела (слышны ветер и общий гул), 1 — приближена до предела (рынок и
 * кузница). Из расстояния камеры в пределах её приближения.
 */
export function hearCity(dist: number, min: number, max: number): void {
  const k = max > min ? (dist - min) / (max - min) : 0.5;
  near = 1 - Math.min(1, Math.max(0, k));
}

/** Сколько слышно улиц, 0..1. */
export const cityNear = (): number => near;

/**
 * Сценка жителей, слышная этим кадром (docs/city_v3.md, ЖГ-2): какая, насколько громко (0..1 — по расстоянию от камеры) и где
 * на экране (−1 — слева, 1 — справа). `k` — доля её хода 0..1: звук знает, на каком она месте (стража прибежала, олень
 * сорвался). Пишет вид сценок (`render/city/skitview`), читает фон (`sound/epoch/skits`).
 */
export interface HeardSkit {
  id: string;
  gain: number;
  pan: number;
  k: number;
}

let skits: readonly HeardSkit[] = [];

/** Сценки этого кадра — копией: вид переиспользует свой список. */
export function hearSkits(list: readonly HeardSkit[]): void {
  skits = list.map((h) => ({ ...h }));
}

/** Что слышно из сценок сейчас; издали — ничего. */
export const skitsHeard = (): readonly HeardSkit[] => skits;
