// Отпечаток супруги (ЛЦ-3, docs/characters.md): общее ЛЦ-2 вынесено в набор персонажа (`chambers/kit`), и гонец строится
// тем же набором. Правка набора под гонца не должна менять супругу ни на точку: сетка, кости, оба листа трёх обликов и
// живость за минуту — отпечатком, снятым на коде ЛЦ-2 (`e9455e9`). Меняешь супругу нарочно — перепиши отпечаток тем же
// коммитом и скажи почему.
import { describe, expect, it } from 'vitest';
import { STILL, type Gesture } from '../folk';
import { buildConsortMesh } from './figure';
import { paintCloth } from './cloth';
import { paintFace } from './face';
import { CONSORT_IDS, LOOKS } from './looks';
import { ConsortMotion } from './motion';

/** FNV-1a по байтам чисел (float64), строкой из 8 цифр. */
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

/** Минута живости: шаг, речь, реверанс и взгляд по расписанию — повороты костей, сдвиг таза и взгляд каждого кадра. */
function* lived(): Generator<number> {
  const m = buildConsortMesh();
  const mo = new ConsortMotion(m.sk);
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
    g.curtsy = t > 40 && t < 42 ? 1 : 0;
    const walk = k === 3 ? 0.8 : 0;
    const p = mo.pose(t, t * 4, walk, g, want);
    for (const name of Object.keys(p.turns).sort()) yield* p.turns[name];
    yield* p.lift;
    yield* mo.gaze;
  }
}

describe('отпечаток супруги: набор персонажа её не меняет (ЛЦ-3)', () => {
  it('сетка и кости', () => {
    const m = buildConsortMesh();
    // Сетка — с точностью float32, с которой она уходит в видеокарту: последние биты float64 у облачного Node и домашнего
    // расходятся (отпечаток float64, снятый в облаке, дома не сходился и на коде ЛЦ-2 — слияние ЛЦ-3, 21.10.2026).
    const all = [...m.pos, ...m.uv, ...m.sheet, ...m.shade, ...m.b0, ...m.b1, ...m.w0, ...m.idx, ...m.eye];
    expect(fnv(all.map(Math.fround))).toBe(PRINT.mesh);
    expect(fnv(m.sk.bones.flatMap((b) => [b.parent, ...b.j]))).toBe(PRINT.bones);
    expect(m.sk.bones.map((b) => b.name).join(' ')).toBe(PRINT.names);
  });

  for (const id of CONSORT_IDS)
    it(`листы облика ${id}`, () => {
      expect(fnv(paintCloth(LOOKS[id]).rgba())).toBe(PRINT.body[id]);
      expect(fnv(paintFace(LOOKS[id]).rgba())).toBe(PRINT.face[id]);
    });

  it('живость за минуту', () => {
    expect(fnv(lived())).toBe(PRINT.motion);
  });
});

const PRINT = {
  mesh: 'c5970384',
  bones: 'bd118267',
  names: 'hips spine chest neck head jaw lids hair armL foreL handL thumbL armR foreR handR thumbR skirtF skirtB skirtS',
  body: { a: 'e0e83403', b: 'c8f0efc8', c: '5c4a9a7d' },
  face: { a: 'f764ba19', b: 'c7d19c21', c: '1270762e' },
  motion: 'e5f4eaac',
};
