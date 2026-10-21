// Советник (ЛЦ-5, docs/characters.md): бюджет и устройство фигуры, пропорции, борода, листы, живость — числами, без WebGL.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { STILL, type Gesture } from '../folk';
import { MAX_WEIGHTS, SkinBody, type SkinMesh } from '../kit/skin';
import type { Img } from '../kit/paint';
import { buildHeraldMesh } from '../herald/figure';
import { headOf as heraldHead } from '../herald/head';
import { HERALD_LOOKS, BEST as HERALD_BEST } from '../herald/looks';
import { paintHeraldFace } from '../herald/face';
import { HEAD_PART, HEIGHT, ROBE, SHEETS, buildAdvisorMesh } from './figure';
import { paintAdvisorBody } from './cloth';
import { paintAdvisorFace } from './face';
import { headOf } from './head';
import { ADVISOR_IDS, ADVISOR_LOOKS, BEST, advisorOf } from './looks';
import { AdvisorMotion, CLIPS, STOOP } from './motion';

const head = headOf(ADVISOR_LOOKS[BEST].face);
const m = buildAdvisorMesh(head);

/** Вершины, лежащие на прямоугольнике листа тела. */
const onSheet = (mesh: SkinMesh, i: number, b: { x0?: number; x1?: number; y0: number; y1: number }): boolean => {
  if (mesh.sheet[i] !== 0) return false;
  const u = mesh.uv[i * 2] * 512;
  const v = mesh.uv[i * 2 + 1] * 512;
  return u >= (b.x0 ?? 0) && u <= (b.x1 ?? 512) && v >= b.y0 && v <= b.y1;
};

/** Поставить сетку в позу живости и вернуть тело (оси фигуры). */
function posed(mo: AdvisorMotion, t: number, g: Gesture = STILL, walk = 0, phase = 0): SkinBody {
  const body = new SkinBody(m, new THREE.MeshBasicMaterial(), 'test');
  const p = mo.pose(t, phase, walk, g, g);
  body.pose({ x: 0, y: 0, z: 0, yaw: 0, lift: p.lift, turns: p.turns });
  return body;
}
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('советник: сетка и кости (ЛЦ-5)', () => {
  it('потолок треугольников: 1400…2000 у каждого облика', () => {
    for (const id of ADVISOR_IDS) {
      const t = buildAdvisorMesh(headOf(ADVISOR_LOOKS[id].face)).triangles;
      expect(t, id).toBeGreaterThanOrEqual(1400);
      expect(t, id).toBeLessThanOrEqual(2000);
    }
  });

  it('скелет: 15…20 костей, ног нет; борода и подол — свои; на вершину не больше двух весов; каждая кость что-то держит', () => {
    const names = m.sk.bones.map((b) => b.name);
    expect(names.length).toBeGreaterThanOrEqual(15);
    expect(names.length).toBeLessThanOrEqual(20);
    for (const n of ['jaw', 'lids', 'beard', 'hemL', 'hemR', 'thumbL', 'thumbR']) expect(names, n).toContain(n);
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

  it('мантия — открытый конус до пола: у пола только кольцо подола, ни дна, ни ног', () => {
    const low: number[] = [];
    for (let i = 0; i < m.vertexCount; i++) if (m.at(i)[1] < 0.3) low.push(i);
    // Ниже колен — одно кольцо подола (16 углов), все — на листе мантии и далеко от оси (ни дна, ни ног внутри).
    expect(low.length).toBe(16);
    for (const i of low) {
      expect(onSheet(m, i, SHEETS.robe), `вершина ${i}`).toBe(true);
      expect(Math.hypot(m.at(i)[0], m.at(i)[2] - ROBE[ROBE.length - 1].zc), `вершина ${i} у оси`).toBeGreaterThan(0.18);
      expect(m.at(i)[1]).toBeCloseTo(ROBE[ROBE.length - 1].y, 6);
    }
  });

  it('борода — один кусок на одной кости', () => {
    const beard = m.sk.of('beard');
    const verts: number[] = [];
    for (let i = 0; i < m.vertexCount; i++) {
      const on = onSheet(m, i, SHEETS.beard);
      const held = m.b0[i] === beard || (m.b1[i] === beard && m.w0[i] < 1);
      expect(held, `вершина ${i}: на листе бороды — значит на кости бороды`).toBe(on);
      if (on) {
        expect([m.b0[i], m.b1[i], m.w0[i]], `вершина ${i}: один вес`).toEqual([beard, beard, 1]);
        verts.push(i);
      }
    }
    // Связность: грани бороды соединяют все её вершины в один кусок.
    const parent = new Map(verts.map((v) => [v, v]));
    const find = (v: number): number => (parent.get(v) === v ? v : find(parent.get(v)!));
    for (let t = 0; t < m.idx.length; t += 3) {
      const tri = [m.idx[t], m.idx[t + 1], m.idx[t + 2]];
      if (!tri.every((v) => parent.has(v))) continue;
      for (const v of tri.slice(1)) parent.set(find(v), find(tri[0]));
    }
    expect(new Set(verts.map(find)).size, 'кусков бороды').toBe(1);
    expect(verts.length).toBeGreaterThan(40);
  });

  it('пропорции: голова — 1/7 роста, плечи уже, чем у гонца, спина сутулая (голова впереди таза)', () => {
    let top = 0;
    let chin = Infinity;
    let headW = 0;
    for (let i = 0; i < m.vertexCount; i++) {
      const p = m.at(i);
      top = Math.max(top, p[1]);
      if (m.sheet[i] === 1 && p[2] > 0.0 && m.shade[i] === 1) chin = Math.min(chin, p[1]);
      if ((m.sheet[i] === 1 && m.uv[i * 2] * 512 < 384) || onSheet(m, i, SHEETS.cap)) headW = Math.max(headW, Math.abs(p[0]));
    }
    expect(top).toBeCloseTo(HEIGHT, 3);
    // Голова — 1/7 роста по заданию (число задания, а не константа фигуры: та строит голову сама и с собой совпала бы всегда).
    expect(HEAD_PART).toBe(7);
    expect(HEIGHT / (top - chin), 'голова — 1/7 роста').toBeGreaterThan(6.7);
    expect(HEIGHT / (top - chin)).toBeLessThan(7.3);
    // Плечи — по внешнему краю на высоте плечевого сустава (мантия, ворот и рукава, без кистей); у гонца — так же.
    const shoulders = (mesh: SkinMesh, hands: { y0: number; y1: number; x0: number; x1: number }): number => {
      const sy = mesh.sk.bones[mesh.sk.of('armL')].j[1];
      let w = 0;
      for (let i = 0; i < mesh.vertexCount; i++) if (Math.abs(mesh.at(i)[1] - sy) < 0.04 && !onSheet(mesh, i, hands) && mesh.sheet[i] === 0) w = Math.max(w, Math.abs(mesh.at(i)[0]));
      return w;
    };
    const herald = buildHeraldMesh(heraldHead(HERALD_LOOKS[HERALD_BEST].face));
    const mine = shoulders(m, SHEETS.hand);
    const his = shoulders(herald, { x0: 160, x1: 320, y0: 416, y1: 512 });
    expect(mine, 'плечи уже, чем у гонца').toBeLessThan(his - 0.005);
    expect(mine / headW, 'плечи — не шире 2,4 головы').toBeLessThan(2.4);
    // Сутулость: в позе стояния голова впереди таза, грудь наклонена вперёд.
    const mo = new AdvisorMotion(m.sk, head.lidClose());
    const body = posed(mo, 2);
    expect(body.at('head')[2] - body.at('hips')[2], 'голова впереди таза').toBeGreaterThan(0.04);
    expect(STOOP.chest).toBeGreaterThan(0.08);
  });

  it('лицо старше гонца: на лбу и у глаз — морщины (перепады тона), у гонца их нет', () => {
    const lum = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    // Средний перепад тона по строкам листа в зоне (метры лица): морщина — борозда и свет под ней.
    const ripple = (img: Img, h: ReturnType<typeof headOf>, x0: number, x1: number, h0: number, h1: number): number => {
      let s = 0;
      let n = 0;
      for (let X = x0; X <= x1; X += 0.004) {
        let prev: number | null = null;
        for (let y = h0; y <= h1; y += 0.0012) {
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
    const hh = heraldHead(HERALD_LOOKS[HERALD_BEST].face);
    const his = paintHeraldFace(HERALD_LOOKS[HERALD_BEST], hh);
    for (const id of ADVISOR_IDS) {
      const look = ADVISOR_LOOKS[id];
      const h = headOf(look.face);
      const face = paintAdvisorFace(look, h);
      // Лоб — ниже линии волос гонца (её край у него с 0,2 м: волосы дали бы перепад тона сами).
      expect(ripple(face, h, 0.006, 0.05, 0.184, 0.2), `${id}: лоб`).toBeGreaterThan(ripple(his, hh, 0.006, 0.05, 0.184, 0.2) * 2);
      expect(ripple(face, h, 0.064, 0.076, 0.128, 0.152), `${id}: у глаз`).toBeGreaterThan(ripple(his, hh, 0.064, 0.076, 0.128, 0.152) * 1.5);
    }
  });
});

/** Шов зеркала: у края листа крайний столбец выбивается из ровного соседства (как у супруги и гонца). */
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

describe('советник: листы (ЛЦ-5)', () => {
  for (const id of ADVISOR_IDS) {
    it(`облик ${id}: листы 512 × 512, шва на линии зеркала нет — ни на лице, ни на волосах, бороде, мантии и вороте`, () => {
      const look = ADVISOR_LOOKS[id];
      const face = paintAdvisorFace(look, headOf(look.face));
      const body = paintAdvisorBody(look);
      expect([face.w, face.h, body.w, body.h]).toEqual([512, 512, 512, 512]);
      expect(seams(face, 0, 1, 0, 512), 'лицо: середина').toEqual([]);
      expect(seams(body, 0, 1, 0, SHEETS.collar.y1), 'тело: середина спереди').toEqual([]);
      expect(seams(body, 511, -1, 0, SHEETS.collar.y1), 'тело: середина сзади').toEqual([]);
    });
  }

  it('палитра облика — восемь цветов; облики — разные люди (палитра и лицо); облик по адресу', () => {
    for (const id of ADVISOR_IDS) expect(Object.keys(ADVISOR_LOOKS[id].palette).length, id).toBe(8);
    expect(new Set(ADVISOR_IDS.map((id) => JSON.stringify(ADVISOR_LOOKS[id].palette))).size).toBe(ADVISOR_IDS.length);
    expect(new Set(ADVISOR_IDS.map((id) => JSON.stringify(ADVISOR_LOOKS[id].face))).size).toBe(ADVISOR_IDS.length);
    expect(advisorOf('?advisor=c')).toBe('c');
    expect(advisorOf('?advisor=z')).toBe(BEST);
    expect(advisorOf('')).toBe(BEST);
  });

  it('лицо — светлее мантии (глаз сначала идёт к лицу)', () => {
    const lum = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    for (const id of ADVISOR_IDS) {
      const look = ADVISOR_LOOKS[id];
      const h = headOf(look.face);
      const face = paintAdvisorFace(look, h);
      const body = paintAdvisorBody(look);
      const at = (x: number, y: number): number => {
        const [px, py] = h.facePx(h.thetaAt(y, x), y);
        return lum(face.get(Math.round(px), Math.round(py)));
      };
      const light = Math.max(at(0.02, 0.21), at(0.07, 0.122), at(0.001, 0.12));
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
      expect(light, `${id}: лицо светлее мантии`).toBeGreaterThan(avg({ x0: 40, x1: 512, y0: SHEETS.robe.y0 + 60, y1: SHEETS.robe.y1 }));
    }
  });
});

describe('советник: живость (ЛЦ-5)', () => {
  const run = (mo: AdvisorMotion, s: number, g: Gesture = STILL, want: Gesture = STILL, walk = 0): { lids: number[]; jaw: number[]; gaze: number[]; clips: Set<string> } => {
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

  it('моргает раз в 3–6 с', () => {
    const mo = new AdvisorMotion(m.sk, head.lidClose());
    const { lids } = run(mo, 60);
    const closed: number[] = [];
    for (let i = 1; i < lids.length; i++) if (lids[i] > mo.closeLids * 0.9 && lids[i - 1] <= mo.closeLids * 0.9) closed.push(i / 60);
    expect(closed.length).toBeGreaterThanOrEqual(9);
    for (let i = 1; i < closed.length; i++) {
      expect(closed[i] - closed[i - 1]).toBeGreaterThanOrEqual(2.9);
      expect(closed[i] - closed[i - 1]).toBeLessThanOrEqual(6.4);
    }
  });

  it('взгляд ведёт голову; рот ходит при речи, и борода — с ним (кость бороды — ребёнок челюсти)', () => {
    const { gaze } = run(new AdvisorMotion(m.sk, head.lidClose()), 0.5, STILL, { ...STILL, lookYaw: 0.8 });
    expect(Math.max(...gaze)).toBeGreaterThan(0.004);
    const talk = run(new AdvisorMotion(m.sk, head.lidClose()), 3, { ...STILL, talk: 1 }).jaw;
    expect(Math.max(...talk)).toBeGreaterThan(0.05);
    expect(m.sk.bones[m.sk.bones[m.sk.of('beard')].parent].name).toBe('jaw');
    // Челюсть открыта — кончик бороды ушёл вниз.
    const body = new SkinBody(m, new THREE.MeshBasicMaterial(), 'test');
    const tip = (): number => body.at('beard', [0, -0.06, 0])[1];
    body.pose({ x: 0, y: 0, z: 0, yaw: 0, lift: [0, 0, 0], turns: {} });
    const shut = tip();
    body.pose({ x: 0, y: 0, z: 0, yaw: 0, lift: [0, 0, 0], turns: { jaw: [0.08, 0, 0] } });
    expect(shut - tip(), 'борода со ртом').toBeGreaterThan(0.004);
  });

  it('стоя сам по себе — гладит бороду, листает свиток и задумчиво кивает; в речи — указывает рукой', () => {
    const quiet = run(new AdvisorMotion(m.sk, head.lidClose()), 90, { ...STILL, read: 0.35 });
    for (const c of ['stroke', 'leaf', 'nod']) expect(quiet.clips.has(c), c).toBe(true);
    const talk = run(new AdvisorMotion(m.sk, head.lidClose()), 40, { ...STILL, talk: 1 });
    expect(talk.clips.has('point'), 'указать рукой').toBe(true);
    // Идёт — клипов нет.
    expect(run(new AdvisorMotion(m.sk, head.lidClose()), 30, STILL, STILL, 1).clips.size).toBe(0);
  });

  /** Поза клипа на его секунде: клип пущен в 0, кадр — `at`. */
  const clipAt = (clip: keyof typeof CLIPS, at: number, g: Gesture = STILL): SkinBody => {
    const mo = new AdvisorMotion(m.sk, head.lidClose());
    mo.start(clip, 0);
    return posed(mo, at, g);
  };
  const beardVerts = (() => {
    const out: number[] = [];
    for (let i = 0; i < m.vertexCount; i++) if (onSheet(m, i, SHEETS.beard)) out.push(i);
    return out;
  })();
  const nearBeard = (body: SkinBody, p: readonly number[]): number => {
    const pos = body.positions();
    return Math.min(...beardVerts.map((i) => dist([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], p)));
  };
  /** Ладонь: середина кисти — от запястья по пальцам (кисть — её −y). */
  const palm = (body: SkinBody, side: 'L' | 'R'): number[] => body.at(`hand${side}`, [0, -0.07, 0]);

  it('гладить бороду: ладонь у бороды и идёт вниз по ней', () => {
    // Ключи клипа: у подбородка (0,75 с) и ниже (1,35 с).
    const a = clipAt('stroke', 0.75);
    const b = clipAt('stroke', 1.35);
    expect(nearBeard(a, palm(a, 'R')), 'у бороды сверху').toBeLessThan(0.05);
    expect(nearBeard(b, palm(b, 'R')), 'у бороды ниже').toBeLessThan(0.05);
    expect(palm(a, 'R')[1] - palm(b, 'R')[1], 'вниз по бороде').toBeGreaterThan(0.04);
    // До клипа — рука далеко от бороды (граница области: клип в 0,75 и 1,35 — внутри ключей, в покое — нет).
    const rest = posed(new AdvisorMotion(m.sk, head.lidClose()), 2);
    expect(nearBeard(rest, palm(rest, 'R')), 'в покое рука не у бороды').toBeGreaterThan(0.15);
  });

  it('листать свиток: правая — к левой, держащей свиток у груди', () => {
    const g = { ...STILL, read: 1 };
    const b = clipAt('leaf', 1.3, g);
    expect(dist(palm(b, 'R'), palm(b, 'L')), 'правая у свитка').toBeLessThan(0.12);
    const rest = posed(new AdvisorMotion(m.sk, head.lidClose()), 2, g);
    expect(dist(palm(rest, 'R'), palm(rest, 'L')), 'в покое правая не у свитка').toBeGreaterThan(0.2);
  });

  it('задумчиво кивнуть: голова медленно вниз и назад; указать: правая вперёд выше пояса', () => {
    const mo = new AdvisorMotion(m.sk, head.lidClose());
    mo.start('nod', 0);
    const pitch: number[] = [];
    for (let i = 0; i <= CLIPS.nod.len * 60; i++) pitch.push(mo.pose(i / 60, 0, 0, STILL, STILL).turns.head[0]);
    expect(Math.max(...pitch) - Math.min(...pitch), 'кивок').toBeGreaterThan(0.18);
    const p = clipAt('point', 1.2, { ...STILL, talk: 1 });
    const w = p.at('handR');
    expect(w[2], 'вперёд').toBeGreaterThan(0.38);
    expect(w[1], 'выше пояса').toBeGreaterThan(1.15);
    // Ладонь вниз: кисть — её +x к полу (`body.mitten`: ладонь — к −x кисти правой руки).
    expect(p.axes('handR')[4], 'пальцы вперёд, не вниз').toBeLessThan(0.3);
  });

  it('идти — скольжением: таз не скачет, подол спереди идёт шагом поочерёдно; поклон — правая к сердцу', () => {
    const mo = new AdvisorMotion(m.sk, head.lidClose());
    const ys: number[] = [];
    const hems: [number, number][] = [];
    for (let i = 0; i < 120; i++) {
      const p = mo.pose(i / 60, (i / 60) * 6, 1, STILL, STILL);
      ys.push(p.lift[1]);
      hems.push([p.turns.hemL[0], p.turns.hemR[0]]);
    }
    expect(Math.max(...ys) - Math.min(...ys), 'таз плывёт ровно').toBeLessThan(0.006);
    expect(hems.some(([l, r]) => l > 0.1 && r < -0.1) && hems.some(([l, r]) => l < -0.1 && r > 0.1), 'подол — шагом').toBe(true);
    // Подол на кости `hemL` у пола уходит вперёд, когда кость наклонена (шаг левой).
    const body = new SkinBody(m, new THREE.MeshBasicMaterial(), 'test');
    body.pose({ x: 0, y: 0, z: 0, yaw: 0, lift: [0, 0, 0], turns: { hemL: [-0.15, 0, 0] } });
    const hemL = body.at('hemL', [0, -0.85, 0.18]);
    body.pose({ x: 0, y: 0, z: 0, yaw: 0, lift: [0, 0, 0], turns: {} });
    expect(hemL[2] - body.at('hemL', [0, -0.85, 0.18])[2], 'подол вперёд').toBeGreaterThan(0.08);
    const bow = posed(new AdvisorMotion(m.sk, head.lidClose()), 2, { ...STILL, bow: 1 });
    expect(dist(palm(bow, 'R'), bow.at('chest', [0.05, 0.05, 0.12])), 'кисть у сердца').toBeLessThan(0.14);
  });
});
