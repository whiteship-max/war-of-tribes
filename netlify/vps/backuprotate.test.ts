// Поворот копий оставляет самую новую (OPS-1, docs/audit/WORKPLAN.md; архив round2/prove-9-1). Две копии в одну минуту
// ложатся рядом: `tribe-…-0330.sqlite`, `…-0330-2.sqlite`, …, `…-0330-10.sqlite` (`freeName`). Новизна читалась сравнением
// имён как строк: «-» меньше «.», и «-10» меньше «-2», — первая копия минуты считалась новее всех, а поворот удалял самые
// новые. Теперь порядок — по разобранной паре (минута, номер). Только файлы во временной папке; на сервере не гоняется.
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { freeName, listBackups, newestBackupAt, rotate } from './backup';

const dirs: string[] = [];
const temp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'tribe-rotate-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('поворот копий по минуте и номеру (OPS-1)', () => {
  it('десять копий в одну минуту: остаётся последняя снятая', () => {
    const d = temp();
    const now = Date.UTC(2026, 9, 4, 3, 30);
    const made: string[] = [];
    for (let i = 0; i < 10; i++) {
      const n = freeName(d, now);
      writeFileSync(join(d, n), '');
      made.push(n);
    }
    expect(made.at(-1), 'точка внутри области: номер двузначный').toMatch(/-10\.sqlite$/);
    expect(rotate(d, 3).sort()).toEqual(made.slice(0, 7).sort());
    expect(readdirSync(d).sort()).toEqual(made.slice(7).sort());
  });

  it('новые первыми: позже по минуте — раньше в списке, в одной минуте — по номеру; свежайшая минута — из первой', () => {
    const d = temp();
    const names = ['tribe-2026-10-04-0330.sqlite', 'tribe-2026-10-04-0330-2.sqlite', 'tribe-2026-10-04-0330-11.sqlite', 'tribe-2026-10-04-0331.sqlite', 'tribe-2026-10-05-0001.sqlite', 'before-restore-2026-10-04-120000.sqlite'];
    for (const n of names) writeFileSync(join(d, n), '');
    const daily = listBackups(d).map((b) => b.name).filter((n) => n.startsWith('tribe-'));
    expect(daily).toEqual(['tribe-2026-10-05-0001.sqlite', 'tribe-2026-10-04-0331.sqlite', 'tribe-2026-10-04-0330-11.sqlite', 'tribe-2026-10-04-0330-2.sqlite', 'tribe-2026-10-04-0330.sqlite']);
    expect(newestBackupAt(d)).toBe(Date.UTC(2026, 9, 5, 0, 1));
    rotate(d, 1);
    expect(readdirSync(d).sort()).toEqual(['before-restore-2026-10-04-120000.sqlite', 'tribe-2026-10-05-0001.sqlite']);
  });
});
