// Сцена боя: земля, свет, фигуры и камера. Всё, что она делает, — раскладывает
// кадр раскадровки по объектам three.js. Своих решений у неё нет: сколько фигур
// стоит, сколько лежит, где камера и к какому сектору она подана — это уже
// посчитано режиссёром из журнала.
import * as THREE from 'three';
import type { Cast, Frame } from '@/battle/replay';
import type { Side } from '@/battle/types';
import { FigurePool } from '../figures';
import type { Action } from '../poses';
import { applyDayNight, type LightRig } from '../lighting';
import { SeasonVisuals } from '../season';
import { buildField, setupFieldScene } from './field';
import { SectorTroops } from './troops';

/**
 * Полдень: бой в этой пачке идёт при ровном дневном свете. Время суток и
 * закатное солнце — четвёртая пачка, и заводить их по дороге не надо.
 */
const SOLAR = 0.25;

/** Что бойцы делают на каждом такте. Одна поза на такт: тактика тут не при чём. */
const ACTION: Record<Frame['act'], Action> = {
  muster: 'stand',
  pullback: 'walk',
  melee: 'strike',
  rout: 'walk',
};

export class BattleStage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.5, 200);
  private rig: LightRig;
  private pool = new FigurePool();
  private blocks: SectorTroops[] = [];
  private season = new SeasonVisuals();
  private ground: THREE.Mesh;
  private us: Side;

  constructor(cast: Cast) {
    this.us = cast.us;
    this.rig = setupFieldScene(this.scene);
    this.ground = buildField();
    this.scene.add(this.ground);
    this.scene.add(this.pool.group);
    this.season.jump('summer');
    applyDayNight(this.rig, this.scene, SOLAR, this.season);
    for (const c of cast.sectors) this.blocks.push(new SectorTroops(c, this.us, this.pool));
    // Пул растёт по потребности; заказываем всё сразу, чтобы посреди отъезда не
    // пересоздавать инстансы — это единственное место, где кадр мог бы дрогнуть.
    this.pool.fit();
  }

  /** Отношение сторон кадра: от него зависит, влезает ли фронт в стратегический план. */
  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Разложить кадр по сцене. `t` — время ролика: по нему идут позы. */
  apply(frame: Frame, t: number): void {
    const s = frame.shot;
    this.camera.position.set(s.x, s.y, s.z);
    this.camera.lookAt(s.atX, s.atY, s.atZ);
    if (this.camera.fov !== s.fov) {
      this.camera.fov = s.fov;
      this.camera.updateProjectionMatrix();
    }
    const action = ACTION[frame.act];
    for (const f of frame.sectors) {
      const block = this.blocks.find((b) => b.side === f.side && b.sector === f.sector);
      block?.apply(f, this.us, action, t);
    }
    this.pool.update();
  }

  /** Сколько инстансов примитивов заказано на всех — по этому числу считают бюджет. */
  demand(): Record<string, number> {
    return this.pool.demand();
  }

  dispose(): void {
    for (const b of this.blocks) b.dispose(this.pool);
    this.blocks = [];
    this.ground.geometry.dispose();
    this.scene.clear();
  }
}
