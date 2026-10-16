// Часы ролика боя — журнал на секундах экрана (docs/gfx.md, «Часы»). Чистые, без three.
//
// Время боя ведёт раскадровка ядра (`battle/replay.buildCast`): такты (построение, сближение, сеча, бегство), фазы на
// секундах, мгновения слома, потери по фазам. Ролик берёт её целиком и только перекладывает на свои секунды: такт за
// тактом, прямой внутри такта. Поэтому темп потерь и порядок слома — те же, что у отчёта, а длина — своя: ролик в поле
// идёт **от 15 до 40 секунд** (слово владельца, задание ГФ-1), и спорный бой длиннее разгрома.
//
// Своих чисел исхода у часов нет: длина сечи выводится из длины сечи раскадровки (а та — из спорности боя и числа меток
// журнала, `MELEE_SECONDS`), прямой из её отрезка в свой. После конца боя часы стоят: развязка (`CODA_SECONDS`) — поле
// после боя, павшие лежат, победитель ликует; ни одного события журнала на ней нет.
import { MELEE_SECONDS, type Cast } from '@/battle/replay';

/** Вступление: построение, залпы и сближение до сшибки (такты `muster` и `pullback` раскадровки). */
export const INTRO_SECONDS = 7;
/** Сеча (такт `melee`): разгром — короче, ровный бой — длиннее; прямой от отрезка раскадровки `MELEE_SECONDS`. */
export const MELEE_REEL = { min: 5, max: 24 } as const;
/** Бегство и погоня (такт `rout`). */
export const ROUT_SECONDS = 4;
/** Развязка после боя: поле, павшие, знамёна победителя; журнал на ней молчит. */
export const CODA_SECONDS = 3;
/** Границы ролика в поле — слово владельца (задание ГФ-1); держит тест часов. */
export const MIN_SECONDS = 15;
export const MAX_SECONDS = 40;

export interface ReelTiming {
  /** Конец вступления в секундах ролика и раскадровки. */
  intro: number;
  castIntro: number;
  /** Сеча: в ролике и в раскадровке. */
  melee: [number, number];
  castMelee: [number, number];
  /** Бегство. */
  rout: [number, number];
  castRout: [number, number];
  /** Бой кончился: дальше — развязка, часы раскадровки стоят на её конце. */
  end: number;
  /** Весь ролик с развязкой. */
  seconds: number;
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** Длина сечи ролика по длине сечи раскадровки: прямой из `MELEE_SECONDS` в `MELEE_REEL`. */
export function meleeReel(castMelee: number): number {
  const u = clamp((castMelee - MELEE_SECONDS.min) / (MELEE_SECONDS.max - MELEE_SECONDS.min), 0, 1);
  return Math.round((MELEE_REEL.min + u * (MELEE_REEL.max - MELEE_REEL.min)) * 100) / 100;
}

/** Часы ролика для раскадровки. */
export function reelTiming(cast: Cast): ReelTiming {
  const melee = cast.acts.find((a) => a.act === 'melee')!;
  const rout = cast.acts.find((a) => a.act === 'rout')!;
  const intro = INTRO_SECONDS;
  const m = meleeReel(melee.to - melee.from);
  const end = intro + m + ROUT_SECONDS;
  return {
    intro,
    castIntro: melee.from,
    melee: [intro, intro + m],
    castMelee: [melee.from, melee.to],
    rout: [intro + m, end],
    castRout: [rout.from, rout.to],
    end,
    seconds: end + CODA_SECONDS,
  };
}

/** Доля отрезка `[a, b]`, пройденная к `v`. */
const share = (v: number, a: number, b: number): number => clamp((v - a) / Math.max(1e-6, b - a), 0, 1);

/** Секунда раскадровки на секунде ролика. На развязке — конец боя. */
export function reelToCast(tm: ReelTiming, t: number): number {
  if (t <= tm.intro) return share(t, 0, tm.intro) * tm.castIntro;
  if (t <= tm.melee[1]) return tm.castMelee[0] + share(t, tm.melee[0], tm.melee[1]) * (tm.castMelee[1] - tm.castMelee[0]);
  return tm.castRout[0] + share(t, tm.rout[0], tm.rout[1]) * (tm.castRout[1] - tm.castRout[0]);
}

/** И обратно: секунда ролика на секунде раскадровки. Конец боя — конец бегства, не развязки. */
export function castToReel(tm: ReelTiming, c: number): number {
  if (c <= tm.castIntro) return share(c, 0, tm.castIntro) * tm.intro;
  if (c <= tm.castMelee[1]) return tm.melee[0] + share(c, tm.castMelee[0], tm.castMelee[1]) * (tm.melee[1] - tm.melee[0]);
  return tm.rout[0] + share(c, tm.castRout[0], tm.castRout[1]) * (tm.rout[1] - tm.rout[0]);
}

/** Секунда раскадровки на тике боя: тик ищет фазу, в чьи тики попал, как метки журнала (`battle/replay.markLog`). */
export function castTimeOfTick(cast: Cast, tick: number): number {
  const span = cast.spans.find((s) => tick >= s.from && tick <= s.to) ?? cast.spans[cast.spans.length - 1];
  const len = Math.max(1, span.to - span.from + 1);
  return span.t0 + (span.t1 - span.t0) * clamp((tick - span.from) / len, 0, 1);
}
