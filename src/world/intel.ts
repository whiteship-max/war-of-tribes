// Старение разведданных. Разведка — не разовая галочка: снимок стареет,
// точность падает ступенями, и в конце от него не остаётся ничего.
import { UNIT_KINDS, stackTotal, type Stack, type UnitKind } from '@/battle';
import type { Estimate, Intel, IntelReading, Precision } from './types';
import { INTEL_EXACT, INTEL_ROUGH, INTEL_ROUGH_SPREAD, INTEL_VAGUE, INTEL_VAGUE_SPREAD } from './data/tuning';

/**
 * На старых данных мелкие отряды теряются: разведка помнит, что было много
 * пехоты, но про десяток всадников уже не поручится. Доля, ниже которой род
 * уходит в «неизвестно».
 */
const VAGUE_SHARE = 0.15;

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
 *
 * `floor` — вилка, ниже которой снимок не сужается, как бы он ни был свеж. Её
 * ставит лазутчик: он считает войско на глаз, и точного числа в его донесении
 * нет с самого начала. Точный снимок с такой вилкой невозможен по смыслу,
 * поэтому он читается как приблизительный.
 */
export function estimate(value: number, precision: Precision, floor = 0): Estimate {
  if (precision === 'unknown') return { ...UNKNOWN };
  if (precision === 'exact' && floor <= 0) {
    const v = Math.round(value);
    return { precision, value: v, min: v, max: v };
  }
  const step = precision === 'vague' ? 10 : 5;
  const base = precision === 'vague' ? INTEL_VAGUE_SPREAD : precision === 'rough' ? INTEL_ROUGH_SPREAD : 0;
  const spread = Math.max(base, floor);
  const min = Math.max(0, Math.floor((value * (1 - spread)) / step) * step);
  const max = Math.ceil((value * (1 + spread)) / step) * step;
  return { precision: precision === 'exact' ? 'rough' : precision, value: null, min, max };
}

/** Точное значение — то, что игрок видит про себя. */
export const exact = (value: number): Estimate => estimate(value, 'exact');

/**
 * Численность по родам с той точностью, что осталась. На свежих данных — точные
 * числа, дальше — диапазоны, на старых мелкие отряды пропадают совсем: показывать
 * «кавалерия: 0», когда её просто не разглядели, значит врать игроку.
 */
export function readKinds(
  kinds: Stack | undefined,
  precision: Precision,
  floor = 0,
): Partial<Record<UnitKind, Estimate>> | null {
  if (!kinds || precision === 'unknown') return null;
  const total = stackTotal(kinds);
  if (total <= 0) return null;
  const out: Partial<Record<UnitKind, Estimate>> = {};
  for (const k of UNIT_KINDS) {
    const n = kinds[k];
    if (precision === 'vague' && n / total < VAGUE_SHARE) continue;
    out[k] = estimate(n, precision, floor);
  }
  return out;
}

/** Читаемые разведданные на момент now. null — разведки не было или она истлела. */
export function readIntel(intel: Intel | null, now: number): IntelReading | null {
  if (!intel) return null;
  const real = Math.max(0, now - intel.at);
  // Дозор не подделывает время: он тянет донесения дальше, поэтому на ступени
  // точности снимок стареет медленнее, чем на календаре. Возраст игроку
  // показывается настоящий — врать ему про свежесть данных нельзя.
  const age = real / Math.max(1, intel.keen ?? 1);
  const precision = precisionOf(age);
  if (precision === 'unknown') return null;
  // Донесение лазутчика приблизительно с самого начала: у него своя вилка, и
  // сузиться до точного числа оно не может ни при какой свежести. Стареет оно
  // при этом обычным порядком — вилка только расширяется.
  const floor = Math.max(0, intel.spread ?? 0);
  const shown: Precision = floor > 0 && precision === 'exact' ? 'rough' : precision;
  return {
    at: intel.at,
    ageSeconds: real / 1000,
    precision: shown,
    hearsay: floor > 0,
    power: estimate(intel.power, shown, floor),
    pop: estimate(intel.pop, shown, floor),
    loot: estimate(intel.loot, shown, floor),
    kinds: readKinds(intel.kinds, shown, floor),
    // Построение живёт недолго: на старых данных противник давно перестроился,
    // и показывать вчерашнюю схему как сегодняшнюю нельзя.
    formation: shown === 'vague' ? null : (intel.formation ?? null),
    style: intel.style ?? null,
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
