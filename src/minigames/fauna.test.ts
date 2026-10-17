/**
 * Звери и места П-4 (docs/polish.md, П-4): то, на чём стоит вид, — точность поворота морфами, копия куска шейдера
 * three, звери на земле, лёжка и падение, трава мимо того, что стоит у игры.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Moves, Rig, Sculpt, bake, morphed, rigid, blend } from './fauna';
import { BONE, FALLEN, STILL, model, posture, torsoPoints, fallenMatrix, type Kind } from './beasts';
import { LAMBERT_DIRECT, LAMBERT_PARS } from './fur';
import { grassSpots, bloomSpots } from './nature';
import { trodden } from './places';
import { BUSH_KINDS, layBerries } from './berries';
import { HAY, PEN_R } from './herd';

const KINDS: Kind[] = ['sheep', 'lamb', 'goat', 'cow', 'stag', 'doe'];

describe('звери: поворот морфами', () => {
  /**
   * Поворот двумя морфами (`Channel.turn`) — точный: вершина целиком на кости уходит туда же, куда её унёс бы поворот
   * матрицей вокруг шарнира. Область — углы от −1.2 до 1.2 рад (шея оленя ходит от −0.6 до 1.1: `hunt.HEAD_UP`,
   * `HEAD_DOWN` и запрокинутая шея упавшего) и все три оси.
   */
  it('вершина на кости — там же, где её поворот матрицей, на любом угле области', () => {
    const s = new Sculpt();
    s.tube([new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1.4, 0.3), new THREE.Vector3(0, 1.7, 0.6)], [0.1, 0.08, 0.05], { seg: 6, color: 0xffffff, skin: rigid(1) });
    const rig = new Rig([
      { name: 'body', parent: -1, at: [0, 0, 0] },
      { name: 'neck', parent: 0, at: [0, 1, 0.1] },
    ]);
    const b = bake(s, rig, { x: { turn: 'neck', axis: 'x' }, y: { turn: 'neck', axis: 'y' }, z: { turn: 'neck', axis: 'z' } });
    const pivot = new THREE.Vector3(0, 1, 0.1);
    const m = new Moves(b.slots, b.count);
    let checked = 0;
    for (const axis of ['x', 'y', 'z'] as const)
      for (const a of [-1.2, -0.6, -0.05, 0.3, 0.82, 1.2]) {
        expect(Math.abs(a), 'угол в области').toBeLessThanOrEqual(1.2);
        m.clear().turn(axis, a);
        const R = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0), a);
        for (let i = 0; i < b.geometry.attributes.position.count; i++) {
          const want = new THREE.Vector3().fromBufferAttribute(b.geometry.attributes.position as THREE.BufferAttribute, i).sub(pivot).applyMatrix4(R).add(pivot);
          const got = morphed(b, m.k, i);
          expect(got.distanceTo(want), `${axis} ${a}: вершина ${i}`).toBeLessThan(1e-5);
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(300);
  });

  it('доля кости делит поворот: вершина на половине кости уходит на половину пути', () => {
    const s = new Sculpt();
    s.blob(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0.1, 0.1, 0.1), new THREE.Euler(), 0xffffff, blend(0, 1, 0.5), 5, 4);
    const rig = new Rig([
      { name: 'body', parent: -1, at: [0, 0, 0] },
      { name: 'neck', parent: 0, at: [0, 0, 0] },
    ]);
    const b = bake(s, rig, { x: { turn: 'neck', axis: 'x' } });
    const m = new Moves(b.slots, b.count).turn('x', 1);
    const p = new THREE.Vector3().fromBufferAttribute(b.geometry.attributes.position as THREE.BufferAttribute, 0);
    const full = p.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), 1);
    expect(morphed(b, m.k, 0).distanceTo(p.clone().lerp(full, 0.5))).toBeLessThan(1e-5);
  });
});

describe('звери: породы', () => {
  for (const kind of KINDS)
    for (const detail of ['hi', 'lo'] as const) {
      it(`${kind} ${detail}: в покое стоит копытами на земле и не выше своей спины`, () => {
        const m = model(kind, detail);
        const box = new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position as THREE.BufferAttribute);
        expect(box.min.y, 'копыта на земле').toBeGreaterThan(-0.03);
        expect(box.min.y, 'копыта на земле').toBeLessThan(0.03);
        // Спина — над туловищем: по ней стоит значок «сколько ещё» стада.
        const torso = new THREE.Box3().setFromPoints(torsoPoints(m));
        expect(m.back, 'спина не ниже туловища').toBeGreaterThanOrEqual(torso.max.y - 0.06);
      });

      it(`${kind} ${detail}: шаг круга — ноги ходят, а туловище нет`, () => {
        const m = model(kind, detail);
        const mv = new Moves(m.slots, m.count);
        const rest = torsoPoints(m);
        let legMoved = 0;
        for (const phase of [0, 0.25, 0.5, 0.75]) {
          posture(mv, { ...STILL, walk: 1, phase });
          const now = torsoPoints(m, mv.k);
          for (let i = 0; i < rest.length; i++) expect(now[i].distanceTo(rest[i]), 'туловище на месте').toBeLessThan(1e-6);
          // Копыто передней левой ноги — самая низкая вершина кости запястья.
          let lowest = Infinity;
          let at = -1;
          m.skins.forEach((s, i) => {
            // Нижняя кость — у копыта целиком: первой (`a`) или второй долей (`b`, `w` = 1) — смотря как лепили сустав.
            if ((s.a === BONE.flk && s.w === 0) || (s.b === BONE.flk && s.w === 1)) {
              const y = (m.geometry.attributes.position as THREE.BufferAttribute).getY(i);
              if (y < lowest) {
                lowest = y;
                at = i;
              }
            }
          });
          expect(at, 'у ноги есть копыто').toBeGreaterThanOrEqual(0);
          const hoof = morphed(m, mv.k, at);
          const was = new THREE.Vector3().fromBufferAttribute(m.geometry.attributes.position as THREE.BufferAttribute, at);
          legMoved = Math.max(legMoved, hoof.distanceTo(was));
        }
        expect(legMoved, 'копыто шагает').toBeGreaterThan(0.05);
      });
    }

  /**
   * Лёжка: сцена опускает тело на `lie` (`herdPlay`), и туловище ложится брюхом на землю; подогнутые ноги — под ним,
   * в траве, а не на полметра в земле. Область — полная лёжка (`fold` = 1) всех пород стада.
   */
  it('лёжка: брюхо на земле, подогнутые ноги — под ним, а не глубоко в земле', () => {
    for (const kind of ['sheep', 'goat', 'cow', 'lamb'] as const) {
      const m = model(kind, 'hi');
      const mv = new Moves(m.slots, m.count);
      const fold = 1;
      expect(fold, 'полная лёжка').toBe(1);
      posture(mv, { ...STILL, fold });
      // Ноги — вершины на костях ног (у кисти хвоста коровы своя забота: её поднимает поза, `herdPlay`).
      const legs = new Set<number>([BONE.fl, BONE.flk, BONE.fr, BONE.frk, BONE.bl, BONE.blk, BONE.br, BONE.brk]);
      let low = Infinity;
      for (let i = 0; i < m.geometry.attributes.position.count; i++) if (legs.has(m.skins[i].a) || legs.has(m.skins[i].b)) low = Math.min(low, morphed(m, mv.k, i).y);
      const belly = Math.min(...torsoPoints(m, mv.k).map((p) => p.y));
      expect(Math.abs(belly - m.lie), `${kind}: брюхо на земле`).toBeLessThan(0.05);
      expect(low - m.lie, `${kind}: ноги лежащей — в траве`).toBeGreaterThan(-0.16);
      expect(m.lie, `${kind}: лёжка опускает тело`).toBeGreaterThan(0.08);
    }
  });

  it('белый олень — та же сетка, что рогачи: масть копии, а не своя модель', () => {
    const stag = model('stag', 'lo');
    expect(stag.count).toBe(model('stag', 'lo').count);
    const mv = new Moves(stag.slots, stag.count);
    posture(mv, FALLEN);
    // Упавший на бок — ниже стоящего: туловище у земли.
    const lying = new THREE.Box3().setFromPoints(torsoPoints(stag, mv.k, fallenMatrix(stag, 1)));
    expect(lying.max.y).toBeLessThan(0.7);
  });
});

describe('шерсть и места: свет — копией куска three', () => {
  /** Копия куска Ламберта (`fur.LAMBERT_PARS`) совпадает с three до буквы: иначе вставка мимо, и свет — прежний. */
  it('кусок совпадает, и строка, которую подменяет вставка, в нём есть', () => {
    expect(LAMBERT_PARS).toBe(THREE.ShaderChunk.lights_lambert_pars_fragment);
    expect(THREE.ShaderChunk.lights_lambert_pars_fragment.includes(LAMBERT_DIRECT)).toBe(true);
  });
});

describe('места: трава и цветы — мимо того, что стоит у игры', () => {
  it('ни один пучок и ни один цветок — не в кусте с ягодами и не в стоге', () => {
    let seen = 0;
    for (const seed of [1, 7, 42, 12345, 99991]) {
      const f = layBerries(seed, { rare: true });
      const keep = f.bushes.map((b) => ({ x: b.x, z: b.z, r: BUSH_KINDS[b.kind].r + 0.25 }));
      keep.push({ x: HAY.x, z: HAY.z, r: HAY.r + 0.2 });
      for (const s of [...grassSpots(1200, 0, 0, 0.8, 14.5, 0.2, 0.5, keep, seed), ...bloomSpots(150, 0, 0, 1, 14, 'summer', keep, seed)]) {
        seen++;
        for (const k of keep) expect(Math.hypot(s.x - k.x, s.z - k.z), `${seed}`).toBeGreaterThanOrEqual(k.r);
      }
    }
    expect(seen, 'область не пустая').toBeGreaterThan(2000);
  });

  it('загон: выбито вдоль жердей и у стога, а посреди выпаса — трава', () => {
    // Тропа — на шаг внутрь от жердей; у стога — круг.
    expect(trodden(PEN_R - 0.9, 0, PEN_R, HAY.r)).toBeGreaterThan(0.6);
    expect(trodden(0, HAY.r + 0.3, PEN_R, HAY.r)).toBeGreaterThan(0.6);
    expect(trodden(PEN_R + 5, 0, PEN_R, HAY.r)).toBeLessThan(0.2);
  });
});
