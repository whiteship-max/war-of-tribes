// Супруга правителя (ЛЦ-2, docs/characters.md): бюджет и устройство фигуры, листы, живость — числами, без WebGL.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STILL } from '../folk';
import { buildConsortMesh, HEIGHT } from './figure';
import { paintCloth } from './cloth';
import { paintFace } from './face';
import { CONSORT_IDS, LOOKS } from './looks';
import { ConsortMotion } from './motion';
import { MAX_WEIGHTS } from './skin';
import { facePx, thetaAt } from './head';
import type { Img } from './paint';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

describe('супруга: сетка и кости (ЛЦ-2)', () => {
  const m = buildConsortMesh();

  it('потолок треугольников: 800…1500 на всю фигуру', () => {
    expect(m.triangles).toBeGreaterThanOrEqual(800);
    expect(m.triangles).toBeLessThanOrEqual(1500);
  });

  it('скелет как у моделей WC3: 15…20 костей, ног нет; на вершину не больше двух весов', () => {
    const names = m.sk.bones.map((b) => b.name);
    expect(names.length).toBeGreaterThanOrEqual(15);
    expect(names.length).toBeLessThanOrEqual(20);
    expect(names.filter((n) => /thigh|shin|foot|leg|knee/.test(n)), 'ног под юбкой нет').toEqual([]);
    for (const n of ['jaw', 'lids', 'hair', 'thumbL', 'thumbR', 'skirtF', 'skirtB', 'skirtS']) expect(names, n).toContain(n);
    // Две кости на вершину — первая с весом w, вторая с остатком; другого способа записать вес у сетки нет.
    expect(MAX_WEIGHTS).toBe(2);
    expect(m.b0.length).toBe(m.vertexCount);
    expect(m.b1.length).toBe(m.vertexCount);
    for (const w of m.w0) expect(w >= 0 && w <= 1).toBe(true);
  });

  it('пропорции как у образца: голова 1/7 роста (6,6…7,4), плечи — 2,2…2,5 ширины лица, шея — около половины', () => {
    let top = 0;
    let chin = Infinity;
    let face = 0;
    for (let i = 0; i < m.vertexCount; i++) {
      const p = m.at(i);
      top = Math.max(top, p[1]);
      // Лицо — лист 1, без полосы под челюстью (она заправлена в шею ниже подбородка).
      if (m.sheet[i] === 1 && p[2] > 0.02 && m.shade[i] === 1) {
        chin = Math.min(chin, p[1]);
        face = Math.max(face, Math.abs(p[0]));
      }
    }
    expect(top).toBeCloseTo(HEIGHT, 3);
    const head = top - chin;
    expect(top / head, 'голова — 1/7 роста').toBeGreaterThan(6.6);
    expect(top / head).toBeLessThan(7.4);
    const shoulder = Math.abs(m.sk.bones[m.sk.of('armL')].j[0]) * 2;
    expect(shoulder / (face * 2), 'плечи — 2,2…2,5 ширины лица').toBeGreaterThan(2.2);
    expect(shoulder / (face * 2)).toBeLessThan(2.5);
    // Шея: ширина торса на уровне шеи (вершины тела выше трапеции и ниже подбородка).
    let neck = 0;
    const nb = m.sk.bones[m.sk.of('neck')].j[1];
    for (let i = 0; i < m.vertexCount; i++) {
      const p = m.at(i);
      // Только торс (лист тела 128…288), без волос и рук.
      const v = m.uv[i * 2 + 1] * 512;
      if (m.sheet[i] === 0 && v > 128 && v < 288 && p[1] > nb + 0.02 && p[1] < chin && Math.abs(p[2]) < 0.06) neck = Math.max(neck, Math.abs(p[0]));
    }
    expect(neck / face, 'шея — около половины ширины головы').toBeGreaterThan(0.4);
    expect(neck / face).toBeLessThan(0.62);
  });

  it('лицо без вывернутых граней: спереди ни одна грань лица не смотрит назад', () => {
    let bad = 0;
    for (let t = 0; t < m.idx.length; t += 3) {
      const [a, b, c] = [m.idx[t], m.idx[t + 1], m.idx[t + 2]];
      if (m.sheet[a] !== 1) continue;
      const pa = m.at(a);
      const pb = m.at(b);
      const pc = m.at(c);
      const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const len = Math.hypot(n[0], n[1], n[2]);
      const cz = (pa[2] + pb[2] + pc[2]) / 3;
      const cx = (pa[0] + pb[0] + pc[0]) / 3;
      // Перед лица — середина маски (щёки, глаза, рот); грани заметной площади, развёрнутые от зрителя.
      if (cz > 0.03 && Math.abs(cx) < 0.05 && len > 1e-8 && n[2] / len < -0.3) bad++;
    }
    expect(bad).toBe(0);
  });
});

/** Шов зеркала: у края листа крайний столбец выбивается из ровного соседства (на ровном месте — линия по оси). */
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

describe('супруга: листы (ЛЦ-2)', () => {
  for (const id of CONSORT_IDS) {
    it(`облик ${id}: листы 512 × 512, шва на линии зеркала нет — ни на лице, ни на волосах, торсе и юбке`, () => {
      const face = paintFace(LOOKS[id]);
      const body = paintCloth(LOOKS[id]);
      expect([face.w, face.h, body.w, body.h]).toEqual([512, 512, 512, 512]);
      expect(seams(face, 0, 1, 0, 512), 'лицо: середина').toEqual([]);
      expect(seams(body, 0, 1, 0, 416), 'тело: середина спереди').toEqual([]);
      expect(seams(body, 511, -1, 0, 416), 'тело: середина сзади').toEqual([]);
    });
  }

  it('палитра облика — от пяти до семи цветов; облики различаются', () => {
    for (const id of CONSORT_IDS) {
      const n = Object.keys(LOOKS[id].palette).length;
      expect(n, id).toBeGreaterThanOrEqual(5);
      expect(n, id).toBeLessThanOrEqual(7);
    }
    expect(new Set(CONSORT_IDS.map((id) => JSON.stringify(LOOKS[id].palette))).size).toBe(CONSORT_IDS.length);
  });

  it('лицо — самое светлое место фигуры: свет лица ярче сорочки и наплечников', () => {
    const lum = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const at = (img: Img, x: number, h: number): number => {
      const [px, py] = facePx(thetaAt(h, x), h);
      return lum(img.get(Math.round(px), Math.round(py)));
    };
    for (const id of CONSORT_IDS) {
      const face = paintFace(LOOKS[id]);
      const body = paintCloth(LOOKS[id]);
      // Свет лица: лоб, скула, спинка носа — ярчайшее из них.
      const light = Math.max(at(face, 0.012, 0.2), at(face, 0.07, 0.122), at(face, 0.001, 0.12));
      // Сорочка на груди и наплечник (верх, на свету) — в среднем по своим местам листа.
      let linen = 0;
      let n = 0;
      for (let x = 2; x < 190; x += 6)
        for (let y = 420; y < 470; y += 5) {
          linen += lum(body.get(x, y));
          n++;
        }
      expect(light, id).toBeGreaterThan(linen / n);
    }
  });
});

describe('супруга: живость (ЛЦ-2)', () => {
  const m = buildConsortMesh();
  const run = (mo: ConsortMotion, s: number, g = STILL, want = STILL, from = 0): { lids: number[]; jaw: number[]; gaze: number[]; clips: Set<string> } => {
    const lids: number[] = [];
    const jaw: number[] = [];
    const gaze: number[] = [];
    const clips = new Set<string>();
    for (let i = 0; i < s * 60; i++) {
      const t = from + i / 60;
      const p = mo.pose(t, 0, 0, g, want);
      lids.push(p.turns.lids?.[0] ?? 0);
      jaw.push(p.turns.jaw?.[0] ?? 0);
      gaze.push(mo.gaze[0]);
      if (mo.playing === 2) clips.add('hair');
      if (mo.playing === 3) clips.add('cross');
    }
    return { lids, jaw, gaze, clips };
  };

  it('моргает раз в 3–6 с: веко закрывается почти целиком и сразу открывается', () => {
    const mo = new ConsortMotion(m.sk);
    const { lids } = run(mo, 60);
    const closed: number[] = [];
    for (let i = 1; i < lids.length; i++) if (lids[i] > mo.closeLids * 0.9 && lids[i - 1] <= mo.closeLids * 0.9) closed.push(i / 60);
    expect(closed.length, 'морганий за минуту').toBeGreaterThanOrEqual(9);
    expect(closed.length).toBeLessThanOrEqual(21);
    for (let i = 1; i < closed.length; i++) {
      expect(closed[i] - closed[i - 1], 'между морганиями').toBeGreaterThanOrEqual(2.9);
      expect(closed[i] - closed[i - 1]).toBeLessThanOrEqual(6.4);
    }
    const shut = lids.filter((l) => l > mo.closeLids * 0.9).length / 60;
    expect(shut, 'закрыт меньше полсекунды за минуту на моргание').toBeLessThan(closed.length * 0.12);
  });

  it('взгляд ведёт голову: правитель слева — белок сдвигается влево раньше головы', () => {
    const mo = new ConsortMotion(m.sk);
    const want = { ...STILL, lookYaw: 0.8 };
    const { gaze } = run(mo, 0.5, STILL, want);
    expect(Math.max(...gaze)).toBeGreaterThan(0.004);
    const still = run(new ConsortMotion(m.sk), 0.5).gaze;
    expect(Math.max(...still.map(Math.abs))).toBeLessThan(0.002);
  });

  it('рот ходит при речи, молча — закрыт', () => {
    const talk = run(new ConsortMotion(m.sk), 3, { ...STILL, talk: 1 }).jaw;
    const quiet = run(new ConsortMotion(m.sk), 3).jaw;
    expect(Math.max(...talk)).toBeGreaterThan(0.05);
    expect(Math.max(...quiet)).toBeLessThan(0.001);
  });

  it('стоя без дела, за минуту поправит волосы и сложит руки — клипы стояния 2 и 3', () => {
    const { clips } = run(new ConsortMotion(m.sk), 90);
    expect([...clips].sort()).toEqual(['cross', 'hair']);
  });
});

describe('супруга: файлы (ЛЦ-2)', () => {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);

  it('чужих моделей и текстур в репозитории нет: ни .mdx, ни .mdl, ни .blp', () => {
    expect(files.filter((f) => /\.(mdx|mdl|blp)$/i.test(f))).toEqual([]);
  });

  it('у каждого внешнего файла фигуры — строка с лицензией в docs/characters.md', () => {
    const doc = readFileSync(`${ROOT}docs/characters.md`, 'utf8');
    const ours = files.filter((f) => /^(docs\/characters\/|assets-src\/characters\/|public\/assets\/characters\/)/.test(f));
    expect(ours.length, 'снимки задания лежат в docs/characters').toBeGreaterThan(0);
    for (const f of ours) {
      const name = f.split('/').pop()!;
      // Файл называют и другие разделы (круги качества); нужна строка, где рядом с именем — лицензия.
      const lines = doc.split('\n').filter((l) => l.includes(name) || l.includes(name.replace(/\d+(?=\.\w+$)/, '*')));
      expect(lines.length, `${f}: строки в docs/characters.md нет`).toBeGreaterThan(0);
      expect(lines.some((l) => /лицензи/i.test(l)), `${f}: ни в одной строке с ним нет лицензии`).toBe(true);
    }
  });

  it('нет имён файлов, различающихся только регистром', () => {
    const seen = new Map<string, string>();
    const clash: string[] = [];
    for (const f of files) {
      const k = f.toLowerCase();
      const was = seen.get(k);
      if (was && was !== f) clash.push(`${was} ↔ ${f}`);
      seen.set(k, f);
    }
    expect(clash).toEqual([]);
  });
});
