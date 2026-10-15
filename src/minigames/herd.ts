/**
 * «Скот»: загон, стадо и правило кормёжки (docs/minigames.md, раздел 6).
 *
 * ГДЕ ЖИВОТНОЕ — ЧИСТАЯ ФУНКЦИЯ ОТ ЗЕРНА И ВРЕМЕНИ СЦЕНЫ. Бредёт оно по плавной кривой из синусов разной частоты:
 * на глаз она не повторяется, а повторить её можно всегда — тем же зерном и той же секундой (`beastAt`). Овцы
 * держатся кучей вокруг общей середины, козы петляют быстро и поодиночке, корова еле идёт. Накормленное ложится там,
 * где его накормили: место — та же функция в минуту кормёжки. `Math.random` здесь нет.
 *
 * Тап по стогу рядом — охапка в руках; тап по животному рядом с охапкой — оно ест. Овце и козе — одна охапка,
 * корове — три. Всё это кадр: в сохранение не попадает ничего, в партию уходит только счёт (`sim/minigames.harvest`).
 */
import { mixSeed } from '@/game/sim/random';
import { seeded } from './rules';

/** Ягнёнок — редкий (`LAMB_P`): родился в эту ночь и бегает за овцами. */
export type BeastKind = 'sheep' | 'goat' | 'cow' | 'lamb';

export interface BeastLook {
  /** Имя в подписи прицела — винительным: «накормить овцу». */
  name: string;
  /** Сколько охапок нужно. */
  need: number;
  /** Толщина: тело игрока его не проходит, досягаемость — от края. */
  r: number;
}

export const BEASTS: Record<BeastKind, BeastLook> = {
  sheep: { name: 'овцу', need: 1, r: 0.42 },
  goat: { name: 'козу', need: 1, r: 0.38 },
  cow: { name: 'корову', need: 3, r: 0.75 },
  lamb: { name: 'ягнёнка', need: 1, r: 0.28 },
};

/**
 * Редкая добыча «Скота» — ягнёнок: в загоне раз в три выхода (`LAMB_P`). Скачет вокруг овечьей кучи шире и быстрее
 * овец, но не быстрее человека; охапка одна, а идёт она вдвойне (`LAMB_WORTH`) — приплод стада. Вся его доля —
 * прибавка, и в знаменатель она легла целиком (`rules.Tally`): основной счёт — прежние десять охапок.
 */
export const LAMB_P = 1 / 3;
export const LAMB_WORTH = 2;

/** Что меняет загон сверх прежнего: редкий ягнёнок. По умолчанию — прежний загон; игра зовёт с `rare: true`. */
export interface HerdTwists {
  rare: boolean;
}

/** Кто в загоне: четыре овцы, три козы и корова — десять охапок. */
export const HERD: readonly BeastKind[] = ['sheep', 'sheep', 'sheep', 'sheep', 'goat', 'goat', 'goat', 'cow'];

/** Радиус загона по жердям. За ним — поляна и лес, но из загона не выходят. */
export const PEN_R = 7.5;
/** Стог — посредине, круг преграды. */
export const HAY = { x: 0, z: 0, r: 0.85 };
/** Где бродит скот: не ближе к стогу и не ближе к жердям, чем это. */
export const ROAM_IN = 2.3;
export const ROAM_OUT = PEN_R - 0.7;

/** Волна кривой: амплитуда, частота (рад/с), фаза. */
type Wave = readonly [number, number, number];

export interface Beast {
  id: number;
  kind: BeastKind;
  /** Угол и радиус середины пути. */
  a0: number;
  r0: number;
  /** Куда тянет по кругу и как быстро, рад/с. */
  drift: number;
  /** Волны угла и радиуса. */
  aw: readonly Wave[];
  rw: readonly Wave[];
  /** Овца — в куче: свой сдвиг от общей середины. */
  flock: boolean;
}

/** Общая середина овечьей кучи — тоже от зерна. */
export interface Herd {
  beasts: Beast[];
  flock: { a0: number; r0: number; drift: number; aw: readonly Wave[]; rw: readonly Wave[] };
  /** Сколько охапок нужно всем: знаменатель счёта. */
  total: number;
}

const wave = (rnd: () => number, amp: number, freq: number): Wave => [amp * (0.75 + 0.5 * rnd()), freq * (0.8 + 0.4 * rnd()), rnd() * Math.PI * 2];

/**
 * Стадо по зерну. Ягнёнок встаёт после прежнего стада своим генератором (`mixSeed(seed, 1)`): места и пути
 * остальных у каждого зерна прежние.
 */
export function herdOf(seed: number, twists: HerdTwists = { rare: false }): Herd {
  const h = herdClassic(seed);
  if (!twists.rare) return h;
  const rnd = seeded(mixSeed(seed >>> 0, 1));
  if (rnd() >= LAMB_P) return h;
  // Скачет вокруг середины овечьей кучи: шире и чаще овцы, петлями — то к стогу, то к жердям.
  h.beasts.push({
    id: h.beasts.length,
    kind: 'lamb',
    a0: (rnd() - 0.5) * 0.6,
    r0: rnd() < 0.5 ? -0.9 : 0.9,
    drift: 0,
    aw: [wave(rnd, 0.32, 0.42), wave(rnd, 0.1, 1.1)],
    rw: [wave(rnd, 0.9, 0.38), wave(rnd, 0.3, 0.9)],
    flock: true,
  });
  return h;
}

/** Прежнее стадо: четыре овцы, три козы и корова. */
function herdClassic(seed: number): Herd {
  const rnd = seeded(seed);
  const sign = (): number => (rnd() < 0.5 ? -1 : 1);
  const flock = {
    a0: rnd() * Math.PI * 2,
    r0: 4.6,
    drift: sign() * 0.05,
    aw: [wave(rnd, 0.35, 0.12)],
    rw: [wave(rnd, 1.0, 0.09)],
  };
  let total = 0;
  let sheep = 0;
  // Знаменатель — прежние десять охапок: ягнёнок (`herdOf`) — прибавка, `herdBonusMax`.
  const beasts = HERD.map((kind, id): Beast => {
    total += BEASTS[kind].need;
    if (kind === 'sheep') {
      // Место в куче — своё у каждой: по дуге через шаг и то ближе, то дальше от стога. Без мест куча слипалась в
      // одно тело (поймано снимком стенда); качание вокруг места малое — куча, а не строй.
      const k = sheep++;
      return { id, kind, a0: (k - 1.5) * 0.28, r0: k % 2 ? 0.55 : -0.55, drift: 0, aw: [wave(rnd, 0.04, 0.5)], rw: [wave(rnd, 0.2, 0.4)], flock: true };
    }
    if (kind === 'goat') {
      return {
        id,
        kind,
        a0: rnd() * Math.PI * 2,
        r0: 4.4 + rnd() * 1.2,
        // Самая быстрая коза на самом длинном плече — около двух метров в секунду: человек (2,6) её догонит.
        drift: sign() * (0.05 + 0.02 * rnd()),
        aw: [wave(rnd, 0.35, 0.28), wave(rnd, 0.08, 0.7)],
        rw: [wave(rnd, 1.2, 0.26), wave(rnd, 0.35, 0.65)],
        flock: false,
      };
    }
    return { id, kind, a0: rnd() * Math.PI * 2, r0: 4.2, drift: 0, aw: [wave(rnd, 0.25, 0.05)], rw: [wave(rnd, 0.6, 0.07)], flock: false };
  });
  return { beasts, flock, total };
}

const sum = (ws: readonly Wave[], t: number): number => ws.reduce((n, [a, f, p]) => n + a * Math.sin(f * t + p), 0);

/** Где животное в секунду `t` сцены — если его ещё не накормили. */
export function roamAt(h: Herd, b: Beast, t: number): { x: number; z: number } {
  let a = b.a0 + b.drift * t + sum(b.aw, t);
  let r = b.r0 + sum(b.rw, t);
  if (b.flock) {
    a += h.flock.a0 + h.flock.drift * t + sum(h.flock.aw, t);
    r += h.flock.r0 + sum(h.flock.rw, t);
  }
  const k = BEASTS[b.kind].r;
  r = Math.max(ROAM_IN + k, Math.min(ROAM_OUT - k, r));
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

/** Куда смотрит животное: по ходу. Стоящее — туда, куда шло последние полторы секунды. */
export function roamYaw(h: Herd, b: Beast, t: number): number {
  const p = roamAt(h, b, t);
  let q = roamAt(h, b, t + 0.25);
  if (Math.hypot(q.x - p.x, q.z - p.z) < 0.01) {
    const back = roamAt(h, b, t - 1.5);
    q = { x: p.x + (p.x - back.x), z: p.z + (p.z - back.z) };
  }
  return Math.atan2(q.x - p.x, q.z - p.z);
}

/** Насколько быстро идёт, м/с — только вид: качает шаг. */
export function roamSpeed(h: Herd, b: Beast, t: number): number {
  const p = roamAt(h, b, t);
  const q = roamAt(h, b, t + 0.1);
  return Math.hypot(q.x - p.x, q.z - p.z) / 0.1;
}

/** Кормёжка: что в руках и кто сколько съел. Живёт в кадре — в сохранение не идёт ничего. */
export class Feed {
  carrying = false;
  /** Сколько охапок отдано каждому. */
  readonly given: number[];
  /** Когда животное наелось, секунды сцены; не наелось — null. */
  readonly fedAt: (number | null)[];
  got = 0;
  /** Сверху: накормленный ягнёнок. */
  bonus = 0;

  constructor(private herd: Herd) {
    this.given = herd.beasts.map(() => 0);
    this.fedAt = herd.beasts.map(() => null);
  }

  /** Взять охапку из стога. Руки заняты — нечем. */
  take(): boolean {
    if (this.carrying) return false;
    this.carrying = true;
    return true;
  }

  /** Отдать охапку. Без охапки и сытому — ничего. */
  feed(id: number, t: number): boolean {
    const b = this.herd.beasts[id];
    if (!b || !this.carrying || this.given[id] >= BEASTS[b.kind].need) return false;
    this.carrying = false;
    this.given[id]++;
    if (b.kind === 'lamb') this.bonus += LAMB_WORTH;
    else this.got++;
    if (this.given[id] >= BEASTS[b.kind].need) this.fedAt[id] = t;
    return true;
  }

  /** Где животное сейчас: бредёт — по кривой; наелось — где наелось. */
  at(id: number, t: number): { x: number; z: number } {
    const b = this.herd.beasts[id];
    const fed = this.fedAt[id];
    return roamAt(this.herd, b, fed ?? t);
  }

  sated(id: number): boolean {
    return this.fedAt[id] !== null;
  }
}

/** Сколько прибавки было можно взять в загоне: ягнёнок, если он есть. */
export const herdBonusMax = (h: Herd): number => h.beasts.filter((b) => b.kind === 'lamb').length * LAMB_WORTH;
