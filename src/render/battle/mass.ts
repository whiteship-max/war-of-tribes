// Масса войска: лес древков, знамёна и тёмное пятно под строем.
//
// Всё, что здесь рисуется, — не украшение, а способ показать число, которого
// фигурами не показать. Фигур на сторону не больше `FIGURE_CAP`, и войско сверх
// этого по ним не читается никак; древки, знамёна и пятно читаются.
//
// Сколько чего — решает раскадровка (`bannersFor`, `shaftsFor`, `dustRadius`).
// Здесь только расстановка и отрисовка: четыре инстансированных набора, четыре
// вызова на всё поле, сколько бы ни было войска.
//
// Главное правило строя: **древки параллельны**. Настоящий строй читается
// дисциплиной, а не разнобоем: одинаковый наклон и есть масса. Разброс —
// пара градусов, и он нужен только чтобы стена не была нарисованной линейкой.
// Разнобой уместен у бегущих, и там он и появляется.
//
// Второе правило, и оно важнее первого: **у каждого древка есть хозяин**.
// Древко ставится только в занятую позицию строя — в клетку человека, который
// его держал бы, — и никогда в промежуток между шеренгами, за фланг или рядом с
// конницей. Лес древков живёт на той же решётке, что и фигуры (`SectorTroops`),
// а не на своей, более плотной: своя решётка и была тем, из-за чего древки
// вставали там, где никто не стоит.
import * as THREE from 'three';
import { FILE_STEP, RANK_STEP, type SectorFrame } from '@/battle/replay';
import type { UnitKind } from '@/battle/types';
import { INSTANCED, SHADE } from '../materials';
import { MAN_HEIGHT, SPEAR_LEN } from '../units';
import { PALETTE } from '../palette';
import { beastSector } from './troops';

/**
 * Длина древка. Не «побольше человека», а ровно то копьё, которое держал бы
 * боец с этого места: `SPEAR_LEN` — та же доля роста, по которой копьё кладётся
 * в руку в `units.ts`. Древко стоит пяткой в земле, поэтому остриё выходит туда
 * же, куда у копья в руке. Двух длин одного копья
 * быть не должно: длинное одинокое древко читается палкой, а не оружием.
 */
const SHAFT_H = { min: MAN_HEIGHT * SPEAR_LEN * 0.92, max: MAN_HEIGHT * SPEAR_LEN };
const SHAFT_R = 0.014;

/**
 * Разброс древка внутри клетки своего хозяина. Меньше половины шага строя по
 * обеим осям — вместе с выносом опущенного копья (`COUCH_SHIFT`): древко обязано
 * оставаться в клетке того, кто его держит, и это проверяется тестом.
 */
const JITTER = { x: 0.4, z: 0.32 };

/** Наклон строя: копья держат чуть назад от вертикали, все одинаково. */
const SHAFT_LEAN = 0.11;
/** Разброс вокруг общего наклона — пара градусов, не больше. */
const SHAFT_SPREAD = 0.035;
/** Наперевес: копьё опускается вперёд почти до горизонтали. */
const COUCH_ANGLE = 1.18;
/**
 * Опущенное копьё держат у груди, а не волочат по земле: пятка древка
 * поднимается вместе с наклоном, иначе стена копий ложится на траву.
 */
const COUCH_PIVOT = 0.98;
/**
 * Насколько пятка опущенного копья выносится вперёд из руки. Вместе с разбросом
 * укладывается в половину шага между шеренгами: копьё наперевес — всё ещё копьё
 * своего бойца, а не воткнутое перед чужой шеренгой.
 */
const COUCH_SHIFT = 0.2;
/** У бегущих строя нет: наклон рассыпается. */
const ROUT_SPREAD = 0.6;

/** Наконечник: он и превращает палку в копьё. */
const TIP_H = 0.17;
const TIP_R = 0.032;

/**
 * Знамя выше древков, и высота у всех знамён войска одна. Мерка та же, что у
 * копья, — рост бойца: древко в два роста это высокий штандарт, а не мачта.
 * Прежние 2.55 давали четыре с половиной человеческих роста в пересчёте, и
 * такое древко читалось шестом, воткнутым в траву, а не знаменем в руках.
 */
const BANNER_H = MAN_HEIGHT * 2;
const BANNER_CLOTH = { w: 0.5, h: 0.34 };
/** Навершие древка знамени. */
const FINIAL_H = 0.13;

/** Насколько пятно массы темнит землю под собой. */
const DUST_DARK = 0.62;

/**
 * Детерминированный хеш: одна и та же раскадровка обязана давать один и тот же
 * лес древков. `Math.random` здесь запрещён так же, как в режиссуре.
 */
const TMP = new THREE.Vector3();
const TOP = new THREE.Vector3();

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Место `i`-й фигуры в блоке. Тот же счёт, что в `SectorTroops`: шеренги
 * заполняются слева направо, ряды уходят назад от передней. Совпадать он обязан
 * до знака — иначе древко встанет в промежуток между шеренгами, то есть туда,
 * где никто не стоит.
 */
export function figureSpot(f: SectorFrame, i: number, back: number): { x: number; z: number } {
  const files = Math.max(1, f.files);
  return {
    x: f.x + f.dx + ((i % files) - (files - 1) / 2) * FILE_STEP,
    z: f.z + f.dz + Math.floor(i / files) * RANK_STEP * back,
  };
}

/** Род бойца, стоящего на месте `i`: виды идут подряд, как их ставит строй. */
export function kindAt(f: SectorFrame, i: number): UnitKind | null {
  let n = 0;
  for (const face of f.byFace) {
    n += face.figures;
    if (i < n) return face.kind;
  }
  return null;
}

/**
 * Кто может держать древко леса: занятые места, кроме конных. Всадник виден
 * целиком — конь под ним крупнее любой пехоты, — и древко рядом с ним читается
 * не оружием невидимого бойца, а палкой, которую никто не держит.
 */
function bearersOf(f: SectorFrame): number[] {
  const out: number[] = [];
  for (let i = 0; i < f.figures; i++) if (kindAt(f, i) !== 'cavalry') out.push(i);
  return out;
}

/** Что нужно массе от кадра помимо самих секторов. */
export interface MassBeat {
  /** Копья опущены: 0 — вверх, 1 — наперевес. */
  couch: number;
  /** Время сцены: по нему колышутся полотнища. */
  time: number;
  /** Вспышка удара, 1 → 0: от неё вздымается пыль под сошедшимися линиями. */
  impact: number;
}

/** Общий пул инстансов массы: один меш на примитив, четыре вызова на всё поле. */
export class MassView {
  readonly group = new THREE.Group();
  /**
   * Куда встали древки леса на последнем кадре и чьи они. Не украшение и не
   * отладка на всякий случай: по этому списку проверяется главное правило —
   * у каждого древка есть хозяин, и он стоит в своей клетке.
   */
  readonly forest: { sector: number; bearer: number; x: number; z: number; h: number }[] = [];
  private shafts: THREE.InstancedMesh;
  private tips: THREE.InstancedMesh;
  private flags: THREE.InstancedMesh;
  private dust: THREE.InstancedMesh;
  private flagMat: THREE.Material;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(capacity: { shafts: number; flags: number; dust: number }) {
    this.group.name = 'mass';
    // Древко без донцев — их закрывает строй; четыре грани, восемь треугольников.
    const shaft = new THREE.CylinderGeometry(SHAFT_R, SHAFT_R * 1.15, 1, 4, 1, true).translate(0, 0.5, 0);
    // Наконечник — тот же конус, что у копья в руках бойца (`units.ts`).
    const tip = new THREE.ConeGeometry(TIP_R, 1, 4).translate(0, 0.5, 0);
    const flag = new THREE.PlaneGeometry(1, 1).translate(0.5, -0.5, 0);
    const poles = Math.max(1, capacity.shafts);
    this.shafts = this.make(shaft, INSTANCED, poles);
    this.tips = this.make(tip, INSTANCED, poles);
    this.flagMat = (INSTANCED as THREE.Material).clone();
    this.flagMat.side = THREE.DoubleSide;
    this.flags = this.make(flag, this.flagMat, Math.max(1, capacity.flags));
    this.dust = this.make(dustDisc(), SHADE, Math.max(1, capacity.dust));
    // Пятно лежит на земле и тени не отбрасывает: оно само и есть тень.
    this.dust.renderOrder = -1;
    for (const mesh of [this.dust, this.shafts, this.tips, this.flags]) this.group.add(mesh);
  }

  private make(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    // Масса ходит по всему кадру; сфера по одной детали культуру только испортит.
    mesh.frustumCulled = false;
    mesh.count = 0;
    return mesh;
  }

  /**
   * Разложить массу всех секторов кадра. Зовётся раз в кадр после фигур.
   * `cloth` — цвет стороны: знамя обязано быть того же цвета, что и рубаха,
   * иначе оно не говорит, чьё оно.
   */
  update(sectors: readonly SectorFrame[], cloth: (s: SectorFrame) => number, beat: MassBeat): void {
    let poles = 0;
    let flags = 0;
    let dust = 0;
    this.forest.length = 0;
    sectors.forEach((f, si) => {
      if (f.figures <= 0) return;
      // Блок: передняя шеренга на месте сектора, ряды уходят назад.
      // Куда «назад» для этого блока: наша сторона стоит на −Z, чужая на +Z.
      const back = Math.sign(f.z) || 1;
      const x0 = f.x + f.dx;
      const z0 = f.z + f.dz;
      // Глубина ПОСТАВЛЕННОГО блока — только для пятна массы под ним: сама масса
      // теперь стоит по местам строя и своей глубины не выдумывает.
      const shown = Math.max(1, Math.ceil(f.figures / Math.max(1, f.files)));
      const depth = Math.max(RANK_STEP, Math.min(f.ranks, shown) * RANK_STEP);
      const color = cloth(f);
      const bearers = bearersOf(f);

      // Копья опускают те, кто идёт в рукопашную; у лучников в руках лук, и он
      // остаётся при них. Бегущие строя не держат вовсе.
      const melee = share(f, (kind) => kind === 'spear' || kind === 'infantry');
      const couch = beat.couch * melee * (1 - f.flee);
      const spread = SHAFT_SPREAD + ROUT_SPREAD * f.flee;

      // Пятно массы — под всем блоком, площадь по числу бойцов. На ударе оно
      // вздувается: это и есть пыль, поднятая сошедшимися линиями.
      const kick = f.row === 'front' ? 1 + beat.impact * 0.55 : 1;
      if (f.dust > 0.01) {
        this.p.set(x0, 0.012, z0 + (back * depth) / 2);
        this.s.set(f.dust * kick, 1, f.dust * 0.85 * kick);
        this.e.set(-Math.PI / 2, 0, 0);
        this.m.compose(this.p, this.q.setFromEuler(this.e), this.s);
        dust = this.write(this.dust, dust, this.m, this.c.setScalar(1));
      }

      // Лес древков стоит НА МЕСТАХ СТРОЯ: каждое древко — оружие бойца из этой
      // клетки, и стоит оно в его клетке. Ни в промежутке между шеренгами, ни за
      // флангом, ни у конницы древка быть не может — там его некому держать.
      for (let i = 0; i < f.shafts && bearers.length > 0; i++) {
        const bearer = bearers[i % bearers.length];
        const spot = figureSpot(f, bearer, back);
        const r1 = hash(si * 9173 + i * 31 + 1);
        const r2 = hash(si * 9173 + i * 31 + 2);
        const x = spot.x + (r1 - 0.5) * JITTER.x;
        const z = spot.z + (r2 - 0.5) * JITTER.z;
        const h = SHAFT_H.min + r1 * (SHAFT_H.max - SHAFT_H.min);
        // Один наклон на весь строй: наклоняются все вместе, вперёд — на врага.
        const lean = -back * (SHAFT_LEAN - COUCH_ANGLE * couch) + (r2 - 0.5) * spread;
        const roll = (r1 - 0.5) * spread;
        const y = COUCH_PIVOT * couch;
        // Опущенное копьё вынесено вперёд из руки, а не растёт из пяток — но не
        // дальше своей клетки: иначе оно встанет перед чужой шеренгой.
        const zc = z - back * couch * COUCH_SHIFT;
        this.forest.push({ sector: si, bearer, x, z: zc, h });
        this.p.set(x, y, zc);
        this.s.set(1, h, 1);
        this.e.set(lean, 0, roll);
        this.q.setFromEuler(this.e);
        this.m.compose(this.p, this.q, this.s);
        this.c.setHex(r1 > 0.5 ? PALETTE.woodDark : PALETTE.wood);
        poles = this.write(this.shafts, poles, this.m, this.c);
        // Наконечник садится ровно на конец древка и наклонён вместе с ним:
        // конец считается тем же поворотом, а не приблизительной формулой.
        this.tip(x, y, zc, h, TIP_H, PALETTE.metal, poles - 1);
      }

      // Знамёна тоже стоят на занятых местах: знамя держит знаменосец, и без
      // него это шест посреди травы. Конница знамя нести может — одно древко в
      // руке всадника не лес, — поэтому места берутся все занятые, а не только
      // пешие. Стае знамя нести некому: у зверей его нет вовсе (`beastSector`).
      const flagged = !beastSector(f);
      for (let i = 0; i < f.banners && f.figures > 0 && flagged; i++) {
        const u = f.banners === 1 ? 0.5 : i / (f.banners - 1);
        const at = Math.min(f.figures - 1, Math.round(u * (f.figures - 1)));
        const spot = figureSpot(f, at, back);
        const x = spot.x;
        const z = spot.z;
        // Падает знамя вместе с сектором: сломался — древко валится набок.
        const fall = f.flee * 1.15;
        const h = BANNER_H * (1 - 0.35 * f.flee);
        this.e.set(0, 0, fall);
        this.q.setFromEuler(this.e);
        this.p.set(x, 0, z);
        this.s.set(1, h, 1);
        this.m.compose(this.p, this.q, this.s);
        this.c.setHex(PALETTE.woodDark);
        poles = this.write(this.shafts, poles, this.m, this.c);
        // Навершие — крошечная деталь, но без неё древко просто палка.
        const top = this.tip(x, 0, z, h, FINIAL_H, PALETTE.gold, poles - 1);

        // Полотнище свисает от верха древка и слегка колышется: своя фаза у
        // каждого знамени, иначе войско машет флагами в такт.
        const phase = hash(si * 733 + i * 97) * Math.PI * 2;
        const wave = Math.sin(beat.time * 1.7 + phase) * 0.26;
        this.p.copy(top).add(TMP.set(0.015, -FINIAL_H - 0.04, 0));
        this.s.set(BANNER_CLOTH.w, BANNER_CLOTH.h, 1);
        this.e.set(0, wave, fall + wave * 0.18);
        this.m.compose(this.p, this.q.setFromEuler(this.e), this.s);
        this.c.setHex(color);
        flags = this.write(this.flags, flags, this.m, this.c);
      }
    });
    this.finish(this.shafts, poles);
    this.finish(this.tips, poles);
    this.finish(this.flags, flags);
    this.finish(this.dust, dust);
  }

  /**
   * Ставит наконечник на конец древка с поворотом `this.q` и возвращает эту
   * точку: от неё же вешается полотнище знамени.
   */
  private tip(x: number, y: number, z: number, h: number, size: number, color: number, at: number): THREE.Vector3 {
    TOP.set(0, h, 0).applyQuaternion(this.q).add(TMP.set(x, y, z));
    this.s.set(1, size, 1);
    this.m.compose(TOP, this.q, this.s);
    this.write(this.tips, at, this.m, this.c.setHex(color));
    return TOP;
  }

  private write(mesh: THREE.InstancedMesh, at: number, m: THREE.Matrix4, color: THREE.Color): number {
    if (at >= mesh.instanceMatrix.count) return at;
    mesh.setMatrixAt(at, m);
    mesh.setColorAt(at, color);
    return at + 1;
  }

  private finish(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = Math.min(count, mesh.instanceMatrix.count);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.shafts, this.tips, this.flags, this.dust]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    // Полотнищу материал клонирован (ему нужны обе стороны) — его и убираем.
    // Общие INSTANCED и SHADE трогать нельзя: ими рисует вся остальная сцена.
    this.flagMat.dispose();
  }
}

/** Какая доля фигур сектора — этого сорта. По ней решается, кому опускать копьё. */
function share(f: SectorFrame, pick: (kind: string) => boolean): number {
  let all = 0;
  let mine = 0;
  for (const face of f.byFace) {
    all += face.figures;
    if (pick(face.kind)) mine += face.figures;
  }
  return all > 0 ? mine / all : 0;
}

/**
 * Диск пятна массы: тёмный в середине, к краю сходит на нет. Растушёвка идёт
 * цветом вершин — умножающее смешивание альфу не смотрит, ровно как у пятна
 * тени под зданием.
 */
function dustDisc(segments = 16): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(1, segments);
  const count = g.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const pos = g.attributes.position;
  for (let i = 0; i < count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    // Середина темнит на DUST_DARK, край — единица, то есть ничего не меняет.
    const k = DUST_DARK + (1 - DUST_DARK) * Math.min(1, r);
    colors[i * 3] = k;
    colors[i * 3 + 1] = k;
    colors[i * 3 + 2] = k * 1.03;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}
