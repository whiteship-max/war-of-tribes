// Обстрел перед штурмом на сцене ролика TW (docs/battle_tw.md, раздел 15): машины с расчётами, камни в полёте, удар —
// пыль, обломки и трещины, обрушенные куски стены, сбитые со стены, дым над городом. Своих решений у сцены нет: где и
// когда — режиссура пролога (`barrage.ts`); здесь кадр раскладывается по объектам three.
//
// Всё — инстансами и одним мешем на машины, из того же набора, что стена (`fort.ts`: кирпичики города, тон слоя в вершинах,
// один Ламберт). Уровень решает, что есть: на низком — машины, камни, пыль и обвал без теней; трещин, обломков и дыма нет
// (docs/perf.md: «Низкое» — новое выключено или минимально).
import * as THREE from 'three';
import { CITY } from '../city/palette';
import { Builder, box, tint } from '../city/geom';
import { log } from '../city/kit';
import type { Quality } from '../quality';
import { MERLON_STEP, geometryOf, m } from './fort';
import type { Crowd, CrowdExtras } from '../reel/crowd';
import { PARAPET, type TwWall } from './site';
import { hash, heightAt } from '../reel/terrain';
import type { TwField } from '../reel/terrain';
import type { TwPlan } from './plan';
import { BREACH_BAND, ENGINE, FALL_TIME, armAngle, breachColumns, chunkFall, engineUp, stoneAt, winching, type TwBarrage, type TwEngine, type TwStone } from './barrage';

/** Что сцене обстрела нужно от зовущего: уровень, поле, стена и сид. Плана боя она не знает (ролик осады — без него). */
export interface WorksInput {
  quality: Quality;
  field: TwField;
  wall: TwWall | null;
  seed: number;
}

/** Сцена обстрела из плана боя: пролог перед штурмом (`plan.barrage`). */
export const worksOfPlan = (plan: TwPlan): WorksInput => ({ quality: plan.quality, field: plan.field, wall: plan.site?.wall ?? null, seed: plan.cast.seed });

/** Что есть на уровне: обломков и клубов на удар, дым, трещины, тени машин. */
interface Detail {
  debris: number;
  /** Камней осыпи у подножия на кусок стены. */
  rubble: number;
  puffs: number;
  smoke: number;
  cracks: boolean;
  shadow: boolean;
}
const DETAIL: Record<Quality, Detail> = {
  low: { debris: 0, rubble: 6, puffs: 3, smoke: 0, cracks: false, shadow: false },
  medium: { debris: 8, rubble: 14, puffs: 6, smoke: 9, cracks: true, shadow: true },
  high: { debris: 14, rubble: 22, puffs: 9, smoke: 14, cracks: true, shadow: true },
};

/** Обломок летит столько, клуб удара живёт столько, клуб обвала — столько. */
const DEBRIS_LIFE = 1.5;
const PUFF_LIFE = 2.2;
const COLLAPSE_LIFE = 3.6;
/** Столб дыма: срок клуба, подъём в секунду, снос ветром. */
const SMOKE_LIFE = 6;
const SMOKE_RISE = 1.5;
const WIND = 0.45;
const GRAVITY = 9.8;
/** Обрушенный кусок: на сколько клонится наружу, отъезжает от стены и оседает (доля высоты), когда лёг. */
const SLAB_TILT = 0.5;
const SLAB_OUT = 1.4;
const SLAB_SQUAT = 0.72;

const DUST = 0xb6a080;
const SMOKE = 0x6f6a63;
/** Огонь у основания столба: тёплый конус без света (лампа на сцене одна, как у костров лагеря). */
const FIRE = 0xf09a3a;

export class Siegeworks {
  readonly group = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  private detail: Detail;
  private arms: Partial<Record<TwEngine['kind'], THREE.InstancedMesh>> = {};
  /** Рама каждой машины своим мешем, если машины встают и пропадают (ролик осады); иначе — одна на все. */
  private frames: THREE.Mesh[] = [];
  private timed: boolean;
  private stones: THREE.InstancedMesh;
  private debris: THREE.InstancedMesh | null = null;
  private puffs: THREE.InstancedMesh;
  private smoke: THREE.InstancedMesh | null = null;
  private fire: THREE.InstancedMesh | null = null;
  private cracks: THREE.InstancedMesh | null = null;
  private chunks: { mesh: THREE.Mesh; pivot: THREE.Vector3; ground: number; at: number; spans: [number, number][]; back?: number; again?: { at: number; back?: number }[] }[] = [];
  /** Осыпь у подножия пролома: камни встают с обвалом своего куска и лежат весь бой. */
  private rubble: THREE.InstancedMesh | null = null;
  private crew: CrowdExtras | null = null;
  private fallers: CrowdExtras | null = null;
  private M = new THREE.Matrix4();
  private Q = new THREE.Quaternion();
  private Q2 = new THREE.Quaternion();
  private V = new THREE.Vector3();
  private S = new THREE.Vector3();
  private P = { x: 0, y: 0, z: 0 };
  private X = new THREE.Vector3(1, 0, 0);
  private Y = new THREE.Vector3(0, 1, 0);
  private Z = new THREE.Vector3(0, 0, 1);
  private C = new THREE.Color();
  private near: TwStone[] = [];
  /** Кадр после пролога, когда всё улеглось: рычаги, куски, осыпь и трещины дальше не двигаются — грузить их незачем. */
  private settled = false;

  constructor(
    private plan: WorksInput,
    private b: TwBarrage,
    crowd: Crowd,
  ) {
    this.group.name = 'tw-siegeworks';
    this.detail = DETAIL[plan.quality];
    this.timed = b.engines.some((e) => e.from !== undefined || e.gone !== undefined);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    mat.name = 'tw-siegeworks';
    this.disposables.push(mat);
    this.buildEngines(mat);
    // Камни: в полёте и на конце плеча взведённой машины.
    const stoneGeo = new THREE.IcosahedronGeometry(0.34, 0);
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x7d776c, flatShading: true });
    stoneMat.name = 'tw-stone';
    this.stones = this.instanced(stoneGeo, stoneMat, b.stones.length + b.engines.length, 'tw-stones', this.detail.shadow);
    if (this.detail.debris > 0) {
      const g = new THREE.BoxGeometry(0.26, 0.2, 0.22);
      const dm = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
      dm.name = 'tw-debris';
      this.debris = this.instanced(g, dm, b.stones.length * this.detail.debris * 2, 'tw-debris', false);
      // Цвет инстансов — с самого начала: иначе шейдер пересобрался бы на первом ударе, посреди пролога.
      const white = new THREE.Color(0xc9bfae);
      for (let i = 0; i < this.debris.instanceMatrix.count; i++) this.debris.setColorAt(i, white);
    }
    const pg = new THREE.CircleGeometry(1, 9);
    const pm = new THREE.MeshBasicMaterial({ color: DUST, transparent: true, opacity: 0.32, depthWrite: false });
    pm.name = 'tw-barrage-dust';
    this.puffs = this.instanced(pg, pm, b.stones.length * this.detail.puffs + (b.breach?.chunks.length ?? 0) * this.detail.puffs * 3 + (b.bursts?.length ?? 0) * this.detail.puffs * 2, 'tw-barrage-dust', false);
    this.puffs.renderOrder = 2;
    if (this.detail.smoke > 0 && b.smoke.length > 0) {
      const sm = new THREE.MeshBasicMaterial({ color: SMOKE, transparent: true, opacity: 0.42, depthWrite: false });
      sm.name = 'tw-smoke';
      this.smoke = this.instanced(new THREE.CircleGeometry(1, 10), sm, b.smoke.length * this.detail.smoke, 'tw-smoke', false);
      this.smoke.renderOrder = 3;
      const fm = new THREE.MeshBasicMaterial({ color: FIRE });
      fm.name = 'tw-fire';
      this.fire = this.instanced(new THREE.ConeGeometry(0.55, 1.4, 5).translate(0, 0.7, 0), fm, b.smoke.length * 3, 'tw-fire', false);
    }
    const w = plan.wall;
    if (w && b.breach) {
      if (this.detail.cracks) this.buildCracks();
      this.buildChunks(w, mat);
    }
    if (b.look.crew >= 0 && b.crew.length > 0) this.crew = crowd.extras(b.look.crew, b.crew.length);
    if (b.look.faller >= 0 && b.fallers.length > 0) this.fallers = crowd.extras(b.look.faller, b.fallers.length);
  }

  private instanced(g: THREE.BufferGeometry, mat: THREE.Material, n: number, name: string, shadow: boolean): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(g, mat, Math.max(1, n));
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.castShadow = shadow;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(mesh);
    this.disposables.push(g, mat, mesh);
    return mesh;
  }

  /**
   * Рамы машин — одним мешем; рычаги — инстансами по виду, поворотом по кадру. Машины ролика осады встают и пропадают по
   * своим секундам (`TwEngine.from`, `gone`): у них рама — своим мешем на машину, иначе их не спрятать порознь.
   */
  private buildEngines(mat: THREE.Material): void {
    let fb = new Builder();
    const oak = tint(CITY.oak, 0.95);
    const oakL = tint(CITY.oakLight, 1.0);
    for (const e of this.b.engines) {
      if (this.timed) fb = new Builder();
      const s = Math.sin(e.yaw);
      const c = Math.cos(e.yaw);
      // Точка в осях машины (поперёк, вверх, вперёд), метры → единицы набора.
      const P = (lx: number, ly: number, lz: number): [number, number, number] => [m(e.x + c * lx + s * lz), m(e.y + ly), m(e.z - s * lx + c * lz)];
      const g = ENGINE[e.kind];
      if (e.kind === 'trebuchet') {
        for (const side of [1, -1]) {
          log(fb, P(side * 1.3, 0.2, -3.2), P(side * 1.3, 0.2, 3.2), 0.24, oak, 5, true);
          log(fb, P(side * 1.25, 0.2, -2.3), P(side * 0.95, g.pivot, 0), 0.2, oakL, 5, true);
          log(fb, P(side * 1.25, 0.2, 2.3), P(side * 0.95, g.pivot, 0), 0.2, oakL, 5, true);
          log(fb, P(side * 1.2, 0.2, 0), P(side * 0.95, g.pivot, 0), 0.18, oak, 5, true);
        }
        for (const z of [-3, 0, 3]) log(fb, P(-1.4, 0.3, z), P(1.4, 0.3, z), 0.18, oak, 5, true);
        log(fb, P(-1.2, g.pivot, 0), P(1.2, g.pivot, 0), 0.16, tint(CITY.iron, 1.6), 6, true);
        // Ворот сзади: барабан и спицы.
        log(fb, P(-1.15, 0.9, -2.7), P(1.15, 0.9, -2.7), 0.3, oakL, 6, true);
        for (const side of [1, -1]) log(fb, P(side * 1.3, 0.2, -2.7), P(side * 1.3, 1.2, -2.7), 0.12, oak, 4, true);
      } else {
        for (const side of [1, -1]) {
          log(fb, P(side * 0.85, 0.3, -2.0), P(side * 0.85, 0.3, 2.0), 0.2, oak, 5, true);
          // Колёса — диски из досок.
          for (const z of [-1.4, 1.4]) box(fb, m(e.x + c * side * 1.0 + s * z), m(e.z - s * side * 1.0 + c * z), c, -s, 0.16, 0.9, m(e.y), m(e.y + 0.9), 'wood', tint(CITY.oak, 0.7), 'wood');
          // Стойки перекладины, о которую бьёт ложка.
          log(fb, P(side * 0.8, 0.3, 0.9), P(side * 0.7, 2.6, 0.3), 0.14, oakL, 5, true);
        }
        for (const z of [-1.8, 1.8]) log(fb, P(-0.95, 0.35, z), P(0.95, 0.35, z), 0.16, oak, 5, true);
        log(fb, P(-0.8, 2.55, 0.3), P(0.8, 2.55, 0.3), 0.17, oakL, 5, true);
        // Скрутка жил на оси ложки.
        log(fb, P(-0.8, g.pivot, 0), P(0.8, g.pivot, 0), 0.26, tint(0x8a7656, 0.9), 6, true);
      }
      if (this.timed) this.addFrame(fb, mat);
    }
    if (!this.timed) this.addFrame(fb, mat);
    // Рычаги: плечо вдоль +Z от оси (в начале координат), противовес у требушета — на коротком плече.
    for (const kind of ['trebuchet', 'mangonel'] as const) {
      const n = this.b.engines.filter((e) => e.kind === kind).length;
      if (n === 0) continue;
      const g = ENGINE[kind];
      const ab = new Builder();
      if (kind === 'trebuchet') {
        log(ab, [0, 0, m(-2.2)], [0, 0, m(g.arm)], 0.2, oakL, 6, true);
        box(ab, 0, m(-2.2), 0, 1, m(1.5), m(1.3), m(-1.9), m(-0.2), 'wood', tint(CITY.oak, 0.75), 'wood');
        box(ab, 0, m(-2.2), 0, 1, m(1.6), m(1.4), m(-1.75), m(-1.45), 'rubble', tint(CITY.iron, 1.5), null);
      } else {
        log(ab, [0, 0, 0], [0, 0, m(g.arm)], 0.15, oakL, 5, true);
        box(ab, 0, m(g.arm - 0.25), 0, 1, m(0.6), m(0.5), m(-0.1), m(0.12), 'wood', tint(CITY.oak, 0.8), 'wood');
      }
      const ag = geometryOf(ab);
      const am = new THREE.InstancedMesh(ag, mat, n);
      am.name = `tw-arm-${kind}`;
      am.castShadow = this.detail.shadow;
      am.frustumCulled = false;
      this.group.add(am);
      this.disposables.push(ag, am);
      this.arms[kind] = am;
    }
  }

  private addFrame(fb: Builder, mat: THREE.Material): void {
    const frames = geometryOf(fb);
    const mesh = new THREE.Mesh(frames, mat);
    mesh.name = 'tw-engines';
    mesh.castShadow = this.detail.shadow;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.frames.push(mesh);
    this.disposables.push(frames);
  }

  /** Трещины по наружной грани: зубцы от точки удара, видны с секунды удара. */
  private buildCracks(): void {
    const hits = this.b.stones.filter((s) => s.hit === 'wall' && s.chunk < 0);
    const per = 5;
    const g = new THREE.BoxGeometry(1, 0.07, 0.05);
    const cm = new THREE.MeshBasicMaterial({ color: 0x2b2722 });
    cm.name = 'tw-cracks';
    this.cracks = this.instanced(g, cm, hits.length * per, 'tw-cracks', false);
  }

  /** Целые куски над проломом — по столбцам пролома, сверху опущенной половины; до обвала стоят, потом ложатся. */
  private buildChunks(w: TwWall, mat: THREE.Material): void {
    const br = this.b.breach!;
    const cols = breachColumns(br, this.plan.seed);
    const s = w.inward;
    const out = -s;
    const zo = m(w.z);
    const band = m(BREACH_BAND);
    const top = m(w.base) + m(w.top);
    const par = m(PARAPET);
    // Частокол (ролик осады, стена до третьего уровня) рушится брёвнами, а не кладкой.
    const layer = w.wood ? 'wood' : 'ashlar';
    const T = w.wood ? tint(CITY.oakLight, 0.8) : tint(CITY.stoneTints[0]);
    const Tdark = w.wood ? tint(CITY.oakLight, 0.66) : tint(CITY.stoneTints[0], 0.86);
    for (const ch of br.chunks) {
      const cb = new Builder();
      let lowest = Infinity;
      let sumX = 0;
      let cnt = 0;
      for (const [a0, a1] of ch.spans) {
        for (const c of cols) {
          const a = Math.max(a0, c.x0);
          const e = Math.min(a1, c.x1);
          if (e - a < 0.02) continue;
          const y0 = top - m(c.drop);
          lowest = Math.min(lowest, y0);
          box(cb, m((a + e) / 2), zo + s * (band / 2), 0, out, m(e - a), band, y0, top, layer, T, null);
        }
        // Парапет и зубцы — как у целой стены, по толщине опущенной полосы.
        const xa = m(a0);
        const xb = m(a1);
        const pt = Math.min(par, band);
        box(cb, (xa + xb) / 2, zo + s * (pt / 2), 0, out, xb - xa, pt, top, top + 1.05, layer, Tdark, layer);
        for (let x = Math.ceil(xa / MERLON_STEP) * MERLON_STEP + MERLON_STEP / 2; x < xb - 0.3; x += MERLON_STEP) {
          box(cb, x, zo + s * (pt / 2), 0, out, 0.85, pt, top + 1.05, top + 2.0, layer, T, layer);
        }
        sumX += (a0 + a1) / 2;
        cnt++;
      }
      if (!Number.isFinite(lowest)) continue;
      const geo = geometryOf(cb);
      // Ось обвала — нижняя наружная кромка куска: геометрия — от неё.
      const pivot = new THREE.Vector3(sumX / cnt, lowest * (1 / m(1)), w.z);
      geo.translate(-pivot.x, -pivot.y, -pivot.z);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'tw-breach-chunk';
      mesh.castShadow = this.detail.shadow;
      mesh.receiveShadow = true;
      mesh.position.copy(pivot);
      this.group.add(mesh);
      this.disposables.push(geo);
      this.chunks.push({ mesh, pivot, ground: heightAt(this.plan.field, pivot.x, w.z - s * 2), at: ch.at, spans: ch.spans, back: ch.back, again: ch.again });
    }
    const n = this.chunks.length * this.detail.rubble;
    if (n > 0) {
      const rm = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
      rm.name = 'tw-rubble';
      this.rubble = this.instanced(new THREE.IcosahedronGeometry(0.5, 0), rm, n, 'tw-rubble', false);
      this.rubble.receiveShadow = true;
      const C = new THREE.Color();
      for (let i = 0; i < n; i++) this.rubble.setColorAt(i, C.setHex(i % 3 === 0 ? 0xb8ae9c : i % 3 === 1 ? 0xd6ccba : 0x9a917f));
    }
  }

  /**
   * Разложить кадр на секунде ролика `t` (с прологом: бой идёт с `b.seconds`). После пролога машины стоят опущенными,
   * сбитые лежат, трещины и дым — на месте; камней, обломков и клубов удара нет.
   */
  update(t: number, cam: THREE.Camera): void {
    const b = this.b;
    const live = t < b.seconds + DEBRIS_LIFE;
    const still = t > b.seconds + COLLAPSE_LIFE && this.settled;
    // Рычаги (улеглось — стоят опущенными, не грузятся).
    const idx: Record<string, number> = { trebuchet: 0, mangonel: 0 };
    if (this.timed) b.engines.forEach((e, k) => (this.frames[k].visible = engineUp(e, t)));
    for (const e of still && !this.timed ? [] : b.engines) {
      const am = this.arms[e.kind]!;
      const g = ENGINE[e.kind];
      const th = armAngle(e, t);
      this.Q.setFromAxisAngle(this.Y, e.yaw);
      this.Q2.setFromAxisAngle(this.X, -th);
      this.Q.multiply(this.Q2);
      this.V.set(e.x, e.y + g.pivot, e.z);
      const k = engineUp(e, t) ? 1 : 0;
      am.setMatrixAt(idx[e.kind]++, this.M.compose(this.V, this.Q, this.S.set(k, k, k)));
    }
    if (!still || this.timed) for (const am of Object.values(this.arms)) am!.instanceMatrix.needsUpdate = true;
    // Камни: в полёте; и на конце плеча взведённой машины, пока следующий её камень ещё не сорвался.
    let n = 0;
    const st = this.stones;
    for (const s of b.stones) {
      if (stoneAt(s, t, this.P)) {
        this.V.set(this.P.x, this.P.y, this.P.z);
        this.Q.setFromAxisAngle(this.X, t * 7 + s.seed);
        st.setMatrixAt(n++, this.M.compose(this.V, this.Q, this.S.set(1, 1, 1)));
      }
    }
    for (const e of b.engines) {
      const next = e.shots.find((s) => s > t);
      if (next === undefined || !engineUp(e, t) || armAngle(e, t) !== ENGINE[e.kind].cocked) continue;
      const g = ENGINE[e.kind];
      const th = g.cocked;
      const r = g.arm;
      const lx = r * Math.cos(th);
      const ly = g.pivot + r * Math.sin(th) + 0.3;
      this.V.set(e.x + Math.sin(e.yaw) * lx, e.y + ly, e.z + Math.cos(e.yaw) * lx);
      st.setMatrixAt(n++, this.M.compose(this.V, this.Q.identity(), this.S.set(1, 1, 1)));
    }
    st.count = live ? n : 0;
    st.visible = st.count > 0;
    st.instanceMatrix.needsUpdate = true;
    this.updateDebris(t, live);
    this.updatePuffs(t, cam, live);
    // Улеглось (камни легли, облака осели): неподвижное раскладывается последний раз и больше не грузится — до перемотки.
    const calm = t > b.seconds + COLLAPSE_LIFE;
    if (!calm || !this.settled) {
      this.updateCracks(t);
      this.updateChunks(t);
      this.updateFigures(t);
    }
    this.settled = calm;
    this.updateSmoke(t, cam);
  }

  /** Камни, легшие не раньше `life` секунд назад, — в `out` (без нового массива на кадр). */
  private impactsNear(t: number, life: number, out: TwStone[]): TwStone[] {
    out.length = 0;
    for (const s of this.b.stones) {
      const age = t - (s.at + s.flight);
      if (age >= 0 && age < life) out.push(s);
    }
    return out;
  }

  private updateDebris(t: number, live: boolean): void {
    const d = this.debris;
    if (!d) return;
    let n = 0;
    if (live) {
      const f = this.plan.field;
      const w = this.plan.wall ?? null;
      const outward = w ? -w.inward : 0;
      const C = this.C;
      for (const s of this.impactsNear(t, DEBRIS_LIFE, this.near)) {
        const age = t - (s.at + s.flight);
        const hut = s.hit === 'hut' || s.hit === 'over';
        const count = this.detail.debris * (s.chunk >= 0 ? 2 : 1);
        for (let j = 0; j < count; j++) {
          const h1 = hash(s.seed, j, 81);
          const h2 = hash(s.seed, j, 82);
          const h3 = hash(s.seed, j, 83);
          // От стены — наружу и вверх; от земли и крыши — во все стороны.
          const vx = (h1 - 0.5) * 6;
          const vz = s.hit === 'wall' ? outward * (2 + h2 * 4) : (h2 - 0.5) * 6;
          const vy = 3 + h3 * 5;
          const x = s.x1 + vx * age;
          const z = s.z1 + vz * age;
          const y = Math.max(heightAt(f, x, z) + 0.1, s.y1 + vy * age - (GRAVITY / 2) * age * age);
          this.V.set(x, y, z);
          this.Q.setFromAxisAngle(this.X, age * (4 + h1 * 6));
          const k = 0.6 + h2 * 0.9;
          d.setMatrixAt(n, this.M.compose(this.V, this.Q, this.S.set(k, k, k)));
          C.setHex(hut ? (j % 3 === 0 ? 0x3a2d22 : 0x6b4c33) : j % 4 === 0 ? 0x8e877b : 0xc9bfae);
          d.setColorAt(n, C);
          n++;
        }
      }
    }
    d.count = n;
    d.visible = n > 0;
    d.instanceMatrix.needsUpdate = true;
    if (d.instanceColor) d.instanceColor.needsUpdate = true;
  }

  private puff(n: number, x: number, y: number, z: number, age: number, life: number, size: number, k: number, cam: THREE.Camera): number {
    const p = this.puffs;
    if (n >= p.instanceMatrix.count) return n;
    const u = age / life;
    if (u < 0 || u > 1) return n;
    const r = size * (0.5 + 0.6 * hash(k, 3, 84)) * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.1)), 0.6) * (0.6 + 0.9 * u);
    if (r <= 0.02) return n;
    this.V.set(x + (hash(k, 1, 85) - 0.5) * 2.4 + WIND * age, y + age * 0.9, z + (hash(k, 2, 86) - 0.5) * 2.4);
    p.setMatrixAt(n, this.M.compose(this.V, cam.quaternion, this.S.set(r, r * 0.8, r)));
    return n + 1;
  }

  private updatePuffs(t: number, cam: THREE.Camera, live: boolean): void {
    let n = 0;
    if (live) {
      const per = this.detail.puffs;
      for (const s of this.impactsNear(t, PUFF_LIFE, this.near)) {
        const age = t - (s.at + s.flight);
        for (let j = 0; j < per; j++) n = this.puff(n, s.x1, s.y1 - 0.4, s.z1, age, PUFF_LIFE, s.hit === 'wall' ? 2.4 : 1.8, s.seed * 13 + j, cam);
      }
      // Пыль без камня (ролик осады: подкоп под стену, ворота рухнули): клубы с секунды `at`.
      for (const bu of this.b.bursts ?? []) {
        const age = t - bu.at;
        if (age < 0 || age > COLLAPSE_LIFE) continue;
        for (let j = 0; j < per * 2; j++) n = this.puff(n, bu.x + (hash(j, 7, 80) - 0.5) * bu.size, bu.y, bu.z, age - j * 0.04, COLLAPSE_LIFE, 2.6 * bu.size * 0.4 + 1.2, Math.round(bu.at * 100) * 31 + j, cam);
      }
      // Обвал — облако во весь кусок и до земли.
      const w = this.plan.wall;
      for (const c of this.chunks) {
        // Обвал и каждый следующий обвал того же куска (ролик осады: заделали — рухнул снова).
        let at = c.at;
        for (const a of c.again ?? []) if (t >= a.at) at = a.at;
        const age = t - at;
        if (age < 0 || age > COLLAPSE_LIFE || !w) continue;
        for (let j = 0; j < per * 3; j++) {
          const k = Math.round(at * 100) * 17 + j;
          const x = c.pivot.x + (hash(k, 4, 87) - 0.5) * 6;
          const z = w.z - w.inward * (1 + hash(k, 5, 88) * 3);
          n = this.puff(n, x, c.ground + 0.5 + hash(k, 6, 89) * 3, z, age - j * 0.03, COLLAPSE_LIFE, 3.2, k, cam);
        }
      }
    }
    this.puffs.count = n;
    this.puffs.visible = n > 0;
    this.puffs.instanceMatrix.needsUpdate = true;
  }

  private updateCracks(t: number): void {
    const cr = this.cracks;
    const w = this.plan.wall;
    if (!cr || !w) return;
    let n = 0;
    const faceZ = w.z - w.inward * 0.04;
    for (const s of this.b.stones) {
      if (s.hit !== 'wall' || s.chunk >= 0 || t < s.at + s.flight) continue;
      // Зубцы ломаной от точки удара: по пять звеньев, каждое — от конца прежнего.
      for (let ray = 0; ray < 5; ray++) {
        const ang = ray * 1.26 + hash(s.seed, ray, 90) * 0.8;
        const len = 0.7 + hash(s.seed, ray, 91) * 0.9;
        const cx = s.x1 + Math.cos(ang) * len * 0.5;
        const cy = s.y1 + Math.sin(ang) * len * 0.5;
        this.V.set(cx, cy, faceZ);
        this.Q.setFromAxisAngle(this.Z, ang);
        cr.setMatrixAt(n++, this.M.compose(this.V, this.Q, this.S.set(len, 1, 1)));
      }
    }
    cr.count = n;
    cr.visible = n > 0;
    cr.instanceMatrix.needsUpdate = true;
  }

  private updateChunks(t: number): void {
    const w = this.plan.wall;
    if (!w) return;
    const outward = -w.inward;
    const rb = this.rubble;
    let n = 0;
    const per = this.detail.rubble;
    for (const [ci, c] of this.chunks.entries()) {
      const u = chunkFall(c, t);
      // Клонится наружу вокруг нижней кромки, рассыпается (оседает) и ложится грудой у подножия, отъехав от стены.
      c.mesh.rotation.set(outward * SLAB_TILT * u, 0, 0);
      c.mesh.scale.set(1, 1 - SLAB_SQUAT * u, 1 + 0.4 * u);
      c.mesh.position.set(c.pivot.x, c.pivot.y + (c.ground - 0.2 - c.pivot.y) * u, c.pivot.z + outward * SLAB_OUT * u);
      if (!rb || u < 0.35) continue;
      // Осыпь: камни встают из-под облака, крупные — ближе к стене, мелкие — дальше по склону груды.
      const grow = Math.min(1, (u - 0.35) / 0.4);
      for (let j = 0; j < per; j++) {
        const k = ci * 101 + j;
        const [a, b] = c.spans[j % c.spans.length];
        const x = a - 0.6 + (b - a + 1.2) * hash(k, 1, 95);
        const d = 0.4 + Math.pow(hash(k, 2, 96), 1.4) * 3.6;
        const z = w.z + outward * d;
        const r = (1.25 - d * 0.22) * (0.5 + 0.7 * hash(k, 3, 97)) * grow;
        this.V.set(x, heightAt(this.plan.field, x, z) + r * 0.25, z);
        this.Q.setFromAxisAngle(this.X, hash(k, 4, 98) * 6).multiply(this.Q2.setFromAxisAngle(this.Y, hash(k, 5, 99) * 6));
        rb.setMatrixAt(n++, this.M.compose(this.V, this.Q, this.S.set(r, r * 0.7, r)));
      }
    }
    if (rb) {
      rb.count = n;
      rb.visible = n > 0;
      rb.instanceMatrix.needsUpdate = true;
    }
  }

  private updateSmoke(t: number, cam: THREE.Camera): void {
    const sm = this.smoke;
    if (!sm) return;
    let n = 0;
    const per = this.detail.smoke;
    for (const col of this.b.smoke) {
      if (t < col.from) continue;
      // Догорело: последние клубы уходят вверх, новых нет.
      if (col.to !== undefined && t > col.to + SMOKE_LIFE) continue;
      const since = t - col.from;
      // Столб разгорается за четыре секунды и дальше стоит.
      const grow = Math.min(1, since / 4);
      for (let j = 0; j < per; j++) {
        // Клуб `j` встаёт со сдвигом в долю срока и живёт срок, потом встаёт снова: столб стоит ровно.
        const off = (j / per) * SMOKE_LIFE;
        if (since < off) continue;
        const born = col.from + off + Math.floor((since - off) / SMOKE_LIFE) * SMOKE_LIFE;
        if (col.to !== undefined && born > col.to) continue;
        const age = t - born;
        const u = age / SMOKE_LIFE;
        const k = Math.round(born * 10) * 7 + j;
        const r = (0.8 + 2.6 * u) * col.size * (0.7 + 0.3 * grow) * (0.8 + 0.4 * hash(k, 7, 92));
        this.V.set(col.x + WIND * 1.6 * age + (hash(k, 8, 93) - 0.5) * 0.8, col.y + 0.6 + age * SMOKE_RISE * (0.8 + 0.4 * grow), col.z + (hash(k, 9, 94) - 0.5) * 0.8);
        // Тает к верху: клуб растёт, а доля неба за ним — тоже (прозрачность общая, размер — свой).
        const fade = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
        const rr = r * Math.max(0.05, fade * 0.6 + 0.4 * (1 - u));
        sm.setMatrixAt(n++, this.M.compose(this.V, cam.quaternion, this.S.set(rr, rr * 0.85, rr)));
      }
    }
    sm.count = n;
    sm.visible = n > 0;
    sm.instanceMatrix.needsUpdate = true;
    // Огонь: три языка на столб, дрожат каждый в своём такте.
    const fi = this.fire;
    if (fi) {
      let k = 0;
      for (const [ci, col] of this.b.smoke.entries()) {
        if (t < col.from || (col.to !== undefined && t > col.to + 1)) continue;
        const grow = Math.min(1, (t - col.from) / 1.5) * (col.to !== undefined && t > col.to ? 1 - (t - col.to) : 1);
        for (let j = 0; j < 3; j++) {
          const fl = 0.75 + 0.25 * Math.sin(t * (9 + j * 3.7) + ci * 2.1 + j) * Math.sin(t * 4.3 + j);
          const r = grow * (j === 0 ? 1 : 0.65) * col.size;
          this.V.set(col.x + (j - 1) * 0.5, col.y - 0.6, col.z + (j % 2) * 0.4 - 0.2);
          fi.setMatrixAt(k++, this.M.compose(this.V, this.Q.identity(), this.S.set(r, r * fl * (j === 0 ? 1.3 : 1), r)));
        }
      }
      fi.count = k;
      fi.visible = k > 0;
      fi.instanceMatrix.needsUpdate = true;
    }
  }

  private updateFigures(t: number): void {
    const b = this.b;
    if (this.crew) {
      b.crew.forEach((c, k) => {
        const e = b.engines[c.engine];
        // Ворот крутят — работа (клип удара в такт); у срыва и в ожидании — стоят.
        const work = winching(e, t);
        this.crew!.set(k, c.x, heightAt(this.plan.field, c.x, c.z), c.z, c.yaw, work ? 'strike' : 'idle', t * (work ? 1 : 0.6) + c.phase * 2);
      });
      this.crew.show(b.crew.length);
    }
    if (this.fallers) {
      const f = this.plan.field;
      let n = 0;
      for (const p of b.fallers) {
        const u = (t - p.at) / FALL_TIME;
        if (u < 0) {
          // До обвала стоят на ходу у зубцов, лицом наружу.
          this.fallers.set(n++, p.x, p.y, p.z, p.yaw, 'guard', t + p.x);
          continue;
        }
        const k = Math.min(1, u);
        const x = p.x + (p.x1 - p.x) * k;
        const z = p.z + (p.z1 - p.z) * k;
        // Падают по дуге: чуть вверх от удара, потом вниз с ускорением.
        const y = Math.max(heightAt(f, x, z), p.y + (p.y1 - p.y) * k * k + 1.2 * k * (1 - k));
        this.fallers.set(n++, x, y, z, p.yaw, 'fall', (t - p.at) * 1.2);
      }
      this.fallers.show(n);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.clear();
  }
}
