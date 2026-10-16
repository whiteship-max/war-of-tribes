// Проигрыватель ролика TW: часы, камера, рендерер (docs/battle_tw.md, раздел 8). Ни одного решения о бое: кадр —
// режиссура на секунде, камера — у игрока или общий вид. Своего контекста WebGL он не создаёт — рендерер приходит
// снаружи (в игре его одалживает сцена, на стенде — стенд), как у прежнего ролика (`battle/player.ts`).
import * as THREE from 'three';
import { FrameLoop } from '../loop';
import type { TwSpec } from '../reel/spec';
import { TacticalCamera, blendCam, overview, type CamState } from '../reel/camera';
import { TwStage } from './stage';
import type { TwPlan } from './plan';
import { reelToCast } from '../reel/clock';
import { beatsOf, type Beat } from '../reel/beats';
import { directorView } from '../reel/director';
import type { TwBarrage } from './barrage';

/** Переход камеры пролога от ключа к ключу и от последнего — к общему виду боя, секунды. */
const CAM_MOVE = 1.3;

/**
 * Камера пролога обстрела сама (docs/battle_tw.md, раздел 15): общий план машин и стены → удар → пролом, и к концу пролога
 * — общий вид боя. Ключи — у режиссуры (`TwBarrage.cam`), кадр — `overview` на ключевой прямоугольник.
 */
export function barrageView(b: TwBarrage, t: number, aspect: number, battle: CamState): CamState {
  const keys = b.cam.map((k) => overview(k.box, aspect, k.yaw, k.pitch));
  let i = 0;
  while (i + 1 < b.cam.length && b.cam[i + 1].at <= t) i++;
  const next = i + 1 < b.cam.length ? { at: b.cam[i + 1].at, s: keys[i + 1] } : { at: b.seconds, s: battle };
  return blendCam(keys[i], next.s, (t - (next.at - CAM_MOVE)) / CAM_MOVE);
}

export interface TwPlayerOptions {
  /**
   * Кадр нарисован: секунда ролика TW (с прологом обстрела, `TwPlayer.pre`) и секунда раскадровки боя (подпись, фаза и
   * музыка берутся у неё; в прологе — нулевая).
   */
  onFrame?: (t: number, castT: number) => void;
  onEnd?: () => void;
  speed?: number;
}

export class TwPlayer {
  readonly stage: TwStage;
  readonly cam: TacticalCamera;
  private clock = new THREE.Clock();
  private beat = new FrameLoop<'idle'>(() => this.loop(), () => this.clock.getDelta());
  private t = 0;
  private running = false;
  private disposed = false;
  private aspect = 1;
  /** Кадров хода нарисовано — счёт теневого прохода (`TwSpec.shadowEvery`). */
  private drawn = 0;
  private readonly shadowEvery: number;
  /** Как рендерер обновлял тень до ролика: холст свой — сам каждый кадр, одолженный у города — по просьбе. */
  private readonly shadowAuto: boolean;
  /** Скорость хода: ×1, ×2, ×4 — у игрока на полосе; кадр — функция времени, поэтому скорость его не меняет. */
  speed: number;
  /**
   * Пролог обстрела перед штурмом, секунды (`plan.barrage`); ноль — его нет. Часы ролика идут от начала пролога: бой — с
   * секунды `pre`, и до неё он стоит на своей нулевой секунде (строи построены).
   */
  readonly pre: number;
  /** Такты смысла боя (`reel/beats`): по ним ведёт камеру режиссёр. */
  readonly beats: readonly Beat[];

  constructor(
    private renderer: THREE.WebGLRenderer,
    readonly plan: TwPlan,
    spec: TwSpec,
    private opts: TwPlayerOptions = {},
  ) {
    this.speed = opts.speed ?? 1;
    this.pre = plan.barrage?.seconds ?? 0;
    this.beats = beatsOf(plan.cast, plan.result, plan.timing);

    this.stage = new TwStage(plan, spec);
    // Жёсткая тень — `BasicShadowMap` (0) числом, как у уровней сцены (`Scene`): имени в куске three первой загрузки нет.
    renderer.shadowMap.type = spec.shadowSoft ? THREE.PCFShadowMap : (0 as THREE.ShadowMapType);
    // Тень — по просьбе кадра, а не сама: так её можно рисовать реже (`spec.shadowEvery`) и на своём холсте.
    this.shadowEvery = Math.max(1, spec.shadowEvery);
    this.shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    this.fitAspect();
    const start = this.view(0);
    this.cam = new TacticalCamera(start, this.stage.bounds(this.aspect));
    this.cam.setAspect(this.aspect);
    this.beat.block('idle', true);
    this.draw();
  }

  get time(): number {
    return this.t;
  }

  /** Весь ролик: пролог обстрела и бой. */
  get seconds(): number {
    return this.pre + this.plan.seconds;
  }

  /** Секунда боя на секунде ролика `t`: в прологе — ноль. */
  battleTime(t = this.t): number {
    return Math.max(0, t - this.pre);
  }

  /** Идёт ли пролог обстрела. */
  get barrage(): boolean {
    return this.t < this.pre;
  }

  /** Камера сама на секунде ролика: в прологе — камера обстрела, в бою — режиссёр по тактам журнала (`reel/director`). */
  view(t: number): CamState {
    const battle = directorView(this.stage.director, this.beats, this.plan.timing, this.battleTime(t), this.aspect);
    const b = this.plan.barrage;
    return b && t < this.pre ? barrageView(b, t, this.aspect, battle) : battle;
  }

  /**
   * «Пропустить» в прологе — к бою, а не из ролика: обстрел — вступление, и пропускают его, как у Total War. Пролога нет
   * или он прошёл — `false`, и кнопка закрывает ролик, как раньше.
   */
  skipBarrage(): boolean {
    if (this.t >= this.pre) return false;
    this.t = this.pre;
    this.draw();
    return true;
  }

  get playing(): boolean {
    return this.running;
  }

  /** Перемотать и показать кадр: повтор точен, кадр — функция времени. */
  seek(t: number): void {
    this.t = Math.max(0, Math.min(this.seconds, t));
    if (this.cam.auto) {
      this.cam.follow(this.view(this.t));
      this.cam.snap();
    }
    this.draw();
  }

  start(): void {
    if (this.running || this.disposed) return;
    if (this.t >= this.seconds) this.t = 0;
    this.running = true;
    this.clock.getDelta();
    this.beat.block('idle', false);
  }

  stop(): void {
    this.running = false;
    this.beat.block('idle', true);
  }

  private fitAspect(): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x > 0 && size.y > 0) this.aspect = size.x / size.y;
  }

  /** Размер канвы мог измениться: аспект — у рендерера. */
  fit(): void {
    this.fitAspect();
    this.cam.setAspect(this.aspect);
    this.cam.bounds = this.stage.bounds(this.aspect);
    this.draw();
  }

  private loop = (): void => {
    if (this.disposed) return;
    const dt = Math.min(0.1, this.clock.getDelta());
    if (this.running) this.t = Math.min(this.seconds, this.t + dt * this.speed);
    this.draw(dt);
    if (this.running && this.t >= this.seconds) {
      this.stop();
      this.opts.onEnd?.();
    }
  };

  /**
   * Кадр. Камера сначала: общий вид знает, где строи на этой секунде, и подтягивается к ним, если игрок её не взял.
   * `dt` — шаг сглаживания камеры; ноль — кадр на месте (снимок стенда).
   */
  draw(dt = 0): void {
    if (this.disposed) return;
    if (this.cam.auto) this.cam.follow(this.view(this.t));
    this.cam.groundY = this.stage.groundY(this.cam.now.tx, this.cam.now.tz);
    if (dt > 0) this.cam.update(dt);
    const bt = this.battleTime();
    this.stage.apply(bt, this.cam, this.t);
    // Вызовы и треугольники — честно, вместе с теневым проходом (счётчик сбрасывается руками, как у диорамы).
    this.renderer.info.reset();
    // Теневой проход — раз в `shadowEvery` кадров хода; кадр на месте (перемотка, снимок, подгонка) — со свежей тенью.
    this.renderer.shadowMap.needsUpdate = dt === 0 || this.drawn++ % this.shadowEvery === 0;
    this.renderer.render(this.stage.scene, this.cam.camera);
    this.opts.onFrame?.(this.t, reelToCast(this.plan.timing, bt));
  }

  /** Камера двигается и без хода ролика: цикл кадров нужен и на паузе, пока её ведут. */
  live(on: boolean): void {
    this.beat.block('idle', !on);
  }

  stats(): { calls: number; triangles: number; crowdTriangles: number; textureMB: number; shown: number } {
    const info = this.renderer.info.render;
    return {
      calls: info.calls,
      triangles: info.triangles,
      crowdTriangles: this.stage.crowd.triangles(),
      textureMB: Math.round((this.stage.textureBytes() / 1048576) * 10) / 10,
      shown: this.plan.figures,
    };
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    this.beat.stop();
    this.cam.detach();
    this.stage.dispose();
    this.renderer.shadowMap.autoUpdate = this.shadowAuto;
  }
}
