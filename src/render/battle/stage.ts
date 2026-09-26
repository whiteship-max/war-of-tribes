// Сцена боя: земля, свет, фигуры и камера. Всё, что она делает, — раскладывает
// кадр раскадровки по объектам three.js. Своих решений у неё нет: сколько фигур
// стоит, сколько лежит, где камера и к какому сектору она подана — это уже
// посчитано режиссёром из журнала.
import * as THREE from 'three';
import type { Cast, Frame } from '@/battle/replay';
import type { Side } from '@/battle/types';
import { FigurePool } from '../figures';
import type { Action } from '../poses';
import { buildSky, setupFieldScene } from './field';
import { buildGround, type GroundView } from './ground';
import { Aftermath } from './aftermath';
import { ArrowStorm } from './arrows';
import { MassView } from './mass';
import { CLOTH_OF, SectorTroops } from './troops';
import { wreckFor } from '@/battle/replay';

/**
 * Что бойцы делают. Такт задаёт основное, но сшибка — своя поза: строй
 * останавливается и упирается, и только потом начинается свалка. Это и есть
 * замах, без которого удар ничего не весит. Сближение круга лежит в такте сечи
 * (`replay.actOf`): линии отходят на разбег посреди боя, и строй стоит в упоре,
 * а не шагает на месте.
 */
const ACTION: Record<Frame['act'], Action> = {
  muster: 'stand',
  pullback: 'walk',
  melee: 'strike',
  rout: 'walk',
};

const actionOf = (frame: Frame): Action =>
  frame.phase === 'approach' ? (frame.act === 'melee' ? 'guard' : 'walk') : frame.phase === 'clash' ? 'guard' : ACTION[frame.act];

export class BattleStage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.5, 200);
  private pool = new FigurePool();
  private blocks: SectorTroops[] = [];
  /** Масса: знамёна, лес древков и пятно под строем. Вызов на набор (`MassView`), сколько бы ни было войска. */
  private mass: MassView;
  /** Залпы: все стрелы поля одним вызовом отрисовки. */
  private arrows = new ArrowStorm();
  /** Поле после боя: брошенные щиты и воткнутые копья. */
  private wreck: Aftermath;
  /** Земля клетки, на которой случился бой, и купол неба над ней. */
  private ground: GroundView;
  private sky: THREE.Mesh;
  private us: Side;

  constructor(cast: Cast) {
    this.us = cast.us;
    // Свет и земля — из раскадровки, то есть из записи боя. Ни настоящих часов,
    // ни карты мира: повтор через неделю обязан дать тот же кадр.
    setupFieldScene(this.scene, cast.ground);
    this.ground = buildGround(cast.ground);
    this.scene.add(this.ground.group);
    // Купол собирается после света: цвета он берёт у самой сцены.
    this.sky = buildSky(this.scene, cast.ground);
    this.scene.add(this.sky);
    this.scene.add(this.pool.group);
    for (const c of cast.sectors) this.blocks.push(new SectorTroops(c, this.us, this.pool));
    // Ёмкость заказывается сразу на всё войско: пересоздавать инстансы посреди
    // отъезда — единственное место, где кадр мог бы дрогнуть.
    this.mass = new MassView({
      shafts: cast.sectors.reduce((n, c) => n + c.shafts + c.banners, 0),
      flags: cast.sectors.reduce((n, c) => n + c.banners, 0),
      dust: cast.sectors.length,
    });
    this.scene.add(this.mass.group);
    this.wreck = new Aftermath(cast.sectors.reduce((n, c) => n + wreckFor(c.figures), 0));
    this.scene.add(this.wreck.group);
    this.scene.add(this.arrows.mesh);
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
    // Позы идут по времени раскадровки, а не по часам: на первом столкновении
    // ход почти замирает, и удар от этого весит больше любых полигонов.
    const action = actionOf(frame);
    for (const f of frame.sectors) {
      const block = this.blocks.find((b) => b.side === f.side && b.sector === f.sector);
      block?.apply(f, this.us, action, frame.poseTime);
    }
    this.pool.update();
    this.mass.update(frame.sectors, (f) => CLOTH_OF(f.side === this.us), { couch: frame.couch, time: t, impact: frame.impact });
    this.wreck.update(frame.sectors, (f) => CLOTH_OF(f.side === this.us));
    this.arrows.update(frame.volleys);
  }

  /** Сколько инстансов примитивов заказано на всех — по этому числу считают бюджет. */
  demand(): Record<string, number> {
    return this.pool.demand();
  }

  dispose(): void {
    this.arrows.dispose();
    this.mass.dispose();
    this.wreck.dispose();
    for (const b of this.blocks) b.dispose(this.pool);
    this.blocks = [];
    this.ground.dispose();
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.scene.clear();
  }
}
