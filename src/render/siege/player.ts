// Проигрыватель ролика осады (docs/gfx.md, ГФ-2): часы, камера по эпизодам, рендерер. Устроен как проигрыватель ролика боя
// (`tw/player.ts`): кадр — функция секунды, цикл кадра — только через дверь `render/loop` (потолок кадров и стоянка в
// скрытой странице — её), сторож плавности — правило города. Рендерер приходит снаружи (в игре его одалживает сцена).
import * as THREE from 'three';
import { FrameLoop } from '../loop';
import { TW_SPEC, type TwSpec } from '../reel/spec';
import { Steady } from '../steady';
import { QUALITIES, VILLAGE_STEADY, type Quality } from '../quality';
import { TacticalCamera, blendCam, overview, type CamState } from '../reel/camera';
import type { TwCamKey } from '../tw/barrage';
import { SiegeStage } from './stage';
import { episodeAt, type Episode, type SiegeReel } from './reel';
import type { TownBackdrop } from '../city/backdrop';

/** Переход камеры от ключа к ключу, секунды (как у пролога обстрела). */
const CAM_MOVE = 1.3;

/** Камера сама на секунде ролика: от ключа к ключу эпизодов, переход — за `CAM_MOVE` до следующего. */
export function keyView(keys: readonly TwCamKey[], t: number, aspect: number): CamState {
  if (keys.length === 0) return overview({ minX: -30, maxX: 30, minZ: -40, maxZ: 10 }, aspect);
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1].at <= t) i++;
  const a = viewOfKey(keys[i], aspect);
  const next = keys[i + 1];
  if (!next) return a;
  const b = viewOfKey(next, aspect);
  return blendCam(a, b, (t - (next.at - CAM_MOVE)) / CAM_MOVE);
}

/** Кадр ключа: камера на месте (`dist`) или прямоугольник, вписанный в экран. */
function viewOfKey(k: TwCamKey, aspect: number): CamState {
  if (k.dist === undefined) return overview(k.box, aspect, k.yaw, k.pitch);
  return { tx: (k.box.minX + k.box.maxX) / 2, tz: (k.box.minZ + k.box.maxZ) / 2, dist: k.dist, yaw: k.yaw, pitch: k.pitch };
}

export interface SiegePlayerOptions {
  /** Кадр нарисован: секунда ролика и эпизод на ней. */
  onFrame?: (t: number, ep: Episode) => void;
  onEnd?: () => void;
  speed?: number;
  /** Сторож плавности: уровень, с которого ролик начат по устройству. Нет — уровень задан игроком или адресом. */
  watch?: Quality;
  onLower?: (q: Quality) => void;
  /** Кусок ролика (короткий ролик фазы, `reel.clipOf`); нет — весь. */
  range?: { from: number; to: number };
  /** Настоящий город за стеной (docs/polish.md, П-6); проигрыватель отдаёт его сцене, она — освобождает. */
  town?: TownBackdrop | null;
}

export class SiegePlayer {
  readonly stage: SiegeStage;
  readonly cam: TacticalCamera;
  private clock = new THREE.Clock();
  private steady: Steady<Quality> | null;
  private loopFrame = new FrameLoop<'idle'>(() => this.loop(), () => this.clock.getDelta());
  private t: number;
  private running = false;
  private disposed = false;
  private aspect = 1;
  private drawn = 0;
  private shadowEvery: number;
  private readonly shadowAuto: boolean;
  readonly from: number;
  readonly to: number;
  speed: number;

  constructor(
    private renderer: THREE.WebGLRenderer,
    readonly reel: SiegeReel,
    spec: TwSpec,
    private opts: SiegePlayerOptions = {},
  ) {
    this.speed = opts.speed ?? 1;
    this.from = opts.range?.from ?? 0;
    this.to = opts.range?.to ?? reel.seconds;
    this.t = this.from;
    this.steady = opts.watch ? new Steady(QUALITIES, opts.watch, VILLAGE_STEADY) : null;
    this.stage = new SiegeStage(reel, spec, opts.town ?? null);
    renderer.shadowMap.type = spec.shadowSoft ? THREE.PCFShadowMap : (0 as THREE.ShadowMapType);
    this.shadowEvery = Math.max(1, spec.shadowEvery);
    this.shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    this.fitAspect();
    this.cam = new TacticalCamera(this.view(this.t), this.stage.bounds(this.aspect));
    this.cam.setAspect(this.aspect);
    this.loopFrame.block('idle', true);
    this.draw();
  }

  get time(): number {
    return this.t;
  }

  /** Длина того, что играет: весь ролик или кусок. */
  get seconds(): number {
    return this.to - this.from;
  }

  get playing(): boolean {
    return this.running;
  }

  /** Эпизод на текущей секунде. */
  get episode(): Episode {
    return episodeAt(this.reel, this.t);
  }

  view(t: number): CamState {
    return keyView(this.reel.cam, t, this.aspect);
  }

  /** «Пропустить» — к следующему эпизоду куска; дальше некуда — `false`, и зовущий показывает итог. */
  skipNext(): boolean {
    const next = this.reel.episodes.find((e) => e.at > this.t + 0.3 && e.at < this.to - 0.5);
    if (!next) return false;
    this.seek(next.at);
    return true;
  }

  /** «Итог»: на последний кадр куска, ход стоит; карточку итога показывает зовущий. */
  finish(): void {
    this.stop();
    this.seek(this.to);
  }

  seek(t: number): void {
    this.t = Math.max(this.from, Math.min(this.to, t));
    if (this.cam.auto) {
      this.cam.follow(this.view(this.t));
      this.cam.snap();
    }
    this.draw();
  }

  start(): void {
    if (this.running || this.disposed) return;
    if (this.t >= this.to) this.seek(this.from);
    this.running = true;
    this.clock.getDelta();
    this.loopFrame.block('idle', false);
  }

  stop(): void {
    this.running = false;
    this.loopFrame.block('idle', true);
  }

  /** Камера двигается и без хода ролика: цикл кадров нужен и на паузе, пока её ведут. */
  live(on: boolean): void {
    this.loopFrame.block('idle', !on);
  }

  private fitAspect(): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x > 0 && size.y > 0) this.aspect = size.x / size.y;
  }

  fit(): void {
    this.fitAspect();
    this.cam.setAspect(this.aspect);
    this.cam.bounds = this.stage.bounds(this.aspect);
    this.draw();
  }

  private loop = (): void => {
    if (this.disposed) return;
    const raw = this.clock.getDelta();
    const dt = Math.min(0.1, raw);
    if (this.running && this.steady) {
      const next = this.steady.feed(raw * 1000);
      if (next) this.lower(next);
    }
    if (this.running) this.t = Math.min(this.to, this.t + dt * this.speed);
    this.draw(dt);
    if (this.running && this.t >= this.to) {
      this.stop();
      this.opts.onEnd?.();
    }
  };

  draw(dt = 0): void {
    if (this.disposed) return;
    if (this.cam.auto) this.cam.follow(this.view(this.t));
    this.cam.groundY = this.stage.groundY(this.cam.now.tx, this.cam.now.tz);
    if (dt > 0) this.cam.update(dt);
    this.stage.apply(this.t, this.cam);
    this.renderer.info.reset();
    this.renderer.shadowMap.needsUpdate = dt === 0 || this.drawn++ % this.shadowEvery === 0;
    this.renderer.render(this.stage.scene, this.cam.camera);
    this.opts.onFrame?.(this.t, this.episode);
  }

  lower(next: Quality): void {
    const spec = TW_SPEC[next];
    this.shadowEvery = Math.max(this.shadowEvery, spec.shadowEvery);
    this.stage.lower(spec);
    this.opts.onLower?.(next);
  }

  stats(): { calls: number; triangles: number; crowdTriangles: number; textureMB: number; shown: number } {
    const info = this.renderer.info.render;
    return {
      calls: info.calls,
      triangles: info.triangles,
      crowdTriangles: this.stage.crowd.triangles(),
      textureMB: Math.round((this.stage.textureBytes() / 1048576) * 10) / 10,
      shown: this.reel.tracks.count,
    };
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    this.loopFrame.stop();
    this.cam.detach();
    this.stage.dispose();
    this.renderer.shadowMap.autoUpdate = this.shadowAuto;
  }
}
