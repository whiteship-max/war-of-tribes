// Проигрыватель ролика TW: часы, камера, рендерер (docs/battle_tw.md, раздел 8). Ни одного решения о бое: кадр —
// режиссура на секунде, камера — у игрока или общий вид. Своего контекста WebGL он не создаёт — рендерер приходит
// снаружи (в игре его одалживает сцена, на стенде — стенд), как у прежнего ролика (`battle/player.ts`).
import * as THREE from 'three';
import { FrameLoop } from '../loop';
import type { TwSpec } from './spec';
import { TacticalCamera } from './camera';
import { TwStage } from './stage';
import { twToCast, type TwPlan } from './plan';

export interface TwPlayerOptions {
  /** Кадр нарисован: секунда ролика TW и та же секунда раскадровки (подпись, фаза и музыка берутся у неё). */
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

  constructor(
    private renderer: THREE.WebGLRenderer,
    readonly plan: TwPlan,
    spec: TwSpec,
    private opts: TwPlayerOptions = {},
  ) {
    this.speed = opts.speed ?? 1;
    this.stage = new TwStage(plan, spec);
    // Жёсткая тень — `BasicShadowMap` (0) числом, как у уровней сцены (`Scene`): имени в куске three первой загрузки нет.
    renderer.shadowMap.type = spec.shadowSoft ? THREE.PCFShadowMap : (0 as THREE.ShadowMapType);
    // Тень — по просьбе кадра, а не сама: так её можно рисовать реже (`spec.shadowEvery`) и на своём холсте.
    this.shadowEvery = Math.max(1, spec.shadowEvery);
    this.shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    this.fitAspect();
    const start = this.stage.autoView(0, this.aspect);
    this.cam = new TacticalCamera(start, this.stage.bounds(this.aspect));
    this.cam.setAspect(this.aspect);
    this.beat.block('idle', true);
    this.draw();
  }

  get time(): number {
    return this.t;
  }

  get seconds(): number {
    return this.plan.seconds;
  }

  get playing(): boolean {
    return this.running;
  }

  /** Перемотать и показать кадр: повтор точен, кадр — функция времени. */
  seek(t: number): void {
    this.t = Math.max(0, Math.min(this.plan.seconds, t));
    if (this.cam.auto) {
      this.cam.follow(this.stage.autoView(this.t, this.aspect));
      this.cam.snap();
    }
    this.draw();
  }

  start(): void {
    if (this.running || this.disposed) return;
    if (this.t >= this.plan.seconds) this.t = 0;
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
    if (this.running) this.t = Math.min(this.plan.seconds, this.t + dt * this.speed);
    this.draw(dt);
    if (this.running && this.t >= this.plan.seconds) {
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
    if (this.cam.auto) this.cam.follow(this.stage.autoView(this.t, this.aspect));
    this.cam.groundY = this.stage.groundY(this.cam.now.tx, this.cam.now.tz);
    if (dt > 0) this.cam.update(dt);
    this.stage.apply(this.t, this.cam);
    // Вызовы и треугольники — честно, вместе с теневым проходом (счётчик сбрасывается руками, как у диорамы).
    this.renderer.info.reset();
    // Теневой проход — раз в `shadowEvery` кадров хода; кадр на месте (перемотка, снимок, подгонка) — со свежей тенью.
    this.renderer.shadowMap.needsUpdate = dt === 0 || this.drawn++ % this.shadowEvery === 0;
    this.renderer.render(this.stage.scene, this.cam.camera);
    this.opts.onFrame?.(this.t, twToCast(this.plan.timing, this.t));
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
