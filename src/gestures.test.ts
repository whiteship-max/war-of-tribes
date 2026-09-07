// Порог, по которому тап отделяется от ведения. Числа общие у деревни и карты,
// поэтому и проверяются один раз здесь.
import { describe, expect, it } from 'vitest';
import { Press, TAP_MOVE, TAP_MS, TAP_TARGET } from './gestures';

describe('тап и ведение', () => {
  it('касание без сдвига — тап', () => {
    const p = new Press(1, 100, 100, 0);
    expect(p.isTap(80)).toBe(true);
  });

  it('сдвиг меньше порога — всё ещё тап', () => {
    const p = new Press(1, 100, 100, 0);
    expect(p.move(100 + TAP_MOVE - 1, 100)).toBe(true);
    expect(p.isTap(80)).toBe(true);
  });

  it('сдвиг больше порога — ведение', () => {
    const p = new Press(1, 100, 100, 0);
    expect(p.move(100 + TAP_MOVE + 1, 100)).toBe(false);
    expect(p.isTap(80)).toBe(false);
  });

  it('порог меряется по диагонали, а не по осям', () => {
    const p = new Press(1, 0, 0, 0);
    // По каждой оси меньше порога, но вместе — дальше.
    p.move(TAP_MOVE * 0.8, TAP_MOVE * 0.8);
    expect(p.moved).toBe(true);
  });

  it('защёлкивается: вернуться на место и назвать это тапом нельзя', () => {
    const p = new Press(1, 100, 100, 0);
    p.move(160, 100);
    p.move(100, 100);
    expect(p.isTap(80)).toBe(false);
  });

  it('долгое удержание — не тап', () => {
    const p = new Press(1, 100, 100, 0);
    expect(p.isTap(TAP_MS + 1)).toBe(false);
    expect(new Press(1, 100, 100, 0).isTap(TAP_MS)).toBe(true);
  });

  it('минимальная цель под палец — та же, что --tap в стилях', () => {
    expect(TAP_TARGET).toBe(44);
  });
});
