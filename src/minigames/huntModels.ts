/**
 * Модели «Охоты»: укрытия и стрелы копиями (docs/minigames.md, раздел 13; мягкий вид — docs/polish.md, П-4). Поле и
 * лес — общие места промыслов (`places.meadowLand`), олени — свои звери (`beasts.ts`), стрела — модель поляны
 * предыстории (`prologue/models.arrow`) как есть.
 *
 * ФОРМА УКРЫТИЙ ВЫВЕДЕНА ИЗ ТЕХ ЖЕ ЧИСЕЛ, ЧТО ИХ ПОПАДАНИЕ (`hunt.SPRUCE`, `BIRCH`, `BUSH`): стрела втыкается туда,
 * где нарисована хвоя, а не туда, где её задумали. Держит это тест.
 *
 * Имена `three` — только те, что игра уже берёт (`prologue/post.test.ts`): своих классов у промыслов нет.
 */
import * as THREE from 'three';
import type { Shade } from '@/prologue/models';
import type { Season } from '@/game/types';
import { BIRCH, BUSH, FOREST_IN, SPRUCE, type Cover } from './hunt';
import { Sculpt, rigid } from './fauna';
import { mix, noise3 } from './beasts';
import { scatter, type Detail, type NatureMats, type Spot } from './nature';

/** Докуда тянется земля: за стену леса, чтобы края диска не было видно. */
export const MEADOW_R = 72;
/** Стена леса: с какого радиуса стоят стволы опушки — там же в них втыкается стрела (`hunt.FOREST_IN`), число одно. */
export const WALL_FROM = FOREST_IN;
/** Докуда поле ровное: там ходят олени и втыкаются стрелы (`hunt.ESCAPE_R` и чуть дальше), холмы — за ним. */
export const MEADOW_FLAT = 46;

/** Береста: белая кора и чёрные полосы. */
const BIRCH_BARK = 0xe6e1d3;
const BIRCH_MARK = 0x2a2622;

/**
 * Укрытия «Охоты» — мягкие, но в числах попадания (`hunt.SPRUCE`, `BIRCH`, `BUSH`): ель — ярусы лап зубцами внутри
 * конусов правила, берёза — белый ствол и купы внутри шаров кроны, куст — купы внутри его эллипсоида. Порода — одна
 * сетка ростом 1 (рост `s` и поворот — у копии), по вызову на кору, хвою и листву. Держит это тест: 85 % вершин — в
 * том, во что втыкается стрела.
 */
const V3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

function spruceCover(detail: Detail): { bark: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const bark = new Sculpt();
  const crown = new Sculpt();
  const hi = detail === 'hi';
  bark.tube([V3(0, -0.02, 0), V3(0, SPRUCE.trunkH * 0.6, 0), V3(0, SPRUCE.trunkH, 0)], [SPRUCE.trunkR, SPRUCE.trunkR * 0.85, SPRUCE.trunkR * 0.6], {
    seg: hi ? 7 : 5,
    color: (u) => mix(0x2e2018, 0x4a3426, u),
    skin: rigid(0),
    caps: [null, 0.4],
  });
  const seg = hi ? 16 : 10;
  const soft: [number, number, number][] = [];
  SPRUCE.tiers.forEach((t, k) => {
    const h = t.y1 - t.y0;
    const from = crown.skins.length;
    // Лапы — зубцами по кругу внутри конуса правила: длинная и короткая через одну, конец лапы чуть ниже середины яруса.
    const tip = crown.vert(V3(0, t.y1, 0), NEEDLES_HI.mid, rigid(0));
    const mid: number[] = [];
    const out: number[] = [];
    const under: number[] = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2 + k * 0.7;
      const jag = j % 2 ? 0.86 : 1;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const ym = t.y0 + h * 0.42;
      const rm = t.r * (1 - 0.42) * 0.96;
      mid.push(crown.vert(V3(c * rm, ym, sn * rm), mix(NEEDLES_HI.deep, NEEDLES_HI.mid, 0.55), rigid(0)));
      out.push(crown.vert(V3(c * t.r * jag * 0.97, t.y0 + h * 0.03, sn * t.r * jag * 0.97), mix(NEEDLES_HI.mid, NEEDLES_HI.tip, 0.4 + 0.5 * ((j * 7 + k) % 5) / 4), rigid(0)));
      under.push(crown.vert(V3(c * t.r * 0.45, t.y0 + h * 0.1, sn * t.r * 0.45), NEEDLES_HI.under, rigid(0)));
    }
    const core = crown.vert(V3(0, t.y0 + h * 0.14, 0), NEEDLES_HI.under, rigid(0));
    for (let j = 0; j < seg; j++) {
      const n = (j + 1) % seg;
      crown.idx.push(tip, mid[n], mid[j]);
      crown.idx.push(mid[j], mid[n], out[j], mid[n], out[n], out[j]);
      crown.idx.push(out[j], out[n], under[j], out[n], under[n], under[j]);
      crown.idx.push(under[j], under[n], core);
    }
    soft.push([from, crown.skins.length, t.y0 + h * 0.25]);
  });
  const b = bark.geometry({ under: 0.7, ground: 0.6, groundUp: 0.6 });
  const g = crown.geometry({ under: 0.55, ground: 1, groundUp: 1 });
  for (const [from, to, cy] of soft) softenTo(g, from, to, V3(0, cy, 0), 0.55, 1.6);
  return { bark: b, crown: g };
}

function birchCover(detail: Detail, season: Season): { bark: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const bark = new Sculpt();
  const crown = new Sculpt();
  const hi = detail === 'hi';
  bark.tube([V3(0, -0.02, 0), V3(0, BIRCH.trunkH * 0.6, 0), V3(0, BIRCH.trunkH, 0), V3(0.02, BIRCH.crowns[2].y, 0)], [BIRCH.trunkR, BIRCH.trunkR * 0.85, BIRCH.trunkR * 0.6, 0.02], {
    seg: hi ? 8 : 6,
    color: (u, a, p) => {
      // Чёрные полосы поперёк и тёмный низ: берёзу узнают по коре.
      const band = Math.sin(p.y * 22 + Math.sin(a * 3) * 2) > 0.8 || noise3(p.x * 30, p.y * 12, p.z * 30) > 0.78;
      return u < 0.06 ? 0x3a3530 : band ? BIRCH_MARK : BIRCH_BARK;
    },
    skin: rigid(0),
    caps: [null, 0.5],
  });
  const soft: [number, number, THREE.Vector3][] = [];
  const leaf = BIRCH_LEAF_HI[season];
  for (const k of BIRCH.crowns) {
    const from = crown.skins.length;
    const at = V3(k.x, k.y, k.z);
    crown.blob(at, V3(k.r * 0.86, k.r * 0.8, k.r * 0.86), new THREE.Euler(0, k.x * 3, 0), (p) => mix(leaf.deep, leaf.light, Math.min(1, Math.max(0, (p.y - k.y + k.r) / (2 * k.r))) * (0.65 + 0.35 * noise3(p.x * 5, p.y * 5, p.z * 5))), rigid(0), hi ? 11 : 8, hi ? 7 : 5, (p) => (noise3(p.x * 3.2 + k.x * 9, p.y * 3.2, p.z * 3.2) - 0.55) * k.r * 0.28);
    soft.push([from, crown.skins.length, at]);
  }
  const b = bark.geometry({ under: 0.7, ground: 0.6, groundUp: 0.5 });
  const g = crown.geometry({ under: 0.55, ground: 1, groundUp: 1 });
  for (const [from, to, c] of soft) softenTo(g, from, to, c, 0.6, 1.2);
  return { bark: b, crown: g };
}

function bushCover(detail: Detail, season: Season): THREE.BufferGeometry {
  const s = new Sculpt();
  const hi = detail === 'hi';
  const leaf = BUSH_LEAF_HI[season];
  const parts: [number, number, number, number][] = [
    [0, BUSH.y, 0, 0.62],
    [BUSH.rx * 0.36, BUSH.y * 0.82, 0.18, 0.5],
    [-BUSH.rx * 0.32, BUSH.y * 0.84, -0.2, 0.5],
    [0.1, BUSH.y * 0.8, -BUSH.rx * 0.38, 0.46],
  ];
  const soft: [number, number][] = [];
  for (const [x, y, z, k] of parts) {
    const from = s.skins.length;
    s.blob(V3(x, y, z), V3(BUSH.rx * k, BUSH.ry * k * 1.25, BUSH.rx * k), new THREE.Euler(0, x * 4, 0), (p) => mix(leaf.deep, leaf.light, Math.min(1, Math.max(0, p.y / (BUSH.y * 2))) * (0.6 + 0.4 * noise3(p.x * 6, p.y * 6, p.z * 6))), rigid(0), hi ? 10 : 7, hi ? 6 : 5, (p) => (noise3(p.x * 4 + x * 9, p.y * 4, p.z * 4) - 0.55) * 0.12);
    soft.push([from, s.skins.length]);
  }
  const g = s.geometry({ under: 0.5, ground: 0.6, groundUp: 0.25 });
  for (const [from, to] of soft) softenTo(g, from, to, V3(0, BUSH.y * 0.7, 0), 0.6, 1.4);
  return g;
}

/** Склонить нормали к середине купы — тот же приём, что у рощи (`nature.ts`). */
function softenTo(g: THREE.BufferGeometry, from: number, to: number, c: THREE.Vector3, k: number, sy: number): void {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const d = new THREE.Vector3();
  const m = new THREE.Vector3();
  for (let i = from; i < to; i++) {
    d.fromBufferAttribute(p, i).sub(c);
    d.y *= sy;
    d.normalize();
    m.fromBufferAttribute(n, i).lerp(d, k).normalize();
    n.setXYZ(i, m.x, m.y, m.z);
  }
}

const NEEDLES_HI = { deep: 0x1e3a26, mid: 0x2f5a35, tip: 0x5a8a4a, under: 0x16281c };
const BIRCH_LEAF_HI: Record<Season, { deep: number; light: number }> = {
  spring: { deep: 0x4a7a30, light: 0xb4d470 },
  summer: { deep: 0x3e6a2e, light: 0x9ac05c },
  autumn: { deep: 0xa07a24, light: 0xf0c848 },
  winter: { deep: 0x5a5040, light: 0x80705a },
};
const BUSH_LEAF_HI: Record<Season, { deep: number; light: number }> = {
  spring: { deep: 0x3a6a2a, light: 0x88b058 },
  summer: { deep: 0x2e5a26, light: 0x6e9a44 },
  autumn: { deep: 0x6a4a1e, light: 0xb08a3a },
  winter: { deep: 0x4a4234, light: 0x6a5f48 },
};

/** Все укрытия поля — копиями по породам; пятна тени под ними — в общую тень поляны. */
export function coverGroup(cover: readonly Cover[], season: Season, shade: Shade, mats: NatureMats, detail: Detail): THREE.Group {
  const g = new THREE.Group();
  g.name = 'cover';
  const spot = (c: Cover, n: number): Spot => ({ x: c.x, z: c.z, yaw: c.yaw, h: c.s, tint: n % 3 === 0 ? 0xe8f0e0 : n % 3 === 1 ? 0xffffff : 0xd8e4d0 });
  const by = (k: Cover['kind']): Cover[] => cover.filter((c) => c.kind === k);
  const sp = spruceCover(detail);
  const bi = birchCover(detail, season);
  const add = (m: THREE.Object3D | null): void => {
    if (m) g.add(m);
  };
  add(scatter(sp.bark, mats.of('bark'), by('spruce').map(spot), 'spruce-bark', true));
  add(scatter(sp.crown, mats.of('needle'), by('spruce').map(spot), 'spruce-crown', true));
  add(scatter(bi.bark, mats.of('bark'), by('birch').map((c) => ({ ...spot(c, 1), tint: 0xffffff })), 'birch-bark', true));
  add(scatter(bi.crown, mats.of('leaf'), by('birch').map(spot), 'birch-crown', true));
  add(scatter(bushCover(detail, season), mats.of('leaf'), by('bush').map(spot), 'bushes', true));
  cover.forEach((c) => {
    const r = c.kind === 'spruce' ? SPRUCE.tiers[0].r * c.s * 0.85 : c.kind === 'birch' ? 0.5 * c.s : BUSH.rx * c.s * 1.1;
    shade.add(c.x, c.z, r, r, c.yaw);
  });
  return g;
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
