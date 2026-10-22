// Служанка (ЛЦ-6, docs/characters.md): бюджет и устройство фигуры, пропорции, коса, фартук, поднос, листы, живость —
// числами, без WebGL.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { STILL, type Gesture } from '../folk';
import { MAX_WEIGHTS, SkinBody, type SkinMesh } from '../kit/skin';
import type { Img } from '../kit/paint';
import { buildConsortMesh, HEIGHT as WIFE_HEIGHT } from '../consort/figure';
import { HEAD as WIFE_HEAD } from '../consort/head';
import { LOOKS as WIFE_LOOKS, BEST as WIFE_BEST } from '../consort/looks';
import { paintFace as paintWifeFace } from '../consort/face';
import { APRON_A, HEAD_PART, apronPt, HEIGHT, SHEETS, SKIRT, TRAY, buildMaidMesh } from './figure';
import { paintMaidBody } from './cloth';
import { paintMaidFace } from './face';
import { headOf } from './head';
import { BEST, MAID_IDS, MAID_LOOKS, maidOf } from './looks';
import { CLIPS, MaidMotion } from './motion';
import { makeMaid } from './index';

const head = headOf(MAID_LOOKS[BEST].face);
const m = buildMaidMesh(head);

const onSheet = (mesh: SkinMesh, i: number, b: { x0?: number; x1?: number; y0: number; y1: number }): boolean => {
  if (mesh.sheet[i] !== 0) return false;
  const u = mesh.uv[i * 2] * 512;
  const v = mesh.uv[i * 2 + 1] * 512;
  return u >= (b.x0 ?? 0) && u <= (b.x1 ?? 512) && v >= b.y0 && v <= b.y1;
};
const vertsOn = (b: { x0?: number; x1?: number; y0: number; y1: number }): number[] => {
  const out: number[] = [];
  for (let i = 0; i < m.vertexCount; i++) if (onSheet(m, i, b)) out.push(i);
  return out;
};

/** Поставить сетку в позу живости и вернуть тело (оси фигуры). */
function posed(mo: MaidMotion, t: number, g: Gesture = STILL, walk = 0, phase = 0): SkinBody {
  const body = new SkinBody(m, new THREE.MeshBasicMaterial(), 'test');
  const p = mo.pose(t, phase, walk, g, g);
  body.pose({ x: 0, y: 0, z: 0, yaw: 0, lift: p.lift, turns: p.turns });
  body.write();
  return body;
}
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const at = (body: SkinBody, i: number): number[] => {
  const p = body.positions();
  return [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
};
/** Связность вершин по граням: сколько кусков. */
function pieces(verts: number[]): number {
  const parent = new Map(verts.map((v) => [v, v]));
  const find = (v: number): number => (parent.get(v) === v ? v : find(parent.get(v)!));
  for (let t = 0; t < m.idx.length; t += 3) {
    const tri = [m.idx[t], m.idx[t + 1], m.idx[t + 2]];
    if (!tri.every((v) => parent.has(v))) continue;
    for (const v of tri.slice(1)) parent.set(find(v), find(tri[0]));
  }
  return new Set(verts.map(find)).size;
}

describe('служанка: сетка и кости (ЛЦ-6)', () => {
  it('потолок треугольников: 1400…2000 у каждого облика', () => {
    for (const id of MAID_IDS) {
      const t = buildMaidMesh(headOf(MAID_LOOKS[id].face)).triangles;
      expect(t, id).toBeGreaterThanOrEqual(1400);
      expect(t, id).toBeLessThanOrEqual(2000);
    }
  });

  it('скелет: 15…20 костей, ног нет; коса и юбка — свои; на вершину не больше двух весов; каждая кость что-то держит', () => {
    const names = m.sk.bones.map((b) => b.name);
    expect(names.length).toBeGreaterThanOrEqual(15);
    expect(names.length).toBeLessThanOrEqual(20);
    for (const n of ['jaw', 'lids', 'braid', 'skirtF', 'skirtB', 'thumbL', 'thumbR']) expect(names, n).toContain(n);
    expect(names.filter((n) => /thigh|shin|foot|leg|knee/.test(n)), 'костей ног нет').toEqual([]);
    expect(MAX_WEIGHTS).toBe(2);
    expect(m.b0.length).toBe(m.vertexCount);
    for (const w of m.w0) expect(w >= 0 && w <= 1).toBe(true);
    const used = new Set<number>();
    for (let i = 0; i < m.vertexCount; i++) {
      used.add(m.b0[i]);
      if (m.w0[i] < 1) used.add(m.b1[i]);
    }
    for (let b = 0; b < names.length; b++) expect(used.has(b), `кость ${names[b]} пуста`).toBe(true);
  });

  it('юбка — открытый конус до пола: ниже фартука только кольцо подола, ни дна, ни ног', () => {
    const low: number[] = [];
    for (let i = 0; i < m.vertexCount; i++) if (m.at(i)[1] < 0.15) low.push(i);
    expect(low.length).toBe(16);
    const hem = SKIRT[SKIRT.length - 1];
    for (const i of low) {
      expect(onSheet(m, i, SHEETS.skirt), `вершина ${i}`).toBe(true);
      expect(Math.hypot(m.at(i)[0], m.at(i)[2] - hem.zc), `вершина ${i} у оси`).toBeGreaterThan(0.25);
      expect(m.at(i)[1]).toBeCloseTo(hem.y, 6);
    }
  });

  it('пропорции: голова с чепцом — 1/7 роста, рост 1,60 — ниже супруги', () => {
    let top = 0;
    let chin = Infinity;
    for (let i = 0; i < m.vertexCount; i++) {
      const p = m.at(i);
      top = Math.max(top, p[1]);
      if (m.sheet[i] === 1 && p[2] > 0.0 && m.shade[i] === 1) chin = Math.min(chin, p[1]);
    }
    expect(top).toBeCloseTo(HEIGHT, 3);
    expect(HEAD_PART).toBe(7);
    // Число задания, а не константа фигуры: та строит голову сама и с собой совпала бы всегда.
    expect(HEIGHT / (top - chin), 'голова — 1/7 роста').toBeGreaterThan(6.7);
    expect(HEIGHT / (top - chin)).toBeLessThan(7.3);
    const wife = buildConsortMesh();
    let wifeTop = 0;
    for (let i = 0; i < wife.vertexCount; i++) wifeTop = Math.max(wifeTop, wife.at(i)[1]);
    expect(wifeTop).toBeCloseTo(WIFE_HEIGHT, 2);
    expect(wifeTop - top, 'чуть ниже супруги: на 2–8 см').toBeGreaterThan(0.02);
    expect(wifeTop - top).toBeLessThan(0.08);
  });

  it('лицо — не супругино: круглее (шире к высоте у щёк и подбородка), нос короче', () => {
    // Ширина лица по высоте над подбородком к высоте лица (чертёжные меры маски — общие у обеих).
    const wide = (h: ReturnType<typeof headOf> | typeof WIFE_HEAD, y: number): number => h.surf(Math.PI / 2, y)[0] / h.TOP_H;
    for (const id of MAID_IDS) {
      const h = headOf(MAID_LOOKS[id].face);
      expect(wide(h, 0.06), `${id}: у подбородка`).toBeGreaterThan(wide(WIFE_HEAD, 0.06) * 1.15);
      expect(wide(h, 0.1), `${id}: у щёк`).toBeGreaterThan(wide(WIFE_HEAD, 0.1) * 1.03);
      // Нос: выступ спинки над переносицей (середина лица, высота 0,13) — ниже, чем у супруги.
      const bridge = (hh: ReturnType<typeof headOf> | typeof WIFE_HEAD): number => hh.spec.relief(0, 0.13).front;
      expect(bridge(h), `${id}: спинка носа`).toBeLessThan(bridge(WIFE_HEAD) * 0.75);
    }
  });

  it('коса — один кусок: из-под чепца у шеи, через плечо, кончик с лентой — на груди спереди', () => {
    const braid = vertsOn(SHEETS.braid);
    const tie = vertsOn(SHEETS.ribbon);
    expect(braid.length).toBeGreaterThan(60);
    expect(pieces([...braid, ...tie]), 'кусков косы').toBe(1);
    const ys = braid.map((i) => m.at(i)[1]);
    const top = braid[ys.indexOf(Math.max(...ys))];
    const low = braid[ys.indexOf(Math.min(...ys))];
    // Корень — сзади-сбоку у шеи, под чепцом; кончик — спереди на груди слева (+x), выше пояса.
    expect(m.at(top)[2], 'корень — за шеей').toBeLessThan(0.0);
    expect(m.at(low)[2], 'кончик — спереди').toBeGreaterThan(0.08);
    expect(m.at(low)[0], 'кончик — слева').toBeGreaterThan(0.03);
    expect(m.at(low)[1], 'кончик — на груди, выше пояса').toBeGreaterThan(0.98);
    expect(m.at(low)[1]).toBeLessThan(1.12);
  });

  it('фартук — спереди поверх юбки, от пояса почти до подола; сзади его нет', () => {
    const apron = vertsOn(SHEETS.apron);
    expect(apron.length).toBe(APRON_A.length * 5);
    for (const i of apron) {
      const p = m.at(i);
      const a = Math.atan2(p[0], p[2]);
      expect(Math.abs(a), `вершина ${i}: спереди`).toBeLessThan(1.2);
    }
    // Поверх юбки: у каждой вершины фартука ниже пояса — дальше от оси, чем юбка на той же высоте и угле.
    const skirt = vertsOn(SHEETS.skirt);
    for (const i of apron) {
      const p = m.at(i);
      if (p[1] > 0.9) continue;
      const near = skirt.filter((j) => Math.abs(m.at(j)[1] - p[1]) < 0.02 && Math.abs(Math.atan2(m.at(j)[0], m.at(j)[2]) - Math.atan2(p[0], p[2])) < 0.2);
      for (const j of near) expect(Math.hypot(p[0], p[2]), `вершина ${i} над юбкой ${j}`).toBeGreaterThan(Math.hypot(m.at(j)[0], m.at(j)[2]));
    }
    const ys = apron.map((i) => m.at(i)[1]);
    expect(Math.max(...ys)).toBeGreaterThan(0.93);
    expect(Math.min(...ys)).toBeLessThan(0.2);
  });

  it('поднос — на левой ладони: целиком на кисти, в стоянии и в шаге — ровно и над ладонью', () => {
    const tray = vertsOn(SHEETS.tray);
    const hand = m.sk.of('handL');
    expect(tray.length).toBeGreaterThan(30);
    for (const i of tray) expect([m.b0[i], m.w0[i]], `вершина ${i}`).toEqual([hand, 1]);
    for (const [walk, phase] of [
      [0, 0],
      [1, 0.8],
      [1, 2.4],
    ] as const) {
      const body = posed(new MaidMotion(m.sk, head.lidClose()), 2, STILL, walk, phase);
      const ys = tray.map((i) => at(body, i)[1]);
      // Ровно: перепад высоты по всему подносу (диаметр 0,28 м) — меньше 4 см.
      expect(Math.max(...ys) - Math.min(...ys), `шаг ${walk}: ровно`).toBeLessThan(TRAY.rim + 0.04);
      expect(Math.min(...ys), `шаг ${walk}: над ладонью`).toBeGreaterThan(body.at('handL')[1] - 0.03);
      expect(Math.min(...ys), `шаг ${walk}: у пояса`).toBeGreaterThan(0.9);
    }
  });
});

/** Шов зеркала: у края листа крайний столбец выбивается из ровного соседства (как у супруги, гонца и советника). */
function seams(img: Img, x: number, step: 1 | -1, y0: number, y1: number): number[] {
  const out: number[] = [];
  const d = (a: readonly number[], b: readonly number[]): number => Math.max(...[0, 1, 2].map((k) => Math.abs(a[k] - b[k])));
  for (let y = y0; y < y1; y++) {
    const row = [0, 1, 2, 3, 4, 5, 6].map((k) => img.get(x + step * k, y));
    const flat = Math.max(...row.slice(1).map((c) => d(c, row[1])));
    if (flat < 0.02 && d(row[0], row[1]) > 0.03) out.push(y);
  }
  return out;
}

describe('служанка: листы (ЛЦ-6)', () => {
  for (const id of MAID_IDS) {
    it(`облик ${id}: листы 512 × 512, шва на линии зеркала нет — ни на лице, ни на чепце, платье и юбке`, () => {
      const look = MAID_LOOKS[id];
      const face = paintMaidFace(look, headOf(look.face));
      const body = paintMaidBody(look);
      expect([face.w, face.h, body.w, body.h]).toEqual([512, 512, 512, 512]);
      expect(seams(face, 0, 1, 0, 512), 'лицо: середина').toEqual([]);
      for (const b of [SHEETS.coif, SHEETS.torso, SHEETS.skirt]) {
        expect(seams(body, 0, 1, b.y0, b.y1), `тело ${b.y0}: середина спереди`).toEqual([]);
        expect(seams(body, 511, -1, b.y0, b.y1), `тело ${b.y0}: середина сзади`).toEqual([]);
      }
    });
  }

  it('палитра облика — восемь цветов; облики — разные люди (палитра и лицо); облик по адресу', () => {
    for (const id of MAID_IDS) expect(Object.keys(MAID_LOOKS[id].palette).length, id).toBe(8);
    expect(new Set(MAID_IDS.map((id) => JSON.stringify(MAID_LOOKS[id].palette))).size).toBe(MAID_IDS.length);
    expect(new Set(MAID_IDS.map((id) => JSON.stringify(MAID_LOOKS[id].face))).size).toBe(MAID_IDS.length);
    expect(maidOf('?maid=c')).toBe('c');
    expect(maidOf('?maid=z')).toBe(BEST);
    expect(maidOf('')).toBe(BEST);
  });

  const lum = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  /** Средний перепад тона по сетке точек лица (метры лица): веснушки — частые тёмные точки на светлом. */
  const ripple = (img: Img, h: ReturnType<typeof headOf> | typeof WIFE_HEAD, x0: number, x1: number, h0: number, h1: number): number => {
    let s = 0;
    let n = 0;
    for (let y = h0; y <= h1; y += 0.003) {
      let prev: number | null = null;
      for (let X = x0; X <= x1; X += 0.0006) {
        const [px, py] = h.facePx(h.thetaAt(y, X), y);
        const v = lum(img.get(Math.round(px), Math.round(py)));
        if (prev !== null) {
          s += Math.abs(v - prev);
          n++;
        }
        prev = v;
      }
    }
    return s / n;
  };

  it('веснушки и румянец: на щеках — частые точки (у супруги в игре их нет), яблочки щёк — краснее лба', () => {
    const wife = paintWifeFace(WIFE_LOOKS[WIFE_BEST]);
    const wifeRipple = ripple(wife, WIFE_HEAD, 0.02, 0.06, 0.1, 0.125);
    for (const id of MAID_IDS) {
      const look = MAID_LOOKS[id];
      const h = headOf(look.face);
      const face = paintMaidFace(look, h);
      expect(ripple(face, h, 0.02, 0.06, 0.1, 0.125), `${id}: веснушки`).toBeGreaterThan(wifeRipple * 1.5);
      const px = (X: number, y: number): readonly number[] => {
        const [x, yy] = h.facePx(h.thetaAt(y, X), y);
        return face.get(Math.round(x), Math.round(yy));
      };
      const red = (c: readonly number[]): number => c[0] / Math.max(0.01, c[1]);
      expect(red(px(0.052, 0.094)), `${id}: румянец`).toBeGreaterThan(red(px(0.025, 0.176)) * 1.06);
    }
  });

  it('лицо и фартук — светлее платья (глаз сначала идёт к лицу и белому)', () => {
    for (const id of MAID_IDS) {
      const look = MAID_LOOKS[id];
      const h = headOf(look.face);
      const face = paintMaidFace(look, h);
      const body = paintMaidBody(look);
      const avg = (img: Img, b: { x0: number; x1: number; y0: number; y1: number }): number => {
        let s = 0;
        let n = 0;
        for (let x = b.x0 + 2; x < b.x1; x += 6)
          for (let y = b.y0 + 2; y < b.y1; y += 5) {
            s += lum(img.get(x, y));
            n++;
          }
        return s / n;
      };
      const [fx, fy] = h.facePx(h.thetaAt(0.1, 0.05), 0.1);
      const dress = avg(body, { x0: 40, x1: 512, y0: SHEETS.skirt.y0 + 10, y1: SHEETS.skirt.y1 - 10 });
      expect(lum(face.get(Math.round(fx), Math.round(fy))), `${id}: щека светлее платья`).toBeGreaterThan(dress + 0.15);
      expect(avg(body, SHEETS.apron), `${id}: фартук светлее платья`).toBeGreaterThan(dress + 0.3);
    }
  });
});

describe('служанка: живость (ЛЦ-6)', () => {
  const run = (mo: MaidMotion, s: number, g: Gesture = STILL, want: Gesture = STILL, walk = 0): { lids: number[]; jaw: number[]; gaze: number[]; clips: Set<string> } => {
    const lids: number[] = [];
    const jaw: number[] = [];
    const gaze: number[] = [];
    const clips = new Set<string>();
    for (let i = 0; i < s * 60; i++) {
      const t = i / 60;
      const p = mo.pose(t, t * 6, walk, g, want);
      lids.push(p.turns.lids?.[0] ?? 0);
      jaw.push(p.turns.jaw?.[0] ?? 0);
      gaze.push(mo.gaze[0]);
      if (mo.playing) clips.add(mo.playing);
    }
    return { lids, jaw, gaze, clips };
  };

  it('моргает раз в 3–6 с; взгляд ведёт голову; рот ходит при речи', () => {
    const mo = new MaidMotion(m.sk, head.lidClose());
    const { lids } = run(mo, 60);
    const closed: number[] = [];
    for (let i = 1; i < lids.length; i++) if (lids[i] > mo.closeLids * 0.9 && lids[i - 1] <= mo.closeLids * 0.9) closed.push(i / 60);
    expect(closed.length).toBeGreaterThanOrEqual(9);
    for (let i = 1; i < closed.length; i++) {
      expect(closed[i] - closed[i - 1]).toBeGreaterThanOrEqual(2.9);
      expect(closed[i] - closed[i - 1]).toBeLessThanOrEqual(6.4);
    }
    const { gaze } = run(new MaidMotion(m.sk, head.lidClose()), 0.5, STILL, { ...STILL, lookYaw: 0.8 });
    expect(Math.max(...gaze)).toBeGreaterThan(0.004);
    expect(Math.max(...run(new MaidMotion(m.sk, head.lidClose()), 3, { ...STILL, talk: 1 }).jaw)).toBeGreaterThan(0.05);
  });

  it('стоя сама по себе — поправляет фартук раз в 6–10 с; идёт, говорит, наливает — не поправляет', () => {
    const mo = new MaidMotion(m.sk, head.lidClose());
    const starts: number[] = [];
    let was: string | null = null;
    for (let i = 0; i < 60 * 60; i++) {
      mo.pose(i / 60, 0, 0, STILL, STILL);
      if (mo.playing && !was) starts.push(i / 60);
      was = mo.playing;
    }
    expect(starts.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i] - starts[i - 1] - CLIPS.apron.len;
      expect(gap, 'между клипами').toBeGreaterThanOrEqual(5.9);
      expect(gap).toBeLessThanOrEqual(10.1);
    }
    for (const [g, walk] of [
      [STILL, 1],
      [{ ...STILL, talk: 1 }, 0],
      [{ ...STILL, pour: 1 }, 0],
    ] as const)
      expect(run(new MaidMotion(m.sk, head.lidClose()), 30, g, STILL, walk).clips.size).toBe(0);
  });

  /** Ладонь: середина кисти — от запястья по пальцам (кисть — её −y). */
  const palm = (body: SkinBody, side: 'L' | 'R'): number[] => body.at(`hand${side}`, [0, -0.07, 0]);
  /** До поверхности фартука (в покое юбка не движется — поверхность по углу и высоте ладони). */
  const nearApron = (_: SkinBody, p: readonly number[]): number => {
    const a = Math.atan2(p[0], p[2]);
    return Math.abs(a) > APRON_A[APRON_A.length - 1] ? Infinity : dist(apronPt(a, p[1], 0.01), p);
  };

  it('поправить фартук: ладонь у фартука и идёт по нему вниз; в покое рука не у фартука', () => {
    const clipAt = (k: number): SkinBody => {
      const mo = new MaidMotion(m.sk, head.lidClose());
      mo.start('apron', 0);
      return posed(mo, k);
    };
    const a = clipAt(0.7);
    const b = clipAt(1.25);
    expect(nearApron(a, palm(a, 'R')), 'у фартука сверху').toBeLessThan(0.06);
    expect(nearApron(b, palm(b, 'R')), 'у фартука ниже').toBeLessThan(0.06);
    expect(palm(a, 'R')[1] - palm(b, 'R')[1], 'вниз по фартуку').toBeGreaterThan(0.08);
    const rest = new MaidMotion(m.sk, head.lidClose());
    rest.stop();
    const body = posed(rest, 1);
    expect(nearApron(body, palm(body, 'R')), 'в покое рука не у фартука').toBeGreaterThan(0.09);
  });

  it('налить: кувшин перед собой над кубком стоймя, наклон — носиком вперёд и вниз; в покое кувшин у бедра стоймя', () => {
    const kit = makeMaid({ look: BEST });
    const frame = (g: Gesture): ReturnType<typeof kit.jug> => {
      const p = kit.pose(2, 0, 0, g, g);
      kit.body.pose({ x: 0, y: 0, z: 0, yaw: 0, lift: p.lift, turns: p.turns });
      return kit.jug();
    };
    const rest = frame(STILL);
    expect(rest.up[1], 'в покое — стоймя').toBeGreaterThan(0.9);
    expect(rest.at[1], 'у бедра').toBeLessThan(0.85);
    const hold = frame({ ...STILL, pour: 1 });
    expect(hold.up[1], 'над кубком — стоймя').toBeGreaterThan(0.85);
    expect(hold.at[2], 'перед собой').toBeGreaterThan(0.3);
    expect(hold.at[1], 'выше стола').toBeGreaterThan(0.95);
    expect(hold.spout[2], 'носик — вперёд').toBeGreaterThan(0.7);
    const tip = frame({ ...STILL, pour: 1, tip: 1 });
    expect(tip.up[2], 'наклон — вперёд').toBeGreaterThan(0.5);
    expect(tip.spout[1], 'носик — вниз').toBeLessThan(-0.4);
    kit.dispose();
  });

  it('реверанс: опускается, голова вниз, правая придерживает юбку сбоку, поднос — ровно', () => {
    const mo = new MaidMotion(m.sk, head.lidClose());
    const stand = posed(mo, 2);
    const c = posed(new MaidMotion(m.sk, head.lidClose()), 2, { ...STILL, curtsy: 1 });
    expect(stand.at('hips')[1] - c.at('hips')[1], 'опустилась').toBeGreaterThan(0.06);
    expect(stand.at('lids')[1] - c.at('lids')[1], 'голова вниз').toBeGreaterThan(0.1);
    const hand = palm(c, 'R');
    expect(Math.abs(hand[0]), 'кисть сбоку').toBeGreaterThan(0.2);
    expect(hand[1], 'у юбки').toBeLessThan(0.8);
    const tray = vertsOn(SHEETS.tray).map((i) => at(c, i)[1]);
    expect(Math.max(...tray) - Math.min(...tray), 'поднос ровно').toBeLessThan(TRAY.rim + 0.06);
  });

  it('идти с подносом — скольжением: таз не скачет, юбка спереди толкается шагом, коса качается', () => {
    const mo = new MaidMotion(m.sk, head.lidClose());
    const ys: number[] = [];
    const skirt: number[] = [];
    const braid: number[] = [];
    for (let i = 0; i < 120; i++) {
      const p = mo.pose(i / 60, (i / 60) * 6, 1, STILL, STILL);
      ys.push(p.lift[1]);
      skirt.push(p.turns.skirtF?.[2] ?? 0);
      braid.push(p.turns.braid?.[0] ?? 0);
    }
    expect(Math.max(...ys) - Math.min(...ys), 'таз плывёт ровно').toBeLessThan(0.012);
    expect(Math.max(...skirt) - Math.min(...skirt), 'юбка — шагом').toBeGreaterThan(0.05);
    expect(Math.max(...braid) - Math.min(...braid), 'коса качается').toBeGreaterThan(0.05);
  });
});
