// Кот покоев (docs/city_v3.md, Г-7): рыжий полосатый, с белой грудкой и белыми «носками». Живёт сам: ходит по комнате,
// сидит, спит клубком у камина, сидит на подоконнике и смотрит на город, запрыгивает на кровать, сам приходит к правителю
// и трётся о ноги; касание — гладят (мурчит, жмурится), клубок — гоняет и бьёт лапой.
//
// Здесь — мозг кота (`Cat`), его поза (`catPosture`) и скелет. Тело — фигура набора персонажа (ЛЦ-4, docs/characters.md):
// сетка в два веса, листы шерсти кодом, глаза, усы, живость ключами — свой ленивый кусок (`pet/`), его тянет жизнь
// покоев при входе. Пока кусок в пути, кот думает и ходит на голом скелете (`bareRig`) и не виден. Решает, что делать,
// `CatBrain` — сам по себе, без механики игры; случайность — своя зернистая (кот — картинка, `Math.random` в игре нет).
import * as THREE from 'three';
import type { V3 } from '../city/geom';
import { Rig, Skeleton, SkinBuilder, type RigPose, type Turn } from './rig';
import { BED, HALF, HEARTH, OPENINGS } from './plan';
import { clear, free, pathTo, step } from './walk';
import type { Hop } from './toss';

/** Радиус кота на плане, м. */
export const CAT_R = 0.13;

/** Хвост — четыре звена (ЛЦ-4: прежде пять). */
export const TAIL_BONES = 4;
/** Середина глазного яблока, левый глаз (+x); правый — зеркалом. Ось век проходит через оба (кость `lids`). */
export const CAT_EYE: V3 = [0.0255, 0.288, 0.229];
/** Поворот век от открытых (подняты под лоб) до сомкнутых, рад. */
export const LID_CLOSE = 2.05;

/**
 * Скелет кота — 25 костей: позвоночник три (корпус-корень, грудь, таз), шея, голова, челюсть, веки, уши по одной, хвост
 * четыре, лапы по три (плечо, предплечье, кисть; бедро, скакательный сустав, стопа).
 */
export function catSkeleton(): Skeleton {
  const sk = new Skeleton();
  sk.add('body', null, [0, 0.2, 0]);
  sk.add('chest', 'body', [0, 0.205, 0.08]);
  sk.add('neck', 'chest', [0, 0.235, 0.15]);
  sk.add('head', 'neck', [0, 0.275, 0.19]);
  sk.add('jaw', 'head', [0, 0.262, 0.212]);
  sk.add('lids', 'head', [0, CAT_EYE[1], CAT_EYE[2]]);
  sk.add('earL', 'head', [0.03, 0.318, 0.193]);
  sk.add('earR', 'head', [-0.03, 0.318, 0.193]);
  sk.add('pelvis', 'body', [0, 0.2, -0.085]);
  sk.add('tail1', 'pelvis', [0, 0.212, -0.165]);
  for (let i = 2; i <= TAIL_BONES; i++) sk.add(`tail${i}`, `tail${i - 1}`, [0, 0.212, -0.165 - 0.075 * (i - 1)]);
  for (const [s, sx] of [
    ['L', 1],
    ['R', -1],
  ] as const) {
    sk.add(`arm${s}`, 'chest', [0.042 * sx, 0.175, 0.11]);
    sk.add(`fore${s}`, `arm${s}`, [0.046 * sx, 0.1, 0.105]);
    sk.add(`paw${s}`, `fore${s}`, [0.046 * sx, 0.025, 0.112]);
    sk.add(`thigh${s}`, 'pelvis', [0.045 * sx, 0.18, -0.11]);
    sk.add(`hock${s}`, `thigh${s}`, [0.048 * sx, 0.09, -0.15]);
    sk.add(`hpaw${s}`, `hock${s}`, [0.048 * sx, 0.025, -0.13]);
  }
  return sk;
}

/** Тело кота: то, что мозг ставит в позу и у чего спрашивает места костей (`rig.Rig` и `kit/skin.SkinBody`). */
export type CatRig = Pick<Rig, 'mesh' | 'triangles' | 'pose' | 'write' | 'at' | 'dispose'>;

/** Голый скелет: позу ставит, сетки нет — пока кусок фигуры в пути (клубок в зубах и рука правителя спрашивают кости). */
export function bareRig(): CatRig {
  return new Rig(new SkinBuilder(catSkeleton()), BARE, 'chambers-cat-bare');
}
const BARE = new THREE.MeshBasicMaterial();

/** Что живость фигуры знает о мозге кадра (клипы ключами, глаза). */
export interface CatState {
  /** Доли поз тела. */
  w: Readonly<Record<CatBody, number>>;
  look: Readonly<CatLook>;
  mind: CatMind;
  /** Спит клубком на месте. */
  sleeping: boolean;
  /** Взгляд, которого хочет мозг (к правителю, к клубку), рад от тела — глаза идут к нему раньше головы. */
  wantYaw: number;
  wantPitch: number;
}

/** Фигура кота из куска `pet/`: тело, живость поверх позы мозга, свет покоев после отрисовки. */
export interface CatFigure {
  readonly body: CatRig;
  /** Клипы ключами и мелочи (уши, кончик хвоста, дыхание) — поверх позы мозга; глаза и зрачок — в сетку. */
  live(p: { turns: Record<string, [number, number, number]>; lift: V3 }, s: CatState, t: number): void;
  drawn(): void;
  dispose(): void;
}

// ---------- Поза ----------

/** Что делает кот телом: стоит, идёт (бежит), сидит, лежит клубком (спит), припал перед прыжком (охота), в прыжке. */
export type CatBody = 'stand' | 'walk' | 'sit' | 'curl' | 'crouch' | 'leap' | 'rub' | 'loaf';

/** Доли позы: смешиваются плавно (`CatPose.k`); фазы шага и хвоста — свои. */
export interface CatLook {
  body: CatBody;
  /** Шаг: фаза и скорость (м/с). */
  phase: number;
  speed: number;
  /** Глаза: 1 — открыты, 0 — закрыты (спит, жмурится под рукой). */
  eyes: number;
  /** Рот: 0…1 — мяу. */
  mouth: number;
  /** Голова к цели (от тела): поворот и наклон. */
  lookYaw: number;
  lookPitch: number;
  /** Лапа бьёт клубок: 0…1. */
  bat: number;
  /** Хвост трубой (гладят, рад), 0…1. */
  tailUp: number;
  /** Крен тела (трётся боком). */
  roll: number;
}

type Turns = Record<string, [number, number, number]>;
const add = (o: Turns, b: string, x: number, y = 0, z = 0): void => {
  const t = o[b] ?? (o[b] = [0, 0, 0]);
  t[0] += x;
  t[1] += y;
  t[2] += z;
};

/** Повороты костей и подъём корня по позе тела `w` (доли поз в сумме 1) и мелочам кадра. */
export function catPosture(w: Partial<Record<CatBody, number>>, l: CatLook, t: number): { turns: Turns; lift: V3; tilt: [number, number, number] } {
  const o: Turns = {};
  const lift: [number, number, number] = [0, 0, 0];
  const tilt: [number, number, number] = [0, 0, 0];
  const W = (b: CatBody): number => w[b] ?? 0;
  // Хвост: свободно покачивается; трубой — когда рад; клубком — обвит вокруг.
  const sway = Math.sin(t * 1.3) * 0.25 + Math.sin(t * 0.47) * 0.15;
  const up = Math.max(l.tailUp, W('walk') * 0.6, W('rub') * 0.95);
  for (let i = 1; i <= TAIL_BONES; i++) {
    const k = i / TAIL_BONES;
    // Звено хвоста смотрит назад (−z): поворот по x со знаком плюс поднимает его, минус — опускает.
    add(o, `tail${i}`, up * (i === 1 ? 1.25 : 0.15) - (1 - up) * (i === 1 ? 0.35 : -0.065), sway * k * 1.25 * (1 - 0.6 * up), 0);
  }
  // Шаг: рысь по диагоналям (левая передняя с правой задней).
  const walk = W('walk') + W('rub') * 0.6;
  if (walk > 0) {
    const p = l.phase;
    const amp = 0.45 + Math.min(0.35, l.speed * 0.3);
    for (const [s, ph] of [
      ['L', 0],
      ['R', Math.PI],
    ] as const) {
      const fl = Math.sin(p + ph);
      const hl = Math.sin(p + ph + Math.PI);
      add(o, `arm${s}`, -fl * amp * walk);
      add(o, `fore${s}`, Math.max(0, Math.sin(p + ph - 1)) * 0.7 * walk);
      add(o, `paw${s}`, -Math.max(0, Math.sin(p + ph - 1)) * 0.5 * walk);
      add(o, `thigh${s}`, -hl * amp * walk);
      add(o, `hock${s}`, -Math.max(0, Math.sin(p + ph + Math.PI - 1)) * 0.6 * walk);
      add(o, `hpaw${s}`, Math.max(0, Math.sin(p + ph + Math.PI - 1)) * 0.4 * walk);
    }
    add(o, 'chest', 0, Math.sin(p) * 0.06 * walk, Math.sin(p) * 0.04 * walk);
    add(o, 'pelvis', 0, -Math.sin(p) * 0.06 * walk, 0);
    lift[1] += Math.abs(Math.sin(p)) * 0.008 * walk;
    add(o, 'neck', -0.08 * walk);
  }
  // Сидит: зад к полу, передние прямо, задние сложены, голова поднята.
  const sit = W('sit');
  if (sit > 0) {
    tilt[0] += -0.62 * sit;
    lift[1] += -0.04 * sit;
    lift[2] += -0.05 * sit;
    add(o, 'armL', 0.62 * sit);
    add(o, 'armR', 0.62 * sit);
    add(o, 'pawL', -0.05 * sit);
    add(o, 'pawR', -0.05 * sit);
    for (const s of ['L', 'R']) {
      add(o, `thigh${s}`, -0.9 * sit);
      add(o, `hock${s}`, 1.9 * sit);
      add(o, `hpaw${s}`, -0.5 * sit);
    }
    // Грудь поднята — шея и голова её гасят: морда прямо вперёд, вверх её ведёт уже взгляд (`lookPitch`).
    add(o, 'neck', 0.28 * sit);
    add(o, 'head', 0.34 * sit);
    // Хвост лежит у лап полукругом.
    add(o, 'tail1', -0.75 * sit, 0.5 * sit);
    for (let i = 2; i <= TAIL_BONES; i++) add(o, `tail${i}`, 0.08 * sit, 0.6 * sit);
  }
  // Лежит «буханкой» (на подоконнике, на кровати): лапы под собой, голова поднята.
  const loaf = W('loaf');
  if (loaf > 0) {
    lift[1] += -0.13 * loaf;
    // Лапы — под собой: передние сложены назад под грудь, задние — под бока.
    for (const s of ['L', 'R']) {
      add(o, `arm${s}`, 1.3 * loaf);
      add(o, `fore${s}`, -2.55 * loaf);
      add(o, `paw${s}`, 0.5 * loaf);
      add(o, `thigh${s}`, -1.45 * loaf);
      add(o, `hock${s}`, 2.65 * loaf);
    }
    add(o, 'neck', -0.2 * loaf);
    for (let i = 1; i <= TAIL_BONES; i++) add(o, `tail${i}`, -0.1 * loaf, 0.44 * loaf);
  }
  // Клубком: лапы под собой, тело дугой (сверху — буква «С»), голова повёрнута к хвосту и лежит на лапах, хвост
  // обвит вокруг морды.
  const curl = W('curl');
  if (curl > 0) {
    // Наполовину на боку: клубок круглее, белое брюшко и лапы видно сверху.
    lift[1] += -0.125 * curl;
    tilt[2] += 0.55 * curl;
    for (const s of ['L', 'R']) {
      add(o, `arm${s}`, 1.1 * curl);
      add(o, `fore${s}`, -2.0 * curl);
      add(o, `thigh${s}`, -1.25 * curl);
      add(o, `hock${s}`, 2.3 * curl);
    }
    add(o, 'chest', 0.05 * curl, 0.6 * curl);
    add(o, 'pelvis', 0, -0.55 * curl);
    add(o, 'neck', 0.55 * curl, 0.75 * curl);
    add(o, 'head', 0.35 * curl, 0.45 * curl, 0.25 * curl);
    add(o, 'tail1', -0.2 * curl, -0.9 * curl);
    for (let i = 2; i <= TAIL_BONES; i++) add(o, `tail${i}`, 0.05 * curl, -0.66 * curl);
  }
  // Припал перед прыжком: грудь к полу, зад приподнят и виляет.
  const crouch = W('crouch');
  if (crouch > 0) {
    lift[1] += -0.08 * crouch;
    tilt[0] += 0.15 * crouch;
    for (const s of ['L', 'R']) {
      add(o, `arm${s}`, 0.6 * crouch);
      add(o, `fore${s}`, -1.4 * crouch);
      add(o, `thigh${s}`, -0.7 * crouch);
      add(o, `hock${s}`, 1.3 * crouch);
    }
    add(o, 'pelvis', 0, Math.sin(t * 9) * 0.12 * crouch);
    add(o, 'neck', -0.2 * crouch);
  }
  // В прыжке: лапы вытянуты вперёд и назад.
  const leap = W('leap');
  if (leap > 0) {
    for (const s of ['L', 'R']) {
      add(o, `arm${s}`, -0.9 * leap);
      add(o, `thigh${s}`, 0.9 * leap);
      add(o, `hock${s}`, -0.3 * leap);
    }
    add(o, 'neck', -0.15 * leap);
  }
  // Трётся боком: крен к ноге, голова бодает.
  if (l.roll !== 0) {
    tilt[2] += l.roll;
    add(o, 'head', 0, 0, l.roll * 0.8);
  }
  // Лапа бьёт клубок (правая передняя).
  if (l.bat > 0) {
    add(o, 'armR', -1.1 * l.bat, 0, 0.2 * l.bat);
    add(o, 'foreR', -0.5 * l.bat);
    add(o, 'pawR', 0.6 * l.bat);
  }
  // Взгляд.
  add(o, 'neck', -l.lookPitch * 0.4, l.lookYaw * 0.4, 0);
  add(o, 'head', -l.lookPitch * 0.6, l.lookYaw * 0.6, 0);
  // Веки: открыт — веко поднято под лоб, закрыт — опущено на глаз.
  add(o, 'lids', LID_CLOSE * (1 - Math.max(0, Math.min(1, l.eyes))));
  add(o, 'jaw', 0.5 * l.mouth);
  return { turns: o, lift, tilt };
}

// ---------- Кот на сцене и что он делает ----------

/** Куда кот ходит сам: места покоев (в осях комнаты). `y` — высота опоры (подоконник, кровать). */
export interface CatSpot {
  id: 'hearth' | 'sill' | 'bed' | 'floor';
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Откуда прыгают (пол рядом), если место выше пола. */
  from?: { x: number; z: number };
  body: CatBody;
}

const south = OPENINGS.find((o) => o.wall === 'south')!;
/** Места кота: шкура у огня (спит клубком), подоконник южного окна (сидит, на город), кровать (лежит буханкой). */
export const CAT_SPOTS: readonly CatSpot[] = [
  { id: 'hearth', x: 0.25, y: 0, z: -3.35, yaw: Math.PI + 0.4, body: 'curl' },
  { id: 'sill', x: 0.6, y: south.sill, z: HALF + south.plate + 0.25, yaw: -1.4, from: { x: 0.4, z: 5.4 }, body: 'sit' },
  { id: 'bed', x: (BED.x0 + BED.x1) / 2 + 0.2, y: BED.top + 0.1, z: BED.z1 - 0.45, yaw: -2.2, from: { x: BED.x1 + 0.35, z: BED.z1 - 0.3 }, body: 'loaf' },
];

/** Дольше стольких секунд кот за клубком к следующему прыжку не идёт — застрял, бросил (Р-1). */
const HOP_WALK = 8;

/** Простая зернистая случайность (кот — картинка, у партии своя кость). */
export function catRandom(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Что кот хочет сейчас — видно тестам и стенду. */
export type CatMind = 'wander' | 'rest' | 'go' | 'rub' | 'petted' | 'play' | 'carried' | 'hidden' | 'come' | 'fetch';

/** Где правитель — коту: место ног и куда смотрит глаз; сидит ли (тогда трётся о кресло, рядом). */
export interface CatWorld {
  ruler: { x: number; z: number; yaw: number; busy: boolean };
  /** Клубок: где он, катится ли. */
  ball: { x: number; y: number; z: number; moving: boolean } | null;
}

/**
 * Кот на сцене: место, высота опоры, поза. Мозг — машинка состояний: побродить, лечь (у огня, на кровати, на подоконнике),
 * прийти к правителю и потереться, играть с клубком; его могут взять на руки (несёт слуга) — тогда он часть рук.
 */
export class Cat {
  /** Тело: голый скелет, пока фигура в пути (`dress`), потом — её сетка. */
  rig: CatRig = bareRig();
  /** Фигура из куска `pet/` (ЛЦ-4); до неё кот не виден. */
  figure: CatFigure | null = null;
  x = 0.6;
  y = 0;
  z = -0.5;
  yaw = 0;
  visible = false;
  mind: CatMind = 'hidden';
  readonly look: CatLook = { body: 'stand', phase: 0, speed: 0, eyes: 1, mouth: 0, lookYaw: 0, lookPitch: 0, bat: 0, tailUp: 0, roll: 0 };
  /** Доли поз (плавно к `look.body`). */
  private w: Record<CatBody, number> = { stand: 1, walk: 0, sit: 0, curl: 0, crouch: 0, leap: 0, rub: 0, loaf: 0 };
  private path: { x: number; z: number }[] = [];
  private spot: CatSpot | null = null;
  private jump: { from: V3; to: V3; t: number; len: number; arc: number } | null = null;
  /** За клубком (Р-1): шаги и прыжки по порядку, потом — `hopsDone`. */
  private hops: Hop[] = [];
  private hopsDone: ((ok: boolean) => void) | null = null;
  private hopAt: V3 | null = null;
  private hopT = 0;
  private turnTo: V3 | null = null;
  /** Клубок в зубах: пасть приоткрыта. */
  mouthful = false;
  /** Доволен собой (принёс клубок): мурчит, хвост трубой, сколько ещё секунд. */
  private proud = 0;
  private timer = 0;
  private t = 0;
  private rng: () => number;
  /** Мяу, мурчание, мягкий шаг, толчок прыжка и приземление — звуку покоев. */
  onSound: ((s: 'meow' | 'purr' | 'step' | 'leap' | 'land', at: V3) => void) | null = null;
  /** Держат на руках: где руки (точка в осях комнаты и куда лицом). */
  held: { x: number; y: number; z: number; yaw: number } | null = null;
  private purr = 0;
  private blink = 0;
  private meowAt = 0;

  /** Куда мозг хочет смотреть (от тела), рад — глазам. */
  private want: [number, number] = [0, 0];

  constructor(seed: number) {
    this.rng = catRandom(seed);
    this.timer = 2 + this.rng() * 3;
  }

  /** Кот входит в покои: ставится в точку, начинает бродить. */
  appear(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.y = 0;
    this.yaw = yaw;
    this.visible = true;
    this.mind = 'wander';
    this.timer = 1.5;
    this.path = [];
    this.spot = null;
    this.jump = null;
  }

  /** Сразу лечь на место (вход в покои, где кот уже был; стенд). */
  settle(id: CatSpot['id']): void {
    const s = CAT_SPOTS.find((c) => c.id === id);
    if (!s) return;
    this.visible = true;
    this.x = s.x;
    this.y = s.y;
    this.z = s.z;
    this.yaw = s.yaw;
    this.spot = s;
    this.mind = 'rest';
    this.look.body = s.body;
    for (const k of Object.keys(this.w) as CatBody[]) this.w[k] = k === s.body ? 1 : 0;
    this.look.eyes = s.body === 'curl' ? 0 : 1;
    this.timer = 20 + this.rng() * 20;
  }

  /** Сесть на полу в точке и сидеть (стенд, тесты). */
  sitAt(x: number, z: number, yaw: number): void {
    this.poseAt(x, 0, z, yaw, 'sit');
  }

  /** Замереть в точке в позе (стенд снимков: прыжок в окно, с клубком в зубах — Р-1). */
  poseAt(x: number, y: number, z: number, yaw: number, body: CatBody): void {
    this.visible = true;
    this.x = x;
    this.z = z;
    this.y = y;
    this.yaw = yaw;
    this.spot = { id: 'floor', x, y, z, yaw, body };
    this.mind = 'rest';
    this.look.body = body;
    for (const k of Object.keys(this.w) as CatBody[]) this.w[k] = k === body ? 1 : 0;
    this.timer = 60;
  }

  hide(): void {
    this.visible = false;
    this.mind = 'hidden';
    this.held = null;
  }

  /** Где кот лежит или сидит сейчас (`null` — на полу, идёт). */
  get place(): CatSpot['id'] | null {
    return this.mind === 'rest' ? (this.spot?.id ?? null) : null;
  }

  /** Подойти к точке (зовут: «кис-кис» слуги, правитель тянет руку). */
  come(x: number, z: number): void {
    if (this.mind === 'carried' || this.mind === 'hidden' || this.mind === 'fetch') return;
    this.leaveSpot();
    this.mind = 'come';
    this.goTo({ x, z });
  }

  /** Гладят: кот стоит, жмурится, мурчит, хвост трубой. */
  pet(on: boolean): void {
    if (this.mind === 'carried' || this.mind === 'hidden' || this.mind === 'fetch') return;
    if (on) {
      if (this.mind !== 'petted') this.onSound?.('purr', [this.x, this.y, this.z]);
      this.mind = 'petted';
      this.path = [];
    } else if (this.mind === 'petted') {
      this.mind = 'wander';
      this.timer = 3 + this.rng() * 4;
    }
  }

  /** Играть: клубок брошен — кот за ним. */
  play(): void {
    if (this.mind === 'carried' || this.mind === 'hidden' || this.mind === 'fetch') return;
    this.leaveSpot();
    this.mind = 'play';
    this.timer = 9;
  }

  /**
   * За клубком (Р-1): шаги по полу и прыжки по порядку (`toss.fetchHops` — в окно и наружу; `windowBack` — обратно), в конце —
   * `then`. Лежал на месте — сперва спрыгивает.
   */
  route(hops: Hop[], then: (ok: boolean) => void): void {
    if (this.mind === 'carried' || this.mind === 'hidden') return;
    this.leaveSpot();
    this.mind = 'fetch';
    this.hops = [...hops];
    this.hopsDone = then;
    this.hopAt = null;
    this.path = [];
  }

  /** Вернуться прыжком (Р-1): кот возникает в `from` (вне кадра) и прыгает дугой `arc` в `to`, дальше — шаги `hops`. */
  leapIn(from: V3, to: V3, arc: number, hops: Hop[], then: (ok: boolean) => void): void {
    this.x = from[0];
    this.y = from[1];
    this.z = from[2];
    this.yaw = Math.atan2(to[0] - from[0], to[2] - from[2]);
    this.visible = true;
    this.held = null;
    this.spot = null;
    this.mind = 'fetch';
    this.hops = [{ to, jump: true, arc }, ...hops];
    this.hopsDone = then;
    this.hopAt = from;
    this.path = [];
    this.jump = null;
    for (const k of Object.keys(this.w) as CatBody[]) this.w[k] = k === 'crouch' ? 1 : 0;
  }

  /** Принёс: мурчит и задирает хвост `s` секунд. */
  pleased(s: number): void {
    this.proud = s;
  }

  /** В прыжке ли (тестам и клубку в зубах). */
  get leaping(): boolean {
    return this.jump !== null;
  }

  /** Мурчит ли сейчас (звук: громкость 0…1). */
  get purring(): number {
    return this.purr;
  }

  private leaveSpot(): void {
    if (!this.spot) return;
    const s = this.spot;
    this.spot = null;
    if (s.from && this.y > 0.05) this.jumpTo([s.from.x, 0, s.from.z]);
  }

  private goTo(p: { x: number; z: number }): void {
    // Путь кота — прямо, если свободно, иначе тем же графом обхода, что у правителя (кот меньше — пройдёт и там).
    const a = { x: this.x, z: this.z };
    if (clear(a, p, CAT_R)) this.path = [{ x: p.x, z: p.z }];
    else this.path = pathTo(a, p) ?? [{ x: p.x, z: p.z }];
  }

  private jumpTo(to: V3, arc?: number): void {
    const from: V3 = [this.x, this.y, this.z];
    const d = Math.hypot(to[0] - from[0], to[2] - from[2]);
    this.jump = { from, to, t: 0, len: 0.32 + d * 0.15 + Math.abs(to[1] - from[1]) * 0.12, arc: arc ?? 0.18 + Math.abs(to[1] - from[1]) * 0.35 };
    this.yaw = Math.atan2(to[0] - from[0], to[2] - from[2]);
    this.onSound?.('leap', from);
  }

  /** Шаг кадра: мозг, движение, поза. */
  step(dt: number, world: CatWorld): void {
    this.t += dt;
    if (!this.visible) return;
    if (this.held) {
      this.x = this.held.x;
      this.y = this.held.y;
      this.z = this.held.z;
      this.yaw = this.held.yaw;
      this.mind = 'carried';
      this.blend('loaf', dt);
      this.look.eyes += (0.7 - this.look.eyes) * dt * 2;
      this.purr += (0.4 - this.purr) * dt;
      return;
    }
    // Прыжок: дугой от и до, лапы вытянуты.
    if (this.jump) {
      const j = this.jump;
      j.t += dt / j.len;
      const k = Math.min(1, j.t);
      const e = k * k * (3 - 2 * k);
      this.x = j.from[0] + (j.to[0] - j.from[0]) * e;
      this.z = j.from[2] + (j.to[2] - j.from[2]) * e;
      this.y = j.from[1] + (j.to[1] - j.from[1]) * e + Math.sin(Math.PI * k) * j.arc;
      this.blend(k < 0.15 || k > 0.85 ? 'crouch' : 'leap', dt * 2);
      if (k >= 1) {
        this.jump = null;
        this.onSound?.('land', [this.x, this.y, this.z]);
      }
      return;
    }
    this.think(dt, world);
    this.move(dt);
    // Моргает, мурчит, мяукает изредка.
    this.blink -= dt;
    if (this.blink < 0) this.blink = 2.5 + this.rng() * 4;
    const sleeping = this.mind === 'rest' && this.spot?.body === 'curl';
    const blinkShut = this.blink < 0.12 ? 0 : 1;
    const eyesWant = sleeping ? 0 : this.mind === 'petted' ? 0.25 : blinkShut;
    this.look.eyes += (eyesWant - this.look.eyes) * Math.min(1, dt * (blinkShut === 0 ? 30 : 6));
    this.proud = Math.max(0, this.proud - dt);
    const proud = this.proud > 0;
    this.purr += ((this.mind === 'petted' ? 1 : proud ? 0.85 : sleeping ? 0.25 : 0) - this.purr) * Math.min(1, dt * 2);
    this.look.tailUp += ((this.mind === 'petted' || this.mind === 'rub' || this.mind === 'come' || proud ? 1 : 0) - this.look.tailUp) * Math.min(1, dt * 3);
    this.look.mouth = Math.max(this.mouthful ? 0.5 : 0, this.look.mouth - dt * 2.5);
    if (this.meowAt > 0 && this.t >= this.meowAt) {
      this.meowAt = 0;
      this.meow();
    }
  }

  /** Мяукнуть: рот открывается, звук. */
  meow(): void {
    this.look.mouth = 1;
    this.onSound?.('meow', [this.x, this.y + 0.25, this.z]);
  }

  private think(dt: number, world: CatWorld): void {
    this.timer -= dt;
    const r = world.ruler;
    const toRuler = Math.hypot(r.x - this.x, r.z - this.z);
    switch (this.mind) {
      case 'come': {
        // Подошёл — сел и смотрит снизу; правитель свободен — трётся о ноги.
        if (!this.path.length) {
          this.mind = 'rub';
          this.timer = 4 + this.rng() * 3;
        }
        return;
      }
      case 'rub': {
        // Круг у ног правителя: бок к ногам, хвост трубой; ушёл далеко — бросил.
        const a = this.t * 0.9;
        const rr = 0.32;
        const tx = r.x + Math.sin(a) * rr;
        const tz = r.z + Math.cos(a) * rr;
        this.path = [{ x: tx, z: tz }];
        if (this.timer < 0 || toRuler > 1.6) {
          this.mind = 'wander';
          this.timer = 2 + this.rng() * 3;
          if (this.rng() < 0.5) this.meowAt = this.t + 0.4;
        }
        return;
      }
      case 'petted':
        this.path = [];
        return;
      case 'fetch': {
        // Дошёл (или допрыгнул) — следующий шаг; шаги кончились — дело сделано. Идёт дольше `HOP_WALK` — застрял.
        this.hopT += dt;
        if (this.turnTo) {
          // Повернуться на месте: мордой к точке — и дальше.
          const err = wrapA(Math.atan2(this.turnTo[0] - this.x, this.turnTo[2] - this.z) - this.yaw);
          this.yaw = wrapA(this.yaw + Math.max(-3.5 * dt, Math.min(3.5 * dt, err)));
          this.blend('stand', dt);
          if (Math.abs(err) > 0.12 && this.hopT < 3) return;
          this.turnTo = null;
        }
        if (this.path.length && this.hopT < HOP_WALK) return;
        this.path = [];
        const h = this.hops.shift();
        // Прыгают только оттуда, куда дошли: застрял по дороге (путь перегородили) — бросил, сквозь камень не прыгает.
        const lost = !!h && h.jump && this.hopAt !== null && Math.hypot(this.x - this.hopAt[0], this.z - this.hopAt[2]) > 0.3;
        if (h && !lost) {
          this.hopT = 0;
          if (h.turn) {
            this.turnTo = h.to;
            return;
          }
          this.hopAt = h.to;
          if (h.jump) this.jumpTo(h.to, h.arc);
          else this.goTo({ x: h.to[0], z: h.to[2] });
          return;
        }
        const then = this.hopsDone;
        this.hopsDone = null;
        this.hops = [];
        this.hopAt = null;
        this.turnTo = null;
        this.mind = 'wander';
        this.timer = 2;
        then?.(!lost);
        return;
      }
      case 'play': {
        const b = world.ball;
        if (!b || this.timer < 0) {
          this.mind = 'wander';
          this.timer = 2;
          return;
        }
        const d = Math.hypot(b.x - this.x, b.z - this.z);
        if (d > 0.22) this.path = [{ x: b.x, z: b.z }];
        else {
          this.path = [];
          this.look.bat = Math.max(this.look.bat, Math.max(0, Math.sin(this.t * 7)) * 1);
        }
        return;
      }
      case 'rest': {
        if (this.timer < 0) {
          this.leaveSpot();
          this.mind = 'wander';
          this.timer = 2 + this.rng() * 4;
        }
        return;
      }
      case 'go': {
        if (!this.path.length && this.spot) {
          const s = this.spot;
          if (s.from) this.jumpTo([s.x, s.y, s.z]);
          else {
            this.x = s.x;
            this.z = s.z;
          }
          this.mind = 'rest';
          this.timer = s.id === 'hearth' ? 30 + this.rng() * 30 : 14 + this.rng() * 16;
        }
        return;
      }
      case 'wander':
      default: {
        if (this.path.length || this.timer > 0) return;
        const roll = this.rng();
        // Иногда — к правителю (он свободен и недалеко).
        if (!r.busy && roll < 0.22 && toRuler < 6) {
          this.come(r.x + Math.sin(r.yaw) * 0.45, r.z + Math.cos(r.yaw) * 0.45);
          this.meowAt = this.t + 0.8;
          return;
        }
        if (roll < 0.62) {
          const s = CAT_SPOTS[Math.floor(this.rng() * CAT_SPOTS.length)];
          this.spot = s;
          this.mind = 'go';
          this.goTo(s.from ?? { x: s.x, z: s.z });
          return;
        }
        // Побродить: точка на полу в паре метров.
        for (let i = 0; i < 8; i++) {
          const a = this.rng() * Math.PI * 2;
          const d = 0.8 + this.rng() * 2.2;
          const x = this.x + Math.sin(a) * d;
          const z = this.z + Math.cos(a) * d;
          if (free(x, z, CAT_R)) {
            this.goTo({ x, z });
            break;
          }
        }
        this.timer = 1.5 + this.rng() * 3;
      }
    }
  }

  private move(dt: number): void {
    const q = this.path[0];
    const want = this.mind === 'play' || this.mind === 'fetch' ? 1.4 : this.mind === 'rub' ? 0.35 : this.mind === 'come' ? 0.85 : 0.55;
    if (q) {
      const dx = q.x - this.x;
      const dz = q.z - this.z;
      const d = Math.hypot(dx, dz);
      const goal = Math.atan2(dx, dz);
      const turn = wrapA(goal - this.yaw);
      this.yaw = wrapA(this.yaw + Math.max(-4 * dt, Math.min(4 * dt, turn * (1 - Math.exp(-dt * 7)))));
      const v = Math.abs(turn) > 1.2 ? want * 0.3 : want;
      this.look.speed += (v - this.look.speed) * Math.min(1, dt * 5);
      const s = Math.min(d, this.look.speed * dt);
      const before = Math.floor(this.look.phase / Math.PI);
      const nx = this.x + Math.sin(this.yaw) * s;
      const nz = this.z + Math.cos(this.yaw) * s;
      const got = step({ x: this.x, z: this.z }, nx, nz, CAT_R);
      const stuck = Math.hypot(got.x - this.x, got.z - this.z) < s * 0.3;
      this.x = got.x;
      this.z = got.z;
      this.look.phase += (s / 0.16) * Math.PI;
      if (Math.floor(this.look.phase / Math.PI) !== before) this.onSound?.('step', [this.x, 0, this.z]);
      if (d < 0.08 || (stuck && this.mind !== 'rub' && this.mind !== 'fetch')) this.path.shift();
      this.blend(this.mind === 'rub' ? 'rub' : 'walk', dt);
      this.look.roll += ((this.mind === 'rub' ? 0.25 : 0) - this.look.roll) * Math.min(1, dt * 4);
    } else {
      this.look.speed = Math.max(0, this.look.speed - dt * 2);
      const body: CatBody = this.mind === 'rest' && this.spot ? this.spot.body : this.mind === 'play' ? 'crouch' : this.mind === 'petted' ? 'stand' : this.mind === 'rub' ? 'stand' : 'sit';
      this.blend(this.mind === 'wander' && this.timer > 1 ? 'stand' : body, dt);
      this.look.roll *= Math.exp(-dt * 4);
    }
    this.look.bat = Math.max(0, this.look.bat - dt * 2.5);
  }

  private blend(b: CatBody, dt: number): void {
    this.look.body = b;
    const k = Math.min(1, dt * 4);
    let sum = 0;
    for (const key of Object.keys(this.w) as CatBody[]) {
      this.w[key] += ((key === b ? 1 : 0) - this.w[key]) * k;
      sum += this.w[key];
    }
    for (const key of Object.keys(this.w) as CatBody[]) this.w[key] /= sum || 1;
  }

  /** Повернуть голову к точке (правитель, клубок). */
  lookAt(x: number, y: number, z: number): void {
    const dy = Math.atan2(x - this.x, z - this.z) - this.yaw;
    const d = Math.hypot(x - this.x, z - this.z);
    this.want = [Math.max(-1.1, Math.min(1.1, wrapA(dy))), Math.max(-0.4, Math.min(0.9, Math.atan2(y - this.y - 0.27, d)))];
    this.look.lookYaw += (this.want[0] - this.look.lookYaw) * 0.08;
    this.look.lookPitch += (this.want[1] - this.look.lookPitch) * 0.08;
  }

  /** Надеть фигуру (кусок `pet/` приехал): голый скелет уступает её сетке. */
  dress(f: CatFigure): void {
    this.rig.dispose();
    this.figure = f;
    this.rig = f.body;
  }

  /** Что видит живость фигуры (тестам и стенду — тоже). */
  state(): CatState {
    return { w: this.w, look: this.look, mind: this.mind, sleeping: this.mind === 'rest' && this.spot?.body === 'curl', wantYaw: this.want[0], wantPitch: this.want[1] };
  }

  pose(): RigPose {
    const { turns, lift, tilt } = catPosture(this.w, this.look, this.t);
    this.figure?.live({ turns, lift }, this.state(), this.t);
    return { x: this.x, y: this.y, z: this.z, yaw: this.yaw, lift, tilt, turns: turns as Record<string, Turn> };
  }

  draw(origin: V3): void {
    const shown = this.visible && !!this.figure;
    this.rig.mesh.visible = shown;
    if (!this.visible) return;
    this.rig.mesh.position.set(origin[0], origin[1], origin[2]);
    this.rig.pose(this.pose());
    if (!shown) return;
    this.rig.write();
    this.figure!.drawn();
  }
}

const wrapA = (a: number): number => {
  let x = a % (2 * Math.PI);
  if (x <= -Math.PI) x += 2 * Math.PI;
  if (x > Math.PI) x -= 2 * Math.PI;
  return x;
};

export { HEARTH };
