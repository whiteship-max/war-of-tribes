/**
 * Люди и звери посёлка вида `next` (этап 2, пункт 3; docs/graphics_world.md, 11.3).
 *
 * - **Покрои у костра** — к прежним трём (`units.dressVillager`) женщина в платке и переднике и ребёнок:
 *   толпа у огня читается людьми разного пола и возраста, а не одним мужиком в трёх рубахах.
 * - **Позы у огня** (`folkIdle`): кто-то греет руки, лицом к пламени, кто-то говорит — рука ходит в
 *   такт, голова кивает; ночью у огня греются почти все. Ходьбы на работу нет и не появляется
 *   (docs/handbook/graphics.md, «У костра стоят свободные руки»).
 * - **Собака у костра** лежит, встаёт, обнюхивает землю, переходит на другое место (`render/beasts.ts`).
 * - **Куры у огородов** роются в грядках: клюют, переступают, перебегают. На низком уровне их меньше.
 *
 * Всё — фигуры общего пула (`figures.FigurePool`): экземпляры семи примитивов, ни меша, ни материала,
 * ни вызова не прибавляется. Модуль едет ленивым куском окружения; до его прихода у костра прежние три
 * покроя и стойка. Случайность — устройства: это картинка, а не игра (как у жителей, `villagers.ts`).
 */
import * as THREE from 'three';
import { DOG, dressCanine, poseCanine, type CanineAction } from '../beasts';
import { Figure, addSlot, type FigurePool } from '../figures';
import { FOLK_TINT, PALETTE } from '../palette';
import { poseFigure } from '../poses';
import type { Quality } from '../quality';
import { FOLK_KINDS, MAN_HEIGHT, bodyOf, dressVillager, headwear, humanRig, neck, torso } from '../units';
import { gardenSpots } from './rules';

/** Покроев у костра вида `next`: прежние три, женщина и ребёнок. */
export const FOLK_KINDS_NEXT = FOLK_KINDS + 2;

/** Ребёнок — тот же покрой рубахи, ростом в две трети взрослого. */
const CHILD_SCALE = 0.66;

/** Одеть жителя у костра вида `next`. Покрои 0–2 — прежние, 3 — женщина, 4 — ребёнок. */
export function dressFolk(f: Figure, kind: number): void {
  const k = ((kind % FOLK_KINDS_NEXT) + FOLK_KINDS_NEXT) % FOLK_KINDS_NEXT;
  f.scale = 1;
  if (k < FOLK_KINDS) {
    dressVillager(f, k);
    return;
  }
  if (k === FOLK_KINDS + 1) {
    dressVillager(f, 0);
    f.scale = CHILD_SCALE;
    return;
  }
  // Женщина: подол до щиколоток (перевёрнутый корпус шире книзу), светлый передник и платок.
  const rig = humanRig(MAN_HEIGHT * 0.92, 0.9);
  const b = bodyOf(rig, 0.9);
  const cloth = FOLK_TINT[2];
  f.strip();
  f.rig = rig;
  torso(f, b, cloth, cloth, PALETTE.skin);
  neck(f, b);
  addSlot(f, 'body', 'hips', cloth, [0, rig.hipY * 0.02, 0], [b.chestW * 1.42, rig.hipY, b.chestW * 1.05], [Math.PI, 0, 0]);
  addSlot(f, 'plate', 'hips', PALETTE.apron, [0, -rig.hipY * 0.42, b.chestW * 0.43], [b.chestW * 0.72, rig.hipY * 0.78, b.headH * 0.06]);
  headwear(f, b, PALETTE.scarf, 0.6, 0.12);
}

/**
 * Поза жителя, пока он стоит у огня: стойка, а поверх — дело. Дело выбирает своя фаза фигуры: греет
 * руки (лицом к пламени, руки вперёд, ладони к огню), говорит (рука ходит в такт, голова кивает) или
 * просто стоит. Ночью у огня греются почти все.
 */
export function folkIdle(f: Figure, t: number, night: boolean): void {
  poseFigure(f, 'stand', t);
  const w = f.phase;
  const deed = Math.floor(w * 7) % 3;
  if (deed === 0 || (night && deed === 2)) {
    const p = f.position;
    f.rotationY = Math.atan2(-p.x, -p.z);
    f.armMain = -0.95 + 0.04 * Math.sin(t * 1.3 + w);
    f.armOff = -0.95 + 0.04 * Math.sin(t * 1.1 + w);
    f.elbowMain = 0.75;
    f.elbowOff = 0.75;
    f.armSpread = 0.14;
    f.headNod = 0.1;
  } else if (deed === 1) {
    f.armMain = -0.3 - 0.45 * (0.5 + 0.5 * Math.sin(t * 2.6 + w));
    f.elbowMain = 0.65;
    f.headNod = 0.07 * Math.sin(t * 1.9 + w);
    f.torsoTwist = 0.08 * Math.sin(t * 0.9 + w);
  }
}

/** Агент жителя: то, что сцена ему ставит, — покрой, фигура и поза у огня (`villagers.VillagerAgent`). */
export interface FolkAgent {
  readonly figure: Figure;
  readonly kind: number;
  idle: ((f: Figure, t: number, night: boolean) => void) | null;
}

// ---------- Собака у костра ----------

/** Где лежит собака: у самого огня, ближе жителей (они гуляют от 1.3). */
const DOG_MIN = 0.95;
const DOG_MAX = 1.25;
const DOG_SPEED = 0.55;

/**
 * Собака ходит дугой вокруг огня, а не хордой: прямая от одного места у костра к другому проходит
 * ближе к центру и при большом угле — через пламя. Место — угол и расстояние от огня.
 */
class Dog {
  readonly figure = new Figure();
  private act: CanineAction = 'lie';
  private timer = 4 + Math.random() * 6;
  private ang = Math.random() * Math.PI * 2;
  private rad = DOG_MIN;
  private toAng = 0;
  private toRad = DOG_MIN;

  constructor() {
    dressCanine(this.figure, DOG);
    this.place();
    this.faceFire();
  }

  private place(): void {
    this.figure.position.set(Math.cos(this.ang) * this.rad, this.figure.position.y, Math.sin(this.ang) * this.rad);
  }

  private faceFire(): void {
    const p = this.figure.position;
    this.figure.rotationY = Math.atan2(-p.x, -p.z);
  }

  update(dt: number, t: number, night: boolean): void {
    const f = this.figure;
    if (this.act === 'walk') {
      const da = this.toAng - this.ang;
      if (Math.abs(da) > 0.01) {
        const step = Math.min(Math.abs(da), (DOG_SPEED * dt) / this.rad) * Math.sign(da);
        this.ang += step;
        this.rad += (this.toRad - this.rad) * Math.min(1, (Math.abs(step) / Math.abs(da)) || 1);
        this.place();
        // Вдоль дуги: касательная по ходу.
        f.rotationY = Math.atan2(-Math.sin(this.ang) * Math.sign(da), Math.cos(this.ang) * Math.sign(da));
        f.position.y = -poseCanine(f, 'walk', t);
        return;
      }
      this.act = 'sniff';
      this.timer = 1.5 + Math.random() * 2;
    }
    f.position.y = -poseCanine(f, this.act, t);
    this.timer -= dt;
    if (this.timer > 0) return;
    // Ночью лежит дольше; днём чаще встаёт, обнюхивает и переходит.
    const r = Math.random();
    if (this.act === 'lie') {
      this.act = r < (night ? 0.7 : 0.35) ? 'lie' : 'stand';
    } else if (r < 0.45) {
      this.act = 'lie';
      this.faceFire();
    } else if (r < 0.7) {
      this.act = 'sniff';
    } else {
      this.toAng = this.ang + (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 1.2);
      this.toRad = DOG_MIN + Math.random() * (DOG_MAX - DOG_MIN);
      this.act = 'walk';
    }
    this.timer = this.act === 'lie' ? 6 + Math.random() * 10 : 2 + Math.random() * 3;
  }
}

// ---------- Куры у огородов ----------

const HEN_SIZE = 0.3;
const HEN_RANGE = 0.6;
const HEN_SPEED = 0.32;

/** Курица: тело-шар, хвост вверх-назад, голова с гребнем и клювом, две ноги. Скелет — крошечный человеческий. */
function dressHen(f: Figure, brown: boolean): void {
  const h = HEN_SIZE;
  const rig = humanRig(h, 1);
  const body = brown ? PALETTE.henBrown : PALETTE.hen;
  f.strip();
  f.rig = rig;
  addSlot(f, 'head', 'hips', body, [0, h * 0.06, 0], [h * 0.42, h * 0.36, h * 0.56]);
  addSlot(f, 'cap', 'hips', body, [0, h * 0.12, -h * 0.24], [h * 0.22, h * 0.3, h * 0.12], [-1.0, 0, 0]);
  addSlot(f, 'head', 'head', body, [0, 0, h * 0.12], [h * 0.2, h * 0.22, h * 0.22]);
  addSlot(f, 'cap', 'head', PALETTE.comb, [0, h * 0.1, h * 0.12], [h * 0.06, h * 0.1, h * 0.12]);
  addSlot(f, 'cap', 'head', PALETTE.beak, [0, 0, h * 0.24], [h * 0.06, h * 0.1, h * 0.06], [Math.PI / 2, 0, 0]);
  for (const leg of ['legL', 'legR'] as const) addSlot(f, 'limb', leg, PALETTE.beak, [0, 0, 0], [h * 0.04, rig.legLen, h * 0.04]);
}

type HenAct = 'peck' | 'walk' | 'stand';

class Hen {
  readonly figure = new Figure();
  private act: HenAct = 'peck';
  private timer = Math.random() * 3;
  private target = new THREE.Vector3();

  constructor(private readonly home: { x: number; z: number }, brown: boolean) {
    dressHen(this.figure, brown);
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * HEN_RANGE;
    this.figure.position.set(home.x + Math.cos(a) * r, 0, home.z + Math.sin(a) * r);
    this.figure.rotationY = Math.random() * Math.PI * 2;
  }

  update(dt: number, t: number): void {
    const f = this.figure;
    const p = f.position;
    const w = f.phase;
    f.pitch = 0;
    f.headNod = 0;
    f.legSwing = 0;
    f.bob = 0;
    if (this.act === 'walk') {
      const dx = this.target.x - p.x;
      const dz = this.target.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.03) {
        const step = Math.min(d, HEN_SPEED * dt);
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
        f.rotationY = Math.atan2(dx, dz);
        f.legSwing = Math.sin(t * 18 + w) * 0.55;
        f.bob = Math.abs(Math.sin(t * 18 + w)) * 0.01;
        f.headNod = 0.25 * Math.sin(t * 18 + w);
        return;
      }
      this.act = 'peck';
      this.timer = 1 + Math.random() * 3;
    }
    if (this.act === 'peck') {
      // Клюёт часто и коротко: наклон всем телом, голова — рывком.
      const k = Math.pow(Math.max(0, Math.sin(t * 7 + w)), 3);
      f.pitch = 0.75 * k;
      f.headNod = 0.4 * k;
    } else {
      f.headNod = 0.2 * Math.sign(Math.sin(t * 1.7 + w));
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    const r = Math.random();
    if (r < 0.45) {
      this.act = 'peck';
    } else if (r < 0.65) {
      this.act = 'stand';
    } else {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * HEN_RANGE;
      this.target.set(this.home.x + Math.cos(a) * rr, 0, this.home.z + Math.sin(a) * rr);
      this.act = 'walk';
    }
    this.timer = 1 + Math.random() * 3;
  }
}

/** Сколько кур по уровню: на низком меньше всего. Собака одна на всех уровнях. */
export const HENS: Record<Quality, number> = { low: 3, medium: 6, high: 9 };

/** По скольку кур у одного огорода. */
const HENS_PER_GARDEN = 3;

export interface VillageLife {
  /** Одеть жителя у костра в покрой вида `next` и дать ему позы у огня. */
  dressFolk(agent: FolkAgent): void;
  /** Звери на этот кадр: собака и куры. */
  update(dt: number, t: number, night: boolean): void;
  /** Снять зверей с пула (сцена выгружается). */
  dispose(): void;
  /** Сколько зверей стоит: собака и куры. */
  readonly beasts: number;
}

/** Завести жизнь посёлка вида `next` на общем пуле фигур сцены. */
export function startLife(o: { pool: FigurePool; quality: Quality }): VillageLife {
  const dog = new Dog();
  const hens: Hen[] = [];
  const spots = gardenSpots();
  for (let i = 0; i < HENS[o.quality] && spots.length > 0; i++) {
    hens.push(new Hen(spots[Math.floor(i / HENS_PER_GARDEN) % spots.length], i % 3 === 1));
  }
  o.pool.add(dog.figure);
  for (const h of hens) o.pool.add(h.figure);
  return {
    dressFolk(agent: FolkAgent): void {
      dressFolk(agent.figure, agent.kind);
      agent.idle = folkIdle;
      o.pool.fit();
    },
    update(dt: number, t: number, night: boolean): void {
      dog.update(dt, t, night);
      for (const h of hens) h.update(dt, t);
    },
    dispose(): void {
      o.pool.remove(dog.figure);
      for (const h of hens) o.pool.remove(h.figure);
    },
    beasts: 1 + hens.length,
  };
}
