/**
 * Модели «Охоты»: поле, укрытия, стена леса и стрелы копиями (docs/minigames.md, раздел 13).
 *
 * Тот же склад, что у остальных промыслов (`minigames/models.ts`): набор деталей (`render/kit.ts`), цвет в вершинах на
 * общем белом теле и склейка `assemble` — одно поле, один вызов отрисовки на материал. Олень, туша, лук, тетива и
 * стрела — модели поляны предыстории (`prologue/models.ts`) как есть: второй раз их не рисуем.
 *
 * ФОРМА УКРЫТИЙ ВЫВЕДЕНА ИЗ ТЕХ ЖЕ ЧИСЕЛ, ЧТО ИХ ПОПАДАНИЕ (`hunt.SPRUCE`, `BIRCH`, `BUSH`): стрела втыкается туда,
 * где нарисована хвоя, а не туда, где её задумали. Держит это тест.
 *
 * Имена `three` — только те, что игра уже берёт (`prologue/post.test.ts`): своих классов у промыслов нет.
 */
import * as THREE from 'three';
import { KIT } from '@/render/materials';
import * as K from '@/render/kit';
import { vnoise } from '@/render/terrain';
import { hash } from '@/prologue/glade';
import type { Shade } from '@/prologue/models';
import type { Season } from '@/game/types';
import { BIRCH, BUSH, FOREST_IN, SPRUCE, type Cover } from './hunt';

const tint = (hex: number): K.Paint => ({ mat: KIT.body, tint: new THREE.Color(hex) });

/** Докуда тянется земля: за стену леса, чтобы края диска не было видно. */
export const MEADOW_R = 72;
/** Стена леса: с какого радиуса стоят стволы опушки — там же в них втыкается стрела (`hunt.FOREST_IN`), число одно. */
export const WALL_FROM = FOREST_IN;
/** Тёмная гребёнка дальнего леса: на этом радиусе, за последним рядом елей. */
const BAND_R = 63;

/** Хвоя: тёмная и светлее — у соседних ёлок разная. Берёза — кора, кора в отметинах и листва по сезону. */
const NEEDLES = [0x2d5634, 0x37643a, 0x2a4d33] as const;
const BIRCH_BARK = 0xe6e1d3;
const BIRCH_MARK = 0x3a3530;
const BIRCH_LEAF: Record<Season, number> = { spring: 0x86b257, summer: 0x6f9a48, autumn: 0xc9a23c, winter: 0x8c7a5a };
const BUSH_LEAF: Record<Season, number> = { spring: 0x5f8f45, summer: 0x4f7d3c, autumn: 0x8f7a3a, winter: 0x6a5f48 };
const TRUNK = 0x5a4030;

/** Земля поля: травяной цвет пятнами, ровная — по ней ходят и на ней стоят олени. */
const GRASS: Record<Season, [number, number, number]> = {
  spring: [1.0, 1.04, 0.96],
  summer: [1, 1, 1],
  autumn: [1.12, 1.0, 0.8],
  winter: [1.08, 1.04, 0.92],
};

export function meadowGround(season: Season): THREE.Mesh {
  const SEG = 72;
  const radii: number[] = [0];
  let r = 0;
  while (r < 24) radii.push((r += 2.4));
  while (r < MEADOW_R) radii.push((r += 4));
  const k = GRASS[season];
  const pos: number[] = [];
  const col: number[] = [];
  const at = (i: number, j: number): [number, number, number, number, number, number] => {
    const rr = radii[i];
    const a = ((j + (i === 0 ? 0 : (hash(i * 7, j * 13) - 0.5) * 0.35)) / SEG) * Math.PI * 2;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    // Пятна: светлее на прогалинах, темнее у кустов — поле не должно быть ровным зелёным столом.
    const w = 0.6 * vnoise(x / 6.5, z / 6.5) + 0.4 * vnoise(x / 2.2 + 11, z / 2.2 + 5);
    const t = Math.max(0, Math.min(1, (w + 1) / 2));
    const m = 0.8 + 0.34 * t;
    return [x, 0, z, m * k[0], m * k[1], m * k[2]];
  };
  const put = (v: [number, number, number, number, number, number]): void => {
    pos.push(v[0], v[1], v[2]);
    col.push(v[3], v[4], v[5]);
  };
  for (let i = 0; i < radii.length - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = at(i, j);
      const b = at(i, (j + 1) % SEG);
      const c = at(i + 1, (j + 1) % SEG);
      const d = at(i + 1, j);
      if (i === 0) {
        put(a);
        put(c);
        put(d);
        continue;
      }
      put(a);
      put(c);
      put(d);
      put(a);
      put(b);
      put(c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, KIT.grass);
  mesh.name = 'ground';
  mesh.receiveShadow = true;
  return mesh;
}

/** Ярус хвои: конус от `y0` до `y1` радиусом `r` у основания. Открытый — донца снизу не видно, а оно треугольники. */
function tier(r: number, y0: number, y1: number, paint: K.Paint, x: number, z: number, seg = 7): K.Part {
  const h = y1 - y0;
  const g = new THREE.ConeGeometry(r, h, seg, 1, true);
  return K.place(g, paint, x, y0 + h / 2, z);
}

/** Ель по числам попадания: ствол и три яруса. */
function spruceParts(c: Cover, parts: K.Part[], n: number): void {
  const s = c.s;
  const needles = tint(NEEDLES[n % NEEDLES.length]);
  parts.push(K.cyl(SPRUCE.trunkR * s * 0.7, SPRUCE.trunkR * s, SPRUCE.trunkH * s, tint(TRUNK), 5, c.x, (SPRUCE.trunkH * s) / 2, c.z, undefined, K.GROUND_AO));
  for (const t of SPRUCE.tiers) parts.push(tier(t.r * s, t.y0 * s, t.y1 * s, needles, c.x, c.z));
}

/** Берёза по числам попадания: белый ствол в отметинах и три шапки кроны. */
function birchParts(c: Cover, parts: K.Part[], season: Season): void {
  const s = c.s;
  parts.push(K.cyl(BIRCH.trunkR * s * 0.65, BIRCH.trunkR * s, BIRCH.trunkH * s, tint(BIRCH_BARK), 6, c.x, (BIRCH.trunkH * s) / 2, c.z, undefined, K.GROUND_AO));
  for (let k = 0; k < 4; k++) {
    const a = c.yaw + k * 1.7;
    const y = (0.25 + k * 0.28) * s;
    // Отметины на коре — заподлицо: чуть выступают из ствола, но не за его круг попадания.
    const r = BIRCH.trunkR * s * (1 - (y / (BIRCH.trunkH * s)) * 0.35) - 0.008 * s;
    parts.push(K.box(0.02 * s, 0.025 * s, 0.06 * s, tint(BIRCH_MARK), c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r, { y: -a }));
  }
  const cos = Math.cos(c.yaw);
  const sin = Math.sin(c.yaw);
  const leaf = tint(BIRCH_LEAF[season]);
  for (const k of BIRCH.crowns) {
    const g = new THREE.IcosahedronGeometry(k.r * s, 0);
    parts.push(K.place(g, leaf, c.x + (k.x * cos + k.z * sin) * s, k.y * s, c.z + (-k.x * sin + k.z * cos) * s, { y: c.yaw + k.x }));
  }
}

/** Куст: три приплюснутые шапки внутри эллипсоида попадания. */
function bushParts(c: Cover, parts: K.Part[], season: Season): void {
  const s = c.s;
  const leaf = tint(BUSH_LEAF[season]);
  const ao = { base: [0.62, 0.66, 0.74] as [number, number, number], y0: 0, y1: BUSH.ry * 2 * s };
  for (let k = 0; k < 3; k++) {
    const a = c.yaw + k * 2.1;
    const off = k === 0 ? 0 : BUSH.rx * s * 0.38;
    const rr = BUSH.rx * s * (k === 0 ? 0.68 : 0.55);
    const g = new THREE.IcosahedronGeometry(rr, 1);
    g.scale(1, (BUSH.ry / BUSH.rx) * 1.15, 1);
    parts.push(K.place(g, leaf, c.x + Math.cos(a) * off, BUSH.y * s * (k === 0 ? 1 : 0.85), c.z + Math.sin(a) * off, { y: a }, ao));
  }
}

/** Все укрытия поля — одним мешем; пятна тени под ними — в общую тень поляны. */
export function coverMesh(cover: readonly Cover[], season: Season, shade: Shade): THREE.Mesh {
  const parts: K.Part[] = [];
  cover.forEach((c, n) => {
    if (c.kind === 'spruce') spruceParts(c, parts, n);
    else if (c.kind === 'birch') birchParts(c, parts, season);
    else bushParts(c, parts, season);
    const r = c.kind === 'spruce' ? SPRUCE.tiers[0].r * c.s * 0.85 : c.kind === 'birch' ? 0.5 * c.s : BUSH.rx * c.s * 1.1;
    shade.add(c.x, c.z, r, r, c.yaw);
  });
  const m = K.assemble(parts);
  m.name = 'cover';
  return m;
}

/**
 * Стена леса вокруг поля: два ряда елей и тёмная гребёнка за ними. Тени ей не положено (за коробкой теней), донец у
 * конусов нет — снизу их не видно. Ряды редкие нарочно: дальше тридцати метров ель — силуэт, и гуще его делает
 * гребёнка, а не треугольники.
 */
export function forestWall(): THREE.Mesh {
  const parts: K.Part[] = [];
  let n = 0;
  for (const [r0, step] of [
    [WALL_FROM, 3.4],
    [WALL_FROM + 5, 3.8],
  ] as const) {
    const count = Math.round((Math.PI * 2 * r0) / step);
    for (let i = 0; i < count; i++) {
      const a = ((i + hash(r0, i * 7) * 0.8) / count) * Math.PI * 2;
      const rr = r0 + (hash(i * 3, r0) - 0.5) * 2;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      const s = 2.6 + hash(i * 5, r0 * 9) * 1.6;
      const needles = tint(NEEDLES[n++ % NEEDLES.length]);
      parts.push(tier(0.75 * s, 0.4 * s, 2.1 * s, needles, x, z, 6));
      parts.push(tier(0.5 * s, 1.5 * s, 3.1 * s, needles, x, z, 6));
    }
  }
  // Гребёнка: зубцы разной высоты по кругу — дальний ельник, которому хватает силуэта.
  const teeth = 200;
  const pos: number[] = [];
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = ((i + 1) / teeth) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const h = 9 + hash(i, 77) * 7;
    const low = 0;
    const p0 = [Math.cos(a0) * BAND_R, low, Math.sin(a0) * BAND_R];
    const p1 = [Math.cos(a1) * BAND_R, low, Math.sin(a1) * BAND_R];
    const pt = [Math.cos(am) * BAND_R, h, Math.sin(am) * BAND_R];
    const sh = h * 0.55;
    const q0 = [Math.cos(a0) * BAND_R, sh, Math.sin(a0) * BAND_R];
    const q1 = [Math.cos(a1) * BAND_R, sh, Math.sin(a1) * BAND_R];
    // Изнутри поля: обход такой, что лицо треугольника смотрит к середине.
    pos.push(...p0, ...p1, ...q1, ...p0, ...q1, ...q0, ...q0, ...q1, ...pt);
  }
  const band = new THREE.BufferGeometry();
  band.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  band.computeVertexNormals();
  parts.push({ geo: band, paint: tint(0x253f2b) });
  const m = K.assemble(parts);
  m.name = 'wall';
  m.castShadow = false;
  return m;
}

/**
 * Стрелы поля: летящие и воткнувшиеся — одним мешем копиями. Стрела толще настоящей вдвое: на тридцати метрах
 * древко в сантиметр — меньше точки экрана, а видеть, куда легла промахнувшаяся, надо — по ней и учатся брать
 * поправку.
 */
export function arrowsMesh(base: THREE.Mesh, count: number): THREE.InstancedMesh {
  const geo = base.geometry.clone();
  geo.scale(2.2, 2.2, 1.25);
  const m = new THREE.InstancedMesh(geo, base.material, Math.max(1, count));
  m.name = 'arrows';
  m.castShadow = false;
  m.receiveShadow = false;
  m.count = 0;
  m.frustumCulled = false;
  return m;
}
