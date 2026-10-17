// Ночной свет (docs/polish.md, П-9): огни — только у видимых источников. Чистый модуль без three: виды огня и их числа,
// когда огонь зажигается, как мерцает, какие огни светят по-настоящему. Его читают город (`city/`), ролики (`tw/`,
// `siege/`), сборка света (`glow/rig.ts`) и тесты.
//
// Свет делится на две цены. **Настоящий** — огонь в шейдере на каждом пикселе: освещает стену по нормали, землю под собой и
// людей рядом. Таких мало (`LAMP_SPEC.real`), и это ближние к взгляду. **Дешёвый** — у всех: огонёк с ореолом над
// источником и, у низких, пятно на земле. Когда огонь становится настоящим, пятно гаснет и наплывает свет — за доли
// секунды, без щелчка.
import type { Quality } from '../quality';

export type LampKind = 'torch' | 'lantern' | 'brazier' | 'forge' | 'fire';

/** Источник света: где горит (метры места), какой, и куда смотрит стена, на которой висит. */
export interface Lamp {
  x: number;
  y: number;
  z: number;
  kind: LampKind;
  /** Наружу от стены (в плане, единичный); 0, 0 — стоит сам (жаровня, фонарь на столбе, костёр). */
  dx: number;
  dz: number;
  /** Над землёй, м: пятно на земле — только у низких огней. */
  lift: number;
  /**
   * Огонь со своим часом (ролик: горящий шатёр, погребальный костёр, сожжённая машина): разгорается с `from` за полторы
   * секунды, с `to` гаснет за секунду; секунды — часы ролика. Нет — горит всю ночь.
   */
  from?: number;
  to?: number;
}

/** Как светит вид огня. */
export interface LampLook {
  /** Досягаемость света, м: дальше — ноль, без обрезки (спад окном). */
  reach: number;
  /** Сила у самого огня (множит альбедо). */
  power: number;
  /** Цвет пламени, sRGB. */
  color: number;
  /** Размах мерцания: доля силы. */
  flicker: number;
  /** Огонёк, м: ядро пламени и ореол вокруг. */
  core: number;
  halo: number;
  /**
   * Когда загорается: на доле ночи `from` загорается первый огонь вида, к `from + span` — последний; гаснут на рассвете в
   * обратном порядке той же мерой. Ворота и дозор — первыми, окна и двери — в сумерках, фонари улиц — к темноте.
   */
  from: number;
  span: number;
  /** Вес при выборе настоящих: костёр виден дальше и важнее фонаря у двери. */
  weight: number;
}

export const LAMP: Record<LampKind, LampLook> = {
  torch: { reach: 10, power: 3.2, color: 0xff9a40, flicker: 0.16, core: 0.6, halo: 2.6, from: 0.06, span: 0.3, weight: 1 },
  lantern: { reach: 9, power: 2.8, color: 0xffb862, flicker: 0.06, core: 0.45, halo: 2.2, from: 0.22, span: 0.3, weight: 0.9 },
  brazier: { reach: 13, power: 3.6, color: 0xff9038, flicker: 0.2, core: 0.9, halo: 3.4, from: 0.04, span: 0.12, weight: 1.4 },
  forge: { reach: 10, power: 2.8, color: 0xff6c26, flicker: 0.24, core: 0.75, halo: 3, from: 0, span: 0.06, weight: 1.3 },
  fire: { reach: 14, power: 2.8, color: 0xff8a32, flicker: 0.22, core: 1.3, halo: 4.6, from: 0.02, span: 0.2, weight: 1.6 },
};

/** Самое большее настоящих огней — столько мест в шейдере (одна программа на все уровни: число — униформой). */
export const MAX_LAMPS = 24;

/**
 * Что уровень берёт от света: сколько огней настоящих (на каждом пикселе), и есть ли пятна на земле у остальных. Низкий —
 * четыре ближних к взгляду, остальное — огоньки и пятна.
 */
export const LAMP_SPEC: Record<Quality, { real: number }> = {
  low: { real: 4 },
  medium: { real: 12 },
  high: { real: MAX_LAMPS },
};

/** За столько секунд огонь становится настоящим или перестаёт им быть (наплыв света и пятна). */
export const LAMP_FADE_S = 0.45;

/** Число огня от места: не синус (одинаково на любой машине), разброс по [0, 1). */
export function lampSeed(x: number, z: number): number {
  let h = Math.imul(Math.round(x * 10) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(z * 10) | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** С какой доли ночи загорается этот огонь. */
export const lampThreshold = (l: Lamp): number => LAMP[l.kind].from + LAMP[l.kind].span * lampSeed(l.x, l.z);

/** Сколько огонь горит при доле ночи `night`: 0 — погашен, 1 — в полную силу; разгорается за десятую долю ночи. */
export const lampOn = (l: Lamp, night: number): number => smooth((night - lampThreshold(l)) / 0.1);

/** Огонь со своим часом в миг `t`: та же мера, что у языков огня ролика (`tw/siegeworks.updateFire`). */
export function lampLife(l: Lamp, t: number): number {
  if (l.from === undefined) return 1;
  if (t < l.from) return 0;
  const grow = Math.min(1, (t - l.from) / 1.5);
  return l.to !== undefined && t > l.to ? Math.max(0, grow * (1 - (t - l.to))) : grow;
}

/**
 * Мерцание: сила огня в миг `t` (с) — около единицы, в пределах `1 ± flicker`. Три несоизмеримые частоты: пламя дышит, а
 * не мигает; фонарь за стеклом почти ровный.
 */
export function lampFlicker(l: Lamp, t: number): number {
  const s = lampSeed(l.x, l.z) * 6.283;
  const a = LAMP[l.kind].flicker;
  const v = 0.5 * Math.sin(t * 7.3 + s) * Math.sin(t * 2.9 + s * 3.1) + 0.3 * Math.sin(t * 13.1 + s * 5.7) + 0.2 * Math.sin(t * 1.7 + s * 2.3);
  return 1 + a * v;
}

/**
 * Какие огни настоящие. Держит вес каждого огня (0 — дешёвый, 1 — настоящий): желанные — ближние к взгляду с поправкой на
 * вид, не больше `cap`; вес идёт к цели за `LAMP_FADE_S`, и мест в шейдере не бывает больше `MAX_LAMPS`, даже пока одни
 * гаснут, а другие наплывают.
 */
export class LampSlots {
  /** Вес каждого огня: доля настоящего света. */
  readonly w: Float32Array;
  private rank: number[] = [];
  private fresh = true;

  constructor(readonly lamps: readonly Lamp[]) {
    this.w = new Float32Array(lamps.length);
  }

  /**
   * Шаг: `fx`, `fz` — куда смотрит камера (в тех же единицах, что огни), `on` — сколько горит каждый огонь, `cap` — сколько
   * настоящих на уровне, `dt` — секунды кадра. Возвращает огни мест шейдера (по убыванию веса), не больше `MAX_LAMPS`.
   */
  step(fx: number, fz: number, on: Float32Array, cap: number, dt: number): number[] {
    const n = this.lamps.length;
    const want = new Uint8Array(n);
    if (cap > 0) {
      const lit: number[] = [];
      for (let i = 0; i < n; i++) if (on[i] > 0.01) lit.push(i);
      const score = (i: number): number => Math.hypot(this.lamps[i].x - fx, this.lamps[i].z - fz) / LAMP[this.lamps[i].kind].weight;
      lit.sort((a, b) => score(a) - score(b));
      for (let k = 0; k < Math.min(cap, lit.length); k++) want[lit[k]] = 1;
    }
    const k = this.fresh ? 1 : Math.min(1, dt / LAMP_FADE_S);
    this.fresh = false;
    const active: number[] = [];
    for (let i = 0; i < n; i++) {
      const goal = want[i];
      const v = this.w[i];
      this.w[i] = goal > v ? Math.min(goal, v + k) : Math.max(goal, v - k);
      if (this.w[i] > 0) active.push(i);
    }
    // Мест не хватает (уровень опустили, взгляд метнулся): лишние гаснут сразу — сначала самые слабые.
    active.sort((a, b) => this.w[b] - this.w[a]);
    for (let j = MAX_LAMPS; j < active.length; j++) this.w[active[j]] = 0;
    this.rank = active.slice(0, MAX_LAMPS);
    return this.rank;
  }
}

/** Цвет огня в линейном виде (0..1 на канал): униформам и огонькам. */
export function lampLinear(kind: LampKind): [number, number, number] {
  const c = LAMP[kind].color;
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [lin((c >> 16) & 255), lin((c >> 8) & 255), lin(c & 255)];
}

/**
 * Свет огня на поверхности — двойник шейдера (`glow/glsl.ts`, `gLamps`) для тестов: спад окном по доле досягаемости,
 * без обрезки и без хвоста за ней; по нормали — Ламберт с узкой обёрткой, со спины ноль.
 */
export function lampFall(d2: number, reach: number): number {
  const x = d2 / (reach * reach);
  if (x >= 1) return 0;
  const win = 1 - x * x;
  return (win * win) / (1 + 9 * x);
}

export const lampFacing = (ndl: number): number => Math.min(1, Math.max(0, ndl * 0.8 + 0.2));

/** Мягкий предел света на пикселе: сколько ни сложи огней, канал не выше `LAMP_KNEE` — камень не выбеливается. */
export const LAMP_KNEE = 1.6;
export const lampKnee = (m: number): number => m / (1 + m / LAMP_KNEE);
