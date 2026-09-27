// Проигрыватель ролика: часы, рендерер и ничего больше. Ни одного решения о
// бое он не принимает — берёт кадр у режиссёра и отдаёт его сцене.
//
// Своего контекста WebGL он не создаёт: рендерер приходит снаружи. В игре его
// одалживает диорама (раздел 12 документа о бое: «не создавать второй контекст
// WebGL»), на стенде — сам стенд.
import * as THREE from 'three';
import { buildCast, frameAt, type Cast, type Frame } from '@/battle/replay';
import type { BattleResult, Side } from '@/battle/types';
import { BattleStage } from './stage';
import { FrameLoop } from '../loop';

export interface PlayerOptions {
  /** Кадр отдаётся наружу: по нему интерфейс рисует подпись и кнопки. */
  onFrame?: (frame: Frame) => void;
  /** Ролик доигран до конца. */
  onEnd?: () => void;
  /** Во сколько раз быстрее реального времени — для стенда и отладки. */
  speed?: number;
}

export class ReplayPlayer {
  readonly cast: Cast;
  private stage: BattleStage;
  private clock = new THREE.Clock();
  /** Цепочка кадров — через дверь кадра (`render/loop.ts`): потолок частоты и скрытая страница там. */
  private beat = new FrameLoop<'idle'>(() => this.loop(), () => this.clock.getDelta());
  private t = 0;
  private running = false;
  private disposed = false;

  constructor(
    private renderer: THREE.WebGLRenderer,
    cast: Cast,
    private opts: PlayerOptions = {},
  ) {
    this.cast = cast;
    this.stage = new BattleStage(cast);
    this.beat.block('idle', true);
    this.fit();
    this.draw();
  }

  /** Собрать проигрыватель прямо из итога боя: журнал уже внутри него. */
  static of(renderer: THREE.WebGLRenderer, result: BattleResult, us: Side, opts?: PlayerOptions): ReplayPlayer {
    return new ReplayPlayer(renderer, buildCast(result, us), opts);
  }

  get time(): number {
    return this.t;
  }

  /** Перемотать на секунду `t` и показать этот кадр. Повтор точен: кадр — функция времени. */
  seek(t: number): void {
    this.t = Math.max(0, Math.min(this.cast.seconds, t));
    this.draw();
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.beat.block('idle', false);
  }

  stop(): void {
    this.running = false;
    this.beat.block('idle', true);
  }

  /** Размер канвы мог измениться: аспект берём у рендерера, а не у окна. */
  fit(): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x > 0 && size.y > 0) this.stage.setAspect(size.x / size.y);
  }

  private loop = (): void => {
    if (!this.running || this.disposed) return;
    const dt = Math.min(0.1, this.clock.getDelta()) * (this.opts.speed ?? 1);
    this.t = Math.min(this.cast.seconds, this.t + dt);
    this.draw();
    if (this.t >= this.cast.seconds) {
      this.stop();
      this.opts.onEnd?.();
    }
  };

  /** Один кадр. Вынесен отдельно: стенду нужен снимок без запущенного цикла. */
  draw(): void {
    if (this.disposed) return;
    const frame = frameAt(this.cast, this.t);
    this.stage.apply(frame, this.t);
    // Диорама и стенд считают вызовы честно, вместе с теневым проходом, поэтому
    // счётчик сбрасывается вручную. Тени обновляются каждый кадр: здесь движется
    // всё, и отставание тени видно сразу.
    this.renderer.info.reset();
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.render(this.stage.scene, this.stage.camera);
    this.opts.onFrame?.(frame);
  }

  /** Бюджет кадра: вызовы, треугольники и заказанные инстансы. */
  stats(): { calls: number; triangles: number; instances: number } {
    const info = this.renderer.info.render;
    const demand = this.stage.demand();
    return {
      calls: info.calls,
      triangles: info.triangles,
      instances: Object.values(demand).reduce((a, b) => a + b, 0),
    };
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    this.beat.stop();
    this.stage.dispose();
  }
}
