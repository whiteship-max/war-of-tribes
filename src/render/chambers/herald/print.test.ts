// Отпечаток гонца (ЛЦ-4, docs/characters.md): набор персонажа растёт под кота (`chambers/kit`), а гонец — как в ЛЦ-3 ни на
// точку: сетка, кости, оба листа трёх обликов и живость за минуту — отпечатком, снятым на коде ЛЦ-3 (`223cdbb`). Меняешь
// гонца нарочно — перепиши отпечаток тем же коммитом и скажи почему.
import { describe, expect, it } from 'vitest';
import { STILL, type Gesture } from '../folk';
import { paintHeraldBody } from './cloth';
import { paintHeraldFace } from './face';
import { buildHeraldMesh } from './figure';
import { headOf } from './head';
import { HERALD_IDS, HERALD_LOOKS } from './looks';
import { HeraldMotion } from './motion';

/** FNV-1a по байтам чисел (float64), строкой из 8 цифр — как у отпечатка супруги. */
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

const meshOf = () => buildHeraldMesh(headOf(HERALD_LOOKS.b.face));

/** Минута живости: шаг, речь, поклон, письмо и взгляд по расписанию. */
function* lived(): Generator<number> {
  const head = headOf(HERALD_LOOKS.b.face);
  const m = buildHeraldMesh(head);
  const mo = new HeraldMotion(m.sk, head.lidClose());
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
    g.offer = t > 44 && t < 48 ? 1 : 0;
    const walk = k === 3 ? 0.8 : 0;
    const p = mo.pose(t, t * 4, walk, g, want);
    for (const name of Object.keys(p.turns).sort()) yield* p.turns[name];
    yield* p.lift;
    yield* mo.gaze;
  }
}

describe('отпечаток гонца: набор персонажа его не меняет (ЛЦ-4)', () => {
  it('сетка и кости', () => {
    const m = meshOf();
    const all = [...m.pos, ...m.uv, ...m.sheet, ...m.shade, ...m.b0, ...m.b1, ...m.w0, ...m.idx, ...m.eye];
    expect(fnv(all.map(Math.fround))).toBe(PRINT.mesh);
    expect(fnv(m.sk.bones.flatMap((b) => [b.parent, ...b.j]))).toBe(PRINT.bones);
  });

  for (const id of HERALD_IDS)
    it(`листы облика ${id}`, () => {
      const look = HERALD_LOOKS[id];
      expect(fnv(paintHeraldBody(look).rgba())).toBe(PRINT.body[id]);
      expect(fnv(paintHeraldFace(look, headOf(look.face)).rgba())).toBe(PRINT.face[id]);
    });

  it('живость за минуту', () => {
    expect(fnv(lived())).toBe(PRINT.motion);
  });
});

const PRINT = {
  mesh: 'f72f386d',
  bones: '8e850f61',
  body: { a: 'e63be987', b: '86c2274d', c: 'f91dda85' },
  face: { a: '6eb7ee65', b: '4423886d', c: 'a34e9ae8' },
  motion: 'd978e3b7',
};
