// Отпечаток советника (ЛЦ-6, docs/characters.md): набор персонажа растёт под служанку (`chambers/kit`), а советник — как в
// ЛЦ-5 ни на точку: сетка, кости, оба листа трёх обликов и живость за минуту — отпечатком, снятым на коде ЛЦ-5 (`05eb793`).
// Меняешь советника нарочно — перепиши отпечаток тем же коммитом и скажи почему.
import { describe, expect, it } from 'vitest';
import { STILL, type Gesture } from '../folk';
import { paintAdvisorBody } from './cloth';
import { paintAdvisorFace } from './face';
import { buildAdvisorMesh } from './figure';
import { headOf } from './head';
import { ADVISOR_IDS, ADVISOR_LOOKS } from './looks';
import { AdvisorMotion } from './motion';

/** FNV-1a по байтам чисел (float64), строкой из 8 цифр — как у отпечатков супруги, гонца и кота. */
function fnv(values: Iterable<number>): string {
  const f = new Float64Array(1);
  const b = new Uint8Array(f.buffer);
  let h = 0x811c9dc5;
  for (const v of values) {
    f[0] = v;
    for (let i = 0; i < 8; i++) h = Math.imul(h ^ b[i], 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Минута живости: шаг, речь, поклон, свиток и взгляд по расписанию; клипы стояния — по своей сеяной кости. */
function* lived(): Generator<number> {
  const head = headOf(ADVISOR_LOOKS.a.face);
  const m = buildAdvisorMesh(head);
  const mo = new AdvisorMotion(m.sk, head.lidClose());
  const g: Gesture = { ...STILL };
  const want: Gesture = { ...STILL };
  for (let i = 0; i < 60 * 30; i++) {
    const t = i / 30;
    const k = Math.floor(t / 7) % 4;
    want.lookYaw = k === 1 ? 0.7 : k === 3 ? -0.5 : 0;
    want.lookPitch = k === 2 ? 0.2 : 0;
    g.lookYaw += (want.lookYaw - g.lookYaw) * 0.12;
    g.lookPitch += (want.lookPitch - g.lookPitch) * 0.12;
    g.talk = k === 2 ? 1 : 0;
    g.bow = t > 40 && t < 42 ? 1 : 0;
    g.read = t > 44 && t < 52 ? 1 : 0;
    const walk = k === 3 ? 0.8 : 0;
    const p = mo.pose(t, t * 4, walk, g, want);
    for (const name of Object.keys(p.turns).sort()) yield* p.turns[name];
    yield* p.lift;
    yield* mo.gaze;
  }
}

describe('отпечаток советника: набор персонажа его не меняет (ЛЦ-6)', () => {
  it('сетка и кости', () => {
    const m = buildAdvisorMesh(headOf(ADVISOR_LOOKS.a.face));
    const all = [...m.pos, ...m.uv, ...m.sheet, ...m.shade, ...m.b0, ...m.b1, ...m.w0, ...m.idx, ...m.eye];
    expect(fnv(all.map(Math.fround))).toBe(PRINT.mesh);
    expect(fnv(m.sk.bones.flatMap((b) => [b.parent, ...b.j]).map(Math.fround))).toBe(PRINT.bones);
  });

  for (const id of ADVISOR_IDS)
    it(`листы облика ${id}`, () => {
      const look = ADVISOR_LOOKS[id];
      expect(fnv(paintAdvisorBody(look).rgba())).toBe(PRINT.body[id]);
      expect(fnv(paintAdvisorFace(look, headOf(look.face)).rgba())).toBe(PRINT.face[id]);
    });

  it('живость за минуту', () => {
    expect(fnv([...lived()].map(Math.fround))).toBe(PRINT.motion);
  });
});

const PRINT = {
  mesh: 'ab09ebe9',
  bones: '22d326d8',
  body: { a: '21b6bfa1', b: '9ffedc2f', c: 'bcf48203' },
  face: { a: '991d94c6', b: '9687433b', c: 'ab8077f1' },
  motion: '41d6e01c',
};
