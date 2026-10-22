// Отпечаток кота (ЛЦ-5, docs/characters.md): набор персонажа растёт под советника (`chambers/kit`), а кот — как в ЛЦ-4 ни на
// точку: сетка, кости, листы трёх окрасов, клубок и клипы живости — отпечатком, снятым на коде ЛЦ-4 (`913f955`). Меняешь
// кота нарочно — перепиши отпечаток тем же коммитом и скажи почему.
import { describe, expect, it } from 'vitest';
import { sample } from '../kit/motion';
import { paintCat } from './coat';
import { buildCatMesh } from './figure';
import { yarnMesh } from './index';
import { CAT_IDS, CAT_LOOKS } from './looks';
import { CLIPS, POSES } from './motion';

/** FNV-1a по байтам чисел (float64), строкой из 8 цифр — как у отпечатков супруги и гонца. */
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

/** Сетка — с точностью float32, с которой она уходит в видеокарту (как у супруги и гонца). */
const meshPrint = (m: ReturnType<typeof yarnMesh>): string => fnv([...m.pos, ...m.uv, ...m.sheet, ...m.shade, ...m.b0, ...m.b1, ...m.w0, ...m.idx, ...m.eye, ...[...m.fade].flat()].map(Math.fround));

/** Клипы живости: каждый — по 30 кадров на секунду от начала до конца. */
function* clips(): Generator<number> {
  for (const name of Object.keys(CLIPS).sort() as (keyof typeof CLIPS)[]) {
    const c = CLIPS[name];
    for (let t = 0; t <= c.len; t += 1 / 30) {
      const q = sample(c, POSES, t);
      for (const bone of Object.keys(q.turns).sort()) yield* q.turns[bone];
      yield* q.lift;
    }
  }
}

describe('отпечаток кота: набор персонажа его не меняет (ЛЦ-5)', () => {
  for (const id of CAT_IDS)
    it(`окрас ${id}: сетка, кости и лист`, () => {
      const look = CAT_LOOKS[id];
      const m = buildCatMesh(look.head);
      expect(meshPrint(m)).toBe(PRINT.mesh[id]);
      expect(fnv(m.sk.bones.flatMap((b) => [b.parent, ...b.j]))).toBe(PRINT.bones);
      expect(fnv(paintCat(look).rgba())).toBe(PRINT.sheet[id]);
    });

  it('клубок', () => {
    expect(meshPrint(yarnMesh())).toBe(PRINT.yarn);
  });

  it('клипы живости', () => {
    expect(fnv(clips())).toBe(PRINT.clips);
  });
});

const PRINT = {
  mesh: { a: 'c5f192b0', b: '8cae181f', c: '0ff8f12b' },
  bones: '708a08c9',
  sheet: { a: '4afe899d', b: '05120993', c: '93e16f8d' },
  yarn: '9ba86019',
  clips: '6e4f4e29',
};
