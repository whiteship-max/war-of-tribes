// Что даёт указ и паёк — числами из полей записи (правило 18): строка разбирается обратно и сверяется с полями.
import { describe, expect, it } from 'vitest';
import { DECREES, RATIONS } from '@/game/data/policy';
import { decreeLine, decreeNumbers, rationLine, rationNumbers } from './policyWords';

/** Число после слова: «выработка +10%» → 10; знак — длинным минусом или плюсом. */
const after = (line: string, word: string): number | null => {
  const m = new RegExp(`${word} ([+−])?(\\d+(?:,\\d+)?)`, 'i').exec(line);
  if (!m) return null;
  return (m[1] === '−' ? -1 : 1) * Number(m[2].replace(',', '.'));
};

describe('указ и паёк: числа на кнопке — из полей записи', () => {
  it('указ: выработка процентом перемены, мораль — в день; без перемен — подпись записи', () => {
    let numbered = 0;
    for (const d of DECREES) {
      const line = decreeLine(d);
      if (d.output === 1 && d.moralePerDay === 0) {
        expect(decreeNumbers(d), d.id).toBeNull();
        expect(line, d.id).toBe(d.effect);
        continue;
      }
      numbered++;
      expect(after(line, 'выработка'), `${d.id}: ${line}`).toBe(d.output === 1 ? null : Math.round((d.output - 1) * 100));
      expect(after(line, 'мораль'), `${d.id}: ${line}`).toBe(d.moralePerDay === 0 ? null : d.moralePerDay);
      expect(line, d.id).not.toMatch(/\d\.\d/);
    }
    // Область: указы с переменами есть — иначе проверка выше зелёная даром.
    expect(numbered).toBeGreaterThan(1);
  });

  it('паёк: еда процентом, мораль в день, рождения множителем или «нет»', () => {
    let numbered = 0;
    for (const r of RATIONS) {
      const line = rationLine(r);
      if (r.food === 1 && r.moralePerDay === 0 && r.growth === 1) {
        expect(rationNumbers(r), r.id).toBeNull();
        expect(line, r.id).toBe(r.effect);
        continue;
      }
      numbered++;
      expect(after(line, 'еда'), `${r.id}: ${line}`).toBe(r.food === 1 ? null : Math.round((r.food - 1) * 100));
      expect(after(line, 'мораль'), `${r.id}: ${line}`).toBe(r.moralePerDay === 0 ? null : r.moralePerDay);
      if (r.growth === 0) expect(line, r.id).toMatch(/рождений нет/);
      else if (r.growth !== 1) expect(line, r.id).toContain(`рождения ×${String(r.growth).replace('.', ',')}`);
    }
    expect(numbered).toBeGreaterThan(1);
  });
});
