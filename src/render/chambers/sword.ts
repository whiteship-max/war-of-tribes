// Покои правителя (docs/city_v3.md, Г-11): бой мечом в покоях. Меч со стены — в боевую стойку; удар — быстрый взмах пальцем
// или мышью (меч бьёт по этой линии, сила — по скорости взмаха), блок — двойное касание у одной из четырёх сторон экрана;
// частые удары утомляют (выносливость), три удара разными направлениями подряд — сильный; чучело у стены считает попадания.
// Чистый модуль без three: что значит палец, как идёт удар, куда смотрит клинок в осях глаза (x — вправо, y — вверх, глаз
// смотрит в −z) и обо что он бьётся в осях комнаты. Комната (`room.ts`) ставит по нему меч и руку, `drill.ts` рисует
// чучело, след и искры, тест сверяет числа (`sword.test.ts`).
import { Press } from '@/gestures';
import { BED, CHAIR, CHESTS, CHESS, DESK, DOOR, DUMMY, HALF, HEARTH, SHELVES, STANDS, WALL_H } from './plan';

export { DUMMY };
import { onFloor } from './walk';

export type V3 = [number, number, number];

// ---------- Мелочь векторов ----------

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const ease = (k: number): number => {
  const t = clamp(k, 0, 1);
  return t * t * (3 - 2 * t);
};
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ---------- Палец: взмах, взгляд, двойное касание ----------

/** Взмах короче этого (пиксели страницы) — не удар: дрожь пальца и начало взгляда. */
export const SWIPE_MIN = 44;
/** Скорость взмаха за последние `SWIPE_RECENT_MS`, пикселей в мс, с которой ведение — удар, а не взгляд. */
export const SWIPE_SPEED = 0.85;
/** Сила удара — полная с этой скорости взмаха, пикселей в мс (быстрый мах большим пальцем — 3–4). */
export const SWIPE_FULL = 3.2;
/** За сколько мс от касания палец решает, удар он или взгляд: дольше взгляд не ждёт (поворот головы — с задержкой не больше этой). */
export const SWIPE_DECIDE_MS = 130;
/** По какому отрезку пути меряется скорость взмаха, мс. */
const SWIPE_RECENT_MS = 48;
/** Двойное касание: второе — не позже этого после первого и не дальше `DOUBLE_PX` от него. */
export const DOUBLE_MS = 340;
export const DOUBLE_PX = 64;

/** Направление блока и удара на экране. */
export type Side = 'left' | 'right' | 'up' | 'down';

/** Что сказал палец взгляда: повернуть голову на столько пикселей, ударить по линии или ничего. */
export type Verdict = { kind: 'look'; dx: number; dy: number } | { kind: 'slash'; from: [number, number]; to: [number, number]; speed: number };

interface Stroke {
  press: Press;
  /** Пока решается: ведение копится, голова не поворачивается. */
  state: 'wait' | 'look' | 'slash';
  x: number;
  y: number;
  /** Последние точки — скорости взмаха. */
  trail: { x: number; y: number; t: number }[];
  /** Ведение, накопленное, пока палец решал. */
  px: number;
  py: number;
  peak: number;
}

/**
 * Судья пальца взгляда в боевой стойке: взмах — удар, ведение — взгляд, касание — касание. Тап это или ведение по-прежнему
 * решает общий `Press` (`@/gestures`, «один палец — один судья»); своё здесь одно — быстрое ли ведение.
 *
 * Голова не поворачивается, пока палец решает (до `SWIPE_DECIDE_MS`): иначе каждый удар сперва дёргал бы взгляд за
 * пальцем, а потом бросал. Решил «взгляд» — накопленное отдаётся разом, дальше — один к одному.
 */
export class SwipeJudge {
  private strokes = new Map<number, Stroke>();

  down(id: number, x: number, y: number, now: number): void {
    this.strokes.set(id, { press: new Press(id, x, y, now), state: 'wait', x, y, trail: [{ x, y, t: now }], px: 0, py: 0, peak: 0 });
  }

  /** Палец поехал: взгляд (сколько повернуть), удар (один раз за ведение) или пока ничего. */
  move(id: number, x: number, y: number, now: number): Verdict | null {
    const s = this.strokes.get(id);
    if (!s) return null;
    const dx = x - s.x;
    const dy = y - s.y;
    s.x = x;
    s.y = y;
    s.press.move(x, y, now);
    s.trail.push({ x, y, t: now });
    while (s.trail.length > 2 && now - s.trail[1].t > SWIPE_RECENT_MS) s.trail.shift();
    if (s.state === 'look') return { kind: 'look', dx, dy };
    if (s.state === 'slash') return null;
    s.px += dx;
    s.py += dy;
    const v = recentSpeed(s.trail);
    s.peak = Math.max(s.peak, v);
    const far = Math.hypot(x - s.press.x, y - s.press.y);
    if (far >= SWIPE_MIN && v >= SWIPE_SPEED) {
      s.state = 'slash';
      return { kind: 'slash', from: [s.press.x, s.press.y], to: [x, y], speed: s.peak };
    }
    if (now - s.press.t > SWIPE_DECIDE_MS) {
      s.state = 'look';
      const out: Verdict = { kind: 'look', dx: s.px, dy: s.py };
      s.px = 0;
      s.py = 0;
      return out;
    }
    return null;
  }

  /**
   * Палец снят: короткий щелчок, не успевший решиться в ведении, — удар, если был быстрым; иначе накопленное — взгляду.
   * `tap` — касание (для двойного касания блока).
   */
  up(id: number, now: number): { tap: boolean; verdict: Verdict | null } {
    const s = this.strokes.get(id);
    this.strokes.delete(id);
    if (!s) return { tap: false, verdict: null };
    if (s.state === 'wait') {
      const far = Math.hypot(s.x - s.press.x, s.y - s.press.y);
      if (far >= SWIPE_MIN && s.peak >= SWIPE_SPEED) return { tap: false, verdict: { kind: 'slash', from: [s.press.x, s.press.y], to: [s.x, s.y], speed: s.peak } };
      if (s.press.isTap(now)) return { tap: true, verdict: null };
      return { tap: false, verdict: s.px || s.py ? { kind: 'look', dx: s.px, dy: s.py } : null };
    }
    return { tap: false, verdict: null };
  }

  cancel(id: number): void {
    this.strokes.delete(id);
  }

  get busy(): boolean {
    return this.strokes.size > 0;
  }
}

/** Скорость по последнему отрезку пути, пикселей в мс. */
function recentSpeed(trail: readonly { x: number; y: number; t: number }[]): number {
  if (trail.length < 2) return 0;
  const a = trail[0];
  const b = trail[trail.length - 1];
  const dt = Math.max(8, b.t - a.t);
  return Math.hypot(b.x - a.x, b.y - a.y) / dt;
}

/** Сторона экрана, у которой касание: по диагоналям из середины — четыре треугольника. */
export function sideOf(x: number, y: number, w: number, h: number): Side {
  const nx = (x - w / 2) / (w / 2);
  const ny = (y - h / 2) / (h / 2);
  if (Math.abs(nx) >= Math.abs(ny)) return nx < 0 ? 'left' : 'right';
  return ny < 0 ? 'up' : 'down';
}

/** Двойное касание: второе касание рядом с первым и вскоре — блок в сторону экрана, у которой оно. */
export class DoubleTap {
  private last: { x: number; y: number; t: number } | null = null;

  tap(x: number, y: number, now: number, w: number, h: number): Side | null {
    const l = this.last;
    if (l && now - l.t <= DOUBLE_MS && Math.hypot(x - l.x, y - l.y) <= DOUBLE_PX) {
      this.last = null;
      return sideOf((x + l.x) / 2, (y + l.y) / 2, w, h);
    }
    this.last = { x, y, t: now };
    return null;
  }
}

// ---------- Удар, блок, выносливость, комбо ----------

/** Выносливость: удар стоит `COST + COST_POWER × сила` (сильный — ещё `COST_HEAVY`), блок — `COST_BLOCK`. */
export const COST = 0.13;
export const COST_POWER = 0.1;
export const COST_HEAVY = 0.06;
export const COST_BLOCK = 0.05;
/** Удар о камень и железо отдаёт в руку — ещё столько. */
export const COST_JAR = 0.04;
/** Восстанавливается столько в секунду, начиная через `REST_AFTER` с после последней траты. */
export const REGEN = 0.3;
export const REST_AFTER = 0.75;
/** Ниже этого — «устал»: полоса краснеет, удары слабее. */
export const TIRED = 0.25;

/** Комбо: три удара подряд разными направлениями, каждый — не позже этого после начала прежнего, с. */
export const COMBO_GAP = 1.15;
/** Сильный удар бьёт во столько раз сильнее. */
export const HEAVY_K = 1.6;

/** Ход удара: замах (от позы, в которой застал, к началу дуги), дуга, возврат в стойку; с. */
export const WIND = 0.07;
export const SWING = 0.24;
export const SWING_FAST = 0.17;
export const SWING_WEAK = 0.36;
export const RECOVER = 0.3;
/** Дуга клинка в плоскости удара: от и до, радианы от прямо-вперёд (минус — замах назад, против направления удара). */
export const PHI0 = (-80 * Math.PI) / 180;
export const PHI1 = (68 * Math.PI) / 180;
/** Отскок от камня и дерева: назад по дуге на столько, за столько. */
const BOUNCE = { stone: 0.42, iron: 0.42, wood: 0.24, cloth: 0.1 } as const;
const BOUNCE_T = 0.13;
/** Сквозь солому клинок идёт медленнее во столько раз. */
const STRAW_SLOW = 0.5;
/** Блок: встать, держать, вернуться; с. */
export const BLOCK_IN = 0.09;
export const BLOCK_HOLD = 0.36;
export const BLOCK_OUT = 0.16;
/** Из стойки к осмотру и обратно, с (взял в стойку — меч поворачивается в руке). */
export const STANCE_T = 0.4;

/** Обо что бьётся клинок. */
export type Surface = 'stone' | 'iron' | 'wood' | 'cloth' | 'straw';

/** Удар: направление на экране (вниз — плюс y), середина взмаха (доли экрана от середины, вверх — плюс), сила 0…1. */
export interface StrikeSpec {
  dir: [number, number];
  mid: [number, number];
  power: number;
  heavy: boolean;
  weak: boolean;
  side: Side;
}

/** Поза клинка в осях глаза: где кулак (хват), куда клинок, куда смотрит лезвие (ведущая кромка). */
export interface Blade {
  hand: V3;
  axis: V3;
  edge: V3;
}

/** Что случилось за шаг — комнате: звук, искры, солома, отдача. */
export type FightEvent =
  | { kind: 'swing'; spec: StrikeSpec }
  | { kind: 'block'; side: Side }
  | { kind: 'hit'; surface: Surface; at: V3; spec: StrikeSpec }
  | { kind: 'tired' };

type State =
  | { kind: 'guard' }
  | { kind: 'strike'; spec: StrikeSpec; t: number; u: number; slow: number; from: Blade; hit: Surface | null; bounce: { t: number; phi: number } | null; back: number }
  | { kind: 'block'; side: Side; t: number; from: Blade };

/** Класс удара по направлению взмаха: слева направо, справа налево, снизу вверх, сверху вниз — по преобладающей оси. */
export function strikeSide(dx: number, dy: number): Side {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}

/** Сила удара по скорости взмаха (пикселей в мс): от порога удара до полной. */
export function powerOf(speed: number): number {
  return clamp((speed - SWIPE_SPEED) / (SWIPE_FULL - SWIPE_SPEED), 0, 1);
}

/**
 * Бой в покоях: стойка, удар, блок, выносливость, комбо. Время — свои часы (`step`); что случилось — события (`take`).
 * Кто ударил по чучелу — счёт `hits`, сильных — `heavies`.
 */
export class Fight {
  stamina = 1;
  /** Сколько прошло с последней траты, с. */
  private rest = REST_AFTER;
  time = 0;
  hits = 0;
  heavies = 0;
  /** Сколько раз за бой ударил (в воздух и во что-то). */
  swings = 0;
  state: State = { kind: 'guard' };
  /** Удар, пришедший посреди дуги: начнётся, как только дуга кончится. */
  private queued: StrikeSpec | null = null;
  /** Последние удары: класс направления и когда начаты — комбо. */
  private history: { side: Side; at: number }[] = [];
  /** Доля стойки 0 (меч рассматривают) … 1 (в стойке); `sheathe` — убирают. */
  stance = 0;
  sheathe = false;
  private events: FightEvent[] = [];
  private wasTired = false;
  /** Стена или мебель у самого клинка стойки: меч поднят к плечу (0…1), а не воткнут в камень. */
  crowd = 0;

  /** Взмах пальцем: `dx`, `dy` — в пикселях, `mid` — середина взмаха долями экрана от середины (вверх — плюс). */
  strike(dx: number, dy: number, mid: [number, number], speed: number): StrikeSpec | null {
    if (this.sheathe || this.stance < 0.6) return null;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;
    const side = strikeSide(dx, dy);
    let power = powerOf(speed);
    // Комбо: два прежних удара — недавно и каждый своим направлением, третий — третьим.
    const h = this.history;
    const prev = h.slice(-2);
    const heavy = prev.length === 2 && this.time - prev[1].at <= COMBO_GAP && prev[1].at - prev[0].at <= COMBO_GAP && new Set([prev[0].side, prev[1].side, side]).size === 3;
    const cost = COST + COST_POWER * power + (heavy ? COST_HEAVY : 0);
    const weak = this.stamina < cost;
    if (weak) power *= 0.4;
    const spec: StrikeSpec = { dir: [dx / len, dy / len], mid: [clamp(mid[0], -1, 1), clamp(mid[1], -1, 1)], power, heavy: heavy && !weak, weak, side };
    const st = this.state;
    // Посреди дуги — в очередь (одна): удар не обрывается на взлёте.
    if (st.kind === 'strike' && !st.bounce && st.u < 1 && st.t >= WIND) {
      this.queued = spec;
      return spec;
    }
    this.begin(spec);
    return spec;
  }

  private begin(spec: StrikeSpec): void {
    const cost = COST + COST_POWER * (spec.weak ? 0 : spec.power) + (spec.heavy ? COST_HEAVY : 0);
    this.spend(cost);
    this.swings++;
    if (spec.heavy || spec.weak) this.history = [];
    else {
      this.history.push({ side: spec.side, at: this.time });
      if (this.history.length > 3) this.history.shift();
    }
    this.state = { kind: 'strike', spec, t: 0, u: 0, slow: 1, from: this.blade(), hit: null, bounce: null, back: 0 };
    this.events.push({ kind: 'swing', spec });
  }

  /** Двойное касание у стороны экрана — блок в эту сторону. Посреди дуги удара блока нет: меч уже летит. */
  block(side: Side): boolean {
    if (this.sheathe || this.stance < 0.6) return false;
    const st = this.state;
    if (st.kind === 'strike' && st.u < 1 && !st.bounce) return false;
    this.spend(COST_BLOCK);
    this.queued = null;
    this.state = { kind: 'block', side, t: 0, from: this.blade() };
    this.events.push({ kind: 'block', side });
    return true;
  }

  private spend(c: number): void {
    this.stamina = Math.max(0, this.stamina - c);
    this.rest = 0;
  }

  /** Клинок встретил то, что `surface`: отскок от камня и дерева, сквозь солому — медленнее. Один раз за удар. */
  hit(surface: Surface, at: V3): void {
    const st = this.state;
    if (st.kind !== 'strike' || st.hit || st.bounce) return;
    st.hit = surface;
    const spec = st.spec;
    this.events.push({ kind: 'hit', surface, at, spec });
    if (surface === 'straw') {
      st.slow = STRAW_SLOW;
      this.hits++;
      if (spec.heavy) this.heavies++;
      return;
    }
    if (surface === 'stone' || surface === 'iron') this.spend(COST_JAR);
    st.bounce = { t: 0, phi: phiOf(st.u) };
    // Отскок не ждёт очереди: удар, пришедший посреди дуги, начнётся после него.
  }

  /** Убрать меч: стойка гаснет к осмотру (комната ведёт к стене). */
  stow(): void {
    this.sheathe = true;
    this.queued = null;
  }

  /** Передумал убирать (палец движения перехватил путь к стене): снова в стойку. */
  draw(): void {
    this.sheathe = false;
  }

  step(dt: number): void {
    this.time += dt;
    this.rest += dt;
    if (this.rest >= REST_AFTER) this.stamina = Math.min(1, this.stamina + REGEN * dt);
    const tired = this.stamina < TIRED;
    if (tired && !this.wasTired) this.events.push({ kind: 'tired' });
    this.wasTired = tired;
    this.stance = clamp(this.stance + (this.sheathe ? -dt : dt) / STANCE_T, 0, 1);
    const st = this.state;
    if (st.kind === 'strike') {
      st.t += dt;
      if (st.bounce) {
        st.bounce.t += dt;
        if (st.bounce.t >= BOUNCE_T + RECOVER) this.toGuard();
        return;
      }
      if (st.t > WIND) {
        const len = st.spec.weak ? SWING_WEAK : SWING - (SWING - SWING_FAST) * st.spec.power;
        st.u = Math.min(1, st.u + ((st.t - WIND - Math.max(0, st.t - dt - WIND)) / len) * st.slow);
      }
      if (st.u >= 1) {
        if (this.queued) {
          const q = this.queued;
          this.queued = null;
          this.begin(q);
          return;
        }
        // Возврат в стойку — от конца дуги.
        st.back += dt;
        if (st.back >= RECOVER) this.toGuard();
      }
      return;
    }
    if (st.kind === 'block') {
      st.t += dt;
      if (st.t >= BLOCK_IN + BLOCK_HOLD + BLOCK_OUT) this.toGuard();
    }
  }

  /**
   * Шаг с клинком в комнате: дуга — мелкими шагами (быстрый мах не проносит клинок сквозь столб), в рубящей части — встреча
   * с тем, что под клинком (`contact`); у стены и мебели стойка поднимает меч к плечу.
   */
  advance(dt: number, eye: Eye, view: View = PHONE_VIEW): void {
    const n = Math.max(1, Math.ceil(dt / SUBSTEP));
    for (let i = 0; i < n; i++) {
      this.step(dt / n);
      if (this.cutting) {
        const c = contact(eye, this.blade(view));
        if (c) this.hit(c.surface, c.at);
      }
    }
    const near = contact(eye, guardBlade(this.time)) ? 1 : 0;
    this.crowd += (near - this.crowd) * (1 - Math.exp(-dt * 8));
  }

  private toGuard(): void {
    const q = this.queued;
    this.queued = null;
    this.state = { kind: 'guard' };
    if (q) this.begin(q);
  }

  /** Забрать события шага. */
  take(): FightEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Клинок в активной части дуги — бьёт (на замахе и на возврате — нет). */
  get cutting(): boolean {
    const st = this.state;
    return st.kind === 'strike' && !st.bounce && st.t > WIND && st.u > 0.12 && st.u < 0.97;
  }

  /** Сила этого удара для отдачи и звука: 0…1 с сильным — до `HEAVY_K`. */
  get force(): number {
    const st = this.state;
    if (st.kind !== 'strike') return 0;
    const s = st.spec;
    return (0.45 + 0.55 * s.power) * (s.heavy ? HEAVY_K : 1) * (s.weak ? 0.5 : 1);
  }

  /** Поза клинка сейчас (без доли стойки: её смешивает комната с позой осмотра). `view` — тангенсы полуполей кадра. */
  blade(view: View = PHONE_VIEW): Blade {
    const st = this.state;
    const guard = this.crowd > 0.001 ? mixBlade(guardBlade(this.time), RAISED, this.crowd) : guardBlade(this.time);
    switch (st.kind) {
      case 'guard':
        return guard;
      case 'block': {
        const pose = blockBlade(st.side);
        if (st.t < BLOCK_IN) return mixBlade(st.from, pose, ease(st.t / BLOCK_IN));
        if (st.t < BLOCK_IN + BLOCK_HOLD) return pose;
        return mixBlade(pose, guard, ease((st.t - BLOCK_IN - BLOCK_HOLD) / BLOCK_OUT));
      }
      case 'strike': {
        const s = st.spec;
        if (st.bounce) {
          const b = st.bounce;
          const back = st.hit && st.hit !== 'straw' ? BOUNCE[st.hit] : 0.2;
          const phi = b.phi - back * ease(Math.min(1, b.t / BOUNCE_T));
          const at = swingBlade(s, phi, view);
          if (b.t <= BOUNCE_T) return at;
          return mixBlade(swingBlade(s, b.phi - back, view), guard, ease((b.t - BOUNCE_T) / RECOVER));
        }
        if (st.t <= WIND) return mixBlade(st.from, swingBlade(s, PHI0, view), ease(st.t / WIND));
        if (st.u < 1) return swingBlade(s, phiOf(st.u), view);
        return mixBlade(swingBlade(s, PHI1, view), guard, ease(st.back / RECOVER));
      }
    }
  }
}

/** Угол дуги на доле удара: разгон и торможение (махом, а не по линейке). */
export const phiOf = (u: number): number => PHI0 + (PHI1 - PHI0) * swingEase(u);
const swingEase = (u: number): number => (1 - Math.cos(Math.PI * clamp(u, 0, 1))) / 2;

/** Тангенсы половин поля зрения кадра — середина взмаха на экране становится направлением в осях глаза. */
export interface View {
  tanH: number;
  tanV: number;
}
/** Телефон 390×844 при поле 70°: тангенс по вертикали 0,70, по горизонтали — ×390/844. */
export const PHONE_VIEW: View = { tanV: Math.tan((35 * Math.PI) / 180), tanH: Math.tan((35 * Math.PI) / 180) * (390 / 844) };

/** Стойка: кулак у правого бедра-пояса, клинок вверх, влево и вперёд — острие над серединой кадра; дыхание качает. */
export function guardBlade(t: number): Blade {
  const br = Math.sin(t * 1.6) * 0.006;
  const hand: V3 = [0.1, -0.26 + br, -0.45];
  const axis = norm([-0.27, 0.74, -0.62]);
  return ortho(hand, axis, [0, 0.3, 1]);
}

/** Стойка у стены: меч поднят к плечу клинком вверх — у камня он не торчит сквозь стену. */
const RAISED: Blade = ortho([0.07, -0.21, -0.3], norm([-0.16, 1, -0.22]), [0, 0, 1]);

/** Шаг проверки клинка, с: за него острие проходит не больше 4 см (дуга 0,17 с, острие — 1 м от плеча). */
const SUBSTEP = 1 / 240;

/**
 * Дуга удара: плоскость — направление взмаха на экране и «середина дуги» `n`: клинок посреди дуги смотрит к середине
 * взмаха и вверх от его линии (кулак — ниже острия), а не в глаз остриём, — так его видно во всю длину. На угле `phi`
 * клинок смотрит `cos φ` к `n` и `sin φ` по взмаху, кромка ведёт по дуге; кулак идёт по той же линии и посреди дуги
 * выносится вперёд — рука выпрямляется в ударе.
 */
export function swingBlade(s: StrikeSpec, phi: number, view: View): Blade {
  const f = norm([s.mid[0] * view.tanH * 0.8, s.mid[1] * view.tanV * 0.8, -1]);
  const d0: V3 = [s.dir[0], -s.dir[1], 0];
  const d = norm(sub(d0, scale(f, dot(d0, f))));
  // Поперёк взмаха на экране — вверх или влево (правая рука: кулак снизу справа, острие — выше и левее).
  const p1: V3 = [-d[1], d[0], 0];
  const perp = p1[1] - 0.5 * p1[0] >= 0 ? p1 : scale(p1, -1);
  const n0 = add(scale(f, MID_FWD), scale(perp, MID_UP));
  const n = norm(sub(n0, scale(d, dot(n0, d))));
  const c = Math.cos(phi);
  const sn = Math.sin(phi);
  const axis = norm(add(scale(n, c), scale(d, sn)));
  const edge = norm(add(scale(n, -sn), scale(d, c)));
  const hc: V3 = [0.06 + s.mid[0] * 0.05, -0.2 + s.mid[1] * 0.06, -0.38];
  const hand = add(add(hc, scale(d, 0.2 * sn)), scale(f, 0.2 * c));
  return { hand, axis, edge };
}

/** Посреди дуги клинок смотрит столько к середине взмаха и столько вверх от линии взмаха. */
const MID_FWD = 0.6;
const MID_UP = 0.8;

/** Позы блока: вверх — клинок поперёк над глазами, в стороны — стоймя у края кадра, вниз — наискось к полу. */
export function blockBlade(side: Side): Blade {
  switch (side) {
    case 'up':
      return ortho([0.2, 0.06, -0.4], norm([-1, 0.14, -0.22]), [0, 1, 0]);
    case 'left':
      return ortho([-0.15, -0.2, -0.4], norm([-0.08, 1, -0.28]), [-1, 0, 0]);
    case 'right':
      return ortho([0.17, -0.2, -0.38], norm([0.06, 1, -0.32]), [1, 0, 0]);
    case 'down':
      return ortho([0.12, -0.1, -0.4], norm([-0.5, -0.82, -0.3]), [0, -1, 0]);
  }
}

/** Смешать две позы: кулак — по прямой, клинок и кромка — по дуге (снова ортогональны). */
export function mixBlade(a: Blade, b: Blade, k: number): Blade {
  const hand = add(scale(a.hand, 1 - k), scale(b.hand, k));
  const axis = slerpDir(a.axis, b.axis, k);
  const edge = add(scale(a.edge, 1 - k), scale(b.edge, k));
  return ortho(hand, axis, edge);
}

/** Поза с кромкой, перпендикулярной клинку (Грам — Шмидт от данного направления). */
function ortho(hand: V3, axis: V3, edgeHint: V3): Blade {
  let e = sub(edgeHint, scale(axis, dot(edgeHint, axis)));
  if (len(e) < 1e-6) e = sub([0, 0, 1], scale(axis, axis[2]));
  return { hand, axis, edge: norm(e) };
}

function slerpDir(a: V3, b: V3, k: number): V3 {
  const c = clamp(dot(a, b), -1, 1);
  const w = Math.acos(c);
  if (w < 1e-4) return norm(add(scale(a, 1 - k), scale(b, k)));
  const s = Math.sin(w);
  return norm(add(scale(a, Math.sin((1 - k) * w) / s), scale(b, Math.sin(k * w) / s)));
}

/** Середина взмаха на экране — доли от середины (вверх — плюс). */
export function midOf(from: [number, number], to: [number, number], w: number, h: number): [number, number] {
  const x = (from[0] + to[0]) / 2;
  const y = (from[1] + to[1]) / 2;
  return [(x - w / 2) / (w / 2), -(y - h / 2) / (h / 2)];
}

// ---------- Обо что бьётся клинок ----------


/** Твёрдое в покоях: короб или столб с высотой и тем, из чего он. */
type Solid = { kind: 'box'; x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; s: Surface } | { kind: 'disc'; x: number; z: number; r: number; y0: number; y1: number; s: Surface };

const boxOf = (b: { x0: number; z0: number; x1: number; z1: number }, y1: number, s: Surface, y0 = 0): Solid => ({ kind: 'box', x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, y0, y1, s });

/**
 * Мебель и камин для клинка — коробками с высотой (план — `walk.OBSTACLES`, высоты — `plan.ts`). Хрупкое (кубок, свечи,
 * шахматы) лежит на столешнице и столике: клинок встречает их опору раньше — дерево — и не ломает ничего.
 */
export const SOLIDS: readonly Solid[] = [
  boxOf({ x0: -DESK.w / 2, z0: DESK.z - DESK.d / 2, x1: DESK.w / 2, z1: DESK.z + DESK.d / 2 }, DESK.top + 0.14, 'wood'),
  boxOf({ x0: CHAIR.x - 0.34, z0: CHAIR.z - 0.29, x1: CHAIR.x + 0.34, z1: CHAIR.z + 0.27 }, 1.18, 'wood'),
  boxOf(BED, BED.canopy, 'cloth'),
  boxOf({ x0: -HEARTH.mouthW / 2 - 0.47, z0: -HALF - 1, x1: HEARTH.mouthW / 2 + 0.47, z1: -HALF + 0.72 }, HEARTH.hoodTop, 'stone'),
  boxOf({ x0: 1.86, z0: -HALF - 1, x1: 2.52, z1: -4.4 }, 0.62, 'wood'),
  boxOf({ x0: -1.74, z0: -HALF - 1, x1: -1.36, z1: -4.55 }, 1.05, 'iron'),
  ...CHESTS.map((c) => boxOf(c, c.h + 0.1, 'wood')),
  ...SHELVES.map((s) => boxOf(s, s.h, 'wood')),
  { kind: 'disc', x: CHESS.x, z: CHESS.z, r: 0.43, y0: 0, y1: CHESS.top + 0.12, s: 'wood' },
  { kind: 'disc', x: CHESS.x - 0.75, z: CHESS.z + 0.1, r: 0.2, y0: 0, y1: 0.48, s: 'wood' },
  { kind: 'disc', x: CHESS.x + 0.75, z: CHESS.z - 0.1, r: 0.2, y0: 0, y1: 0.48, s: 'wood' },
  ...STANDS.map((s) => ({ kind: 'disc' as const, x: s.x, z: s.z, r: s.r * 0.6, y0: 0, y1: 1.35, s: 'iron' as const })),
  // Чучело: тело, голова и руки — солома; столб над головой и под телом — дерево.
  { kind: 'disc', x: DUMMY.x, z: DUMMY.z, r: DUMMY.r, y0: DUMMY.y0, y1: DUMMY.y1, s: 'straw' },
  { kind: 'disc', x: DUMMY.x, z: DUMMY.z, r: DUMMY.head.r, y0: DUMMY.head.y - DUMMY.head.r, y1: DUMMY.head.y + DUMMY.head.r, s: 'straw' },
  { kind: 'box', x0: DUMMY.x - 0.07, z0: DUMMY.z - DUMMY.arms.half, x1: DUMMY.x + 0.07, z1: DUMMY.z + DUMMY.arms.half, y0: DUMMY.arms.y - 0.06, y1: DUMMY.arms.y + 0.06, s: 'straw' },
  { kind: 'disc', x: DUMMY.x, z: DUMMY.z, r: 0.05, y0: 0, y1: DUMMY.top, s: 'wood' },
];

/** Из чего то, что в точке комнаты: мебель, чучело, стена (камень; дверь — дерево), пол (доски); `null` — воздух. */
export function surfaceAt(p: V3): Surface | null {
  const [x, y, z] = p;
  for (const o of SOLIDS) {
    if (y < o.y0 || y > o.y1) continue;
    if (o.kind === 'box' ? x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1 : Math.hypot(x - o.x, z - o.z) <= o.r) return o.s;
  }
  if (y <= 0.005) return 'wood';
  if (y >= WALL_H) return 'stone';
  if (!onFloor(x, z, 0)) return z < -HALF + 0.01 && Math.abs(x - DOOR.x) < DOOR.w / 2 && y < DOOR.h ? 'wood' : 'stone';
  return null;
}

/** Глаз в осях комнаты: место и взгляд (`yaw` 0 — на юг, плюс — к востоку; `pitch` плюс — вверх). */
export interface Eye {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** Точка осей глаза → оси комнаты. */
export function toRoom(e: Eye, p: V3): V3 {
  const cp = Math.cos(e.pitch);
  const f: V3 = [Math.sin(e.yaw) * cp, Math.sin(e.pitch), Math.cos(e.yaw) * cp];
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  return [e.x + r[0] * p[0] + u[0] * p[1] - f[0] * p[2], e.y + r[1] * p[0] + u[1] * p[1] - f[1] * p[2], e.z + r[2] * p[0] + u[2] * p[1] - f[2] * p[2]];
}

/** Клинок от хвата: от этой доли длины до острия — то, чем рубят (у перекрестья не рубят). */
export const BLADE_FROM = 0.17;
export const BLADE_TO = 0.72;

/**
 * Встретил ли клинок что-нибудь: точки по клинку от `BLADE_FROM` до острия — первая, что внутри твёрдого (от хвата к
 * острию). `null` — рубит воздух.
 */
export function contact(e: Eye, b: Blade): { surface: Surface; at: V3 } | null {
  for (let i = 0; i <= 6; i++) {
    const l = BLADE_FROM + ((BLADE_TO - BLADE_FROM) * i) / 6;
    const at = toRoom(e, add(b.hand, scale(b.axis, l)));
    const s = surfaceAt(at);
    if (s) return { surface: s, at };
  }
  return null;
}
