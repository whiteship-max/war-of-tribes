/**
 * «Охота»: поле, олени, лук и стрела (docs/minigames.md, раздел 13).
 *
 * МОДУЛЬ ЧИСТЫЙ: ни three, ни DOM, ни часов. Время приходит доводом — секунды сцены с «Начать» (`t`), а всё, что
 * решает игра, выводится из зерна (`sim/minigames.minigameSeed`) и того, что сделал игрок: где он шёл и куда пустил
 * стрелу. Поэтому правила держит тест, а не снимок.
 *
 * ГДЕ ОЛЕНЬ — ФУНКЦИЯ ОТ ЗЕРНА И ВЕСТЕЙ. У каждого оленя — список отрезков жизни: пасётся, насторожился, бежит,
 * лёг, ушёл в лес (`Seg`). Внутри отрезка место — чистая функция секунды: пасётся по плавной кривой из синусов от
 * зерна, бежит по прямой с разгоном, насторожившийся стоит. Новый отрезок заводит только весть — шаг, тетива, стук
 * стрелы, упавший сосед — и только с её секунды: прошлое оленя не переписывается никогда. Тот же ряд вестей —
 * те же олени, с какой бы частотой ни шли кадры (тест).
 *
 * СТРЕЛА ЛЕТИТ ПО ДУГЕ. Скорость — от натяжки, падение — тяжестью: на тридцати метрах полной натяжки стрела уходит
 * вниз почти на два метра, и целиться приходится выше (поправку показывают метки прицела — `pins`). Полёт идёт
 * неизменным шагом от секунды выстрела (`ARROW_STEP`), а не кадром: попала ли стрела, не зависит от того, как
 * часто рисует телефон. На каждом шаге стрела проверяет землю, укрытия (ствол, хвоя, крона, куст) и оленей — где
 * олень стоит в ту самую секунду.
 *
 * В партию отсюда уходит только счёт — сколько оленей легло из скольких (`tally`), через `sim/minigames.harvest`.
 */
import { seeded } from './rules';

// ---------- Поле ----------

/** Где встаёт охотник на «Начать» и куда смотрит: у южной опушки, лицом к полю (вдоль −Z). */
export const START = { x: 0, z: 14, yaw: 0 };

/**
 * Докуда от середины поля можно уйти. Охотник подкрадывается — до ближних оленей можно дойти на десяток шагов,
 * до дальних нет: середина поля открыта, и идущего там слышно.
 */
export const ROAM_R = 18;

/** Где пасутся олени: не дальше этого от середины. */
export const FIELD_R = 40;

/** Опушка: олень, перебежавший её, ушёл в лес — его больше нет. */
export const ESCAPE_R = 44;

/** Докуда бежит ушедший — в глубь стволов, чтобы не таять у всех на глазах. */
const VANISH_R = 50;

/** Откуда смотрит и стреляет охотник — тот же рост, что у поляны (`prologue/glade.EYE`; тест держит равенство). */
export const EYE_Y = 1.62;

export type CoverKind = 'spruce' | 'birch' | 'bush';

/** Укрытие на поле: ель, берёза или куст. Размер `s` — множитель модели и её формы попадания. */
export interface Cover {
  kind: CoverKind;
  x: number;
  z: number;
  s: number;
  yaw: number;
}

/** Сколько укрытий каждого вида. */
export const COVER_COUNT: Record<CoverKind, number> = { spruce: 9, birch: 7, bush: 14 };

/** Размеры укрытий — от и до. */
const COVER_SIZE: Record<CoverKind, [number, number]> = { spruce: [2.3, 3.1], birch: [2.1, 2.7], bush: [0.8, 1.25] };

/**
 * Ель: ствол и три яруса хвои — конусы. Ярусы начинаются выше оленя, но ниже глаза: под елью видно ноги и бок
 * зверя, а стоящего за ней охотника не видно. Числа — в долях роста `s`; модель строится из них же (`huntModels`).
 */
export const SPRUCE = {
  trunkR: 0.09,
  trunkH: 0.95,
  tiers: [
    { r: 0.62, y0: 0.55, y1: 1.75 },
    { r: 0.48, y0: 1.25, y1: 2.3 },
    { r: 0.32, y0: 1.85, y1: 2.8 },
  ],
} as const;

/** Берёза: ствол и три шапки кроны — шары. Крона начинается выше человека. */
export const BIRCH = {
  trunkR: 0.075,
  trunkH: 1.6,
  crowns: [
    { x: 0, y: 1.75, z: 0, r: 0.55 },
    { x: 0.26, y: 2.15, z: 0.1, r: 0.45 },
    { x: -0.22, y: 2.3, z: -0.16, r: 0.4 },
  ],
} as const;

/** Куст: приплюснутый шар. Олень за кустом виден спиной и головой; стрелу куст останавливает. */
export const BUSH = { y: 0.5, rx: 0.85, ry: 0.55 } as const;

/** Сколько глаз держит от хвои и веток: то же правило, что у поляны (`prologue/glade.EYE_CLEAR`). */
const EYE_CLEAR = 0.4;

/** Круг, в который не войти телом: у ели — хвоя на высоте глаза, у берёзы — ствол, у куста — сам куст. */
export function coverRadius(c: Cover): number {
  if (c.kind === 'spruce') {
    const t = SPRUCE.tiers[0];
    const atEye = t.r * c.s * Math.max(0, (t.y1 * c.s - EYE_Y) / ((t.y1 - t.y0) * c.s));
    return Math.max(SPRUCE.trunkR * c.s + 0.3, atEye + EYE_CLEAR);
  }
  if (c.kind === 'birch') return BIRCH.trunkR * c.s + 0.35;
  return BUSH.rx * c.s;
}

/** Внутри ли точка укрытия — по нему стрела останавливается. */
export function inCover(c: Cover, x: number, y: number, z: number): boolean {
  if (y < 0) return false;
  const dx = x - c.x;
  const dz = z - c.z;
  const s = c.s;
  if (c.kind === 'bush') {
    const ex = dx / (BUSH.rx * s);
    const ey = (y - BUSH.y * s) / (BUSH.ry * s);
    const ez = dz / (BUSH.rx * s);
    return ex * ex + ey * ey + ez * ez <= 1;
  }
  const d = Math.hypot(dx, dz);
  if (c.kind === 'spruce') {
    if (y <= SPRUCE.trunkH * s && d <= SPRUCE.trunkR * s) return true;
    for (const t of SPRUCE.tiers) {
      const y0 = t.y0 * s;
      const y1 = t.y1 * s;
      if (y >= y0 && y <= y1 && d <= (t.r * s * (y1 - y)) / (y1 - y0)) return true;
    }
    return false;
  }
  if (y <= BIRCH.trunkH * s && d <= BIRCH.trunkR * s) return true;
  // Шапки кроны повёрнуты вместе с деревом.
  const cos = Math.cos(c.yaw);
  const sin = Math.sin(c.yaw);
  for (const k of BIRCH.crowns) {
    const kx = (k.x * cos + k.z * sin) * s;
    const kz = (-k.x * sin + k.z * cos) * s;
    const r = k.r * s;
    if ((dx - kx) ** 2 + (y - k.y * s) ** 2 + (dz - kz) ** 2 <= r * r) return true;
  }
  return false;
}

// ---------- Олень: тело и голова ----------

/**
 * Форма попадания — по модели оленя предыстории (`prologue/models.deer`): корпус — эллипсоид по двум брусам туловища,
 * голова и шея — шары на оси в холке. Ноги не считаются: стрела в ногу оленя не валит. Тест сверяет эти числа с
 * рамкой модели — правило и картинка одни.
 */
export const DEER_BODY = { y: 0.95, z: -0.06, rx: 0.29, ry: 0.35, rz: 0.7 } as const;
/** Ось головы — холка (`models.deer`: голова на `DEER_H − 0.2`, `0.42` вперёд). */
export const DEER_NECK = { y: 1.04, z: 0.42 } as const;
/** Шея и голова от оси: место и радиус шара, пока голова поднята. */
export const DEER_HEAD: readonly { y: number; z: number; r: number }[] = [
  { y: 0.24, z: 0.14, r: 0.16 },
  { y: 0.44, z: 0.38, r: 0.19 },
];
/** Лежащий: туша (`models.carcass`) — стрела в неё втыкается, но второго оленя не даёт. */
export const CARCASS = { y: 0.27, z: -0.06, rx: 0.3, ry: 0.3, rz: 0.7 } as const;

/** Наклон головы вокруг оси, рад: пасётся — опущена в траву, заметил — вскинута. Те же числа, что у поляны. */
export const HEAD_DOWN = 0.82;
export const HEAD_UP = -0.05;

// ---------- Олень: поведение ----------

/** Сколько оленей на поле: три кучки по два. Знаменатель счёта. */
export const DEER = 6;
const GROUPS = 3;

/** Как далеко от охотника кучки: ближняя, средняя, дальняя — по одной каждой дали. */
const BANDS: readonly [number, number][] = [
  [16, 22],
  [24, 31],
  [33, 40],
];

/** Бег, м/с: заметно быстрее человека (`glade.WALK_SPEED` 2,6) — догнать нельзя, в этом и лук. */
export const RUN_SPEED = 8.5;
/** Разгон с места до полного бега. */
const RUN_ACC = 0.4;
/** Прыжок: олень бежит скачками, корпус взлетает на четверть метра. Время одного скачка. */
export const HOP_S = 0.42;
export const HOP_LIFT = 0.22;
/** Сколько бежит, прежде чем встать: от и до. */
const RUN_DIST: [number, number] = [16, 24];

/** Сколько стоит, насторожившись, если ничего больше не случилось. */
export const ALERT_S = 5;
/** Сколько стоит, прибежав, — отдышаться и смотреть назад. */
export const CALM_S = 6;
/** Сколько проходит от вести до прыжка: олень «срывается с тетивы», но не мгновенно. */
export const REACT_S = 0.25;

/** Как часто пасущийся олень вскидывает голову — от и до, секунды, — и на сколько. */
const GLANCE_EVERY: [number, number] = [5, 9];
export const GLANCE_S = 1.6;
/** Сколько голова поднимается или опускается. */
const HEAD_RAMP = 0.25;

/**
 * Что слышно и откуда срываются, метры. Шаг слышно тем дальше, чем быстрее идёшь (`loud` 0,35..1), а поднявший
 * голову олень замечает идущего вдвое дальше: двигаться надо, пока стадо щиплет траву. Тетиву слышно далеко, и
 * ближних она срывает раньше, чем долетит стрела. Стук стрелы о землю или ствол пугает тех, кто рядом. Упавший
 * сосед срывает всю кучку.
 */
export const HEAR = {
  step: { alert: 7, flee: 0 },
  twang: { alert: 30, flee: 12 },
  thud: { alert: 15, flee: 5 },
  fall: { alert: 25, flee: 14 },
} as const;
export type NoiseKind = keyof typeof HEAR;

/** Насторожившийся олень срывается от второй вести, если она ближе этой доли слышимости. */
const SECOND_FLEE = 0.75;

/** Ближе этого охотника олень не подпускает никогда: видит. */
export const SEE_R = 6.5;

/** Как часто сцена спрашивает, слышно ли охотника, секунды сцены. */
export const TICK = 0.25;
/** Шаг слышен не чаще этого. */
const STEP_EVERY = 0.5;
/** Медленнее этой доли полного шага — крадётся, и его не слышно вовсе. */
export const SNEAK = 0.15;

type Wave = readonly [number, number, number];

export interface DeerSpec {
  id: number;
  group: number;
  /** Где стоит на «Начать» и куда смотрит. */
  x: number;
  z: number;
  yaw: number;
  /** Брожение: волны по x и z (амплитуда, частота, фаза) и поворот. */
  wx: Wave;
  wz: Wave;
  turn: Wave;
  /** Когда вскидывает голову: раз в `every` секунд, со сдвигом `phase`. */
  every: number;
  phase: number;
  /** Сколько бежит, сорвавшись, и в какую сторону от «прочь» отклоняется (рад). */
  dist: number;
  veer: number;
  /** Оленуха — без рогов (`models.deer(false)`). Правила у неё те же: та же цель, тот же слух, тот же бег. */
  doe: boolean;
}

export interface Field {
  cover: Cover[];
  deer: DeerSpec[];
}

const wave = (rnd: () => number, amp: number, freq: number): Wave => [amp * (0.7 + 0.6 * rnd()), freq * (0.75 + 0.5 * rnd()), rnd() * Math.PI * 2];
const waveAt = (w: Wave, t: number): number => w[0] * Math.sin(w[1] * t + w[2]);

/** Отрезок прямой от охотника до цели не задевает укрытия. Шаг — 20 см: тоньше ствола ели. */
export function clearSight(cover: readonly Cover[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  const n = Math.max(2, Math.ceil(len / 0.2));
  for (let i = 1; i < n; i++) {
    const u = i / n;
    const x = x0 + (x1 - x0) * u;
    const y = y0 + (y1 - y0) * u;
    const z = z0 + (z1 - z0) * u;
    for (const c of cover) if (inCover(c, x, y, z)) return false;
  }
  return true;
}

/**
 * Поле по зерну: где кучки оленей и где укрытия. Кучки — по одной на каждую даль (`BANDS`), в пределах полутора
 * прямых углов от взгляда на старте; укрытия — где угодно на поле, но не у ног охотника, не на оленях и не поперёк
 * линии от глаза к середине каждой кучки: на старте каждая кучка видна, а обходить приходится всё остальное.
 */
export function layHunt(seed: number): Field {
  const rnd = seeded(seed);
  const order = [0, 1, 2];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const deer: DeerSpec[] = [];
  const centers: { x: number; z: number }[] = [];
  for (let g = 0; g < GROUPS; g++) {
    // Направления кучек — слева, прямо и справа, в своём порядке у каждого зерна; даль — своя у каждой.
    const side = (order[g] - 1) * 0.72 + (rnd() - 0.5) * 0.4;
    const band = BANDS[g];
    let d = band[0] + rnd() * (band[1] - band[0]);
    let cx = START.x - Math.sin(side) * d;
    let cz = START.z - Math.cos(side) * d;
    // Кучка не у самой опушки: оленю есть куда уйти по полю, прежде чем скрыться.
    const r = Math.hypot(cx, cz);
    if (r > FIELD_R - 4) {
      const k = (FIELD_R - 4) / r;
      cx *= k;
      cz *= k;
      d = Math.hypot(cx - START.x, cz - START.z);
    }
    centers.push({ x: cx, z: cz });
    const face = rnd() * Math.PI * 2;
    for (let k = 0; k < DEER / GROUPS; k++) {
      const a = face + k * Math.PI + (rnd() - 0.5) * 0.8;
      const off = 1.1 + rnd() * 0.7;
      deer.push({
        id: deer.length,
        group: g,
        x: cx + Math.cos(a) * off,
        z: cz + Math.sin(a) * off,
        yaw: face + (rnd() - 0.5) * 1.6,
        wx: wave(rnd, 0.7, 0.07),
        wz: wave(rnd, 0.7, 0.06),
        turn: wave(rnd, 0.7, 0.09),
        every: GLANCE_EVERY[0] + rnd() * (GLANCE_EVERY[1] - GLANCE_EVERY[0]),
        phase: rnd() * GLANCE_EVERY[1],
        dist: RUN_DIST[0] + rnd() * (RUN_DIST[1] - RUN_DIST[0]),
        veer: (rnd() - 0.5) * 0.7,
        doe: false,
      });
    }
  }
  const cover: Cover[] = [];
  const kinds: CoverKind[] = [];
  for (const k of ['spruce', 'birch', 'bush'] as const) for (let i = 0; i < COVER_COUNT[k]; i++) kinds.push(k);
  for (const kind of kinds) {
    for (let tries = 0; tries < 400; tries++) {
      const a = rnd() * Math.PI * 2;
      const r = 3 + Math.sqrt(rnd()) * (FIELD_R + 1);
      const s = COVER_SIZE[kind][0] + rnd() * (COVER_SIZE[kind][1] - COVER_SIZE[kind][0]);
      const c: Cover = { kind, x: Math.cos(a) * r, z: Math.sin(a) * r, s, yaw: rnd() * Math.PI * 2 };
      const cr = coverRadius(c);
      if (Math.hypot(c.x - START.x, c.z - START.z) < cr + 3.5) continue;
      if (deer.some((d) => Math.hypot(c.x - d.x, c.z - d.z) < cr + 3)) continue;
      if (cover.some((o) => Math.hypot(c.x - o.x, c.z - o.z) < cr + coverRadius(o) + 1.2)) continue;
      if (centers.some((m) => !clearSight([c], START.x, EYE_Y, START.z, m.x, DEER_BODY.y, m.z))) continue;
      cover.push(c);
      break;
    }
  }
  // Оленухи (решение владельца 04.10.2026): в каждой кучке — олень и оленуха, кто из двоих — от зерна. Жребий — после
  // укрытий, чтобы места оленей и укрытий у каждого зерна остались прежними.
  for (let g = 0; g < GROUPS; g++) deer[g * (DEER / GROUPS) + Math.floor(rnd() * (DEER / GROUPS))].doe = true;
  return { cover, deer };
}

// ---------- Отрезки жизни оленя ----------

export type SegKind = 'graze' | 'alert' | 'run' | 'down' | 'gone';

export interface Seg {
  kind: SegKind;
  /** С какой секунды. Кончается там, где начинается следующий. */
  t0: number;
  /** Где стоял в начале отрезка и куда смотрел. */
  x: number;
  z: number;
  yaw: number;
  /** Бег: куда (единичный вектор) и сколько метров. */
  dx?: number;
  dz?: number;
  dist?: number;
}

/** Олень в секунду `t`: где, куда смотрит, насколько поднята голова и как высоко взлетел корпус. */
export interface DeerPose {
  kind: SegKind;
  x: number;
  z: number;
  yaw: number;
  /** Наклон головы, рад: `HEAD_DOWN` — щиплет траву, `HEAD_UP` — смотрит. */
  head: number;
  /** На сколько корпус над обычным — скачок бега. */
  lift: number;
  /** Скорость, м/с: качать ноги. */
  speed: number;
  /** Сколько пробежал в этом беге, метры: фаза ног. */
  ran: number;
}

const runAt = (tau: number): number => (tau < RUN_ACC ? (RUN_SPEED * tau * tau) / (2 * RUN_ACC) : RUN_SPEED * (tau - RUN_ACC / 2));
const runTime = (dist: number): number => dist / RUN_SPEED + RUN_ACC / 2;
const smooth = (k: number): number => {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
};

/** Поднята ли голова пасущегося — доля 0..1: вскидывает раз в `every` секунд на `GLANCE_S`. */
export function glanceAt(d: DeerSpec, t: number): number {
  const p = (((t - d.phase) % d.every) + d.every) % d.every;
  if (p < HEAD_RAMP) return smooth(p / HEAD_RAMP);
  if (p < GLANCE_S) return 1;
  return 1 - smooth((p - GLANCE_S) / HEAD_RAMP);
}

/** Где олень в секунду `t` по своим отрезкам. Чистая: тот же ряд и та же секунда — то же место. */
export function poseAt(d: DeerSpec, segs: readonly Seg[], t: number): DeerPose {
  let i = 0;
  while (i + 1 < segs.length && segs[i + 1].t0 <= t) i++;
  const g = segs[i];
  const out: DeerPose = { kind: g.kind, x: g.x, z: g.z, yaw: g.yaw, head: HEAD_UP, lift: 0, speed: 0, ran: 0 };
  if (g.kind === 'graze') {
    out.x = g.x + waveAt(d.wx, t) - waveAt(d.wx, g.t0);
    out.z = g.z + waveAt(d.wz, t) - waveAt(d.wz, g.t0);
    out.yaw = g.yaw + waveAt(d.turn, t) - waveAt(d.turn, g.t0);
    const up = glanceAt(d, t);
    out.head = HEAD_DOWN + (HEAD_UP - HEAD_DOWN) * up;
    // Скорость брожения — только вид: качнуть ноги, когда переступает.
    const vx = d.wx[0] * d.wx[1] * Math.cos(d.wx[1] * t + d.wx[2]);
    const vz = d.wz[0] * d.wz[1] * Math.cos(d.wz[1] * t + d.wz[2]);
    out.speed = Math.hypot(vx, vz);
    out.ran = t * out.speed;
  } else if (g.kind === 'run') {
    const tau = Math.max(0, t - g.t0);
    const s = Math.min(g.dist ?? 0, runAt(tau));
    out.x = g.x + (g.dx ?? 0) * s;
    out.z = g.z + (g.dz ?? 0) * s;
    out.ran = s;
    out.speed = s < (g.dist ?? 0) ? Math.min(RUN_SPEED, (RUN_SPEED * tau) / RUN_ACC) : 0;
    out.lift = Math.abs(Math.sin((Math.PI * tau) / HOP_S)) * HOP_LIFT * Math.min(1, out.speed / RUN_SPEED);
    out.head = HEAD_UP + 0.18;
  }
  return out;
}

/** Внутри ли эллипсоида отрезок: ближняя точка входа, доля 0..1 вдоль отрезка, или `null`. */
function hitEllipsoid(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
): number | null {
  // В осях эллипсоида он — единичный шар: отрезок против шара.
  const px = (ax - cx) / rx;
  const py = (ay - cy) / ry;
  const pz = (az - cz) / rz;
  const qx = (bx - ax) / rx;
  const qy = (by - ay) / ry;
  const qz = (bz - az) / rz;
  const a = qx * qx + qy * qy + qz * qz;
  const b = 2 * (px * qx + py * qy + pz * qz);
  const c = px * px + py * py + pz * pz - 1;
  if (c <= 0) return 0;
  if (a < 1e-12) return null;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const u = (-b - Math.sqrt(disc)) / (2 * a);
  return u >= 0 && u <= 1 ? u : null;
}

/** В оси оленя: из мира в его собственные оси (вперёд — +Z, как у модели). */
function toLocal(p: DeerPose, x: number, z: number): [number, number] {
  const dx = x - p.x;
  const dz = z - p.z;
  const cos = Math.cos(p.yaw);
  const sin = Math.sin(p.yaw);
  return [dx * cos - dz * sin, dx * sin + dz * cos];
}

/**
 * Попала ли стрела, летящая отрезком `a → b`, в оленя в позе `p`: доля вдоль отрезка или `null`. Стоящий — корпус,
 * шея и голова (на своём наклоне); лежащий — туша; ушедший — ничего.
 */
export function hitDeer(p: DeerPose, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number | null {
  if (p.kind === 'gone') return null;
  const [lax, laz] = toLocal(p, ax, az);
  const [lbx, lbz] = toLocal(p, bx, bz);
  if (p.kind === 'down') return hitEllipsoid(lax, ay, laz, lbx, by, lbz, 0, CARCASS.y, CARCASS.z, CARCASS.rx, CARCASS.ry, CARCASS.rz);
  let best = hitEllipsoid(lax, ay, laz, lbx, by, lbz, 0, DEER_BODY.y + p.lift, DEER_BODY.z, DEER_BODY.rx, DEER_BODY.ry, DEER_BODY.rz);
  const cos = Math.cos(p.head);
  const sin = Math.sin(p.head);
  for (const h of DEER_HEAD) {
    // Поворот вокруг оси X, как у модели: y' = y·cos − z·sin, z' = y·sin + z·cos.
    const hy = DEER_NECK.y + p.lift + h.y * cos - h.z * sin;
    const hz = DEER_NECK.z + h.y * sin + h.z * cos;
    const u = hitEllipsoid(lax, ay, laz, lbx, by, lbz, 0, hy, hz, h.r, h.r, h.r);
    if (u !== null && (best === null || u < best)) best = u;
  }
  return best;
}

// ---------- Лук и стрела ----------

/** Стрел в колчане. */
export const ARROWS = 8;
/** Тяжесть, м/с². */
export const GRAVITY = 9.8;
/** Сколько тянуть тетиву до полной натяжки, секунды. */
export const DRAW_S = 0.6;
/** Меньше этой доли натяжки стрела не уходит: тетиву отпустили, не натянув, — это не выстрел. */
export const LOOSE_MIN = 0.25;
/** Скорость стрелы на пороге и в полную натяжку, м/с. */
export const V_LOOSE = 18;
export const V_FULL = 50;
/** Наложить новую стрелу после выстрела. */
export const NOCK_S = 0.7;
/** Шаг полёта — от секунды выстрела, не кадром: на 50 м/с это 21 см, тоньше корпуса оленя. */
export const ARROW_STEP = 1 / 240;
/** Дольше этого стрела не летит: ушла за лес. */
const ARROW_LIFE = 4;
/** Куда дальше этого от середины стрела не долетает — потеряна в лесу. */
const ARROW_LOST_R = 75;
/** Стена леса: ниже кроны дальше этого стрела втыкается в стволы; модель ставит опушку здесь же (`huntModels.WALL_FROM`). */
export const FOREST_IN = 47;
const FOREST_LOW = 7;
/** Откуда уходит стрела: на этом расстоянии перед глазом, по линии взгляда. */
export const NOCK_AHEAD = 0.6;

/** Скорость стрелы при такой натяжке, м/с; ниже порога — ноль. */
export function speedOf(drawn: number): number {
  if (!(drawn >= LOOSE_MIN)) return 0;
  const k = (Math.min(1, drawn) - LOOSE_MIN) / (1 - LOOSE_MIN);
  return V_LOOSE + (V_FULL - V_LOOSE) * k;
}

/** Где стрела через `tau` секунд полёта: прямая плюс падение. */
export function flightAt(s: Shot, tau: number): { x: number; y: number; z: number } {
  return { x: s.x + s.vx * tau, y: s.y + s.vy * tau - (GRAVITY * tau * tau) / 2, z: s.z + s.vz * tau };
}

/**
 * Угол над горизонтом, под которым надо пустить стрелу со скоростью `v`, чтобы на `d` метрах по земле она пришла на
 * `dy` метров выше (ниже) точки выпуска — пологая из двух дуг. Не достаёт — `null`.
 */
export function aimFor(d: number, dy: number, v: number): number | null {
  const v2 = v * v;
  const disc = v2 * v2 - GRAVITY * (GRAVITY * d * d + 2 * dy * v2);
  if (disc < 0 || d <= 0) return null;
  return Math.atan((v2 - Math.sqrt(disc)) / (GRAVITY * d));
}

/** На каких далях метки прицела. */
export const PIN_DISTS = [15, 25, 35] as const;

/**
 * Метки прицела: на сколько ниже середины прицела класть на оленя, стоящего на этой дали, при полной натяжке, рад.
 * Считаются той же дугой, что летит стрела (`aimFor`), — от глаза до середины корпуса.
 */
export function pins(): { d: number; angle: number }[] {
  return PIN_DISTS.map((d) => {
    const dy = DEER_BODY.y - EYE_Y;
    const need = aimFor(d, dy, V_FULL) ?? 0;
    return { d, angle: need - Math.atan2(dy, d) };
  });
}

export interface Shot {
  id: number;
  /** Секунда выстрела. */
  t0: number;
  /** Откуда и с какой скоростью, м и м/с. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export type Struck = 'deer' | 'cover' | 'ground' | 'lost';

/** Стрела: полёт и, когда кончился, — где и во что. */
export interface Arrow extends Shot {
  /** Сколько шагов полёта уже пройдено. */
  steps: number;
  /** Когда воткнулась; летит — `null`. */
  end: number | null;
  struck: Struck | null;
  /** Куда: номер оленя или укрытия. */
  what: number;
  /** Где воткнулась и куда смотрела. */
  at: { x: number; y: number; z: number } | null;
  dir: { x: number; y: number; z: number } | null;
}

/** Весть, по которой олени решают, что делать: шаг, тетива, стук, упавший сосед. */
export interface Noise {
  t: number;
  kind: NoiseKind;
  /** Откуда слышно. */
  x: number;
  z: number;
  /** Насколько громко — шаг: доля полного шага. */
  loud: number;
  /** Где в эту секунду охотник: от него не бегут навстречу. */
  hx: number;
  hz: number;
}

/** Охотник на кадре — то, что сцена знает о нём: где стоит и идёт ли (доля полного шага). */
export interface Hunter {
  x: number;
  z: number;
  walking: number;
}

/** Отклик игре: что случилось — сцене (звук, подпись, отклик рукой). */
export interface HuntEvent {
  t: number;
  kind: 'loose' | 'hit' | 'thud' | 'flee';
  /** Номер оленя или стрелы. */
  id: number;
  x: number;
  y: number;
  z: number;
  struck?: Struck;
}

/**
 * Охота: поле, олени, колчан и стрелы. Живёт в кадре — в сохранение не идёт ничего, в партию уходит только счёт.
 * Ход — только вперёд: `advance` до секунды кадра, `pull` и `loose` — в секунду, до которой дошёл последний кадр.
 */
export class Hunt {
  readonly field: Field;
  readonly segs: Seg[][];
  readonly arrows: Arrow[] = [];
  /** Что случилось с прошлого раза — сцене. */
  readonly events: HuntEvent[] = [];
  /** Ряд вестей — тесту и стенду: тот же ряд, те же олени. */
  readonly noises: Noise[] = [];
  /** До какой секунды дошла охота. */
  now = 0;
  private tick = 0;
  private lastStep = -Infinity;
  private hunter: Hunter = { x: START.x, z: START.z, walking: 0 };
  /** С какой секунды тянут тетиву; не тянут — `null`. */
  private pullFrom: number | null = null;
  /** Когда наложена стрела: раньше этого тянуть нечего. */
  private nockAt = 0;

  constructor(seed: number) {
    this.field = layHunt(seed);
    this.segs = this.field.deer.map((d) => [{ kind: 'graze', t0: 0, x: d.x, z: d.z, yaw: d.yaw }]);
  }

  /** Сколько стрел в колчане. */
  get quiver(): number {
    return ARROWS - this.arrows.length;
  }

  /** Сколько оленей легло. */
  get down(): number {
    return this.segs.filter((s) => s.some((g) => g.kind === 'down' && g.t0 <= this.now)).length;
  }

  /** Где олень сейчас (или в секунду `t`). */
  pose(id: number, t = this.now): DeerPose {
    return poseAt(this.field.deer[id], this.segs[id], t);
  }

  /** Сколько натянута тетива в секунду `t`: 0..1. Стрела ещё не наложена — тянуть нечего. */
  drawn(t = this.now): number {
    if (this.pullFrom === null || this.quiver <= 0) return 0;
    const from = Math.max(this.pullFrom, this.nockAt);
    return Math.max(0, Math.min(1, (t - from) / DRAW_S));
  }

  /** Тянут ли тетиву сейчас. */
  get pulling(): boolean {
    return this.pullFrom !== null;
  }

  /** Палец лёг — тянуть тетиву. Стрел нет — нечего. */
  pull(t: number): void {
    if (this.quiver <= 0) return;
    this.pullFrom = t;
  }

  /** Тетиву отпустили без выстрела: палец ушёл, жест отобран. */
  slack(): void {
    this.pullFrom = null;
  }

  /**
   * Отпустить тетиву: из глаза `eye` по направлению `dir` (единичный вектор взгляда). Недотянул — стрела не уходит,
   * и это не трата. Пущенная — весть «тетива» всем, кто слышит.
   */
  loose(t: number, eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): Arrow | null {
    const drawn = this.drawn(t);
    this.pullFrom = null;
    const v = speedOf(drawn);
    if (v <= 0 || this.quiver <= 0) return null;
    const a: Arrow = {
      id: this.arrows.length,
      t0: t,
      x: eye.x + dir.x * NOCK_AHEAD,
      y: eye.y + dir.y * NOCK_AHEAD,
      z: eye.z + dir.z * NOCK_AHEAD,
      vx: dir.x * v,
      vy: dir.y * v,
      vz: dir.z * v,
      steps: 0,
      end: null,
      struck: null,
      what: -1,
      at: null,
      dir: null,
    };
    this.arrows.push(a);
    this.nockAt = t + NOCK_S;
    this.events.push({ t, kind: 'loose', id: a.id, x: a.x, y: a.y, z: a.z });
    this.hear({ t, kind: 'twang', x: eye.x, z: eye.z, loud: 1, hx: eye.x, hz: eye.z });
    return a;
  }

  /** Летит ли хоть одна стрела. */
  get flying(): boolean {
    return this.arrows.some((a) => a.end === null);
  }

  /** Когда воткнулась последняя стрела. */
  private settledAt(): number {
    let t = 0;
    for (const a of this.arrows) if (a.end !== null) t = Math.max(t, a.end);
    return t;
  }

  /**
   * Кончилась ли охота раньше времени: на поле не осталось ни одного стоящего оленя — или стрел нет и все долетели.
   * Полторы секунды после последнего держим: упавшего оленя и воткнувшуюся стрелу надо увидеть.
   */
  over(t: number): boolean {
    if (this.flying) return false;
    let last = this.settledAt();
    let standing = false;
    for (let i = 0; i < this.field.deer.length; i++) {
      const segs = this.segs[i];
      const end = segs.find((g) => (g.kind === 'down' || g.kind === 'gone') && g.t0 <= t);
      if (end) last = Math.max(last, end.t0);
      else standing = true;
    }
    if (standing && this.quiver > 0) return false;
    return t >= last + 1.5;
  }

  /** Счёт: сколько легло из скольких. */
  tally(): { got: number; total: number } {
    return { got: this.down, total: DEER };
  }

  /**
   * Дойти до секунды `t`: стрелы — шагами полёта, слух — тиками, всё — по порядку секунд. Охотник — каким его
   * видит этот кадр.
   */
  advance(t: number, hunter: Hunter): void {
    if (t < this.now) return;
    this.hunter = hunter;
    for (;;) {
      let next = Infinity;
      let arrow: Arrow | null = null;
      for (const a of this.arrows) {
        if (a.end !== null) continue;
        const at = a.t0 + (a.steps + 1) * ARROW_STEP;
        if (at < next) {
          next = at;
          arrow = a;
        }
      }
      const tickAt = (this.tick + 1) * TICK;
      if (tickAt <= next && tickAt <= t) {
        this.tick++;
        this.listen(tickAt);
        continue;
      }
      if (arrow && next <= t) {
        this.fly(arrow);
        continue;
      }
      break;
    }
    this.now = t;
  }

  /** Тик: слышно ли шаги охотника и не подошёл ли он вплотную. */
  private listen(t: number): void {
    const h = this.hunter;
    for (let i = 0; i < this.field.deer.length; i++) {
      const p = this.pose(i, t);
      if (p.kind === 'graze' || p.kind === 'alert') {
        if (Math.hypot(p.x - h.x, p.z - h.z) < SEE_R) this.flee(i, t, h.x, h.z, h);
      }
    }
    if (h.walking > SNEAK && t - this.lastStep >= STEP_EVERY - 1e-9) {
      this.lastStep = t;
      this.hear({ t, kind: 'step', x: h.x, z: h.z, loud: Math.min(1, 0.35 + 0.65 * h.walking), hx: h.x, hz: h.z });
    }
  }

  /** Один шаг полёта стрелы: земля, укрытия, олени — что встретилось раньше на отрезке. */
  private fly(a: Arrow): void {
    const tau0 = a.steps * ARROW_STEP;
    const tau1 = tau0 + ARROW_STEP;
    a.steps++;
    const p0 = flightAt(a, tau0);
    const p1 = flightAt(a, tau1);
    const t = a.t0 + tau1;
    let u = Infinity;
    let struck: Struck | null = null;
    let what = -1;
    if (p1.y <= 0) {
      u = p0.y / Math.max(1e-9, p0.y - p1.y);
      struck = 'ground';
    }
    // Укрытие — по двум точкам отрезка: шаг тоньше любого ствола.
    for (const k of [0.5, 1]) {
      if (k >= u) break;
      const x = p0.x + (p1.x - p0.x) * k;
      const y = p0.y + (p1.y - p0.y) * k;
      const z = p0.z + (p1.z - p0.z) * k;
      const c = this.field.cover.findIndex((c) => inCover(c, x, y, z));
      if (c >= 0) {
        u = k;
        struck = 'cover';
        what = c;
        break;
      }
    }
    if (struck === null && Math.hypot(p1.x, p1.z) > FOREST_IN && p1.y < FOREST_LOW) {
      u = 1;
      struck = 'cover';
    }
    for (let i = 0; i < this.field.deer.length; i++) {
      const hit = hitDeer(this.pose(i, t), p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
      if (hit !== null && hit < u) {
        u = hit;
        struck = 'deer';
        what = i;
      }
    }
    if (struck === null) {
      if (tau1 >= ARROW_LIFE || Math.hypot(p1.x, p1.z) > ARROW_LOST_R) {
        a.end = t;
        a.struck = 'lost';
        a.at = p1;
        this.events.push({ t, kind: 'thud', id: a.id, x: p1.x, y: p1.y, z: p1.z, struck: 'lost' });
      }
      return;
    }
    const te = a.t0 + tau0 + u * ARROW_STEP;
    const at = { x: p0.x + (p1.x - p0.x) * u, y: Math.max(0, p0.y + (p1.y - p0.y) * u), z: p0.z + (p1.z - p0.z) * u };
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z) || 1;
    a.end = te;
    a.struck = struck;
    a.what = what;
    a.at = at;
    a.dir = { x: (p1.x - p0.x) / len, y: (p1.y - p0.y) / len, z: (p1.z - p0.z) / len };
    const h = this.hunter;
    if (struck === 'deer') {
      const standing = this.pose(what, te).kind !== 'down';
      if (standing) {
        const p = this.pose(what, te);
        this.cut(what, te, [{ kind: 'down', t0: te, x: p.x, z: p.z, yaw: p.yaw }]);
        this.events.push({ t: te, kind: 'hit', id: what, x: at.x, y: at.y, z: at.z, struck });
        this.hear({ t: te, kind: 'fall', x: p.x, z: p.z, loud: 1, hx: h.x, hz: h.z });
        return;
      }
    }
    this.events.push({ t: te, kind: 'thud', id: a.id, x: at.x, y: at.y, z: at.z, struck });
    this.hear({ t: te, kind: 'thud', x: at.x, z: at.z, loud: 1, hx: h.x, hz: h.z });
  }

  /** Весть: каждый живой олень решает — не заметить, насторожиться или сорваться. */
  hear(n: Noise): void {
    this.noises.push(n);
    const rule = HEAR[n.kind];
    for (let i = 0; i < this.field.deer.length; i++) {
      const p = this.pose(i, n.t);
      if (p.kind !== 'graze' && p.kind !== 'alert') continue;
      const dist = Math.hypot(p.x - n.x, p.z - n.z);
      const up = p.kind === 'alert' || p.head < (HEAD_DOWN + HEAD_UP) / 2;
      // Шаг слышно по громкости, а поднявший голову олень видит идущего вдвое дальше.
      const alert = n.kind === 'step' ? rule.alert * n.loud * (up ? 2 : 1) : rule.alert;
      if (dist < rule.flee || (p.kind === 'alert' && dist < alert * SECOND_FLEE)) this.flee(i, n.t, n.x, n.z, { x: n.hx, z: n.hz });
      else if (dist < alert) this.alert(i, n.t, n.x, n.z);
    }
  }

  /** Насторожился: стоит и смотрит туда, откуда слышно, `ALERT_S` секунд, потом снова пасётся. */
  private alert(i: number, t: number, fx: number, fz: number): void {
    const p = this.pose(i, t);
    const yaw = Math.atan2(fx - p.x, fz - p.z);
    this.cut(i, t, [
      { kind: 'alert', t0: t, x: p.x, z: p.z, yaw },
      { kind: 'graze', t0: t + ALERT_S, x: p.x, z: p.z, yaw },
    ]);
  }

  /**
   * Сорвался: через `REACT_S` бежит прочь от `fx, fz`. Направление — «прочь» с отклонением этого оленя; дорогу он
   * выбирает из нескольких: не сквозь ель и куст и не мимо охотника ближе `SEE_R`. Перебежал опушку — ушёл в лес.
   */
  private flee(i: number, t: number, fx: number, fz: number, hunter: { x: number; z: number }): void {
    const d = this.field.deer[i];
    const p = this.pose(i, t);
    const go = t + REACT_S;
    // Срывается с того места, где услышал: `REACT_S` стоит, вскинув голову, потом прыгает.
    const p2 = { x: p.x, z: p.z };
    const away = Math.atan2(p2.x - fx, p2.z - fz);
    let pick: { dx: number; dz: number } | null = null;
    for (const k of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
      const a = away + d.veer + k;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      if (this.pathClear(p2.x, p2.z, dx, dz, d.dist, hunter)) {
        pick = { dx, dz };
        break;
      }
    }
    const dir = pick ?? { dx: Math.sin(away + d.veer), dz: Math.cos(away + d.veer) };
    const yaw = Math.atan2(dir.dx, dir.dz);
    const segs: Seg[] = [
      { kind: 'alert', t0: t, x: p.x, z: p.z, yaw: p.yaw },
      { kind: 'run', t0: go, x: p2.x, z: p2.z, yaw, dx: dir.dx, dz: dir.dz, dist: d.dist },
    ];
    // Перебежит опушку — уходит в глубь стволов и пропадает.
    const out = this.exitAt(p2.x, p2.z, dir.dx, dir.dz);
    if (out !== null && out <= d.dist) {
      const far = this.exitAt(p2.x, p2.z, dir.dx, dir.dz, VANISH_R) ?? out;
      segs[1].dist = far;
      const end = go + runTime(far);
      segs.push({ kind: 'gone', t0: end, x: p2.x + dir.dx * far, z: p2.z + dir.dz * far, yaw });
    } else {
      const end = go + runTime(d.dist);
      const ex = p2.x + dir.dx * d.dist;
      const ez = p2.z + dir.dz * d.dist;
      // Прибежал — стоит и смотрит назад, туда, откуда бежал, потом снова пасётся.
      const back = Math.atan2(fx - ex, fz - ez);
      segs.push({ kind: 'alert', t0: end, x: ex, z: ez, yaw: back }, { kind: 'graze', t0: end + CALM_S, x: ex, z: ez, yaw: back });
    }
    if (this.cut(i, t, segs)) this.events.push({ t, kind: 'flee', id: i, x: p.x, y: 0, z: p.z });
  }

  /** На сколько метров по лучу из точки до круга радиуса `r`; внутри круга не выходит — `null`. */
  private exitAt(x: number, z: number, dx: number, dz: number, r = ESCAPE_R): number | null {
    const b = x * dx + z * dz;
    const c = x * x + z * z - r * r;
    const disc = b * b - c;
    if (disc < 0) return null;
    const s = -b + Math.sqrt(disc);
    return s > 0 ? s : null;
  }

  /**
   * Свободна ли дорога бегущему: ни ели, ни берёзы, ни куста поперёк, и к охотнику не ближе `SEE_R` — а если он уже
   * ближе, то не ближе, чем сейчас: от человека не бегут ему навстречу.
   */
  private pathClear(x: number, z: number, dx: number, dz: number, dist: number, hunter: { x: number; z: number }): boolean {
    const keep = Math.min(SEE_R, Math.hypot(x - hunter.x, z - hunter.z));
    for (let s = 1; s <= dist; s += 0.5) {
      const px = x + dx * s;
      const pz = z + dz * s;
      if (Math.hypot(px - hunter.x, pz - hunter.z) < keep) return false;
      if (Math.hypot(px, pz) > ESCAPE_R) return true;
      for (const c of this.field.cover) if (Math.hypot(px - c.x, pz - c.z) < coverRadius(c) + 0.5) return false;
    }
    return true;
  }

  /**
   * Новые отрезки оленя с секунды `t`: всё, что было запланировано с неё и позже, снимается, прошлое — нет. Бегущего
   * и уже сорвавшегося (бег запланирован) весть не останавливает — бежит, куда бежал; лежащего и ушедшего — ничто.
   * Стрела останавливает всех. Вернёт, легло ли.
   */
  private cut(i: number, t: number, next: Seg[]): boolean {
    const segs = this.segs[i];
    const now = poseAt(this.field.deer[i], segs, t).kind;
    if (now === 'down' || now === 'gone') return false;
    const shot = next[0].kind === 'down';
    if (!shot && (now === 'run' || segs.some((g) => g.kind === 'run' && g.t0 > t))) return false;
    while (segs.length > 0 && segs[segs.length - 1].t0 >= t) segs.pop();
    segs.push(...next);
    return true;
  }

  /** Забрать отклики для сцены. */
  takeEvents(): HuntEvent[] {
    return this.events.splice(0, this.events.length);
  }
}
