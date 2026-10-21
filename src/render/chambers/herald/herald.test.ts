// Гонец (ЛЦ-3, docs/characters.md): бюджет и устройство фигуры, пропорции, листы, живость — числами, без WebGL.
import { describe, expect, it } from 'vitest';
import { STILL, liveryOf, type Gesture } from '../folk';
import { DEFAULT_ARMS } from '@/heraldry/arms';
import { MAX_WEIGHTS, SkinBody } from '../kit/skin';
import type { Img } from '../kit/paint';
import { HEAD as WIFE } from '../consort/head';
import { HEIGHT, HEAD_PART, LEG, SHEETS, TUNIC, buildHeraldMesh } from './figure';
import { paintHeraldBody } from './cloth';
import { paintHeraldFace } from './face';
import { headOf } from './head';
import { BEST, HERALD_IDS, HERALD_LOOKS } from './looks';
import { HeraldMotion } from './motion';
import * as THREE from 'three';

const head = headOf(HERALD_LOOKS[BEST].face);
const m = buildHeraldMesh(head);

/** Вершины, лежащие на прямоугольнике листа тела. */
const onSheet = (i: number, b: { x0: number; x1: number; y0: number; y1: number }): boolean => {
  if (m.sheet[i] !== 0) return false;
  const u = m.uv[i * 2] * 512;
  const v = m.uv[i * 2 + 1] * 512;
  return u >= b.x0 && u <= b.x1 && v >= b.y0 && v <= b.y1;
};

describe('гонец: сетка и кости (ЛЦ-3)', () => {
  it('потолок треугольников: 1000…1800 у каждого облика', () => {
    for (const id of HERALD_IDS) {
      const t = buildHeraldMesh(headOf(HERALD_LOOKS[id].face)).triangles;
      expect(t, id).toBeGreaterThanOrEqual(1000);
      expect(t, id).toBeLessThanOrEqual(1800);
    }
  });

  it('скелет: 18…24 кости, ноги, плащ и сума свои; на вершину не больше двух весов', () => {
    const names = m.sk.bones.map((b) => b.name);
    expect(names.length).toBeGreaterThanOrEqual(18);
    expect(names.length).toBeLessThanOrEqual(24);
    for (const n of ['jaw', 'lids', 'thumbL', 'thumbR', 'thighL', 'shinR', 'footL', 'cloak', 'bag']) expect(names, n).toContain(n);
    expect(MAX_WEIGHTS).toBe(2);
    expect(m.b0.length).toBe(m.vertexCount);
    expect(m.b1.length).toBe(m.vertexCount);
    for (const w of m.w0) expect(w >= 0 && w <= 1).toBe(true);
  });

  it('ноги — только ниже туники: чулок начинается под подолом, кости ног держат лишь низ туники', () => {
    const hem = TUNIC[TUNIC.length - 1].y;
    const legBones = new Set(['thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR'].map((n) => m.sk.of(n)));
    let top = 0;
    for (let i = 0; i < m.vertexCount; i++) {
      if (onSheet(i, SHEETS.leg) || onSheet(i, SHEETS.foot)) top = Math.max(top, m.at(i)[1]);
      // Вершина на кости ноги — либо сама нога, либо подол туники ниже пояса.
      if (legBones.has(m.b0[i]) || (legBones.has(m.b1[i]) && m.w0[i] < 1)) expect(m.at(i)[1], `вершина ${i}`).toBeLessThan(0.9);
    }
    // Верх чулка — под туникой, но не выше её середины бедра: ног выше подола не строим.
    expect(top).toBe(LEG.hose[0]);
    expect(top - hem).toBeLessThan(0.12);
  });

  it('пропорции: голова 1/7,5 роста, плечи в 2,5 раза шире головы, шея плотная', () => {
    let top = 0;
    let chin = Infinity;
    let headW = 0;
    for (let i = 0; i < m.vertexCount; i++) {
      const p = m.at(i);
      top = Math.max(top, p[1]);
      if (m.sheet[i] === 1 && p[2] > 0.0 && m.shade[i] === 1) chin = Math.min(chin, p[1]);
      // Ширина головы — маска и шапка волос (без ушей).
      if ((m.sheet[i] === 1 && m.uv[i * 2] * 512 < 384) || onSheet(i, { x0: 0, x1: 512, y0: SHEETS.cap.y0, y1: SHEETS.cap.y1 })) headW = Math.max(headW, Math.abs(p[0]));
    }
    expect(top).toBeCloseTo(HEIGHT, 3);
    const h = top - chin;
    expect(HEIGHT / h, 'голова — 1/7,5 роста').toBeGreaterThan(HEAD_PART - 0.3);
    expect(HEIGHT / h).toBeLessThan(HEAD_PART + 0.3);
    // Плечи — по внешнему краю на высоте плечевого сустава (туника и плащ, без рук).
    const sy = m.sk.bones[m.sk.of('armL')].j[1];
    let shoulder = 0;
    let neck = 0;
    for (let i = 0; i < m.vertexCount; i++) {
      const p = m.at(i);
      const body = onSheet(i, { x0: 0, x1: 512, y0: SHEETS.tunic.y0, y1: SHEETS.hood.y1 });
      if (body && Math.abs(p[1] - sy) < 0.04) shoulder = Math.max(shoulder, Math.abs(p[0]));
      if (onSheet(i, { x0: 0, x1: 512, y0: SHEETS.tunic.y0, y1: SHEETS.tunic.y1 }) && p[1] > 1.47 && p[1] < 1.5) neck = Math.max(neck, Math.abs(p[0]));
    }
    expect(shoulder / headW, 'плечи — 2,5 ширины головы').toBeGreaterThan(2.4);
    expect(shoulder / headW).toBeLessThan(2.6);
    expect(neck / headW, 'шея плотная — две трети головы').toBeGreaterThan(0.6);
    expect(neck / headW).toBeLessThan(0.8);
  });

  it('челюсть и надбровье сильнее, чем у супруги', () => {
    const jaw = (h: ReturnType<typeof headOf>): number => Math.abs(h.surf(1.2, 0.03)[0]) / Math.abs(h.surf(1.2, 0.14)[0]);
    expect(jaw(head), 'челюсть шире к скулам').toBeGreaterThan(jaw(WIFE) + 0.05);
    const brow = (h: ReturnType<typeof headOf>): number => Math.max(...[0.155, 0.16, 0.165, 0.17].map((y) => h.spec.relief(0.42, y).front));
    expect(brow(head), 'надбровье выступает сильнее').toBeGreaterThan(brow(WIFE) * 1.15);
  });
});

/** Шов зеркала: у края листа крайний столбец выбивается из ровного соседства (как у супруги). */
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

describe('гонец: листы (ЛЦ-3)', () => {
  for (const id of HERALD_IDS) {
    it(`облик ${id}: листы 512 × 512, шва на линии зеркала нет — ни на лице, ни на волосах, тунике, плаще и капюшоне`, () => {
      const look = HERALD_LOOKS[id];
      const face = paintHeraldFace(look, headOf(look.face));
      const body = paintHeraldBody(look);
      expect([face.w, face.h, body.w, body.h]).toEqual([512, 512, 512, 512]);
      expect(seams(face, 0, 1, 0, 512), 'лицо: середина').toEqual([]);
      expect(seams(body, 0, 1, 0, SHEETS.hood.y1), 'тело: середина спереди').toEqual([]);
      expect(seams(body, 511, -1, 0, SHEETS.hood.y1), 'тело: середина сзади').toEqual([]);
    });
  }

  it('палитра облика — семь цветов; облики — разные люди (палитра и лицо)', () => {
    for (const id of HERALD_IDS) expect(Object.keys(HERALD_LOOKS[id].palette).length, id).toBe(7);
    expect(new Set(HERALD_IDS.map((id) => JSON.stringify(HERALD_LOOKS[id].palette))).size).toBe(HERALD_IDS.length);
    expect(new Set(HERALD_IDS.map((id) => JSON.stringify(HERALD_LOOKS[id].face))).size).toBe(HERALD_IDS.length);
  });

  it('в игре туника — цвета герба: ливрея меняет тунику, лица не трогает', () => {
    const look = HERALD_LOOKS[BEST];
    const lv = liveryOf(DEFAULT_ARMS);
    const own = paintHeraldBody(look);
    const realm = paintHeraldBody(look, lv);
    const at = (img: Img): readonly number[] => img.get(60, SHEETS.tunic.y0 + 80);
    const hexRgb = (v: number): number[] => [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => c / 255);
    const dist = (a: readonly number[], b: number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(dist(at(realm), hexRgb(lv.body)), 'туника — к цвету ливреи').toBeLessThan(dist(at(realm), hexRgb(look.palette.tunic)));
    expect(dist(at(own), hexRgb(look.palette.tunic))).toBeLessThan(dist(at(own), hexRgb(lv.body)));
  });

  it('лицо — светлее туники, плаща и сапог (глаз сначала идёт к лицу)', () => {
    const lum = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    for (const id of HERALD_IDS) {
      const look = HERALD_LOOKS[id];
      const h = headOf(look.face);
      const face = paintHeraldFace(look, h);
      const body = paintHeraldBody(look);
      const at = (x: number, y: number): number => {
        const [px, py] = h.facePx(h.thetaAt(y, x), y);
        return lum(face.get(Math.round(px), Math.round(py)));
      };
      const light = Math.max(at(0.012, 0.2), at(0.06, 0.12), at(0.001, 0.12));
      const avg = (b: { x0: number; x1: number; y0: number; y1: number }): number => {
        let s = 0;
        let n = 0;
        for (let x = b.x0 + 2; x < b.x1; x += 6)
          for (let y = b.y0 + 2; y < b.y1; y += 5) {
            s += lum(body.get(x, y));
            n++;
          }
        return s / n;
      };
      for (const [name, b] of [
        ['туника', { x0: 0, x1: 512, y0: SHEETS.tunic.y0 + 40, y1: SHEETS.tunic.y1 }],
        ['плащ', { x0: 300, x1: 512, y0: SHEETS.cloak.y0, y1: SHEETS.cloak.y1 }],
        ['сапог', { x0: SHEETS.leg.x0, x1: SHEETS.leg.x1, y0: 440, y1: 512 }],
      ] as const)
        expect(light, `${id}: лицо светлее, чем ${name}`).toBeGreaterThan(avg(b));
    }
  });
});

describe('гонец: живость (ЛЦ-3)', () => {
  const run = (mo: HeraldMotion, s: number, g: Gesture = STILL, want: Gesture = STILL, walk = 0): { lids: number[]; jaw: number[]; gaze: number[]; chest: number[] } => {
    const lids: number[] = [];
    const jaw: number[] = [];
    const gaze: number[] = [];
    const chest: number[] = [];
    for (let i = 0; i < s * 60; i++) {
      const t = i / 60;
      const p = mo.pose(t, t * 6, walk, g, want);
      lids.push(p.turns.lids?.[0] ?? 0);
      jaw.push(p.turns.jaw?.[0] ?? 0);
      gaze.push(mo.gaze[0]);
      chest.push(p.turns.chest?.[0] ?? 0);
    }
    return { lids, jaw, gaze, chest };
  };
  const span = (a: number[]): number => Math.max(...a) - Math.min(...a);

  it('моргает раз в 3–6 с', () => {
    const mo = new HeraldMotion(m.sk, head.lidClose());
    const { lids } = run(mo, 60);
    const closed: number[] = [];
    for (let i = 1; i < lids.length; i++) if (lids[i] > mo.closeLids * 0.9 && lids[i - 1] <= mo.closeLids * 0.9) closed.push(i / 60);
    expect(closed.length).toBeGreaterThanOrEqual(9);
    for (let i = 1; i < closed.length; i++) {
      expect(closed[i] - closed[i - 1]).toBeGreaterThanOrEqual(2.9);
      expect(closed[i] - closed[i - 1]).toBeLessThanOrEqual(6.4);
    }
  });

  it('взгляд ведёт голову; рот ходит при речи; молча и отдышавшись — почти закрыт', () => {
    const { gaze } = run(new HeraldMotion(m.sk, head.lidClose()), 0.5, STILL, { ...STILL, lookYaw: 0.8 });
    expect(Math.max(...gaze)).toBeGreaterThan(0.004);
    const talk = run(new HeraldMotion(m.sk, head.lidClose()), 3, { ...STILL, talk: 1 }).jaw;
    expect(Math.max(...talk)).toBeGreaterThan(0.05);
    const calm = new HeraldMotion(m.sk, head.lidClose());
    calm.winded = 0;
    expect(Math.max(...run(calm, 3).jaw)).toBeLessThan(0.002);
  });

  it('отдышка после дороги: с порога грудь ходит чаще и глубже, за полминуты на месте — успокаивается', () => {
    const mo = new HeraldMotion(m.sk, head.lidClose());
    const all = run(mo, 50).chest;
    const first = all.slice(0, 5 * 60);
    const later = all.slice(42 * 60, 47 * 60);
    expect(span(first), 'глубже').toBeGreaterThan(span(later) * 1.8);
    const crossings = (a: number[]): number => a.reduce((n, v, i) => n + (i > 0 && Math.sign(v - 0) !== Math.sign(a[i - 1] - 0) ? 1 : 0), 0);
    expect(crossings(first), 'чаще').toBeGreaterThan(crossings(later) * 1.5);
    expect(mo.winded).toBe(0);
  });

  it('шаг: ноги идут враскачку, плащ отлетает назад; поклон: спина вперёд, правая — к сердцу', () => {
    const mo = new HeraldMotion(m.sk, head.lidClose());
    const a = mo.pose(1, 0.5 * Math.PI, 1, STILL, STILL);
    const b = mo.pose(1.2, 1.5 * Math.PI, 1, STILL, STILL);
    expect(Math.sign(a.turns.thighL[0])).toBe(-Math.sign(b.turns.thighL[0]));
    expect(Math.sign(a.turns.thighL[0])).toBe(-Math.sign(a.turns.thighR[0]));
    expect(a.turns.cloak[0], 'плащ назад').toBeGreaterThan(0.1);
    const body = new SkinBody(m, new THREE.MeshBasicMaterial(), 'test');
    const bow = mo.pose(2, 0, 0, { ...STILL, bow: 1 }, STILL);
    body.pose({ x: 0, y: 0, z: 0, yaw: 0, lift: bow.lift, turns: bow.turns });
    expect(bow.turns.spine[0], 'спина вперёд').toBeGreaterThan(0.2);
    const hand = body.at('handR');
    const chest = body.at('chest', [0.05, 0.05, 0.1]);
    expect(Math.hypot(hand[0] - chest[0], hand[1] - chest[1], hand[2] - chest[2]), 'кисть у сердца').toBeLessThan(0.14);
  });

  it('вручить: правая кисть вперёд на высоте груди, пальцы — к правителю (лист письма лицом к нему)', () => {
    const mo = new HeraldMotion(m.sk, head.lidClose());
    mo.winded = 0;
    const g = { ...STILL, offer: 1 };
    const p = mo.pose(3, 0, 0, g, g);
    const body = new SkinBody(m, new THREE.MeshBasicMaterial(), 'test');
    body.pose({ x: 0, y: 0, z: 0, yaw: 0, lift: p.lift, turns: p.turns });
    const w = body.at('handR');
    expect(w[2], 'вперёд').toBeGreaterThan(0.3);
    expect(w[1], 'на высоте груди').toBeGreaterThan(1.15);
    expect(w[1]).toBeLessThan(1.4);
    // Пальцы кисти — её −y (`life.paper`: лист поперёк пальцев, лицом туда, куда пальцы).
    const R = body.axes('handR');
    expect(-R[5], 'пальцы — к правителю').toBeGreaterThan(0.75);
    // И большой палец (её +z) — вверх: лист стоймя.
    expect(R[7], 'большой палец вверх').toBeGreaterThan(0.5);
  });
});
