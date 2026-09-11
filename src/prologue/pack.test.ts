/**
 * Вещи.
 *
 * Обещание одно, и оно из двух половин: окно показывает **ровно то, что есть** —
 * ни строкой больше, ни строкой меньше, — и надетое помечено надетым.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pack, packKey } from './pack';
import { freshPrologue, type PrologueSave } from './save';

const state = (over: Partial<PrologueSave> = {}): PrologueSave => ({ ...freshPrologue(0), ...over });

describe('вещи — ровно то, что есть', () => {
  it('у новой поляны вещей нет', () => {
    expect(pack(state())).toEqual([]);
  });

  it('полные руки: всё по порядку, с числами, и надета только одежда', () => {
    const s = state({
      axe: true,
      kit: true,
      quiver: 5,
      arrows: [{ x: 1, z: 1 }, { x: 2, z: 2 }],
      meat: { cooked: 3, raw: 6 },
      logs: 12,
      hides: 1,
    });
    s.body = { ...s.body, coat: true };
    const items = pack(s);
    expect(items.map((i) => i.id)).toEqual(['axe', 'bow', 'arrows', 'cooked', 'raw', 'logs', 'hides', 'coat']);
    expect(items.map((i) => i.count)).toEqual([1, 1, 5, 3, 6, 12, 1, 1]);
    expect(items.filter((i) => i.worn).map((i) => i.id)).toEqual(['coat']);
    // Число пишется у того, что считают, и не пишется у того, что бывает одно.
    expect(items.filter((i) => !i.counted).map((i) => i.id)).toEqual(['axe', 'bow', 'coat']);
    // Стрелы в траве — не в колчане, но и не пропали: сказано, где они.
    expect(items.find((i) => i.id === 'arrows')?.note).toBe('ещё 2 в траве');
  });

  it('чего нет — того нет: пустые счёты строк не заводят', () => {
    const s = state({ axe: true, kit: true, quiver: 0, meat: { cooked: 0, raw: 2 }, logs: 0, hides: 0 });
    expect(pack(s).map((i) => i.id)).toEqual(['axe', 'bow', 'raw']);
  });

  it('каждое поле записи попадает в свою строку, и счёт берётся из записи как есть', () => {
    // Второго счёта вещей нет: поменялась запись — поменялось окно, и только так.
    for (const [field, id] of [['logs', 'logs'], ['hides', 'hides'], ['quiver', 'arrows']] as const) {
      for (const n of [1, 2, 7]) {
        const item = pack(state({ [field]: n } as Partial<PrologueSave>)).find((i) => i.id === id);
        expect(item?.count, `${field} = ${n}`).toBe(n);
      }
    }
  });

  it('ключ списка меняется вместе со списком — надстройка не пропустит перемену', () => {
    const a = state({ logs: 3 });
    const b = state({ logs: 4 });
    expect(packKey(pack(a))).not.toBe(packKey(pack(b)));
    expect(packKey(pack(a))).toBe(packKey(pack(state({ logs: 3 }))));
  });
});

describe('из вещей не применяется ничего, кроме еды', () => {
  it('модуль вещей только читает: ни одного присваивания в запись', () => {
    const src = readFileSync(join(__dirname, 'pack.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/\bs\.\w+(\.\w+)*\s*[-+*/]?=(?!=)/);
  });
});
