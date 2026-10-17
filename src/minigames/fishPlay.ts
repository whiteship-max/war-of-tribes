/**
 * «Рыбалка» в сцене: берег, вода, удочка в руках, поплавок, леска и рыба (docs/minigames.md, раздел 17).
 *
 * Правило — в `fishing.ts`: где упадёт поплавок, какая рыба подойдёт, когда дрогнет и когда утонет, как рвётся рыба
 * и выдержит ли леска. Здесь только то, что видно и слышно: удилище уходит за плечо и хлещет вперёд, поплавок летит
 * дугой и шлёпается, по воде идут круги, поплавок вздрагивает и тонет, удилище гнётся дугой к рыбе, рыба бьётся у
 * поверхности и выпрыгивает, катушка трещит, а вытащенная рыба висит перед глазами и блестит.
 *
 * РУКИ (docs/minigames.md, 18.1): слева — палец движения, справа — кнопка. Ходить на берегу некуда: палец вбок —
 * куда бросить, на вываживании — удилище против рывка. Кнопку держат — замах, сила растёт (`CHARGE_S`), отпустили —
 * заброс; на ожидании нажатие — подсечка; на вываживании держишь — подтягиваешь, отпустил — рыба берёт леску. Взгляд
 * ведёт игра (`Play.lead`): за поплавком и за рыбой.
 *
 * БЕРЕГ ПОВЁРНУТ К СОЛНЦУ. Правило считает в своих осях (вода — к −Z); сцена ставит весь берег одной группой так, чтобы
 * утреннее солнце стояло слева-спереди (`SHORE_YAW`): по воде бежит его блик, а поплавок не теряется в нём.
 *
 * Своим куском (`Minigame.tsx` грузит его по «К воде»): остальные промыслы его не качают.
 */
import * as THREE from 'three';
import type { Surfaces } from '@/prologue/surface';
import type { Shade } from '@/prologue/models';
import type { Blocker } from '@/prologue/glade';
import { EYE } from '@/prologue/glade';
import { KEY_AZIMUTH } from '@/render/lighting';
import type { Season } from '@/game/types';
import type { Zone } from '@/render/climate';
import { haptic } from '@/telegram/webapp';
import { dec } from '@/game/num';
import { NatureMats, bloomSpots, flower, grassClump, grassSpots, scatter } from './nature';
import { DENSITY } from './places';
import type { Tier } from '@/prologue/look';
import { Sparks, type Burst } from './sparks';
import {
  BANK_Z,
  CAST_ARC,
  CAST_WEAK,
  FISH_STREAK,
  Fishing,
  castPoint,
  dirOf,
  flightS,
  poolOf,
  spotAt,
  type FishEvent,
  type FishId,
  type Hooked,
  type Shore,
} from './fishing';
import {
  FISH_LOOK,
  WATER_Y,
  farBank,
  fishGeometry,
  fishLength,
  fishMaterial,
  fishMotion,
  floatMesh,
  forestBand,
  headland,
  layTrees,
  reedsMesh,
  shoreRocks,
  snagMesh,
  treesGroup,
  bankGround,
  waterMesh,
  waterUniforms,
  weedRocksMesh,
  RINGS,
  type WaterUniforms,
} from './fishModels';
import { FishRig } from './fishRig';
import { fishSound, type Ear, type FishSound } from './fishSound';
import type { Hour, Tally, Target } from './rules';
import { solarOf, type Play } from './stage';
import { nightOf } from '@/render/water/moon';
import { syncWaterLight } from '@/render/water/material';
import { LAYOUT_OF } from './pad';

/** Где ловят: берег, пояс, сезон и дождь — оболочка выводит их из города (`ui/parts/weather`). */
export interface FishContext {
  shore: Shore;
  zone: Zone;
  season: Season;
  /** Дождь сейчас, 0..1: круги на воде и мокрый берег. */
  rain: number;
  /** Час города: на зорьке клюёт бойко, днём — лениво (`fishing.HOUR_BITE`). Нет — утро. */
  hour?: Hour;
}

/**
 * Утро у воды — тот же час, что у «Охоты»: солнце уже поднялось, утренняя дымка сошла. Раньше (0.06) дымка рассвета
 * и солнце в лицо выбеливали воду до молока (снимок `f1`).
 */
export const SOLAR = 0.13;
/** Солнце — на столько левее середины взгляда, рад: свет сбоку-спереди лепит волну, а в глаза не бьёт. */
const SUN_LEFT = 1.35;
/**
 * Рыскание солнца в час `solar` — та же формула азимута, что у рига света (`lighting.applyDayNight`): азимут —
 * `KEY_AZIMUTH + (solar − 0.25)·1.25`, а в рыскании камеры (0 — к −Z) он на π дальше. Тест сверяет с ригом.
 */
export const sunYaw = (solar: number): number => KEY_AZIMUTH + (solar - 0.25) * 1.25 + Math.PI;
/** Поворот берега: вода правила (−Z) — туда, где солнце слева-спереди. */
export const SHORE_YAW = sunYaw(SOLAR) - SUN_LEFT;

/**
 * Замах — кнопкой (docs/minigames.md, 18.1): держишь «Заброс» — удилище уходит за плечо и сила растёт, полная — за
 * столько секунд; отпустил — бросок. Полторы секунды — чтобы ближний заброс и дальний различались на глаз, а не на
 * кадр: метка на воде бежит от берега, и отпускают, когда она легла, куда надо.
 */
export const CHARGE_S = 1.4;

/** Брызги: от поплавка — горсть, от рыбы — веер, от вытащенной — капли. */
const SPLASH: Record<'float' | 'fish' | 'drip' | 'jump', Burst> = {
  float: { colors: [0xffffff, 0xd8eef2, 0xc4e2ea], n: 10, speed: 0.9, up: 1.1, gravity: 9, life: 0.55, drag: 0.6 },
  fish: { colors: [0xffffff, 0xe2f2f4, 0xb9dbe4], n: 18, speed: 1.8, up: 1.6, gravity: 9, life: 0.8, drag: 0.5 },
  jump: { colors: [0xffffff, 0xe2f2f4, 0xb9dbe4], n: 24, speed: 2.2, up: 2.2, gravity: 9, life: 0.9, drag: 0.4 },
  drip: { colors: [0xe8f4f8, 0xffffff], n: 3, speed: 0.15, up: 0, gravity: 6, life: 0.6, drag: 0.2 },
};

/** Что сказать над прицелом. */
const SAY: Partial<Record<FishEvent['kind'], string>> = {
  weak: 'Замах слабый, тяни сильнее',
  hang: 'Зацеп',
  early: 'Рано, крючок пустой',
  missed: 'Объела насадку',
  hooked: 'На крючке',
  snap: 'Леска лопнула',
  slack: 'Сошла',
};

/** Вес словами: «340 г», «2,4 кг». */
export const weightText = (grams: number): string => (grams < 1000 ? `${Math.round(grams / 10) * 10} г` : `${dec(grams / 1000, 1)} кг`);

/** Прыжок рыбы: столько длится дуга над водой. */
const JUMP_S = 0.75;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _x = new THREE.Vector3(1, 0, 0);
const _e = new THREE.Euler();
const _col = new THREE.Color();
const _col2 = new THREE.Color();
/** Уровень воды по ступени промысла: подробно, телефон, пол (`render/water`). */
const WATER_LOD: Record<Tier, number> = { full: 2, lite: 1, base: 0 };
const _la = new THREE.Vector3();
const _lb = new THREE.Vector3();
const smooth = (k: number): number => {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
};
/** Угол к ближайшему: разность рысканий в (−π, π]. */
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export class FishPlay implements Play {
  readonly solar = SOLAR;
  readonly start = { x: 0, z: 0, yaw: SHORE_YAW };
  /** На берегу не ходят: удочка — весь экран. */
  readonly roam = 0.01;
  readonly shadowHalf = 16;
  /** Слева — палец движения (куда бросить, удилище вбок), справа — кнопка: заброс, подсечка, тянуть. */
  readonly layout = LAYOUT_OF.fish;
  readonly fog: { near: number; far: number };
  readonly far: number;
  readonly focus = 60;
  readonly game: Fishing;
  private ctx: FishContext;
  /** Берег — одной группой в осях правила, повёрнутой к солнцу. */
  private world = new THREE.Group();
  private camera: THREE.Camera | null = null;
  private scene: THREE.Scene | null = null;
  private rig: FishRig | null = null;
  private sound: FishSound | null = null;
  private water: WaterUniforms = waterUniforms();
  private float: THREE.Mesh | null = null;
  private line: THREE.LineSegments | null = null;
  private linePos: Float32Array = new Float32Array(0);
  private marker: THREE.Mesh | null = null;
  private fish = new Map<FishId, THREE.Mesh>();
  /** Ступень входа (`Play.dress`) и материалы берега (`nature.ts`). */
  private tier: Tier = 'lite';
  private mats: NatureMats | null = null;
  private shine = { value: 1 };
  /** Изгиб тела рыбы (`fishModels.fishMotion`): плывёт, бьётся на крючке, бьёт хвостом в руке. */
  private motion = fishMotion();
  private sparks = new Sparks(0.05);
  /** Капли с рыбы в руке — мельче брызг: у самых глаз крупная точка читалась бы шаром. */
  private drips = new Sparks(0.008);

  private notes: string[] = [];
  /** Часы сцены: вода, круги, рябь, качание. */
  private clock = 0;
  /** Круги на воде: x, z правила, начало по часам сцены, сила. */
  private rings: { x: number; z: number; t0: number; a: number }[] = [];
  private ringNext = 0;
  /** Замах: сколько протянул палец, рад взгляда; сила — доля полного. */
  /** С какой секунды часов рига держат «Заброс»; не держат — `null`. */
  private chargeFrom: number | null = null;
  /** Удилище вбок, −1..1 — копится от пальца на вываживании. */
  private rodSide = 0;
  private rodSent = 0;
  /** Где был поплавок, когда пошёл назад, — от него он едет к удилищу. */
  private backFrom = new THREE.Vector3();
  /** Откуда летит поплавок: хлыст в миг заброса, в осях правила. */
  private flyFrom = new THREE.Vector3();
  /** Рыба на виду: место, глубина, рыскание. */
  private fishVis = { x: 0, z: 0, y: WATER_Y - 0.3, yaw: 0 };
  private jumpAt = -1e9;
  /** Где была рыба на прошлом кадре — от этого её курс. */
  private fishWas = { x: 0, z: 0 };
  /** Брызги у бьющейся рыбы — раз в столько. */
  private thrashDue = 0;
  /** Что вытащили — висит в руке в фазе показа. */
  private shown: Hooked | null = null;
  /** Рот вытащенной рыбы — в осях берега: туда идёт леска. */
  private mouth = new THREE.Vector3();
  /** Длина лески прошлого кадра — щелчкам катушки. */
  private distWas = 0;
  private clickOwed = 0;
  private strainDue = 0;
  private warnDue = 0;
  private blockers_: Blocker[] = [];
  private lastPhase = 'idle';

  constructor(seed: number, ctx: FishContext) {
    this.ctx = ctx;
    // С серией рыб подряд (`fishing.FISH_STREAK`) — правила этапа 6.
    this.game = new Fishing(seed, { shore: ctx.shore, zone: ctx.zone, season: ctx.season, hour: ctx.hour }, true);
    const sea = ctx.shore === 'sea';
    this.fog = sea ? { near: 40, far: 420 } : { near: 30, far: 150 };
    this.far = sea ? 800 : 260;
    this.world.rotation.y = SHORE_YAW;
    this.world.name = 'shore';
  }

  // ---------- Берег ----------

  /** Подробность деревьев и травы берега по ступени входа (`places.DENSITY`). Зовётся до `land`. */
  dress(tier: Tier): void {
    this.tier = tier;
  }

  land(scene: THREE.Scene, surfaces: Surfaces, _shade: Shade, season: Season): void {
    const { shore, zone } = this.ctx;
    const f = this.game.field;
    const w = this.world;
    w.add(surfaces.adopt(bankGround(shore, season)));
    if (shore === 'river') {
      w.add(surfaces.adopt(farBank(season)), surfaces.adopt(forestBand()));
      w.add(surfaces.adopt(snagMesh('river', f.snag, season)));
      // Камыш: заросль на месте травы и бахрома вдоль своего берега по краям.
      const fringe = [-1, 1].flatMap((s) => [0, 1, 2].map((k) => ({ x: s * (5 + k * 4.5), z: BANK_Z - 0.4, r: 1.1, n: 16 })));
      w.add(surfaces.adopt(reedsMesh([{ x: f.weeds.x, z: f.weeds.z, r: f.weeds.r, n: 70 }, ...fringe], season), 'tuft'));
    } else {
      const side = f.weeds.x < 0 ? -1 : 1;
      w.add(surfaces.adopt(headland(zone, side)));
      w.add(surfaces.adopt(snagMesh('sea', f.snag, season)), surfaces.adopt(weedRocksMesh(f.weeds)));
    }
    w.add(surfaces.adopt(shoreRocks(shore, 7)));
    // Деревья: ближние отбрасывают тень на свой берег, дальние — нет (тень за коробкой теней — пустая трата прохода).
    const trees = layTrees(shore, zone, 3);
    const nearTree = (t: { x: number; z: number }): boolean => t.z > BANK_Z && Math.hypot(t.x, t.z) < 22;
    // Мягкие деревья, трава и цветы — местами промыслов (`nature.ts`, П-4).
    this.mats = new NatureMats(surfaces.u);
    const d = DENSITY[this.tier];
    w.add(treesGroup(trees.filter(nearTree), season, this.mats, true, d.near));
    w.add(treesGroup(trees.filter((t) => !nearTree(t)), season, this.mats, false, d.far));
    // Трава у ног — пучками, не у самой воды: вода отрезана огромным кругом, его край у кромки почти прям.
    const water = [{ x: 0, z: BANK_Z - 400, r: 400.9 }];
    const grass = scatter(grassClump(9, season, 3), this.mats.of('grass'), grassSpots(Math.round(d.grass * 0.5), 0, 5, 1.2, 15, 0.24, 0.5, water, 31), 'grass');
    const bloom = scatter(flower(), this.mats.of('grass'), bloomSpots(Math.round(d.bloom * 0.4), 0, 6, 2, 14, season, water, 37), 'bloom');
    for (const m of [grass, bloom]) if (m) w.add(m);
    w.add(waterMesh(shore, this.water));
    // Течение реки — вдоль берега (ось x правила); море стоит. Ступень промысла — уровень воды (`render/water`).
    this.water.wFlow.value = shore === 'river' ? 0.35 : 0;
    this.water.wYaw.value = SHORE_YAW;
    this.water.wRain.value = Math.min(1, this.ctx.rain);
    this.water.wCloud.value = Math.min(1, this.ctx.rain * 1.4);
    this.water.wLod.value = WATER_LOD[this.tier];
    scene.add(w);
  }

  build(scene: THREE.Scene, _surfaces: Surfaces, _shade: Shade, camera: THREE.Camera): void {
    this.scene = scene;
    this.camera = camera;
    this.float = floatMesh();
    this.world.add(this.float);
    // Леска: ломаная из двадцати четырёх колен — от хлыста к поплавку и дальше к рыбе.
    const n = 24;
    this.linePos = new Float32Array(n * 2 * 3);
    const g = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(this.linePos, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', pa);
    this.line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xe8e4d6, transparent: true, opacity: 0.85 }));
    this.line.frustumCulled = false;
    this.line.name = 'line';
    this.world.add(this.line);
    // Метка заброса: куда упадёт поплавок при этой силе — кольцо на воде.
    this.marker = markerRing();
    this.marker.visible = false;
    this.world.add(this.marker);
    // Рыбы этого берега — по мешу на вид; видна одна, та, что на крючке или в руке.
    const mat = fishMaterial(this.shine, this.motion);
    for (const def of poolOf(this.game.setting)) {
      const m = new THREE.Mesh(fishGeometry(def.id), mat);
      m.visible = false;
      m.castShadow = false;
      m.name = `fish-${def.id}`;
      this.fish.set(def.id, m);
      this.world.add(m);
    }
    this.world.add(this.sparks.points, this.drips.points);
    this.rig = new FishRig();
    camera.add(this.rig.root);
    this.frame(0, 0);
  }

  blockers(): Blocker[] {
    return this.blockers_;
  }

  /** Тапом на рыбалке не трогают ничего: удочка — весь экран. */
  targets(): Target[] {
    return [];
  }

  tap(): string {
    return '';
  }

  // ---------- Палец ----------

  begin(): void {
    this.sound ??= fishSound();
    this.sound.arm(this.ctx.shore === 'sea', this.ctx.rain);
  }

  draw(t: number): void {
    const was = this.game.phase;
    this.game.press(t);
    if (was === 'idle' && this.game.phase === 'charge') this.chargeFrom = this.clock;
  }

  loose(t: number, shoot: boolean): void {
    const phase = this.game.phase;
    if (phase === 'charge') {
      const power = this.power();
      this.flyFrom.copy(this.tipLocal());
      this.game.release(t, power, this.aimYaw(), shoot);
    } else this.game.release(t, 0, 0);
    this.chargeFrom = null;
  }

  /** Палец движения вбок на вываживании — удилище против рывка (−1 влево, 1 вправо); в замахе он водит взглядом. */
  pad(strafe: number, t: number): void {
    if (this.game.phase !== 'fight' || !this.game.line) return;
    this.rodSide = Math.max(-1, Math.min(1, strafe));
    if (Math.abs(this.rodSide - this.rodSent) > 0.03) {
      this.rodSent = this.rodSide;
      this.game.steer(t, this.rodSide);
    }
  }

  /** Сила замаха, 0..1: сколько держат «Заброс». */
  power(): number {
    return this.chargeFrom === null || this.game.phase !== 'charge' ? 0 : Math.max(0, Math.min(1, (this.clock - this.chargeFrom) / CHARGE_S));
  }

  /** Кнопка действия по фазе: заброс держат, подсечку жмут, катушку держат. */
  act(): { label: string; ready: boolean; hold: boolean; on: boolean } {
    const g = this.game;
    switch (g.phase) {
      case 'idle':
        return { label: 'Заброс', ready: true, hold: true, on: false };
      case 'charge':
        return { label: 'Заброс', ready: true, hold: true, on: true };
      case 'wait':
        return { label: 'Подсечь', ready: true, hold: false, on: false };
      case 'fight':
        return { label: 'Тянуть', ready: true, hold: true, on: !!g.line?.reeling };
      default:
        return { label: g.phase === 'show' ? 'Тянуть' : 'Подсечь', ready: false, hold: false, on: false };
    }
  }

  /** Куда бросает: рыскание камеры в осях правила. */
  private aimYaw(): number {
    const cam = this.camera;
    return cam ? wrap(cam.rotation.y - SHORE_YAW) : 0;
  }

  lookScale(): number {
    // Взгляд за пальцем — только в замахе: вбок — куда бросить. Дальше палец — удочка, а взгляд ведёт игра.
    return this.game.phase === 'charge' || this.game.phase === 'idle' ? 1 : 0;
  }

  stride(): number {
    return 0;
  }

  lead(yaw: number, pitch: number, dt: number): { yaw: number; pitch: number } | null {
    const g = this.game;
    const k = 1 - Math.exp(-dt * 3);
    const toward = (x: number, z: number, rate: number, lift = 0.05): { yaw: number; pitch: number } => {
      const d = Math.max(1, Math.hypot(x, z));
      const ty = SHORE_YAW + Math.atan2(-x, -z);
      const tp = -Math.atan2(EYE - WATER_Y, d) + lift;
      const kk = 1 - Math.exp(-dt * rate);
      return { yaw: yaw + wrap(ty - yaw) * kk, pitch: pitch + (tp - pitch) * kk };
    };
    switch (g.phase) {
      case 'charge': {
        // Куда бросить — не дальше `CAST_ARC` от прямо; взгляд опускается к метке, пока палец тянет.
        const rel = Math.max(-CAST_ARC, Math.min(CAST_ARC, wrap(yaw - SHORE_YAW)));
        const p = castPoint(this.power(), rel);
        const tp = -Math.atan2(EYE - WATER_Y, Math.max(3, p.d)) + 0.03;
        return { yaw: SHORE_YAW + rel, pitch: pitch + (tp - pitch) * k };
      }
      case 'flight':
      case 'wait':
      case 'hang': {
        const at = g.phase === 'flight' && g.land ? g.land : g.floatAt(g.phase === 'wait' ? this.ruleT : 0);
        return toward(at.x, at.z, g.phase === 'flight' ? 3.5 : 2);
      }
      case 'fight': {
        const at = g.fishAt();
        return at ? toward(at.x, at.z, 3, 0.08) : null;
      }
      case 'show':
        return { yaw, pitch: pitch + (-0.22 - pitch) * k };
      default:
        // Готовая удочка: взгляд водит палец, но не дальше дуги заброса — бросать за неё некуда.
        return { yaw: SHORE_YAW + Math.max(-CAST_ARC, Math.min(CAST_ARC, wrap(yaw - SHORE_YAW))), pitch: pitch + (-0.1 - pitch) * (1 - Math.exp(-dt * 1.5)) };
    }
  }

  gauge(): { mode: 'cast' | 'line'; k: number; warn: boolean } | null {
    const g = this.game;
    if (g.phase === 'charge') return { mode: 'cast', k: this.power(), warn: false };
    if (g.phase === 'fight' && g.line) return { mode: 'line', k: Math.min(1, g.line.tension), warn: g.line.tension > 0.85 };
    return null;
  }

  cue(): string {
    switch (this.game.phase) {
      case 'idle':
        return 'Держи «Заброс» и отпусти';
      case 'charge':
        return this.power() < CAST_WEAK ? 'Держи — сильнее' : 'Пальцем вбок — куда, отпусти — заброс';
      case 'flight':
      case 'wait':
        return 'Утонет поплавок — «Подсечь»';
      case 'fight':
        return 'Держи — тянуть, пальцем вбок — удилище';
      default:
        return '';
    }
  }

  streak(): number {
    return this.game.streak?.run ?? 0;
  }

  aside(): string {
    const L = this.game.line;
    if (this.game.phase === 'fight' && L) return `${Math.round(L.dist)} м`;
    return `Рыб ${this.game.catches.length}`;
  }

  say(): string {
    return this.notes.shift() ?? '';
  }

  tick(): void {
    this.sound?.tick();
  }

  tally(): Tally {
    return this.game.tally();
  }

  // ---------- Кадр ----------

  /** Секунда игры прошлого кадра. */
  private ruleT = 0;

  frame(t: number, dt: number): void {
    this.ruleT = t;
    this.clock += dt;
    const g = this.game;
    g.advance(t);
    if (g.phase !== this.lastPhase) {
      if (g.phase === 'back' && this.float) this.backFrom.copy(this.float.position);
      if (g.phase === 'fight' && g.line) {
        this.distWas = g.line.dist;
        this.rodSide = 0;
        this.rodSent = 0;
        const at = g.floatAt(t);
        this.fishVis = { x: at.x, z: at.z, y: WATER_Y - 0.25, yaw: 0 };
        this.fishWas = { x: at.x, z: at.z };
      }
      this.lastPhase = g.phase;
    }
    this.react(g.takeEvents());
    this.syncSun();
    this.syncRig(dt);
    this.syncFloat(t);
    this.syncFish(t, dt);
    this.syncLine();
    this.syncMarker();
    this.syncReel(dt);
    this.sparks.frame(dt);
    this.drips.frame(dt);
    this.water.wTime.value = this.clock;
    const rv = this.water.wSplash.value;
    for (let i = 0; i < RINGS; i++) {
      const r = this.rings[i];
      if (r) rv[i].set(r.x, r.z, r.t0, r.a);
      else rv[i].set(0, 0, -99, 0);
    }
  }

  /** Круг на воде — в кольцевой буфер: старый уступает место новому. */
  private ring(x: number, z: number, a: number): void {
    const r = { x, z, t0: this.clock, a };
    if (this.rings.length < RINGS) this.rings.push(r);
    else {
      this.rings[this.ringNext] = r;
      this.ringNext = (this.ringNext + 1) % RINGS;
    }
  }

  private splash(x: number, z: number, b: Burst, y = WATER_Y + 0.02): void {
    this.sparks.burst(x, y, z, b);
  }

  /** Ухо рыболова: где камера и куда её правая рука — в осях правила. */
  private ear(): Ear {
    const cam = this.camera;
    if (!cam) return { x: 0, z: 0, rx: 1, rz: 0 };
    const yaw = cam.rotation.y - SHORE_YAW;
    const f = dirOf(yaw);
    return { x: 0, z: 0, rx: -f.z, rz: f.x };
  }

  private react(events: readonly FishEvent[]): void {
    const ear = this.ear();
    for (const e of events) {
      const said = SAY[e.kind];
      if (said) this.notes.push(said);
      switch (e.kind) {
        case 'cast':
          this.sound?.swish(e.power);
          break;
        case 'land':
          this.ring(e.x, e.z, 1);
          this.splash(e.x, e.z, SPLASH.float);
          this.sound?.plop(0.3, ear, e.x, e.z);
          break;
        case 'hang':
          this.splash(e.x, e.z, SPLASH.float);
          this.sound?.plop(0.3, ear, e.x, e.z);
          haptic('error');
          break;
        case 'nibble':
          this.ring(e.x, e.z, 0.35);
          this.rig?.nod(0.35);
          this.sound?.nibble(ear, e.x, e.z);
          break;
        case 'bite':
          this.ring(e.x, e.z, 0.8);
          this.rig?.nod(1);
          this.sound?.plop(0.45, ear, e.x, e.z);
          // Поклёвку чувствует рука: удилище дрогнуло — отклик лёгкий, как у тапа.
          haptic('light');
          break;
        case 'hooked':
          this.ring(e.x, e.z, 1.2);
          this.splash(e.x, e.z, SPLASH.fish);
          this.sound?.plop(0.8, ear, e.x, e.z);
          this.sound?.creak();
          haptic('medium');
          break;
        case 'surge': {
          const at = this.game.fishAt();
          if (e.jump && at) {
            this.jumpAt = this.clock;
            this.splash(at.x, at.z, SPLASH.jump);
            this.ring(at.x, at.z, 1.3);
            this.sound?.plop(1, ear, at.x, at.z);
          }
          if (e.side !== 0 || e.jump) haptic('light');
          break;
        }
        case 'snap':
          this.sound?.snap();
          haptic('error');
          break;
        case 'slack':
          haptic('error');
          break;
        case 'caught': {
          this.shown = e.fish;
          const kg = weightText(e.fish.grams);
          const run = this.game.streak?.run ?? 0;
          const more = run >= FISH_STREAK.from ? ` · серия ${run}` : '';
          this.notes.push(e.fish.trophy ? `Трофей · ${e.fish.def.big}, ${kg}${more}` : `${e.fish.def.name}, ${kg}${more}`);
          this.splash(0, BANK_Z - 0.6, SPLASH.fish);
          this.ring(0, BANK_Z - 0.8, 1.2);
          this.sound?.caught(e.fish.trophy);
          haptic('success');
          break;
        }
        default:
          break;
      }
    }
  }

  /** Солнце и небо — воде: тот же свет, что раскладывает сцена (`Stage.applyLight`), читается из сцены. */
  private sunRead = false;
  private syncSun(): void {
    if (this.sunRead || !this.scene) return;
    let sun: THREE.DirectionalLight | null = null;
    this.scene.traverse((o) => {
      if (!sun && (o as THREE.DirectionalLight).isDirectionalLight) sun = o as THREE.DirectionalLight;
    });
    const bg = this.scene.background as THREE.Color | null;
    if (!sun || !bg) return;
    const s = sun as THREE.DirectionalLight;
    // Ночь — по часу города (`stage.solarOf`): после заката солнце рига уже луна, и блик в воде — лунная дорожка.
    const night = nightOf(solarOf(this.ctx.hour ?? 'dawn', this.solar));
    syncWaterLight(this.water, {
      sun: s,
      zenith: _col.copy(bg).lerp(_col2.setHex(0x5f8fc4), 0.55 * (1 - night)),
      horizon: bg,
      night,
      rain: Math.min(1, this.ctx.rain),
      cloud: Math.min(1, this.ctx.rain * 1.4),
    });
    this.sunRead = this.clock > 0;
  }

  /** Хлыст в осях правила (группы берега). */
  private tipLocal(out = new THREE.Vector3()): THREE.Vector3 {
    const cam = this.camera;
    const rig = this.rig;
    if (!cam || !rig) return out.set(0, 2, BANK_Z - 1.5);
    cam.updateMatrixWorld();
    out.copy(rig.tip);
    cam.localToWorld(out);
    this.world.updateMatrixWorld();
    return this.world.worldToLocal(out);
  }

  private syncRig(dt: number): void {
    const rig = this.rig;
    const cam = this.camera;
    if (!rig || !cam) return;
    const g = this.game;
    // Куда тянет леска: от хлыста к поплавку или рыбе — в осях камеры.
    let pull: THREE.Vector3 | null = null;
    const target = g.phase === 'fight' ? g.fishAt() : g.phase === 'wait' || g.phase === 'hang' ? g.floatAt(this.ruleT) : null;
    if (target) {
      cam.updateMatrixWorld();
      _v.set(target.x, WATER_Y, target.z);
      this.world.localToWorld(_v);
      cam.worldToLocal(_v);
      _w.copy(rig.tip);
      pull = _v.sub(_w).normalize().clone();
    }
    const L = g.line;
    rig.update({
      now: this.clock,
      dt,
      phase: g.phase,
      power: this.power(),
      tension: L?.tension ?? 0,
      reeling: L?.reeling ?? false,
      rod: L?.rod ?? 0,
      pull,
      paid: this.paid,
    });
  }

  /** Сколько лески ушло с катушки за кадр: плюс — отдали рыбе, минус — подтянули. */
  private paid = 0;

  private syncReel(dt: number): void {
    const L = this.game.line;
    if (this.game.phase !== 'fight' || !L) {
      this.paid = 0;
      this.sound?.strain(0);
      return;
    }
    const d = L.dist - this.distWas;
    this.distWas = L.dist;
    this.paid = d;
    // Щелчки: собачка трещит, пока рыба забирает леску (часто), ручка тикает, пока подтягивают (реже).
    this.clickOwed += Math.abs(d) / (d > 0 ? 0.045 : 0.09);
    let n = 0;
    while (this.clickOwed >= 1 && n < 4) {
      this.clickOwed -= 1;
      n++;
      this.sound?.click(d > 0);
    }
    if (this.clickOwed > 4) this.clickOwed = 0;
    this.strainDue -= dt;
    if (this.strainDue <= 0) {
      this.strainDue = 0.05;
      this.sound?.strain(L.tension);
    }
    // Леска в красной — рука чувствует: дрожь раз в четверть секунды.
    this.warnDue -= dt;
    if (L.tension > 0.85 && this.warnDue <= 0) {
      this.warnDue = 0.25;
      haptic('light');
    }
  }

  /** Поплавок: висит у хлыста, летит дугой, качается, вздрагивает, тонет; на вываживании — на леске у рыбы. */
  private syncFloat(t: number): void {
    const fl = this.float;
    if (!fl) return;
    const g = this.game;
    const tip = this.tipLocal(_w);
    const sway = Math.sin(this.clock * 2.1) * 0.03;
    fl.visible = true;
    fl.rotation.set(0, 0, 0);
    const bob = (x: number, z: number): number =>
      WATER_Y - 0.03 + 0.012 * Math.sin(this.clock * 2.3 + x) + (this.ctx.shore === 'sea' ? 0.05 * Math.sin(this.clock * 0.9 + z * 0.2) : 0);
    switch (g.phase) {
      case 'idle':
      case 'charge':
        fl.position.set(tip.x + sway, tip.y - 0.55, tip.z);
        fl.rotation.z = sway * 2;
        break;
      case 'flight': {
        const land = g.land!;
        const u = Math.min(1, (t - g.since) / flightS(land.d));
        const h = 1 + land.d * 0.15;
        fl.position.set(
          this.flyFrom.x + (land.x - this.flyFrom.x) * u,
          this.flyFrom.y - 0.55 + (WATER_Y - this.flyFrom.y + 0.55) * u + 4 * h * u * (1 - u),
          this.flyFrom.z + (land.z - this.flyFrom.z) * u,
        );
        break;
      }
      case 'wait': {
        const at = g.floatAt(t);
        const plan = g.plan!;
        const age = t - g.since;
        let y = bob(at.x, at.z);
        let x = at.x;
        // Ложные — короткий тычок вниз; поклёвка — утонул, положил или увёл.
        for (const n of plan.nibbles) {
          const a = age - n;
          if (a > 0 && a < 0.35) y -= 0.045 * Math.sin((a / 0.35) * Math.PI);
        }
        const b = age - plan.bite;
        if (b > 0) {
          const kind = plan.fish.def.bite;
          const k = smooth(b / 0.12);
          if (kind === 'dip') y -= 0.2 * k + 0.02 * Math.sin(this.clock * 30);
          else if (kind === 'lift') {
            y += 0.04 * k;
            fl.rotation.z = 1.35 * k;
          } else {
            y -= 0.12 * k;
            x += 0.5 * b;
          }
        }
        fl.position.set(x, y, at.z);
        break;
      }
      case 'hang':
        if (g.land) fl.position.set(g.land.x, WATER_Y + 0.15, g.land.z);
        fl.rotation.z = 0.9;
        break;
      case 'fight': {
        const at = g.fishAt();
        if (at) {
          // Поплавок — на леске в полуметре от рыбы к берегу, мотается и ныряет вместе с ней.
          const dx = -at.x;
          const dz = BANK_Z - at.z;
          const len = Math.hypot(dx, dz) || 1;
          fl.position.set(at.x + (dx / len) * 0.7, bob(at.x, at.z) - 0.03 * Math.abs(Math.sin(this.clock * 9)), at.z + (dz / len) * 0.7);
          fl.rotation.z = 0.5 * Math.sin(this.clock * 7);
        }
        break;
      }
      case 'back': {
        const u = smooth((t - g.since) / 0.7);
        fl.position.lerpVectors(this.backFrom, _v.set(tip.x, tip.y - 0.55, tip.z), u);
        fl.position.y = Math.max(fl.position.y, WATER_Y - 0.02);
        break;
      }
      case 'show':
        // Поплавок — на леске между хлыстом и рыбой, ближе к рыбе.
        fl.position.lerpVectors(tip, this.mouth, 0.3);
        break;
    }
    // Вдали поплавок крупнее настоящего: на пятнадцати метрах пробка с ноготь — меньше точки экрана, а глаз игры — на нём.
    const cam = this.camera;
    if (cam) {
      _v.copy(fl.position);
      this.world.localToWorld(_v);
      const d = _v.distanceTo(cam.position);
      fl.scale.setScalar(Math.max(1, Math.min(3.6, d / 4.5)));
    }
  }

  /** Рыба: у поверхности, когда близко или бьётся; выпрыгивает на рывке; вытащенная — перед глазами. */
  private syncFish(t: number, dt: number): void {
    const g = this.game;
    for (const m of this.fish.values()) m.visible = false;
    // Изгиб тела: ось — вбок, у камбалы, лежащей плашмя, — вверх-вниз (`FishMotion.axis`).
    const def = g.phase === 'show' ? this.shown?.def : g.fish?.def;
    if (def) this.motion.axis.value.set(0, FISH_LOOK[def.id].flat ? 1 : 0, FISH_LOOK[def.id].flat ? 0 : 1);
    if (g.phase === 'show' && this.shown) {
      this.showFish(t);
      return;
    }
    const hooked = g.fish;
    const at = g.fishAt();
    if (g.phase !== 'fight' || !hooked || !at) return;
    const m = this.fish.get(hooked.def.id);
    if (!m) return;
    const v = this.fishVis;
    const vx = at.x - this.fishWas.x;
    const vz = at.z - this.fishWas.z;
    this.fishWas = { x: at.x, z: at.z };
    if (Math.hypot(vx, vz) > 1e-4) v.yaw += wrap(Math.atan2(-vz, vx) - v.yaw) * (1 - Math.exp(-dt * 6));
    v.x = at.x;
    v.z = at.z;
    const L = g.line!;
    // Ближе к берегу и на рывке — у самой поверхности: спина и плавник режут воду.
    const near = smooth((7 - L.dist) / 5);
    const thrash = L.surge && L.surge.k > 0.5 ? 1 : 0;
    const depth = 0.32 - 0.26 * Math.max(near, thrash * 0.7);
    v.y += (WATER_Y - depth - v.y) * (1 - Math.exp(-dt * 5));
    // На воде рыба крупнее настоящей на треть: в пятнадцати метрах полуметровая рыба — с ноготь.
    const len = Math.min(1.1, fishLength(hooked.def.id, hooked.grams));
    m.scale.setScalar(len * 1.35);
    let y = v.y;
    let roll = Math.sin(this.clock * 11) * 0.25 * (0.4 + thrash);
    let pitch = 0;
    const j = this.clock - this.jumpAt;
    // Плывёт и бьётся: волна по телу тем чаще и шире, чем сильнее рвётся; в прыжке — изо всех сил.
    const fightBend = 0.35 + 0.55 * thrash;
    this.motion.bend.value += (fightBend - this.motion.bend.value) * (1 - Math.exp(-dt * 6));
    this.motion.phase.value += dt * (8 + 9 * thrash);
    if (j >= 0 && j < JUMP_S) {
      this.motion.bend.value = 0.95;
      this.motion.phase.value += dt * 10;
      // Прыжок: дуга над водой, рыба трясёт головой и падает боком.
      const u = j / JUMP_S;
      y = WATER_Y - 0.1 + (0.6 + len * 0.5) * 4 * u * (1 - u);
      pitch = (0.5 - u) * 1.6;
      roll = Math.sin(j * 30) * 0.5;
      // Над водой — боком к глазу и крупнее вдали: прыжок видно силуэтом, а не торцом и не точкой.
      const cam = this.camera;
      if (cam) v.yaw = cam.rotation.y - SHORE_YAW;
      m.scale.setScalar(len * Math.max(1.35, Math.min(2.4, L.dist / 9)));
      this.shine.value = 1.6;
      if (u > 0.92) {
        this.splash(at.x, at.z, SPLASH.jump);
        this.ring(at.x, at.z, 1.2);
        this.jumpAt = -1e9;
      }
    } else this.shine.value = 1;
    m.visible = y > WATER_Y - 0.36;
    m.position.set(v.x, y, v.z);
    _e.set(roll, v.yaw, pitch, 'YXZ');
    m.quaternion.setFromEuler(_e);
    // Бьётся у поверхности — брызги и круги.
    this.thrashDue -= dt;
    if (this.thrashDue <= 0 && (thrash || near > 0.5)) {
      this.thrashDue = 0.18 + 0.2 * (1 - thrash);
      this.splash(at.x, at.z, near > 0.5 ? SPLASH.fish : SPLASH.float);
      this.ring(at.x, at.z, 0.5 + 0.5 * thrash);
    }
  }

  /** Вытащенная рыба висит перед глазами на леске, бьёт хвостом, с неё капает. */
  private showFish(t: number): void {
    const fish = this.shown!;
    const m = this.fish.get(fish.def.id);
    const cam = this.camera;
    if (!m || !cam) return;
    const age = t - this.game.since;
    const len = fishLength(fish.def.id, fish.grams);
    // Крупная — дальше от глаз, чтобы влезла в кадр; мелкая — ближе.
    const dist = 0.42 + Math.min(0.9, len) * 0.55;
    const k = Math.min(0.62, len) / Math.max(0.05, len);
    m.visible = true;
    m.scale.setScalar(len * Math.max(0.55, Math.min(1, k * 1.25)));
    const up = smooth(age / 0.35);
    const scale = len * Math.max(0.55, Math.min(1, k * 1.25));
    // Где рыба в осях камеры: чуть левее середины, приподнимается из-под кадра.
    const cx = -0.03;
    const cy = -0.06 - 0.25 * (1 - up);
    _v.set(cx, cy, -dist);
    cam.updateMatrixWorld();
    cam.localToWorld(_v);
    this.world.worldToLocal(_v);
    m.position.copy(_v);
    // Голова вверх (висит на крючке за губу), бок — к глазу, хвост бьёт.
    const flap = Math.sin(age * 13) * 0.35 * Math.exp(-age * 0.6);
    // Тело бьётся волной вместе с хвостом: сильно сперва, потом изредка вздрагивает.
    this.motion.bend.value = 0.2 + 0.8 * Math.exp(-age * 0.6) + 0.25 * Math.max(0, Math.sin(age * 1.7)) ** 8;
    this.motion.phase.value = age * 13;
    _q.setFromEuler(_e.set(0, cam.rotation.y - SHORE_YAW + flap, Math.PI / 2 - 0.12, 'YXZ'));
    // Камбала плоская: к глазу — её широкая спина, а не ребро.
    if (FISH_LOOK[fish.def.id].flat) _q.multiply(_q2.setFromAxisAngle(_x, Math.PI / 2));
    m.quaternion.copy(_q);
    // Рот — на голове, куда идёт леска: в осях берега.
    this.mouth.set(scale * 0.5, 0, 0).applyQuaternion(_q).add(m.position);
    this.shine.value = 1.5;
    if (Math.floor(age * 6) !== Math.floor((age - 1 / 60) * 6)) this.drips.burst(_v.x, _v.y - scale * 0.45, _v.z, SPLASH.drip);
  }

  /** Леска: от хлыста провисом к поплавку; на вываживании — струной к рыбе; на показе — к рыбе в руке. */
  private syncLine(): void {
    const line = this.line;
    const fl = this.float;
    if (!line || !fl) return;
    const g = this.game;
    const tip = this.tipLocal(_w);
    const pos = this.linePos;
    const n = pos.length / 6;
    const end = _v.copy(fl.position);
    end.y += 0.16;
    let sag = 0.05;
    if (g.phase === 'wait') sag = Math.max(0.1, (tip.y - WATER_Y) * 0.55);
    else if (g.phase === 'fight' && g.line) {
      sag = (1 - Math.min(1, g.line.tension)) * 0.06 * g.line.dist + 0.02;
      const at = g.fishAt();
      if (at) end.set(at.x, this.fishVis.y + 0.05, at.z);
    } else if (g.phase === 'flight') sag = 0.3;
    else if (g.phase === 'show' && this.shown) {
      end.copy(this.mouth);
      sag = 0.01;
    }
    else if (g.phase === 'hang') sag = 0.02;
    let k = 0;
    const px = (u: number, out: THREE.Vector3): THREE.Vector3 => {
      out.lerpVectors(tip, end, u);
      out.y -= sag * 4 * u * (1 - u);
      if (out.y < WATER_Y + 0.005 && u > 0.5) out.y = WATER_Y + 0.005;
      return out;
    };
    const a = _la;
    const b = _lb;
    for (let i = 0; i < n; i++) {
      px(i / n, a);
      px((i + 1) / n, b);
      pos[k++] = a.x;
      pos[k++] = a.y;
      pos[k++] = a.z;
      pos[k++] = b.x;
      pos[k++] = b.y;
      pos[k++] = b.z;
    }
    line.geometry.attributes.position.needsUpdate = true;
  }

  /** Метка заброса: кольцо там, куда упадёт поплавок; красное — над травой и корягой (зацеп). */
  private syncMarker(): void {
    const m = this.marker;
    if (!m) return;
    const g = this.game;
    const p = this.power();
    if (g.phase !== 'charge' || p < CAST_WEAK) {
      m.visible = false;
      return;
    }
    const at = castPoint(p, this.aimYaw());
    m.visible = true;
    m.position.set(at.x, WATER_Y + 0.02, at.z);
    const hang = spotAt(g.field, at.x, at.z).hang;
    // Охра — цвет действия, как у шкалы: на светлой воде у горизонта кремовое кольцо терялось (снимок `f7`).
    (m.material as THREE.MeshBasicMaterial).color.setHex(hang ? 0xe0503a : 0xe0a040);
    m.scale.setScalar(0.8 + 0.07 * at.d);
  }

  dispose(): void {
    this.mats?.dispose();
    this.sound?.stop();
    this.rig?.dispose();
    this.sparks.dispose();
    for (const m of this.fish.values()) m.geometry.dispose();
    (this.line?.material as THREE.Material | undefined)?.dispose();
    (this.marker?.material as THREE.Material | undefined)?.dispose();
  }
}

/** Кольцо метки: плоское, лежит на воде, светится сквозь дымку. */
function markerRing(): THREE.Mesh {
  const seg = 40;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    for (const r of [0.72, 1]) pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xe0a040, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  m.name = 'castMarker';
  m.renderOrder = 2;
  m.castShadow = false;
  return m;
}

