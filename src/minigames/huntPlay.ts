/**
 * «Охота» в сцене: поле, олени, лук в руках и стрелы (docs/minigames.md, раздел 13).
 *
 * Правило — в `hunt.ts`: где олени, что они слышат, куда летит стрела и во что втыкается — зерно, секунда игры и
 * то, что сделал игрок. Здесь только то, что видно и слышно: олень пасётся и вскидывает голову, бежит скачками,
 * падает; лук поднимается, тетива тянется к скуле, стрела летит дугой и остаётся торчать там, где легла, —
 * по воткнувшимся и учатся брать поправку.
 *
 * Руки (docs/minigames.md, 18.1): слева — кнопка «Натянуть» — лёг палец — тянет, снят — выстрел; справа — палец движения:
 * вбок — плавный поворот, вверх-вниз — шаг, а с натянутым луком — прицел (поворот вдвое с лишним тише). Сцена отдаёт
 * касания кнопки сюда (`Play.draw`, `Play.loose`), а натяжку спрашивает (`Play.aiming`).
 *
 * Своим куском (`Minigame.tsx` грузит его по «На охоту»): «Ягоды» и «Скот» его не качают.
 */
import * as THREE from 'three';
import type { Surfaces } from '@/prologue/surface';
import { Shade, arrow as arrowModel, blob } from '@/prologue/models';
import type { Blocker } from '@/prologue/glade';
import type { Season } from '@/game/types';
import { haptic } from '@/telegram/webapp';
import { Archer } from './archer';
import { Sparks, type Burst } from './sparks';
import {
  ARROWS,
  CARCASS,
  DEER,
  DEER_BODY,
  GRAVITY,
  HEAD_DOWN as HEAD_DOWN_,
  HEAD_UP as HEAD_UP_,
  HOP_S,
  Hunt,
  LOOSE_MIN,
  NOCK_S,
  ROAM_R,
  RUN_SPEED,
  START,
  WHITE_WORTH,
  coverRadius,
  flightAt,
  pins,
  type Arrow,
  type HuntEvent,
} from './hunt';
import { MEADOW_FLAT, WALL_FROM, arrowsMesh, coverGroup } from './huntModels';
import { NatureMats } from './nature';
import { DENSITY, meadowLand } from './places';
import { huntSound, type Ear, type HuntSound, type ThudKind } from './huntSound';
import type { Hour, Tally, Target } from './rules';
import type { Play } from './stage';
import { LAYOUT_OF } from './pad';
import { Moves, Pack, placeBeast, smooth as ease } from './fauna';
import { STILL, model, posture, type Detail, type Model, type Posture } from './beasts';
import { HAIR, furMaterial } from './fur';
import type { Tier } from '@/prologue/look';

/** Насколько уже угол обзора в полную натяжку: приближение лука — олень на тридцати шагах крупнее, метки дальше. */
const ZOOM = 0.3;
/** Взгляд с натянутым луком тише вдвое с лишним; шаг — медленнее. */
const AIM_LOOK = 0.45;
const AIM_STRIDE = 0.4;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _d = new THREE.Vector3();
const _fwd = new THREE.Vector3(0, 0, -1);
const _e = new THREE.Euler();

/** Горсть от стрелы: клок шерсти и пыль — от оленя, дёрн — от земли, щепа — от ствола, листья — от куста. */
const PUFF: Record<'deer' | 'ground' | 'wood' | 'bush', Burst> = {
  deer: { colors: [0x8a5a3a, 0xb08a64, 0x9c8e74, 0xd8c8a8], n: 14, speed: 1.6, up: 0.55, gravity: 1.2, life: 1.0, drag: 2.5 },
  ground: { colors: [0x6f8f3e, 0x7a6248, 0x5f7a36], n: 10, speed: 1.9, up: 0.85, gravity: 7, life: 0.8, drag: 1 },
  wood: { colors: [0xd9c49a, 0x8a6a4a, 0xe8dcc0], n: 9, speed: 2.2, up: 0.4, gravity: 8, life: 0.8, drag: 0.8 },
  bush: { colors: [0x4f7d3c, 0x6f9a48, 0x3e6a32], n: 12, speed: 1.3, up: 0.6, gravity: 2.5, life: 1.2, drag: 2.5 },
};

/** След стрелы: точка раз в столько секунд, бледная, без тяжести — висит в воздухе и тает. */
const TRAIL_EVERY = 0.025;
const TRAIL: Burst = { colors: [0xf2ecdc, 0xe0d8c4], n: 1, speed: 0.04, up: 0, gravity: 0, life: 0.45, drag: 3 };

/** Скрип лука — на этих долях натяжки: тис отзывается по мере того, как его гнут. */
const CREAKS = [0.3, 0.65, 0.97];

/** Падение подстреленного: подламываются передние, валится на бок, бьёт ногами и затихает, с. */
const BUCKLE_S = 0.22;
const ROLL_FROM = 0.12;
const ROLL_TO = 0.62;
const KICK_S = 2.4;
/** Шаг брожения пасущегося, м на круг. */
const GRAZE_STRIDE = 0.9;
/** Поворот головы к охотнику у насторожившегося, рад: не больше — шары попадания правила поворота не знают. */
const LOOK_MAX = 0.35;

/** Что вид помнит об олене между кадрами. В правило не идёт ничего. */
interface DeerLife {
  pack: 'stag' | 'doe';
  slot: number;
  phase: number;
  headAt: number;
  /** Когда насторожился — вздрогнуть один раз. */
  alertAt: number;
  was: string;
  beat: number;
  /** На какой бок валится: от зерна поля. */
  side: number;
}

const hash = (i: number, k: number): number => {
  const v = Math.sin(i * 61.3 + k * 17.9) * 43758.5453;
  return v - Math.floor(v);
};

/** Что сказать над прицелом, когда стрела легла. */
const LANDED: Record<string, string> = { ground: 'Мимо', cover: 'В дерево', bush: 'В куст', lost: 'Улетела', deer: 'В тушу' };

export class HuntPlay implements Play {
  /** Утро: солнце над лесом, роса — тот час, когда выходят на опушку. */
  readonly solar = 0.13;
  /** Слева — кнопка «Натянуть», справа — палец движения: повороты и шаг, с натянутым луком — прицел. */
  readonly layout = LAYOUT_OF.hunt;
  readonly start = { ...START };
  readonly roam = ROAM_R;
  /** Тени — у ближних укрытий и оленей; дальше их съедает дымка, а коробка вдвое шире размыла бы ближние. */
  readonly shadowHalf = 26;
  readonly fog = { near: 28, far: 115 };
  readonly far = 150;
  readonly focus = 70;
  readonly hunt: Hunt;
  private sound: HuntSound | null = null;
  private camera: THREE.Camera | null = null;
  /** Рогачи и оленухи — копиями двух сеток; белый олень — рогач с белой мастью (`fauna.Pack.setCoat`). */
  private packs: Partial<Record<'stag' | 'doe', { pack: Pack; model: Model; moves: Moves }>> = {};
  private lives: DeerLife[] = [];
  private pose: Posture = { ...STILL };
  private detail: Detail = 'lo';
  private tier: Tier = 'lite';
  /** Материалы поля (`nature.ts`): земля, трава, лес, укрытия. */
  private mats: NatureMats | null = null;
  /** Часы вида оленей: жвачка и уши идут и до «Начать». */
  private deerClock = 0;
  private blobs: THREE.InstancedMesh | null = null;
  private arrows: THREE.InstancedMesh | null = null;
  /** Лучник у глаза: лук, руки, тетива и стрела на ней (`archer.ts`). */
  private archer: Archer | null = null;
  /** Часы рига: дрожь и дыхание идут и до «Начать». */
  private clock = 0;
  /** Взгляд прошлого кадра без поправки рига — от него риг отстаёт, когда игрок ведёт взгляд. */
  private look = { yaw: NaN, pitch: 0 };
  /** Приближение, под которое сцена поставила угол камеры в прошлом кадре. */
  private zoomed = 1;
  /** Натяжка прошлого кадра — скрипу лука; что делала правая — шороху колчана. */
  private drawnWas = 0;
  private handWas = 'string';
  /** Крупнее, чем у ягод: на поле горсть видна с тридцати метров. */
  private sparks = new Sparks(0.1);
  /**
   * След летящей стрелы: бледная пыль вдоль полёта, тает за треть секунды. Дугу видно глазом — по ней и учатся брать
   * поправку (раздел 13.2: учиться помогают метки и воткнувшиеся стрелы; след — третий учитель, и самый быстрый).
   */
  private trail = new Sparks(0.035);
  private trailDue = 0;
  private notes: string[] = [];
  private blockers_: Blocker[];
  private pins_ = pins();
  private walking = 0;
  /** Сезон города — от земли (`land`): листва берёз и кустов. */
  private season: Season = 'summer';

  constructor(seed: number, hour: Hour = 'dawn') {
    // Час города — слух оленей (`hunt.HOUR_EAR`); белый олень — раз в четыре выхода (`hunt.WHITE_P`).
    this.hunt = new Hunt(seed, { hour, rare: true });
    this.blockers_ = this.hunt.field.cover.map((c) => ({ x: c.x, z: c.z, r: coverRadius(c) }));
  }

  land(scene: THREE.Scene, surfaces: Surfaces, shade: Shade, season: Season): void {
    this.season = season;
    this.mats = new NatureMats(surfaces.u);
    // Трава — вокруг охотника, где её видно; не в кустах и не под елями.
    const keep = this.blockers_.map((b) => ({ x: b.x, z: b.z, r: b.r * 0.8 }));
    meadowLand({ scene, mats: this.mats, shade, season, density: DENSITY[this.tier], seed: 9013, keep }, MEADOW_FLAT, WALL_FROM, { x: START.x, z: START.z - 6 });
  }

  build(scene: THREE.Scene, surfaces: Surfaces, shade: Shade, camera: THREE.Camera): void {
    this.camera = camera;
    scene.add(coverGroup(this.hunt.field.cover, this.season, shade, this.mats ?? new NatureMats(surfaces.u), this.detail));
    const mat = furMaterial(HAIR, surfaces.u);
    const counts = { stag: 0, doe: 0 };
    for (const d of this.hunt.field.deer) counts[d.doe ? 'doe' : 'stag']++;
    for (const kind of ['stag', 'doe'] as const) {
      if (!counts[kind]) continue;
      const m = model(kind, this.detail);
      const pack = new Pack(m, mat, counts[kind], kind);
      scene.add(pack.mesh);
      this.packs[kind] = { pack, model: m, moves: new Moves(m.slots, m.count) };
    }
    const seen = { stag: 0, doe: 0 };
    for (let i = 0; i < DEER; i++) {
      // Оленуха — без рогов (`DeerSpec.doe`): у неё тот же корпус для стрелы, рогов стрела не видит.
      const d = this.hunt.field.deer[i];
      const kind = d.doe ? 'doe' : 'stag';
      const slot = seen[kind]++;
      if (d.white) this.packs[kind]?.pack.setCoat(slot, 1);
      this.lives.push({ pack: kind, slot, phase: hash(i, 1), headAt: this.hunt.pose(i, 0).head, alertAt: -1e9, was: 'graze', beat: 0, side: hash(i, 2) < 0.5 ? -1 : 1 });
    }
    // Пятна тени под оленями — одним мешем копиями: шесть пятен — один вызов.
    const b = blob(0.42, 0.82);
    this.blobs = new THREE.InstancedMesh(b.geometry, b.material, DEER);
    this.blobs.name = 'deerBlobs';
    this.blobs.frustumCulled = false;
    scene.add(this.blobs);
    const one = arrowModel();
    this.arrows = arrowsMesh(one, ARROWS);
    one.geometry.dispose();
    scene.add(this.arrows);
    scene.add(this.sparks.points, this.trail.points);
    this.buildBow(camera);
    this.frame(0, 0, 0);
  }

  /**
   * Лучник: лук в левой, правая на тетиве, рукава и перчатки (`archer.ts`). Висит на камере — вещь взгляда, а не мира.
   */
  private buildBow(camera: THREE.Camera): void {
    this.archer = new Archer();
    camera.add(this.archer.root);
  }

  /** Подробность лепки по ступени: олени вдали — `lo`, на настольном — `hi`. Зовётся до `build`. */
  dress(tier: Tier): void {
    this.tier = tier;
    this.detail = tier === 'full' ? 'hi' : 'lo';
  }

  blockers(): Blocker[] {
    return this.blockers_;
  }

  /** Тапом на охоте не трогают ничего: лук целится, а не досягает. */
  targets(): Target[] {
    return [];
  }

  tap(): string {
    return '';
  }

  begin(): void {
    this.sound ??= huntSound();
    this.sound.arm();
    if (this.hunt.field.deer.some((d) => d.white)) this.notes.push(`В дальней кучке белый олень — ×${WHITE_WORTH}`);
  }

  draw(t: number): void {
    this.hunt.pull(t);
  }

  loose(t: number, shoot: boolean): void {
    const cam = this.camera;
    if (!shoot || !cam) {
      // Ослабили натянутое — сказать: выстрела не было, и стрела цела (отзыв тестеров 11.10).
      if (!shoot && this.hunt.pulling && this.hunt.drawn(t) > 0) this.notes.push('Тетива ослаблена');
      this.hunt.slack();
      return;
    }
    if (!this.hunt.pulling) return;
    const drawn = this.hunt.drawn(t);
    cam.getWorldDirection(_d);
    const a = this.hunt.loose(t, { x: cam.position.x, y: cam.position.y, z: cam.position.z }, { x: _d.x, y: _d.y, z: _d.z });
    if (!a) {
      if (this.hunt.quiver > 0 && drawn > 0) this.notes.push('Натяни сильнее');
      return;
    }
    haptic('light');
    this.sound?.twang(drawn);
    // Свист — вдоль полёта: где стрела будет через полсекунды.
    const mid = flightAt(a, 0.5);
    this.sound?.whistle(0.9, this.ear(), mid.x, mid.z);
    if (this.hunt.quiver === 0) this.notes.push('Последняя стрела');
  }

  lookScale(): number {
    return this.hunt.pulling ? AIM_LOOK : 1;
  }

  stride(): number {
    return this.hunt.pulling ? AIM_STRIDE : 1;
  }

  /** Натянут — палец движения вверх-вниз ведёт прицел, а не шаг (`pad.ts`). */
  aiming(): boolean {
    return this.hunt.pulling;
  }

  /** Кнопка «Натянуть»: держат — тянут (натянул — «Выстрел»: отпусти), отпустили — выстрел. Колчан пуст — гаснет. */
  act(): { label: string; ready: boolean; hold: boolean; on: boolean } {
    const pulling = this.hunt.pulling;
    const ready = this.hunt.quiver > 0;
    return { label: pulling && this.hunt.drawn() >= LOOSE_MIN ? 'Выстрел' : 'Натянуть', ready, hold: true, on: pulling && ready };
  }

  zoom(): number {
    return 1 - ZOOM * (this.archer?.shown ?? 0);
  }

  drawn(): number {
    return this.hunt.drawn();
  }

  pins(): readonly { d: number; angle: number }[] {
    return this.pins_;
  }

  aside(): string {
    return `Стрел ${this.hunt.quiver}`;
  }

  say(): string {
    return this.notes.shift() ?? '';
  }

  over(t: number): boolean {
    return this.hunt.over(t);
  }

  tick(): void {
    this.sound?.tick();
  }

  /** Ухо охотника: где камера и куда её правая рука. */
  private ear(): Ear {
    const cam = this.camera;
    if (!cam) return { x: START.x, z: START.z, rx: 1, rz: 0 };
    cam.getWorldDirection(_d);
    const len = Math.hypot(_d.x, _d.z) || 1;
    return { x: cam.position.x, z: cam.position.z, rx: -_d.z / len, rz: _d.x / len };
  }

  frame(t: number, dt: number, walking: number): void {
    const cam = this.camera;
    this.walking = walking * this.stride();
    if (cam) this.hunt.advance(t, { x: cam.position.x, z: cam.position.z, walking: this.walking });
    this.react(this.hunt.takeEvents());
    this.syncDeer(t, dt);
    this.syncArrows(t);
    this.syncBow(t, dt);
    this.sparks.frame(dt);
    this.syncTrail(t, dt);
  }

  /** След: точка за каждые `TRAIL_EVERY` секунды полёта каждой летящей стрелы. */
  private syncTrail(t: number, dt: number): void {
    this.trailDue -= dt;
    if (this.trailDue <= 0) {
      this.trailDue = TRAIL_EVERY;
      for (const a of this.hunt.arrows) {
        if (a.end !== null && a.end <= t) continue;
        const p = flightAt(a, Math.max(0, t - a.t0));
        this.trail.burst(p.x, p.y, p.z, TRAIL);
      }
    }
    this.trail.frame(dt);
  }

  /** Что случилось за кадр: звук, подпись, отклик рукой. */
  private react(events: readonly HuntEvent[]): void {
    const ear = this.ear();
    for (const e of events) {
      if (e.kind === 'hit') {
        // Отметка попадания на прицеле — по «Попал» в начале отклика (`Minigame.tsx`); белый олень — с прибавкой.
        this.notes.push(this.hunt.field.deer[e.id]?.white ? `Попал · белый олень ×${WHITE_WORTH}` : 'Попал');
        haptic('medium');
        this.sound?.thud('deer', ear, e.x, e.z);
        this.sparks.burst(e.x, DEER_BODY.y, e.z, PUFF.deer);
      } else if (e.kind === 'thud') {
        const arrow = this.hunt.arrows[e.id];
        const c = e.struck === 'cover' ? this.hunt.field.cover[arrow?.what ?? -1] : undefined;
        const word = e.struck === 'cover' && c?.kind === 'bush' ? 'bush' : (e.struck ?? 'ground');
        this.notes.push(LANDED[word] ?? 'Мимо');
        const kind: ThudKind | null = e.struck === 'deer' ? 'deer' : e.struck === 'cover' && c?.kind !== 'bush' ? 'wood' : e.struck === 'lost' ? null : 'ground';
        if (kind) this.sound?.thud(kind, ear, e.x, e.z);
        // Горсть там, где воткнулась стрела: от земли — дёрн, от ствола — щепа, от куста — листья.
        const at = arrow?.at;
        const puff = word === 'bush' ? PUFF.bush : kind === 'wood' ? PUFF.wood : kind === 'ground' ? PUFF.ground : null;
        if (at && puff) this.sparks.burst(at.x, Math.max(0.05, at.y), at.z, puff);
      }
    }
  }

  /**
   * Олени: правило решает, где олень, куда смотрит, на какой угол поднята голова и как высоко взлетел корпус; вид
   * добавляет то, чего правило не решает: шаг и скачок ногами, жвачку, уши, хвост-флаг, вздрог, падение на бок.
   */
  private syncDeer(t: number, dt: number): void {
    const ear = this.ear();
    this.deerClock += dt;
    const clock = this.deerClock;
    const pose = this.pose;
    for (let i = 0; i < this.lives.length; i++) {
      const L = this.lives[i];
      const P = this.packs[L.pack];
      if (!P) continue;
      const m = P.model;
      const p = this.hunt.pose(i, t);
      if (p.kind === 'gone') {
        P.pack.hide(L.slot);
        this.blob(i, null);
        continue;
      }
      Object.assign(pose, STILL);
      // Голова догоняет правило за доли секунды: правило решает «вскинул», глаз видит, как он вскидывает.
      L.headAt += (p.head - L.headAt) * Math.min(1, dt * 12);
      const seg = this.segOf(i, t);
      const since = seg ? t - seg.t0 : 0;
      if (p.kind !== L.was) {
        if (p.kind === 'alert') L.alertAt = clock;
        L.was = p.kind;
      }
      let y = p.lift;
      let pitch = 0;
      let roll = 0;
      if (p.kind === 'down') {
        // Падение: подламываются передние, олень валится на бок, бьёт ногами и затихает.
        const buckle = ease(0, BUCKLE_S, since) * (1 - ease(0.35, 0.7, since));
        const rollK = ease(ROLL_FROM, ROLL_TO, since);
        pose.fold = 0.5 * buckle;
        pose.dead = ease(0.3, 0.7, since);
        pose.neck = -0.55 * pose.dead + 0.3 * buckle;
        pose.ears = 0.8 * pose.dead;
        const kick = since > 0.55 && since < KICK_S ? Math.exp(-(since - 0.55) / 0.5) : 0;
        pose.walk = 0.45 * kick;
        pose.phase = since * 2.6;
        pitch = 0.28 * buckle * (1 - rollK);
        roll = L.side * (Math.PI / 2) * rollK;
        y = -0.22 * buckle * (1 - rollK) + (m.side - m.core.y) * rollK;
      } else if (p.kind === 'run') {
        // Скачками: фаза — от начала бега тем же сроком скачка, что у правила (`HOP_S`), — ноги вытянуты в полёте.
        const run = Math.min(1, p.speed / (RUN_SPEED * 0.35));
        pose.run = run;
        pose.walk = 1;
        pose.phase = since / HOP_S;
        pose.neck = L.headAt;
        pose.tailUp = 1;
        pose.ears = 0.45;
        pose.breathe = 1;
        pitch = 0.1 * Math.sin(Math.PI * 2 * pose.phase) * run;
        // Топот: два удара на скачок — передние и задние.
        const n = Math.floor(pose.phase * 2);
        if (n !== L.beat && run > 0.5) {
          L.beat = n;
          this.sound?.hoof(ear, p.x, p.z);
        }
      } else {
        // Пасётся или насторожился: переступает по брожению правила, голова — на угол правила.
        L.phase += (p.speed * dt) / GRAZE_STRIDE;
        pose.walk = ease(0.02, 0.35, p.speed);
        pose.phase = L.phase;
        pose.neck = L.headAt;
        const down = Math.max(0, Math.min(1, (L.headAt - HEAD_UP_) / (HEAD_DOWN_ - HEAD_UP_)));
        pose.head = 0.3 * down;
        pose.chew = down > 0.7 ? 0.5 + 0.5 * Math.sin(clock * 8 + i) : 0;
        const fl = (clock + hash(i, 5) * 5) % (3.5 + 3 * hash(i, 6));
        pose.ears = fl < 0.22 ? Math.sin((fl / 0.22) * Math.PI) * 0.6 : 0;
        pose.tailSwish = 0.2 * Math.sin(clock * 3.1 + i * 1.7);
        pose.breathe = 0.5 + 0.5 * Math.sin(clock * 1.7 + i);
        if (p.kind === 'alert') {
          // Насторожился: уши торчком, хвост приподнят, голова — к шороху; в первую долю секунды — вздрог.
          const cam = this.camera;
          const look = cam ? Math.atan2(Math.cos(p.yaw) * (cam.position.x - p.x) - Math.sin(p.yaw) * (cam.position.z - p.z), Math.sin(p.yaw) * (cam.position.x - p.x) + Math.cos(p.yaw) * (cam.position.z - p.z)) : 0;
          pose.turn = Math.max(-LOOK_MAX, Math.min(LOOK_MAX, look));
          pose.ears = -1;
          pose.tailUp = 0.35;
          pose.chew = 0;
          const jolt = clock - L.alertAt;
          if (jolt < 0.35) {
            y += Math.sin((jolt / 0.35) * Math.PI) * 0.05;
            pitch = -0.05 * Math.sin((jolt / 0.35) * Math.PI);
          }
        }
      }
      posture(P.moves, pose);
      placeBeast(_m, p.x, y, p.z, p.yaw, pitch, roll, m.core);
      P.pack.put(L.slot, _m, P.moves.k);
      this.blob(i, p);
    }
    for (const k of ['stag', 'doe'] as const) this.packs[k]?.pack.commit();
    if (this.blobs) this.blobs.instanceMatrix.needsUpdate = true;
  }

  /** Отрезок правила, в котором олень в секунду `t`. */
  private segOf(i: number, t: number): { t0: number } | null {
    const segs = this.hunt.segs[i];
    let out: { t0: number } | null = null;
    for (const g of segs) if (g.t0 <= t) out = g;
    return out;
  }

  private blob(i: number, p: { x: number; z: number; yaw: number; kind: string } | null): void {
    const m = this.blobs;
    if (!m) return;
    if (!p) {
      _m.makeScale(0, 0, 0);
    } else {
      _e.set(0, p.yaw, 0);
      _q.setFromEuler(_e);
      _p.set(p.x, 0, p.z);
      const k = p.kind === 'down' ? 1.1 : 1;
      _s.set(k, 1, k);
      _m.compose(_p, _q, _s);
      _s.set(1, 1, 1);
    }
    m.setMatrixAt(i, _m);
  }

  /** Стрелы: летящие — по дуге носом по ходу, воткнувшиеся — где легли; в подстреленном — на туше. */
  private syncArrows(t: number): void {
    const m = this.arrows;
    if (!m) return;
    let n = 0;
    for (const a of this.hunt.arrows) {
      if (a.struck === 'lost') continue;
      if (!this.placeArrow(a, t)) continue;
      m.setMatrixAt(n++, _m);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  }

  private placeArrow(a: Arrow, t: number): boolean {
    if (a.end === null || a.end > t) {
      const tau = Math.max(0, t - a.t0);
      const p = flightAt(a, tau);
      _d.set(a.vx, a.vy - GRAVITY * tau, a.vz).normalize();
      _p.set(p.x, p.y, p.z);
    } else {
      if (!a.at || !a.dir) return false;
      _d.set(a.dir.x, a.dir.y, a.dir.z);
      // Наконечник в том, во что попала; середина древка — позади.
      _p.set(a.at.x, a.at.y, a.at.z).addScaledVector(_d, -0.3);
      if (a.struck === 'deer') {
        // Подстреленный лёг: стрела торчит из туши, а не висит там, где была холка.
        _p.y = CARCASS.y + 0.2 + (_p.y - DEER_BODY.y) * 0.3;
      }
    }
    _q.setFromUnitVectors(_fwd, _d);
    _m.compose(_p, _q, _s);
    return true;
  }

  /**
   * Лучник: правило говорит, тянут ли, насколько и когда ушла последняя стрела; риг рисует жест и отдаёт поправку
   * взгляда — дрожь натянутого лука и толчок отдачи. Поправка ложится на камеру поверх взгляда игрока: стрела летит
   * туда, куда смотрит камера, и гуляет вместе с прицелом.
   */
  private syncBow(t: number, dt: number): void {
    const a = this.archer;
    const cam = this.camera;
    if (!a || !cam) return;
    this.clock += dt;
    const last = this.hunt.arrows[this.hunt.arrows.length - 1];
    // Взгляд игрока — тот, что поставила сцена в этом кадре; поворот за кадр — без прошлой поправки рига.
    const yaw = cam.rotation.y;
    const pitch = cam.rotation.x;
    const turn = Number.isNaN(this.look.yaw) ? { yaw: 0, pitch: 0 } : { yaw: yaw - this.look.yaw, pitch: pitch - this.look.pitch };
    this.look.yaw = yaw;
    this.look.pitch = pitch;
    a.update({
      now: this.clock,
      dt,
      pulling: this.hunt.pulling,
      drawn: this.hunt.drawn(t),
      quiver: this.hunt.quiver,
      sinceLoose: last ? Math.max(0, t - last.t0) : null,
      nockS: NOCK_S,
      walking: this.walking,
      turn,
    });
    // Скрип — когда натяжка прошла очередную долю; шорох — когда правая дошла до колчана.
    const drawn = this.hunt.drawn(t);
    for (const k of CREAKS) if (this.drawnWas < k && drawn >= k) this.sound?.creak(k);
    this.drawnWas = drawn;
    if (a.state.hand === 'quiver' && this.handWas !== 'quiver') this.sound?.rustle();
    this.handWas = a.state.hand;
    cam.rotation.y = yaw + a.sway.yaw;
    cam.rotation.x = pitch + a.sway.pitch;
    // Натянутый лук приближает поле, а не руки: риг сжат к середине кадра ровно на столько, на сколько уже стал угол
    // обзора, — руки и лук стоят на экране так же, как без приближения (угол рига свой, как у вещи в руках в играх от
    // первого лица). Угол камеры прошлого кадра — от прошлого приближения; этот кадр сцена поставит по `zoom()`.
    const pc = cam as THREE.PerspectiveCamera;
    if (pc.isPerspectiveCamera) {
      const base = (pc.fov / this.zoomed) * (Math.PI / 360);
      this.zoomed = this.zoom();
      const k = Math.tan(base * this.zoomed) / Math.tan(base);
      a.root.scale.set(k, k, 1);
    }
  }

  tally(): Tally {
    return this.hunt.tally();
  }

  /** Геометрию разберёт сцена (`disposeGeometries` — лук висит на камере, камера в сцене); здесь — копии. */
  dispose(): void {
    this.mats?.dispose();
    const mats = new Set<THREE.Material>();
    for (const k of ['stag', 'doe'] as const) {
      const p = this.packs[k];
      if (!p) continue;
      mats.add(p.pack.mesh.material as THREE.Material);
      p.pack.dispose();
    }
    for (const m of mats) m.dispose();
    this.blobs?.dispose();
    this.arrows?.dispose();
    this.archer?.dispose();
    this.sparks.dispose();
    this.trail.dispose();
  }
}
