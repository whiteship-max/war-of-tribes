// Граница быстрой приёмки (`quick.ts`): интервалы держат то, что обещает вывод, а сверка сдвига отличает
// перетасовку внутри прежней границы от сдвига за неё.
//
// Правило 11: область правила названа и проверена утверждением. Покрытие считается точно — суммой вероятностей
// исходов, чья граница накрывает правду, — а не бросками: у Уилсона покрытие колеблется от доли к доле, и
// бросок увидел бы шум броска, а не свойство. Область — доли от 2 до 98 % при числе случаев, с которого
// граница печатается (`SHARE_FROM`) и до 160 (раздел 6.3 полной); частоты — от 0.1 до 60 событий на прогон.
import { describe, expect, it } from 'vitest';
import { wilson } from './halfband';
import { FIELD_HEAD, SHARE_FROM, boundShift, boundsOf, poisson, rateText, shareText } from './quick';

const logFact = (n: number): number => {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
};

/** Точная вероятность, что граница доли из `n` случаев накроет правду `p`. */
function wilsonCover(n: number, p: number): number {
  let c = 0;
  for (let k = 0; k <= n; k++) {
    const b = wilson(k, n);
    if (b.lo <= p && p <= b.hi) c += Math.exp(logFact(n) - logFact(k) - logFact(n - k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
  }
  return c;
}

/** Точная вероятность, что граница числа событий накроет правду `m`. */
function poissonCover(m: number): number {
  let c = 0;
  for (let k = 0; k < 400; k++) {
    const b = poisson(k);
    if (b.lo <= m && m <= b.hi) c += Math.exp(-m + k * Math.log(m) - logFact(k));
  }
  return c;
}

describe('граница быстрой приёмки держит обещанное', () => {
  it('доля: в среднем 95 %, в худшей точке не хуже 89 % — от SHARE_FROM случаев', () => {
    let worst = 1;
    let sum = 0;
    let points = 0;
    for (let n = SHARE_FROM; n <= 160; n += n < 40 ? 1 : 10) {
      expect(n >= SHARE_FROM && n <= 160, `n=${n} вне области`).toBe(true);
      for (let p = 0.02; p < 0.985; p += 0.02) {
        expect(p > 0 && p < 1, `p=${p} вне области`).toBe(true);
        const c = wilsonCover(n, p);
        worst = Math.min(worst, c);
        sum += c;
        points++;
      }
    }
    expect(points).toBeGreaterThan(1000);
    expect(sum / points).toBeGreaterThanOrEqual(0.945);
    expect(worst).toBeGreaterThanOrEqual(0.89);
  });

  it('частота: не хуже 95 % при любом числе событий в области', () => {
    for (let m = 0.1; m <= 60; m += 0.1) {
      expect(m > 0 && m <= 60, `m=${m} вне области`).toBe(true);
      expect(poissonCover(m), `m=${m.toFixed(1)}`).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('меньше SHARE_FROM случаев — границы нет, и это сказано: при одном случае Уилсон держит 80 %', () => {
    expect(wilsonCover(1, 0.2)).toBeLessThan(0.85);
    expect(shareText(3, SHARE_FROM - 1)).toBe(`33% из ${SHARE_FROM - 1} — мало случаев, границы нет`);
    expect(boundsOf(['шапка', FIELD_HEAD, `  А: ${shareText(3, SHARE_FROM - 1)}`].join('\n')).size).toBe(0);
  });
});

describe('сверка сдвига по границе', () => {
  const out = (lines: string[]): string => ['шапка', FIELD_HEAD, 'срезано', ...lines].join('\n');

  it('печать и разбор — одна дверь: что напечатано, то и прочитано', () => {
    const text = out([`  А: прорвали: ${shareText(3, 14)}`, `  А: падения: ${rateText(6, 8, 'в ч на мир')}`]);
    const b = boundsOf(text);
    expect(b.get('А: прорвали')).toEqual({ value: 21, lo: 8, hi: 48 });
    expect(b.get('А: падения')?.value).toBe(0.75);
  });

  it('сдвиг внутри прежней границы — внутри, за ней — снаружи, и называется', () => {
    const before = out([`  А: прорвали: 20% [8%…42%] из 20`, `  Б: падения: 0.50 [0.20…0.90] в ч на мир, событий 6`]);
    const inside = out([`  А: прорвали: 35% [18%…57%] из 20`, `  Б: падения: 0.50 [0.20…0.90] в ч на мир, событий 6`]);
    expect(boundShift(before, inside)).toEqual({ inside: 1, outside: [] });
    const outside = out([`  А: прорвали: 60% [39%…78%] из 20`, `  Б: падения: 0.50 [0.20…0.90] в ч на мир, событий 6`]);
    const r = boundShift(before, outside);
    expect(r.inside).toBe(0);
    expect(r.outside).toEqual(['А: прорвали: 20 [8…42] → 60']);
  });

  it('пропавшее и новое ключевое число — за границей: сравнивать его не с чем', () => {
    const before = out([`  А: прорвали: 20% [8%…42%] из 20`]);
    const after = out([`  В: прорвали: 20% [8%…42%] из 20`]);
    expect(boundShift(before, after).outside.sort()).toEqual(['А: прорвали (пропало)', 'В: прорвали (новое)']);
  });
});
