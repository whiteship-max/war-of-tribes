// Луг и опушка ролика в виде `next` (docs/graphics_world.md, 11.5): трава и цветы — только на сухом лугу и от сида,
// зимой их нет; деревья окружения — на местах прежней опушки, конусов у `next` нет; у прежнего вида — всё как было.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { simulateBattle } from '@/battle/sim';
import { deploySetup } from '@/battle/setup';
import { PLAIN_GROUND, buildCast, type Ground } from '@/battle/replay';
import { MEADOW, WOODS_SPECIES, buildMeadow } from './meadow';
import { buildGround, groundHeight, meadowAt, woodsSpots } from './ground';
import { BattleStage } from './stage';

const ground = (extra: Partial<Ground> = {}): Ground => ({ ...PLAIN_GROUND, seed: 5, ...extra });
/** Клетка со всем, что отнимает землю у луга: река, тракт и опушка. */
const RICH = ground({ river: true, road: true, woods: true });

const meshes = (g: THREE.Object3D): THREE.InstancedMesh[] => g.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);
const byName = (g: THREE.Object3D, name: string): THREE.InstancedMesh | undefined => meshes(g).find((m) => m.name === name);

/** Места экземпляров меша: x, y, z. */
function spotsOf(m: THREE.InstancedMesh): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const mat = new THREE.Matrix4();
  for (let i = 0; i < m.count; i++) {
    m.getMatrixAt(i, mat);
    out.push(new THREE.Vector3().setFromMatrixPosition(mat));
  }
  return out;
}

const vertsOf = (g: THREE.Group): number =>
  g.children.reduce((n, c) => n + ((c as THREE.Mesh).geometry?.attributes.position.count ?? 0), 0);

const stripComments = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('луг ролика в виде next', () => {
  it('трава и цветы — на сухом лугу, на земле и в круге; у воды и на тракте их нет', () => {
    // Граница области: на клетке есть земля, которой у луга нет, — правило спрашивается.
    expect(meadowAt(RICH, 0, 5), 'тракт').toBe(false);
    expect(meadowAt(RICH, 10, 5), 'луг у тракта').toBe(true);
    let wetSeen = false;
    for (let z = 20; z < 34 && !wetSeen; z += 0.5) wetSeen = !meadowAt(RICH, 10, z);
    expect(wetSeen, 'у реки луга нет').toBe(true);
    const mv = buildMeadow(RICH);
    for (const name of ['meadow-grass', 'meadow-flowers']) {
      const m = byName(mv.group, name);
      expect(m, name).toBeDefined();
      // Попыток хватает: луг набирается почти целиком и на клетке с рекой и трактом.
      expect(m!.count, name).toBeGreaterThan((name === 'meadow-grass' ? MEADOW.tufts : MEADOW.flowers) * 0.9);
      for (const p of spotsOf(m!)) {
        expect(meadowAt(RICH, p.x, p.z), `${name}: сухой луг`).toBe(true);
        expect(Math.abs(p.y - groundHeight(RICH, p.x, p.z)), `${name}: на земле`).toBeLessThan(1e-6);
        expect(Math.hypot(p.x, p.z), `${name}: в круге`).toBeLessThanOrEqual(MEADOW.radius);
      }
    }
    mv.dispose();
  });

  it('тот же сид — тот же луг до травинки, другой сид — другой', () => {
    const a = buildMeadow(RICH);
    const b = buildMeadow(RICH);
    const c = buildMeadow({ ...RICH, seed: 6 });
    const arr = (mv: ReturnType<typeof buildMeadow>): number[] => Array.from(byName(mv.group, 'meadow-grass')!.instanceMatrix.array);
    expect(arr(b)).toEqual(arr(a));
    // Другой сид — другие места на земле, а не только другая высота той же земли под ними.
    const xz = (mv: ReturnType<typeof buildMeadow>): string[] => spotsOf(byName(mv.group, 'meadow-grass')!).map((p) => `${p.x},${p.z}`);
    expect(xz(c)).not.toEqual(xz(a));
    for (const mv of [a, b, c]) mv.dispose();
  });

  it('зимой травы и цветов нет, а деревья стоят в снегу', () => {
    const mv = buildMeadow({ ...RICH, winter: true });
    expect(byName(mv.group, 'meadow-grass')).toBeUndefined();
    expect(byName(mv.group, 'meadow-flowers')).toBeUndefined();
    const trees = meshes(mv.group).reduce((n, m) => n + m.count, 0);
    expect(trees).toBe(woodsSpots(RICH).length);
    expect(mv.shared.snow.value).toBe(1);
    mv.dispose();
  });

  it('опушка: у next — деревья окружения на местах прежней опушки, конусов нет; у прежнего — конусы', () => {
    const spots = woodsSpots(RICH);
    // Граница области: опушка есть, и в ней оба рода мест — высокие и низкие.
    expect(spots.length).toBeGreaterThan(40);
    expect(spots.some((t) => t.tall) && spots.some((t) => !t.tall)).toBe(true);
    const mv = buildMeadow(RICH);
    const placed: THREE.Vector3[] = [];
    for (const species of Object.values(WOODS_SPECIES)) {
      const m = byName(mv.group, `meadow-${species}`)!;
      expect(m.castShadow, `${species}: отбрасывает тень`).toBe(true);
      placed.push(...spotsOf(m));
    }
    // Матрица хранит место в float32: сверка — с допуском, а не строкой.
    expect(placed).toHaveLength(spots.length);
    for (const t of spots) {
      expect(placed.some((p) => Math.abs(p.x - t.x) < 1e-3 && Math.abs(p.z - t.z) < 1e-3 && Math.abs(p.y - t.y) < 1e-3), `дерево у ${t.x.toFixed(1)}, ${t.z.toFixed(1)}`).toBe(true);
    }
    mv.dispose();
    // Конусы опушки: у прежнего вида земля с опушкой тяжелее земли без неё, у `next` — нет.
    const bare = ground({ river: true, road: true });
    const verts = (g: Ground, look: 'now' | 'next'): number => {
      const v = buildGround(g, look);
      const n = vertsOf(v.group);
      v.dispose();
      return n;
    };
    expect(verts(RICH, 'now')).toBeGreaterThan(verts(bare, 'now'));
    expect(verts(RICH, 'next')).toBe(verts(bare, 'next'));
  });

  it('ветер — от времени ролика: тот же момент — тот же ветер, и он не стихает', () => {
    const mv = buildMeadow(RICH);
    mv.update(3);
    const w3 = mv.shared.wind.value;
    expect(mv.shared.time.value).toBe(3);
    mv.update(10);
    expect(mv.shared.wind.value).not.toBe(w3);
    mv.update(3);
    expect(mv.shared.wind.value).toBe(w3);
    for (let t = 0; t < 60; t += 0.7) {
      mv.update(t);
      expect(mv.shared.wind.value, `t=${t}`).toBeGreaterThan(0);
    }
    mv.dispose();
  });
});

describe('сцена ролика: луг — только у вида next', () => {
  const cast = (): ReturnType<typeof buildCast> => {
    const result = simulateBattle({ seed: 7, attacker: deploySetup({ infantry: 40 }), defender: deploySetup({ infantry: 40 }) });
    return buildCast(result, 'attacker', undefined, { ...RICH, seed: result.seed });
  };

  it('у прежнего вида луга нет и плита гранёная; у next — луг есть и плита гладкая', () => {
    const now = new BattleStage(cast(), 'now');
    const next = new BattleStage(cast(), 'next');
    expect(now.scene.getObjectByName('meadow')).toBeUndefined();
    expect(next.scene.getObjectByName('meadow')).toBeDefined();
    const plate = (st: BattleStage): THREE.MeshLambertMaterial =>
      ((st.scene.getObjectByName('ground') as THREE.Group).children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial;
    expect(plate(now).flatShading).toBe(true);
    expect(plate(next).flatShading).toBe(false);
    now.dispose();
    next.dispose();
  });

  it('ролик в игре берёт вид сцены посёлка; луг не трогает материалов посёлка', () => {
    const replay = readFileSync(join(process.cwd(), 'src/ui/battle/BattleReplay.tsx'), 'utf8');
    // Вид «город» (docs/city.md) своего поля боя не имеет — его ролик идёт в виде `next`.
    expect(replay).toMatch(/look: sceneGfx\(gfx\(\), window\.location\.search\)\.look === 'now' \? 'now' : 'next',/);
    const src = stripComments(readFileSync(join(__dirname, 'meadow.ts'), 'utf8'));
    // Свои материалы и свои числа кадра: общие наборы посёлка переливает его сезон.
    expect(src).not.toMatch(/\bKIT\b|\bLEGACY\b|SeasonVisuals/);
    expect(src).toMatch(/envShared\(\)/);
  });
});
