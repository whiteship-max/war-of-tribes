// Старение разведданных. Разведка — не разовая галочка: снимок стареет,
// точность падает ступенями, и в конце от него не остаётся ничего.
import type { Estimate, Intel, IntelReading, Precision } from './types';
import { INTEL_EXACT, INTEL_ROUGH, INTEL_ROUGH_SPREAD, INTEL_VAGUE, INTEL_VAGUE_SPREAD } from './data/tuning';

/** Ступень точности по возрасту данных. */
export function precisionOf(ageMs: number): Precision {
  if (ageMs < INTEL_EXACT) return 'exact';
  if (ageMs < INTEL_ROUGH) return 'rough';
  if (ageMs < INTEL_VAGUE) return 'vague';
  return 'unknown';
}

const UNKNOWN: Estimate = { precision: 'unknown', value: null, min: 0, max: 0 };

/**
 * Число с той точностью, которая осталась. Границы диапазона считаются от самого
 * значения, а не случайно, — иначе оценка прыгала бы при каждой перерисовке.
 */
export function estimate(value: number, precision: Precision): Estimate {
  if (precision === 'unknown') return { ...UNKNOWN };
  if (precision === 'exact') {
    const v = Math.round(value);
    return { precision, value: v, min: v, max: v };
  }
  const spread = precision === 'rough' ? INTEL_ROUGH_SPREAD : INTEL_VAGUE_SPREAD;
  const step = precision === 'rough' ? 5 : 10;
  const min = Math.max(0, Math.floor((value * (1 - spread)) / step) * step);
  const max = Math.ceil((value * (1 + spread)) / step) * step;
  return { precision, value: null, min, max };
}

/** Точное значение — то, что игрок видит про себя. */
export const exact = (value: number): Estimate => estimate(value, 'exact');

/** Читаемые разведданные на момент now. null — разведки не было или она истлела. */
export function readIntel(intel: Intel | null, now: number): IntelReading | null {
  if (!intel) return null;
  const age = Math.max(0, now - intel.at);
  const precision = precisionOf(age);
  if (precision === 'unknown') return null;
  return {
    at: intel.at,
    ageSeconds: age / 1000,
    precision,
    power: estimate(intel.power, precision),
    pop: estimate(intel.pop, precision),
    loot: estimate(intel.loot, precision),
  };
}

/** «12 минут назад» — возраст данных всегда рядом с числом. */
export function formatAge(seconds: number): string {
  const s = Math.floor(seconds);
  if (s < 60) return 'только что';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  return `${h} ч назад`;
}

/** Как показать оценку: точное число, диапазон или прочерк. */
export function formatEstimate(e: Estimate | null): string {
  if (!e || e.precision === 'unknown') return 'неизвестно';
  if (e.precision === 'exact') return String(e.value);
  return `${e.min}–${e.max}`;
}

export const PRECISION_NOTE: Record<Precision, string> = {
  exact: 'данные свежие',
  rough: 'данные стареют — примерная оценка',
  vague: 'данные старые — только порядок величины',
  unknown: 'данных нет',
};
