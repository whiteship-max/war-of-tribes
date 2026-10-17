// Сцена ролика TW: поле, свет, толпа, знамёна, стрелы (docs/battle_tw.md, раздел 8). Своих решений о бое у неё нет:
// кто где стоит и когда падает — режиссура (`plan.ts`); здесь кадр раскладывается по объектам three.
import * as THREE from 'three';
import { buildClouds, buildSky, cloudShade, nightOf, setupFieldScene } from '../reel/light';
import { frameOf, townLand } from './town';
import type { TownBackdrop } from '../city/backdrop';
import { fitShadow, type LightRig } from '../lighting';
import type { TwSpec } from '../reel/spec';
import { Arrows } from './arrows';
import { Banners } from '../reel/banners';
import { Crowd, SHADOW_LAYER } from '../reel/crowd';
import { Dust } from './dust';
import { buildFort, fortOfPlan, type FortView } from './fort';
import { buildField, fogFor, type FieldView, type LandInput } from '../reel/land';
import { OVERVIEW_PITCH, overview, type CamBounds, type CamState, type TacticalCamera } from '../reel/camera';
import type { DirectorScene } from '../reel/director';
import { poseFigures, unitPose, type TwPlan } from './plan';
import { figureFrame, type FigureFrame } from '../reel/troupe';
import { heightAt } from '../reel/terrain';
import { siteBlocks, siteGround } from './site';
import { Siegeworks, worksOfPlan } from './siegeworks';

/** Лампа стоит так далеко от цели по своему направлению; коробка теней — от расстояния камеры. */
const SUN_DIST = 160;
const SHADOW_HALF = { min: 28, max: 110, perDist: 0.6 };
/** Кадр развязки режиссёра: бегущие и гонящие не дальше этого от линии соприкосновения, метры сцены. */
const ROUT_FRAME = 15;
/** В строю для режиссёра бегущий остаётся там, где был через столько секунд после слома (треть пути бегства). */
const FLEE_HOLD = 2.6;
/** Небо — купол прежнего ролика (`reel/light.buildSky`, радиус 150), растянутый до горизонта поля. */
const SKY_SCALE = 7;

export class TwStage {
  readonly scene = new THREE.Scene();
  readonly frame: FigureFrame;
  /** Что режиссёр камеры спрашивает у плана (`directorScene`). */
  readonly director: DirectorScene;
  readonly crowd: Crowd;
  readonly field: FieldView;
  private banners: Banners;
  private arrows: Arrows;
  private dust: Dust;
  readonly fort: FortView;
  /** Обстрел перед штурмом (`plan.barrage`, docs/battle_tw.md, раздел 15); нет — null. */
  readonly siege: Siegeworks | null;
  private sky: THREE.Mesh;
  /** Облака (`spec.clouds`); на низком уровне их нет. */
  private clouds: ReturnType<typeof buildClouds> | null;
  private rig: LightRig;
  private sunDir = new THREE.Vector3();

  /**
   * `town` — настоящий город за стеной места боя (docs/polish.md, П-6, `city/backdrop.ts`): его дома, стены по кругу, лес и
   * земля до горизонта; сцена его освобождает. Нет (поле, логово, город не собрался) — дома ролика на его поле.
   */
  constructor(
    readonly plan: TwPlan,
    readonly spec: TwSpec,
    readonly town: TownBackdrop | null = null,
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
    this.clouds = spec.clouds ? buildClouds(this.scene, plan.cast.ground, this.rig) : null;
    if (this.clouds) {
      this.clouds.mesh.scale.setScalar(SKY_SCALE);
      this.scene.add(this.clouds.mesh);
    }
    const site = plan.site;
    const land = landOf(plan);
    if (town && site?.wall && site.town) land.town = townLand(frameOf(site.wall), site.town.paint, site.town.outside, town.cleared, town.road);
    this.field = buildField(land, spec);
    this.scene.add(this.field.group);
    if (town) {
      this.scene.add(town.group);
      // Свет боя — один на весь ролик (час записи): ночь города, солнце и небо — раз.
      town.light(nightOf(plan.cast.ground.solar), this.sunDir, (this.scene.fog as THREE.Fog).color);
    }
    const them = plan.us === 'attacker' ? 'defender' : 'attacker';
    const coats = { ours: plan.coats[plan.us], theirs: plan.coats[them] };
    // Гербы сторон — на знамёнах и на щитах и сюрко бойцов (docs/polish.md, П-5).
    this.crowd = new Crowd(plan, spec, coats);
    this.scene.add(this.crowd.group);
    this.banners = new Banners(plan, coats);
    this.scene.add(this.banners.group);
    this.arrows = new Arrows(plan, spec.arrows);
    this.scene.add(this.arrows.mesh);
    this.scene.add(this.arrows.stuck);
    this.dust = new Dust(plan);
    this.scene.add(this.dust.mesh);
    // Место боя: стена, ворота, город, лагерь, логово (docs/battle_tw.md, раздел 13); у поля — пустая группа.
    this.fort = buildFort({ ...fortOfPlan(plan), town: town ? town.skin : null });
    this.scene.add(this.fort.group);
    this.siege = plan.barrage ? new Siegeworks({ ...worksOfPlan(plan), skin: town ? town.skin : null }, plan.barrage, this.crowd) : null;
    if (this.siege) this.scene.add(this.siege.group);
    this.frame = figureFrame(plan.figures);
    this.director = directorSceneOf(plan);
  }

  /**
   * Разложить кадр на секунде боя `t`; `clip` — секунда ролика с прологом обстрела (`TwPlayer.pre`), по ней идут машины,
   * камни и дым. Камера — уже поставлена (её ведёт игрок или общий вид).
   */
  apply(t: number, cam: TacticalCamera, clip = t): void {
    poseFigures(this.plan, t, this.frame);
    // Облик бойца — по дальности (`crowd.LOD_PX`, `NEAR_PX`): порог по полю зрения камеры, оно растёт с узостью экрана;
    // вне кадра бойцы не пишутся.
    this.crowd.update(this.frame, cam.camera);
    this.banners.update(this.frame, t, cam.camera, cam.now.dist);
    this.arrows.update(t);
    this.dust.update(t, cam.camera);
    this.field.update(t);
    this.fort.update(t);
    this.siege?.update(clip, cam.camera);
    // Небо идёт за камерой, туман — от её расстояния, коробка теней — вокруг её цели.
    this.sky.position.copy(cam.camera.position);
    if (this.clouds) {
      this.clouds.mesh.position.copy(cam.camera.position);
      this.clouds.update(clip);
    }
    const fog = this.scene.fog as THREE.Fog;
    const f = fogFor(cam.now.dist);
    fog.near = f.near;
    fog.far = f.far;
    const tgt = this.rig.sun.target.position.set(cam.now.tx, cam.groundY, cam.now.tz);
    this.rig.sun.position.copy(tgt).addScaledVector(this.sunDir, SUN_DIST);
    this.rig.sun.target.updateMatrixWorld();
    fitShadow(this.rig, Math.min(SHADOW_HALF.max, Math.max(SHADOW_HALF.min, cam.now.dist * SHADOW_HALF.perDist)));
  }

  /**
   * Сторож ролика опустил уровень посреди боя (`TwPlayer`): гаснет то, чего у нового уровня нет, — тени бойцов, облака,
   * кустики и цветы. Фигур не меньше: их число — `k` плана, одно на весь бой (соотношение сил видно глазами), и менять его
   * посреди ролика нельзя; меньше фигур будет со следующего ролика — уровень помнится (`gfx.rememberAutoCap`).
   */
  lower(next: TwSpec): void {
    // Бойцы вблизи — средним обликом, если у нового уровня ближнего нет (`TwSpec.crowdLod`).
    this.crowd.detail(next.crowdLod);
    if (next.shadow === 'none') this.crowd.shadows(false);
    if (!next.clouds && this.clouds) this.clouds.mesh.visible = false;
    this.field.lower(next);
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
    return this.crowd.bones.bytes + this.spec.shadowMap * this.spec.shadowMap * 4 + (this.town?.textureBytes ?? 0);
  }

  dispose(): void {
    this.crowd.dispose();
    this.banners.dispose();
    this.arrows.dispose();
    this.dust.dispose();
    this.fort.dispose();
    this.siege?.dispose();
    this.field.dispose();
    this.town?.dispose();
    this.sky.geometry.dispose();
    if (this.clouds) {
      this.clouds.mesh.geometry.dispose();
      (this.clouds.mesh.material as THREE.Material).dispose();
    }
    (this.sky.material as THREE.Material).dispose();
    this.rig.sun.shadow.map?.dispose();
    this.scene.clear();
  }
}

/** Земля плана места: поле, строи на построении и что место боя говорит земле (`site.ts`). */
export function landOf(plan: TwPlan): LandInput {
  const site = plan.site;
  // Вытоптанная полоса сечи: у линии соприкосновения, во всю ширину сошедшихся полос, растёт от сшибки к концу сечи.
  const span = Math.max(8, ...plan.slotX.map((x, i) => Math.abs(x) + plan.slotW[i] / 2));
  const from = plan.clashAt;
  const to = Math.max(from + 1, plan.timing.melee[1]);
  return {
    field: plan.field,
    scar: { z: 0, half: 3.4, span, at: (t) => Math.min(1, Math.max(0, (t - from) / (to - from))) ** 0.7 },
    cloud: cloudShade(plan.cast.ground),
    deployZ: plan.deployZ,
    units: plan.units,
    site: site
      ? {
          ground: (x, z) => siteGround(site, x, z),
          blocks: (x, z) => siteBlocks(site, x, z),
          lair: site.kind === 'lair' ? site.camp : null,
        }
      : null,
  };
}

/**
 * Что режиссёр камеры (`reel/director`) спрашивает у плана: прямоугольник строя и место сектора на секунде боя. В
 * строю — бежавшие не дальше трети пути; с бегством — и бегущие, и гонящие, пока они на поле.
 */
export function directorSceneOf(plan: TwPlan): DirectorScene {
  return {
    us: plan.us,
    box: (t, which) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const u of plan.units) {
        if (which === 'lines' && (u.row === 'reserve' || u.row === 'general')) continue;
        // Прямоугольник меняется непрерывно: бегущий не выпадает из него разом, а замирает там, где был к трети пути
        // (`FLEE_HOLD`); на развязке — прижат к краю её кадра. Иначе отряд, переступивший черту, дёргал бы камеру.
        const at = which !== 'rout' && u.fleeAt !== null ? Math.min(t, u.fleeAt + FLEE_HOLD) : t;
        const p = unitPose(plan, u, at);
        const x = which === 'rout' ? Math.max(-ROUT_FRAME, Math.min(ROUT_FRAME, p.x)) : p.x;
        const z = which === 'rout' ? Math.max(-ROUT_FRAME, Math.min(ROUT_FRAME, p.z)) : p.z;
        const back = u.ours ? -1 : 1;
        minX = Math.min(minX, x - u.width / 2);
        maxX = Math.max(maxX, x + u.width / 2);
        minZ = Math.min(minZ, z, z + back * u.depth);
        maxZ = Math.max(maxZ, z, z + back * u.depth);
      }
      return Number.isFinite(minX) ? { minX: minX - 3, maxX: maxX + 3, minZ: minZ - 3, maxZ: maxZ + 3 } : null;
    },
    spot: (side, sector, t) => {
      let best: (typeof plan.units)[number] | null = null;
      for (const u of plan.units) if (u.side === side && u.sector === sector && u.row !== 'general' && (!best || u.men > best.men)) best = u;
      if (!best) return null;
      const p = unitPose(plan, best, t);
      return { x: p.x, z: p.z };
    },
  };
}
