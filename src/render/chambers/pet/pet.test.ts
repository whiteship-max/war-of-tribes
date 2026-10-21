// Кот (ЛЦ-4, docs/characters.md): бюджет и устройство фигуры, лист, глаза, усы, клубок, живость ключами — числами, без
// WebGL; и что мозг кота с новой фигурой ходит теми же путями.
import { describe, expect, it } from 'vitest';
import { MAX_WEIGHTS, SkinBody } from '../kit/skin';
import { Cat, LID_CLOSE, catSkeleton, type CatBody, type CatState } from '../cat';
import { EYE_R, PX, SHEET, buildCatMesh, eyeAxis, eyeCenter } from './figure';
import { paintCat } from './coat';
import { BEST, CAT_IDS, CAT_LOOKS, catOf } from './looks';
import { CLIPS, CatMotion, PUPIL_LUX } from './motion';
import { makeCat, yarnMesh } from './index';
import * as THREE from 'three';

const look = CAT_LOOKS[BEST];
const m = buildCatMesh(look.head);
const names = m.sk.bones.map((b) => b.name);

/** Вершина лежит на прямоугольнике листа. */
const onSheet = (i: number, b: { x0: number; x1: number; y0: number; y1: number }): boolean => {
  const u = m.uv[i * 2] * PX;
  const v = m.uv[i * 2 + 1] * PX;
  return u >= b.x0 && u <= b.x1 && v >= b.y0 && v <= b.y1;
};

/** Плотность листа на треугольниках, чьи три вершины лежат на прямоугольнике: точек листа на метр (корень отношения площадей). */
function density(b: { x0: number; x1: number; y0: number; y1: number }, where: (p: readonly number[]) => boolean = () => true): number {
  let uvA = 0;
  let wA = 0;
  for (let t = 0; t < m.idx.length; t += 3) {
    const [a, c, d] = [m.idx[t], m.idx[t + 1], m.idx[t + 2]];
    if (![a, c, d].every((i) => onSheet(i, b) && where(m.at(i)))) continue;
    const P = [a, c, d].map((i) => m.at(i));
    const U = [a, c, d].map((i) => [m.uv[i * 2] * PX, m.uv[i * 2 + 1] * PX]);
    const e1 = P[1].map((x, k) => x - P[0][k]);
    const e2 = P[2].map((x, k) => x - P[0][k]);
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    wA += Math.hypot(cr[0], cr[1], cr[2]) / 2;
    uvA += Math.abs((U[1][0] - U[0][0]) * (U[2][1] - U[0][1]) - (U[2][0] - U[0][0]) * (U[1][1] - U[0][1])) / 2;
  }
  return Math.sqrt(uvA / wA);
}

/** Мозг с фигурой — состояние для живости. */
function state(over: Partial<CatState> & { body?: CatBody } = {}): CatState {
  const w = { stand: 0, walk: 0, sit: 0, curl: 0, crouch: 0, leap: 0, rub: 0, loaf: 0 };
  w[over.body ?? 'stand'] = 1;
  return { w, look: { body: over.body ?? 'stand', phase: 0, speed: 0, eyes: 1, mouth: 0, lookYaw: 0, lookPitch: 0, bat: 0, tailUp: 0, roll: 0 }, mind: 'wander', sleeping: false, wantYaw: 0, wantPitch: 0, ...over };
}

describe('кот: сетка и кости (ЛЦ-4)', () => {
  it('потолок треугольников: 600…1200 у каждого окраса; одна сетка на всех уровнях', () => {
    for (const id of CAT_IDS) {
      const t = buildCatMesh(CAT_LOOKS[id].head).triangles;
      expect(t, id).toBeGreaterThanOrEqual(600);
      expect(t, id).toBeLessThanOrEqual(1200);
    }
  });

  it('скелет: 20…26 костей — позвоночник 3, хвост 4, уши по одной, челюсть, лапы по три; мозг и фигура — один скелет', () => {
    expect(names.length).toBeGreaterThanOrEqual(20);
    expect(names.length).toBeLessThanOrEqual(26);
    expect(names.filter((n) => ['body', 'chest', 'pelvis'].includes(n))).toHaveLength(3);
    expect(names.filter((n) => /^tail\d$/.test(n))).toHaveLength(4);
    expect(names.filter((n) => /^ear[LR]$/.test(n))).toHaveLength(2);
    expect(names).toContain('jaw');
    for (const s of ['L', 'R']) for (const leg of [['arm', 'fore', 'paw'], ['thigh', 'hock', 'hpaw']]) for (const b of leg) expect(names, `${b}${s}`).toContain(`${b}${s}`);
    expect(catSkeleton().bones.map((b) => b.name)).toEqual(names);
  });

  it('на вершину не больше двух весов, и каждая кость держит хоть одну вершину', () => {
    expect(MAX_WEIGHTS).toBe(2);
    expect(m.b0.length).toBe(m.vertexCount);
    expect(m.b1.length).toBe(m.vertexCount);
    for (const w of m.w0) expect(w >= 0 && w <= 1).toBe(true);
    const used = new Set([...m.b0, ...m.b1.filter((_, i) => m.w0[i] < 1)]);
    for (let b = 0; b < names.length; b++) expect(used.has(b), names[b]).toBe(true);
  });
});

describe('кот: лист (ЛЦ-4)', () => {
  it('лист один, 512 × 512; морда — плотнее туловища (точек листа на метр)', () => {
    const img = paintCat(look);
    expect([img.w, img.h]).toEqual([512, 512]);
    // Морда — передняя половина головы ниже лба, без глаз (у них своя ячейка).
    const face = density(SHEET.head, (p) => p[2] > 0.215 && p[1] < 0.3);
    const body = density(SHEET.torso);
    expect(face / body, `морда ${face.toFixed(0)}, туловище ${body.toFixed(0)}`).toBeGreaterThan(1.5);
  });

  it('свет и тень нарисованы: спина светлее брюха, лоб светлее горла; узор у полосатых есть, у чёрно-белого — нет', () => {
    for (const id of CAT_IDS) {
      const img = paintCat(CAT_LOOKS[id]);
      const lum = (x: number, y: number): number => {
        let s = 0;
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            const c = img.get(x + dx, y + dy);
            s += 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
          }
        return s / 49;
      };
      const T = SHEET.torso;
      // У спины — светлее, чем у брюха того же окраса (`bib` у брюха светлит: сравниваем с боком под линией света).
      expect(lum(T.x0 + 60, 300), `${id}: спина светлее нижнего бока`).toBeGreaterThan(lum(T.x0 + 200, 300) * (CAT_LOOKS[id].marks.bib > 0.8 ? 0.6 : 1));
      // Полосы: разброс яркости вдоль туловища на одной высоте бока.
      const row: number[] = [];
      for (let y = T.y0 + 20; y < T.y1 - 20; y += 3) row.push(lum(T.x0 + 70, y));
      const spread = Math.max(...row) - Math.min(...row);
      if (CAT_LOOKS[id].marks.tabby > 0) expect(spread, `${id}: полосы`).toBeGreaterThan(0.12);
      else expect(spread, `${id}: без полос`).toBeLessThan(0.12);
    }
  });

  it('три окраса — шесть цветов каждый; флаг адреса выбирает окрас, иначе — лучший', () => {
    for (const id of CAT_IDS) expect(Object.keys(CAT_LOOKS[id].palette)).toHaveLength(6);
    expect(catOf('?cat=a')).toBe('a');
    expect(catOf('?cat=c')).toBe('c');
    expect(catOf('?cat=z')).toBe(BEST);
    expect(catOf(null)).toBe(BEST);
  });
});

describe('кот: глаза и усы (ЛЦ-4)', () => {
  it('зрачок: днём щель, в сумерках вполовину, ночью круглый; на пороге не дрожит; в игре — шире', () => {
    const mo = new CatMotion(1);
    const at = (lux: number, s = state()): number => {
      mo.lux = lux;
      mo.live({ turns: {}, lift: [0, 0, 0] }, s, 0);
      return mo.pupil;
    };
    expect(at(1)).toBe(0);
    expect(at(PUPIL_LUX[0] - 0.08)).toBe(1);
    expect(at(0.3)).toBe(2);
    // Чуть выше порога — ещё круглый (запас), заметно выше — снова вполовину.
    expect(at(PUPIL_LUX[1] + 0.02)).toBe(2);
    expect(at(PUPIL_LUX[1] + 0.06)).toBe(1);
    expect(at(1)).toBe(0);
    expect(at(1, state({ mind: 'play' }))).toBe(1);
  });

  it('веки: сомкнутые — на глазу, открытые — под лбом; мозг смыкает их по `look.eyes`', () => {
    const kit = makeCat({ look: BEST });
    const body = kit.body;
    const lids = m.sk.of('lids');
    const lidVerts = [...Array(m.vertexCount).keys()].filter((i) => m.b0[i] === lids && onSheet(i, SHEET.lid));
    const front = (sx: 1 | -1): number[] => eyeCenter(sx).map((c, k) => c + eyeAxis(sx)[k] * EYE_R);
    const nearest = (pos: Float32Array, p: number[]): number => Math.min(...lidVerts.map((i) => Math.hypot(pos[i * 3] - p[0], pos[i * 3 + 1] - p[1], pos[i * 3 + 2] - p[2])));
    const pose = (eyes: number): Float32Array => {
      const c = new Cat(1);
      c.dress(kit);
      c.poseAt(0, 0, 0, 0, 'stand');
      c.look.eyes = eyes;
      const q = c.pose();
      body.pose({ ...q, turns: { ...q.turns, lids: [LID_CLOSE * (1 - eyes), 0, 0] } });
      body.write();
      return body.positions();
    };
    for (const sx of [1, -1] as const) {
      expect(nearest(pose(0), front(sx)), 'сомкнуты — веко на глазу').toBeLessThan(0.003);
      expect(nearest(pose(1), front(sx)), 'открыты — веко далеко').toBeGreaterThan(0.01);
    }
    kit.dispose();
  });

  it('взгляд ведёт голову: мозг хочет к правителю — глаз туда раньше, во сне — прямо', () => {
    const mo = new CatMotion(2);
    mo.live({ turns: {}, lift: [0, 0, 0] }, state({ wantYaw: 0.8 }), 5);
    expect(mo.gaze[0]).toBeGreaterThan(0.002);
    mo.live({ turns: {}, lift: [0, 0, 0] }, state({ wantYaw: -0.8 }), 5.1);
    expect(mo.gaze[0]).toBeLessThan(-0.002);
    mo.live({ turns: {}, lift: [0, 0, 0] }, state({ wantYaw: 0.8, sleeping: true }), 5.2);
    expect(mo.gaze).toEqual([0, 0]);
  });

  it('усы — тонкие полоски с прозрачностью: у корня полупрозрачны, к концу — ноль; их грани — последними', () => {
    const fade = [...m.fade.entries()];
    expect(fade.length).toBe(2 * 3 * 3 * 2);
    expect(Math.max(...fade.map(([, a]) => a))).toBeLessThanOrEqual(0.75);
    expect(Math.min(...fade.map(([, a]) => a))).toBe(0);
    const whisker = new Set(fade.map(([i]) => i));
    const tris = m.idx.length / 3;
    const first = [...Array(tris).keys()].find((t) => whisker.has(m.idx[t * 3]))!;
    for (let t = first; t < tris; t++) expect(whisker.has(m.idx[t * 3]), `грань ${t}`).toBe(true);
    // Толщина — до 1,5 мм.
    for (let i = 0; i < fade.length; i += 2) {
      const a = m.at(fade[i][0]);
      const b = m.at(fade[i + 1][0]);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(0.0015);
    }
  });

  it('материал кота прозрачен (усы) и читает прозрачность вершин; у супруги и гонца — нет', () => {
    const kit = makeCat({ look: 'a' });
    const mat = kit.body.mesh.material as THREE.ShaderMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.defines.FADE).toBe(1);
    expect(kit.body.mesh.geometry.getAttribute('fade')).toBeDefined();
    kit.dispose();
  });
});

describe('кот: клубок (ЛЦ-4)', () => {
  it('клубок — одна кость; нитка — тонкая лента', () => {
    const y = yarnMesh();
    expect(y.sk.bones).toHaveLength(1);
    expect(y.triangles).toBeLessThanOrEqual(150);
    const fadeVerts = [...y.fade.keys()];
    expect(fadeVerts.length).toBeGreaterThan(0);
    const [a, b] = fadeVerts.map((i) => y.at(i));
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), 'ширина нитки').toBeLessThan(0.004);
    const body = new SkinBody(y, new THREE.MeshBasicMaterial(), 'yarn');
    expect(body.triangles).toBe(y.triangles);
    body.dispose();
  });
});

describe('кот: живость ключами (ЛЦ-4)', () => {
  const run = (mo: CatMotion, s: CatState, from: number, to: number, each?: (t: number, p: { turns: Record<string, [number, number, number]>; lift: [number, number, number] }) => void): void => {
    for (let t = from; t <= to; t += 1 / 30) {
      const p = { turns: {} as Record<string, [number, number, number]>, lift: [0, 0, 0] as [number, number, number] };
      mo.live(p, s, t);
      each?.(t, p);
    }
  };

  it('потянуться: встал с лежанки и стоит — передние вперёд, грудь к полу, зад и хвост вверх, зевок', () => {
    const mo = new CatMotion(3);
    run(mo, state({ mind: 'rest', body: 'curl', sleeping: true }), 0, 1);
    let arm = 0;
    let chest = 0;
    let jaw = 0;
    run(mo, state({ mind: 'wander', body: 'stand' }), 1.05, 1.15 + CLIPS.stretch.len, (_, p) => {
      arm = Math.min(arm, p.turns.armL?.[0] ?? 0);
      chest = Math.max(chest, p.turns.body?.[0] ?? 0);
      jaw = Math.max(jaw, p.turns.jaw?.[0] ?? 0);
    });
    expect(arm, 'передние вперёд').toBeLessThan(-0.9);
    expect(chest, 'грудь к полу').toBeGreaterThan(0.25);
    expect(jaw, 'зевок').toBeGreaterThan(0.5);
    expect(mo.playing('stretch'), 'клип кончился').toBe(false);
  });

  it('умываться: сидит — правая лапа к пасти; встал — клип гаснет', () => {
    const kit = makeCat({ look: BEST });
    const c = new Cat(1);
    c.dress(kit);
    c.poseAt(0, 0, 0, 0, 'sit');
    kit.motion.start('groom', 0);
    let best = 1;
    for (let i = 0; i < 40; i++) {
      // Время мозга идёт `step`-ом; клип читает его время.
      c.step(1 / 30, { ruler: { x: 3, z: 3, yaw: 0, busy: true }, ball: null });
      const q = c.pose();
      kit.body.pose(q);
      const paw = kit.body.at('pawR');
      const jaw = kit.body.at('jaw', [0, -0.004, 0.02]);
      best = Math.min(best, Math.hypot(paw[0] - jaw[0], paw[1] - jaw[1], paw[2] - jaw[2]));
    }
    expect(best, 'лапа у пасти').toBeLessThan(0.07);
    const mo = new CatMotion(4);
    mo.start('groom', 0);
    run(mo, state({ body: 'walk', look: { ...state().look, speed: 0.5 } }), 0.1, 0.2);
    expect(mo.playing('groom'), 'пошёл — бросил').toBe(false);
    kit.dispose();
  });

  it('сон клубком — бока дышат; уши и кончик хвоста дёргаются сами, во сне — чаще', () => {
    const count = (sleeping: boolean): { ear: number; tip: number; breath: number } => {
      const mo = new CatMotion(5);
      let ear = 0;
      let tip = 0;
      let lo = Infinity;
      let hi = -Infinity;
      let wasE = false;
      let wasT = false;
      run(mo, state({ mind: 'rest', body: sleeping ? 'curl' : 'sit', sleeping }), 0, 60, (_, p) => {
        const e = mo.playing('ear');
        const t = mo.playing('tip');
        if (e && !wasE) ear++;
        if (t && !wasT) tip++;
        wasE = e;
        wasT = t;
        const ch = p.turns.chest?.[0] ?? 0;
        lo = Math.min(lo, ch);
        hi = Math.max(hi, ch);
      });
      return { ear, tip, breath: hi - lo };
    };
    const asleep = count(true);
    const awake = count(false);
    expect(asleep.breath, 'дышит').toBeGreaterThan(0.03);
    expect(awake.ear, 'уши дёргаются и наяву').toBeGreaterThan(4);
    expect(awake.tip, 'кончик хвоста').toBeGreaterThan(4);
    expect(asleep.ear, 'во сне уши чаще').toBeGreaterThan(awake.ear);
  });
});

describe('кот: мозг прежний (ЛЦ-4)', () => {
  it('с фигурой и без неё мозг идёт той же дорогой: живость кидает свою кость', () => {
    const walk = (dressed: boolean): number[] => {
      const c = new Cat(7919);
      if (dressed) c.dress(makeCat({ look: BEST }));
      c.appear(0.8, 0.4, 0.6);
      const out: number[] = [];
      for (let i = 0; i < 60 * 40; i++) {
        c.step(1 / 60, { ruler: { x: 0, z: 1.2, yaw: Math.PI, busy: false }, ball: null });
        c.lookAt(0, 1.6, 1.2);
        c.draw([0, 0, 0]);
        if (i % 30 === 0) out.push(c.x, c.z, c.yaw);
      }
      return out;
    };
    expect(walk(true)).toEqual(walk(false));
  });
});
