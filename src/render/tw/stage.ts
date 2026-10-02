// Сцена ролика TW: поле, свет, толпа, знамёна, стрелы (docs/battle_tw.md, раздел 8). Своих решений о бое у неё нет:
// кто где стоит и когда падает — режиссура (`plan.ts`); здесь кадр раскладывается по объектам three.
import * as THREE from 'three';
import { buildSky, setupFieldScene } from '../battle/field';
import { fitShadow, type LightRig } from '../lighting';
import type { TwSpec } from './spec';
import { Arrows } from './arrows';
import { Banners } from './banners';
import { Crowd, SHADOW_LAYER } from './crowd';
import { buildField, fogFor, type FieldView } from './field';
import { OVERVIEW_PITCH, overview, type CamBounds, type CamState, type TacticalCamera } from './camera';
import { figureFrame, poseFigures, unitPose, type FigureFrame, type TwPlan } from './plan';
import { heightAt } from './terrain';

/** Лампа стоит так далеко от цели по своему направлению; коробка теней — от расстояния камеры. */
const SUN_DIST = 160;
const SHADOW_HALF = { min: 28, max: 110, perDist: 0.6 };
/** Небо — купол прежнего ролика (`battle/field.buildSky`, радиус 150), растянутый до горизонта поля. */
const SKY_SCALE = 7;

export class TwStage {
  readonly scene = new THREE.Scene();
  readonly frame: FigureFrame;
  readonly crowd: Crowd;
  readonly field: FieldView;
  private banners: Banners;
  private arrows: Arrows;
  private sky: THREE.Mesh;
  private rig: LightRig;
  private sunDir = new THREE.Vector3();

  constructor(
    readonly plan: TwPlan,
    readonly spec: TwSpec,
  ) {
    // Свет и небо — прежнего ролика: час и сезон из записи боя (`Cast.ground`), низкое тёплое солнце.
    this.rig = setupFieldScene(this.scene, plan.cast.ground);
    this.rig.sun.shadow.mapSize.set(spec.shadowMap, spec.shadowMap);
    this.rig.sun.shadow.camera.far = SUN_DIST * 2.2;
    this.rig.sun.shadow.camera.layers.enable(SHADOW_LAYER);
    this.rig.sun.shadow.normalBias = 0.05;
    this.sunDir.copy(this.rig.sun.position).normalize();
    this.sky = buildSky(this.scene, plan.cast.ground);
    this.sky.scale.setScalar(SKY_SCALE);
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
    this.field = buildField(plan.field, spec, plan);
    this.scene.add(this.field.group);
    this.crowd = new Crowd(plan, spec);
    this.scene.add(this.crowd.group);
    this.banners = new Banners(plan);
    this.scene.add(this.banners.group);
    this.arrows = new Arrows(plan, spec.arrows);
    this.scene.add(this.arrows.mesh);
    this.frame = figureFrame(plan.figures);
  }

  /** Разложить кадр на секунде `t`. Камера — уже поставлена (её ведёт игрок или общий вид). */
  apply(t: number, cam: TacticalCamera): void {
    poseFigures(this.plan, t, this.frame);
    this.crowd.update(this.frame);
    this.banners.update(this.frame, t, cam.camera, cam.now.dist);
    this.arrows.update(t);
    this.field.update(t);
    // Небо идёт за камерой, туман — от её расстояния, коробка теней — вокруг её цели.
    this.sky.position.copy(cam.camera.position);
    const fog = this.scene.fog as THREE.Fog;
    const f = fogFor(cam.now.dist);
    fog.near = f.near;
    fog.far = f.far;
    const tgt = this.rig.sun.target.position.set(cam.now.tx, cam.groundY, cam.now.tz);
    this.rig.sun.position.copy(tgt).addScaledVector(this.sunDir, SUN_DIST);
    this.rig.sun.target.updateMatrixWorld();
    fitShadow(this.rig, Math.min(SHADOW_HALF.max, Math.max(SHADOW_HALF.min, cam.now.dist * SHADOW_HALF.perDist)));
  }

  /** Высота земли под точкой — камере, чтобы не уходить под холм. */
  groundY(x: number, z: number): number {
    return heightAt(this.plan.field, x, z);
  }

  /**
   * Общий вид на секунде `t`: прямоугольник отрядов, что ещё на поле (бежавшие дальше десяти метров — уже нет).
   * К сшибке он сжимается к линии соприкосновения сам: строи сходятся.
   */
  autoView(t: number, aspect: number): CamState {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const u of this.plan.units) {
      const p = unitPose(this.plan, u, t);
      if (p.flee > 0.35) continue;
      const back = u.ours ? -1 : 1;
      minX = Math.min(minX, p.x - u.width / 2);
      maxX = Math.max(maxX, p.x + u.width / 2);
      minZ = Math.min(minZ, p.z, p.z + back * u.depth);
      maxZ = Math.max(maxZ, p.z, p.z + back * u.depth);
    }
    if (!Number.isFinite(minX)) return overview({ minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, aspect);
    const pad = 3;
    return overview({ minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad }, aspect, 0, OVERVIEW_PITCH);
  }

  /** Границы камеры: поле с запасом; приблизить — до бойца в треть экрана, отдалить — до всего поля и ещё половины. */
  bounds(aspect: number): CamBounds {
    const f = this.plan.field;
    const all = overview({ minX: -f.halfX, maxX: f.halfX, minZ: f.minZ, maxZ: f.maxZ }, aspect);
    return { minX: -f.halfX, maxX: f.halfX, minZ: f.minZ, maxZ: f.maxZ, minDist: 4.5, maxDist: Math.max(60, all.dist * 1.1) };
  }

  /** Байт текстур ролика: суставы и карта теней лампы (глубина — четыре байта на тексель). */
  textureBytes(): number {
    return this.crowd.bones.bytes + this.spec.shadowMap * this.spec.shadowMap * 4;
  }

  dispose(): void {
    this.crowd.dispose();
    this.banners.dispose();
    this.arrows.dispose();
    this.field.dispose();
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.rig.sun.shadow.map?.dispose();
    this.scene.clear();
  }
}
