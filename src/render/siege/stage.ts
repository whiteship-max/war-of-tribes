// Сцена ролика осады (docs/gfx.md, ГФ-2): город за стеной, лагерь, машины, люди, огонь и дым, свет по часу осады. Своих
// решений нет: где кто и когда — режиссура (`reel.ts`); здесь кадр раскладывается по объектам three. Всё, что умеет ролик
// боя, берётся у него и у общего модуля (`render/reel`): земля, толпа, знамёна, камень и дерево места, машины и обвал.
import * as THREE from 'three';
import { CITY } from '../city/palette';
import { Builder, box, tint } from '../city/geom';
import { log } from '../city/kit';
import { fitShadow, type LightRig } from '../lighting';
import { buildClouds, buildLiveSky, cloudShade, nightOf, relight, setupFieldScene } from '../reel/light';
import type { TwSpec } from '../reel/spec';
import { Crowd, SHADOW_LAYER } from '../reel/crowd';
import { Banners } from '../reel/banners';
import { buildField, fogFor, type FieldView } from '../reel/land';
import { overview, type CamBounds, type TacticalCamera } from '../reel/camera';
import { CLIP_INDEX, figureFrame, type FigureFrame } from '../reel/troupe';
import { heightAt } from '../reel/terrain';
import { buildFort, geometryOf, m, type FortView } from '../tw/fort';
import { Siegeworks } from '../tw/siegeworks';
import { siteBlocks, siteGround, standY, type TwSite } from '../tw/site';
import { motionOf, solarAt, type SiegeReel } from './reel';
import { poseAt, type TrackPose } from './tracks';
import { BANDIT_ARMS, DEFAULT_ARMS, armsCode } from '@/heraldry/arms';
import { frameOf, townLand } from '../tw/town';
import type { TownBackdrop } from '../city/backdrop';

const SUN_DIST = 160;
const SHADOW_HALF = { min: 30, max: 110, perDist: 0.6 };
const SKY_SCALE = 7;
/** Огонь факела и костра — тёплый, без света: лампа на сцене одна (docs/handbook/graphics.md). */
const FLAME = 0xf6a347;

export { nightOf } from '../reel/light';

/** Кадр фигур ролика осады на секунде `t`. */
export function poseSiege(reel: SiegeReel, t: number, out: FigureFrame, scratch: TrackPose): void {
  const site = reel.layout.site;
  const f = reel.layout.field;
  for (let i = 0; i < reel.tracks.count; i++) {
    poseAt(reel.tracks, i, t, reel.phase[i], scratch);
    out.x[i] = scratch.x;
    out.z[i] = scratch.z;
    out.y[i] = Number.isFinite(scratch.y) ? scratch.y : standY(f, site, scratch.x, scratch.z);
    out.yaw[i] = scratch.yaw;
    out.clip[i] = CLIP_INDEX[scratch.clip];
    out.time[i] = scratch.time;
    out.shown[i] = scratch.shown ? 1 : 0;
  }
}

/** Телега: короб на двух колёсах, оглобли; гружёная — мешки поверх. Метры набора. */
function cartGeometry(loaded: boolean): THREE.BufferGeometry {
  const b = new Builder();
  const T = tint(CITY.oak, 0.9);
  box(b, 0, 0, 0, 1, 1.5, 2.4, 0.7, 1.25, 'wood', T, 'wood');
  for (const side of [1, -1]) box(b, side * 0.88, 0.1, 1, 0, 0.18, 1.2, 0.0, 1.2, 'wood', tint(CITY.oak, 0.65), 'wood');
  for (const side of [1, -1]) log(b, [side * 0.45, 0.85, 1.2], [side * 0.45, 0.6, 3.0], 0.06, T, 4, false);
  if (loaded) for (let k = 0; k < 4; k++) box(b, (k % 2 === 0 ? -0.35 : 0.35), (k < 2 ? -0.5 : 0.5), 0, 1, 0.6, 0.7, 1.25, 1.75, 'cloth', tint(0xc9b48c, 0.9 + k * 0.03), 'cloth');
  return geometryOf(b);
}

/** Леса у пролома: столбы и настил — чинят изнутри. */
function scaffoldGeometry(width: number, height: number): THREE.BufferGeometry {
  const b = new Builder();
  const T = tint(CITY.oakLight, 0.95);
  const w = m(width);
  const h = m(height);
  for (let x = -w / 2; x <= w / 2 + 0.01; x += Math.max(1.5, w / 4)) {
    log(b, [x, 0, 0], [x, h, 0], 0.09, T, 4, false);
    log(b, [x, 0, 1.4], [x, h * 0.85, 1.4], 0.09, T, 4, false);
  }
  for (const y of [h * 0.35, h * 0.7]) box(b, 0, 0.7, 0, 1, w, 1.6, y, y + 0.08, 'wood', tint(CITY.oak, 0.8), 'wood');
  return geometryOf(b);
}

export class SiegeStage {
  readonly scene = new THREE.Scene();
  readonly frame: FigureFrame;
  readonly crowd: Crowd;
  readonly field: FieldView;
  readonly fort: FortView;
  private lairFort: FortView | null = null;
  private banners: Banners;
  private works: Siegeworks;
  private rig: LightRig;
  private sky: ReturnType<typeof buildLiveSky>;
  private clouds: ReturnType<typeof buildClouds> | null;
  private sunDir = new THREE.Vector3();
  private lastSolar = -1;
  private pose: TrackPose = { x: 0, y: 0, z: 0, yaw: 0, clip: 'idle', time: 0, shown: true };
  private arrows: THREE.InstancedMesh;
  private carts: THREE.InstancedMesh[] = [];
  private torches: THREE.InstancedMesh | null = null;
  /** Огни, что светятся ночью: факелы на стене (`reel.torches`) и костры лагеря; `k` — величина. */
  private flames: { x: number; y: number; z: number; k: number }[] = [];
  private scaffolds: THREE.Mesh[] = [];
  private disposables: { dispose(): void }[] = [];
  private M = new THREE.Matrix4();
  private Q = new THREE.Quaternion();
  private V = new THREE.Vector3();
  private S = new THREE.Vector3();
  private Y = new THREE.Vector3(0, 1, 0);
  private D = new THREE.Vector3();
  private Z = new THREE.Vector3(0, 0, 1);

  /**
   * `town` — настоящий город за стеной (docs/polish.md, П-6, `city/backdrop.ts`): его дома, стены по кругу, лес и земля до
   * горизонта; сцена его освобождает. Нет (логово, город не собрался) — дома ролика на его поле.
   */
  constructor(
    readonly reel: SiegeReel,
    readonly spec: TwSpec,
    readonly town: TownBackdrop | null = null,
  ) {
    const lay = reel.layout;
    const ground0 = { ...reel.show.ground, solar: reel.show.solar0 };
    this.rig = setupFieldScene(this.scene, ground0);
    this.rig.sun.shadow.mapSize.set(spec.shadowMap, spec.shadowMap);
    this.rig.sun.shadow.camera.far = SUN_DIST * 2.2;
    this.rig.sun.shadow.camera.layers.enable(SHADOW_LAYER);
    this.rig.sun.shadow.normalBias = 0.05;
    this.sky = buildLiveSky();
    this.sky.mesh.scale.setScalar(SKY_SCALE);
    this.sky.mesh.renderOrder = -1;
    this.scene.add(this.sky.mesh);
    this.clouds = spec.clouds ? buildClouds(this.scene, ground0, this.rig) : null;
    if (this.clouds) {
      this.clouds.mesh.scale.setScalar(SKY_SCALE);
      this.scene.add(this.clouds.mesh);
    }
    // Земля: город и лагерь утоптаны, деревья — не на них; логово — в чаще.
    const site: TwSite = { ...lay.site, ladders: reel.ladders, ram: reel.ram, tower: reel.tower };
    const lair = lay.lair;
    this.field = buildField(
      {
        field: lay.field,
        deployZ: { attacker: -26, defender: 2 },
        units: [],
        site: {
          ground: (x, z) => {
            const g = siteGround(site, x, z);
            if (lair && x > lair.x0 - 2 && x < lair.x1 + 2 && z > lair.z0 - 2 && z < lair.z1 + 2) g.dirt = Math.max(g.dirt, 0.55);
            return g;
          },
          blocks: (x, z) => siteBlocks(site, x, z) || (!!lair && x > lair.x0 - 5 && x < lair.x1 + 5 && z > lair.z0 - 5 && z < lair.z1 + 5),
          lair: lair ? { x0: lair.x0, x1: lair.x1, z0: lair.z0, z1: lair.z1 } : null,
        },
        scar: null,
        cloud: cloudShade(ground0),
        town: town && lay.wall && lay.town ? townLand(frameOf(lay.wall), lay.town.paint, lay.town.outside, town.cleared, town.road) : null,
      },
      spec,
    );
    this.scene.add(this.field.group);
    this.fort = buildFort({ site, field: lay.field, seed: reel.show.seed, breach: reel.breach, quality: reel.quality, motion: motionOf(reel), town: town ? town.skin : null });
    this.scene.add(this.fort.group);
    if (town) this.scene.add(town.group);
    if (lair) {
      const still = { ladderZ: () => 0, towerZ: () => 0, ram: () => ({ z: 0, swing: 0 }), gate: () => ({ open: 0, shake: 0 }) };
      this.lairFort = buildFort({ site: { ...site, kind: 'lair', wall: null, ladders: [], ram: null, tower: null, houses: [], camp: lair }, field: lay.field, seed: reel.show.seed + 3, breach: null, quality: reel.quality, motion: still });
      this.scene.add(this.lairFort.group);
    }
    this.crowd = new Crowd(reel.troupe, spec, reel.show.coats ?? { ours: armsCode(DEFAULT_ARMS), theirs: armsCode(BANDIT_ARMS) });
    this.scene.add(this.crowd.group);
    // Гербы (П-2): по донесению (`SiegeShow.coats`) — наш герб державы, у чужих — сосед, логово или разбойники; без
    // донесения (стенд) — прежняя башня против разбойников. Прежде чужой герб решала стена, и логово под нашим городом
    // несло башню соседа.
    this.banners = new Banners(reel.troupe, reel.show.coats ?? { ours: armsCode(DEFAULT_ARMS), theirs: armsCode(BANDIT_ARMS) });
    this.scene.add(this.banners.group);
    this.works = new Siegeworks({ quality: reel.quality, field: lay.field, wall: lay.wall, seed: reel.show.seed, skin: town ? town.skin : null }, reel.barrage, this.crowd);
    this.scene.add(this.works.group);

    // Стрелы со стены.
    const ag = new THREE.BoxGeometry(0.035, 0.035, 0.85);
    const am = new THREE.MeshBasicMaterial({ color: 0x3a2f24 });
    am.name = 'siege-arrows';
    this.arrows = new THREE.InstancedMesh(ag, am, Math.max(1, Math.min(spec.arrows, reel.arrows.length)));
    this.arrows.name = 'siege-arrows';
    this.arrows.frustumCulled = false;
    this.arrows.count = 0;
    this.arrows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.arrows);
    this.disposables.push(ag, am, this.arrows);

    // Телеги дани и добычи: гружёные и порожние — свой меш на вид.
    const cartMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    cartMat.name = 'siege-carts';
    this.disposables.push(cartMat);
    for (const loaded of [false, true]) {
      const ids = reel.carts.loaded.map((l, i) => (l === loaded ? i : -1)).filter((i) => i >= 0);
      if (ids.length === 0) continue;
      const g = cartGeometry(loaded);
      const mesh = new THREE.InstancedMesh(g, cartMat, ids.length);
      mesh.name = loaded ? 'siege-carts-loaded' : 'siege-carts';
      mesh.castShadow = spec.shadow !== 'none';
      mesh.frustumCulled = false;
      mesh.userData.ids = ids;
      this.scene.add(mesh);
      this.carts.push(mesh);
      this.disposables.push(g, mesh);
    }

    // Факелы на стене и костры лагеря — светятся сами ночью (лампа на сцене одна: огонь — без света, своим цветом).
    for (const f of lay.camp.fires) this.flames.push({ x: f.x, y: heightAt(lay.field, f.x, f.z) + 0.15, z: f.z, k: 2.4 });
    for (const p of reel.torches) this.flames.push({ ...p, k: 1 });
    if (this.flames.length > 0) {
      const tg = new THREE.ConeGeometry(0.16, 0.5, 5).translate(0, 0.25, 0);
      const tm = new THREE.MeshBasicMaterial({ color: FLAME });
      tm.name = 'siege-torches';
      this.torches = new THREE.InstancedMesh(tg, tm, this.flames.length);
      this.torches.name = 'siege-torches';
      this.torches.frustumCulled = false;
      this.scene.add(this.torches);
      this.disposables.push(tg, tm, this.torches);
    }

    // Леса у пролома: по одному на починку.
    const w = lay.wall;
    if (w) {
      const smat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
      smat.name = 'siege-scaffold';
      this.disposables.push(smat);
      for (const sc of reel.scaffolds) {
        const g = scaffoldGeometry(sc.width, w.top + 0.6);
        const mesh = new THREE.Mesh(g, smat);
        mesh.name = 'siege-scaffold';
        mesh.position.set(sc.x, w.base, w.z + w.inward * (w.thick + 0.15));
        mesh.visible = false;
        mesh.userData.win = sc;
        this.scene.add(mesh);
        this.scaffolds.push(mesh);
        this.disposables.push(g);
      }
    }
    this.frame = figureFrame(reel.tracks.count);
    this.relightAt(0);
  }

  /** Свет на секунде `t`: час осады — день, закат, ночь с луной, рассвет. */
  private relightAt(t: number): void {
    const solar = solarAt(this.reel, t);
    if (Math.abs(solar - this.lastSolar) < 0.0015) return;
    this.lastSolar = solar;
    const g = { ...this.reel.show.ground, solar };
    relight(this.rig, this.scene, g);
    // Ночь осады темнее ночи города: город держит жителей различимыми, а ролику нужны огни на тёмной земле.
    const night = nightOf(solar);
    this.rig.hemi.intensity *= 1 - 0.38 * night;
    this.rig.sun.intensity *= 1 - 0.22 * night;
    this.sunDir.copy(this.rig.sun.position).normalize();
    this.sky.update(this.scene, g);
    this.clouds?.relight(this.scene, g, this.rig);
    this.town?.light(night, this.sunDir, (this.scene.fog as THREE.Fog).color);
    this.field.light(this.rig.sun, this.scene, night);
  }

  apply(t: number, cam: TacticalCamera): void {
    const reel = this.reel;
    this.relightAt(t);
    poseSiege(reel, t, this.frame, this.pose);
    this.crowd.update(this.frame, cam.camera);
    this.banners.update(this.frame, t, cam.camera, cam.now.dist);
    this.field.update(t);
    this.fort.update(t);
    this.works.update(t, cam.camera);
    this.updateArrows(t);
    this.updateCarts(t);
    this.updateTorches(t);
    for (const s of this.scaffolds) {
      const win = s.userData.win as SiegeReel['scaffolds'][number];
      s.visible = t >= win.from && t < win.to;
    }
    this.sky.mesh.position.copy(cam.camera.position);
    if (this.clouds) {
      this.clouds.mesh.position.copy(cam.camera.position);
      this.clouds.update(t);
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

  private updateArrows(t: number): void {
    const a = this.arrows;
    let n = 0;
    const cap = a.instanceMatrix.count;
    for (const ar of this.reel.arrows) {
      if (n >= cap) break;
      const u = (t - ar.at) / ar.flight;
      if (u < 0 || u > 1) continue;
      const lift = Math.hypot(ar.x1 - ar.x0, ar.z1 - ar.z0) * 0.12;
      const x = ar.x0 + (ar.x1 - ar.x0) * u;
      const z = ar.z0 + (ar.z1 - ar.z0) * u;
      const y = ar.y0 + (ar.y1 - ar.y0) * u + 4 * lift * u * (1 - u);
      // Вдоль скорости: производная дуги.
      this.D.set(ar.x1 - ar.x0, ar.y1 - ar.y0 + 4 * lift * (1 - 2 * u), ar.z1 - ar.z0).normalize();
      this.Q.setFromUnitVectors(this.Z, this.D);
      a.setMatrixAt(n++, this.M.compose(this.V.set(x, y, z), this.Q, this.S.set(1, 1, 1)));
    }
    a.count = n;
    a.visible = n > 0;
    a.instanceMatrix.needsUpdate = true;
  }

  private updateCarts(t: number): void {
    const f = this.reel.layout.field;
    for (const mesh of this.carts) {
      const ids = mesh.userData.ids as number[];
      ids.forEach((i, k) => {
        poseAt(this.reel.carts.tracks, i, t, 0, this.pose);
        const s = this.pose.shown ? 1 : 0;
        this.Q.setFromAxisAngle(this.Y, this.pose.yaw);
        mesh.setMatrixAt(k, this.M.compose(this.V.set(this.pose.x, heightAt(f, this.pose.x, this.pose.z), this.pose.z), this.Q, this.S.set(s, s, s)));
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private updateTorches(t: number): void {
    const tm = this.torches;
    if (!tm) return;
    const night = nightOf(this.lastSolar);
    tm.visible = night > 0.05;
    if (!tm.visible) return;
    this.flames.forEach((p, k) => {
      const fl = 0.8 + 0.2 * Math.sin(t * 11 + k * 1.7) * Math.sin(t * 5.3 + k);
      const s = night * fl * p.k;
      tm.setMatrixAt(k, this.M.compose(this.V.set(p.x, p.y, p.z), this.Q.identity(), this.S.set(s, s * 1.2, s)));
    });
    tm.instanceMatrix.needsUpdate = true;
  }

  /** Сторож ролика опустил уровень: гаснут тени бойцов, облака, кустики (как у ролика боя, `TwStage.lower`). */
  lower(next: TwSpec): void {
    // Бойцы вблизи — средним обликом, если у нового уровня ближнего нет (`TwSpec.crowdLod`).
    this.crowd.detail(next.crowdLod);
    if (next.shadow === 'none') this.crowd.shadows(false);
    if (!next.clouds && this.clouds) this.clouds.mesh.visible = false;
    this.field.lower(next);
  }

  groundY(x: number, z: number): number {
    return heightAt(this.reel.layout.field, x, z);
  }

  /** Границы камеры: поле с запасом; приблизить — до бойца в треть экрана, отдалить — до всего поля. */
  bounds(aspect: number): CamBounds {
    const f = this.reel.layout.field;
    const all = overview({ minX: -f.halfX, maxX: f.halfX, minZ: f.minZ, maxZ: f.maxZ }, aspect);
    return { minX: -f.halfX, maxX: f.halfX, minZ: f.minZ, maxZ: f.maxZ, minDist: 4.5, maxDist: Math.max(60, all.dist * 1.1) };
  }

  textureBytes(): number {
    return this.crowd.bones.bytes + this.spec.shadowMap * this.spec.shadowMap * 4 + (this.town?.textureBytes ?? 0);
  }

  dispose(): void {
    this.crowd.dispose();
    this.banners.dispose();
    this.works.dispose();
    this.fort.dispose();
    this.lairFort?.dispose();
    this.field.dispose();
    this.town?.dispose();
    for (const d of this.disposables) d.dispose();
    this.sky.mesh.geometry.dispose();
    (this.sky.mesh.material as THREE.Material).dispose();
    if (this.clouds) {
      this.clouds.mesh.geometry.dispose();
      (this.clouds.mesh.material as THREE.Material).dispose();
    }
    this.rig.sun.shadow.map?.dispose();
    this.scene.clear();
  }
}
