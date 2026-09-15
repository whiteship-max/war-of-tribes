// Сравнение выводов: замер плавает, всё остальное — буква в букву.
import { describe, expect, it } from 'vitest';
import { measure, measuredValues, shifts, stableLines } from './measured';

const report = (heap: string, ms: string, alive: number, extra = ''): string =>
  [
    'ОЖИДАНИЕ',
    `  куча в деревне        ${measure(heap)} МБ`,
    `  вход на карту         ${measure(ms)} мс`,
    `  живых диорам          ${alive}   (обязана быть одна)`,
    extra,
    `  ${measure(`+${ms}s tg вьюпорт 760/760`)}`,
  ].join('\n');

describe('устойчивая часть вывода', () => {
  it('разные замеры при том же коде — совпадение', () => {
    expect(shifts(report('16.86', '55', 1), report('17.02', '61', 1))).toEqual([]);
  });

  it('разная ширина замера сдвигает колонки, но не смысл', () => {
    expect(shifts(report('9.1', '5', 1), report('112.44', '1250', 1))).toEqual([]);
  });

  it('устойчивое число, сдвинувшееся рядом с замером, — сдвиг', () => {
    const d = shifts(report('16.86', '55', 1), report('16.86', '55', 2));
    expect(d).toHaveLength(2);
    expect(d.map((s) => (s.before ? `−${s.was}` : `+${s.now}`)).sort()).toEqual(['+живых диорам 2 (обязана быть одна)', '−живых диорам 1 (обязана быть одна)']);
  });

  it('строка из одних замеров не сравнивается: её число зависит от гонки', () => {
    const a = report('1', '2', 1);
    const b = report('1', '2', 1).split('\n').filter((l) => !l.includes('tg')).join('\n');
    expect(shifts(a, b)).toEqual([]);
  });

  it('новая устойчивая строка — сдвиг ровно на неё, а не на всё ниже', () => {
    const d = shifts(report('1', '2', 1), report('1', '2', 1, '  холстов 1'));
    expect(d).toEqual([{ before: 0, after: 5, was: '', now: 'холстов 1' }]);
  });

  it('место замера в строке сравнивается: замер, ставший числом, — сдвиг', () => {
    expect(shifts(`кадр ${measure('16.7')} мс`, 'кадр 16.7 мс')).toHaveLength(2);
  });

  it('цвет терминала и перевод строки Windows не сдвиг', () => {
    const esc = String.fromCharCode(27);
    expect(stableLines(`${esc}[31mкод 1${esc}[0m\r\nдальше`)).toEqual(['код 1', 'дальше']);
  });

  it('замеры вынимаются по порядку', () => {
    expect(measuredValues(report('16.86', '55', 1))).toEqual(['16.86', '55', '+55s tg вьюпорт 760/760']);
  });
});
