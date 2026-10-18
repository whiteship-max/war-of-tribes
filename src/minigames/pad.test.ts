/**
 * Руки промыслов (docs/minigames.md, 18.1): где палец движения и где кнопка действия, и как палец ведёт.
 */
import { describe, expect, it } from 'vitest';
import { MINIGAMES } from '@/game/data/minigames';
import { Sticks } from '@/prologue/controls';
import { TAP_MS, TAP_SLIP } from '@/gestures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AIM_RATE, LAYOUT_OF, SLIDE_OFF, TURN_RATE, ZONES, aimRate, buttonSide, slidOff, sticksWidth, turnRate, zoneAt } from './pad';

describe('руки промыслов', () => {
  it('слово владельца: ягоды, скот, рыбалка — палец движения слева, кнопка справа; охота — «Натянуть» слева, палец справа', () => {
    for (const g of ['berries', 'herd', 'fish'] as const) {
      expect(ZONES[LAYOUT_OF[g]].left, g).toBe('pad');
      expect(buttonSide(LAYOUT_OF[g]), g).toBe('right');
    }
    expect(ZONES[LAYOUT_OF.hunt]).toEqual({ left: 'press', right: 'pad' });
    expect(buttonSide(LAYOUT_OF.hunt)).toBe('left');
    // Раскладка — у каждой игры таблицы.
    for (const g of MINIGAMES) expect(LAYOUT_OF[g.id], g.id).toBeDefined();
  });

  it('половина экрана решает, что ловит палец: середина — граница', () => {
    expect(zoneAt('walk', 10, 390)).toBe('pad');
    expect(zoneAt('walk', 380, 390)).toBe('look');
    expect(zoneAt('bow', 10, 390)).toBe('press');
    expect(zoneAt('bow', 380, 390)).toBe('pad');
    expect(zoneAt('rod', 194, 390)).toBe('pad');
    expect(zoneAt('rod', 195, 390)).toBe('press');
  });

  it('поворот: вправо — минус рыскания, полный ход — полная скорость, малый ход — много медленнее доли хода', () => {
    expect(turnRate(1)).toBeCloseTo(-TURN_RATE, 9);
    expect(turnRate(-1)).toBeCloseTo(TURN_RATE, 9);
    expect(turnRate(0)).toBe(-0);
    // Малый ход — четверть: скорость меньше четверти полной, на этом стоит доводка прицела.
    expect(Math.abs(turnRate(0.25))).toBeLessThan(TURN_RATE * 0.25);
    expect(aimRate(1)).toBeCloseTo(AIM_RATE, 9);
    expect(aimRate(0.25)).toBeCloseTo(AIM_RATE / 16, 9);
    // Монотонно по ходу.
    for (let k = 0; k < 1; k += 0.05) expect(Math.abs(turnRate(k + 0.05))).toBeGreaterThan(Math.abs(turnRate(k)));
  });

  it('кнопка обхода — тап общего судьи с порогами отчёта `tap`: сход 31 — тап, 33 — нет; 620 мс — тап, 780 — нет', () => {
    // Те же точки, что держит отчёт `tap` (docs/ui_v2.md, 2.5): по обе стороны `TAP_SLIP` и `TAP_MS`.
    expect(31).toBeLessThan(TAP_SLIP);
    expect(33).toBeGreaterThan(TAP_SLIP);
    expect(620).toBeLessThan(TAP_MS);
    expect(780).toBeGreaterThan(TAP_MS);
    const tap = (slip: number, ms: number): boolean | undefined => {
      const s = new Sticks();
      expect(s.down(1, 300, 600, 0, sticksWidth('look'))).toBe('look');
      s.move(1, 300 + slip, 600, ms / 2);
      return s.up(1, ms)?.tap;
    };
    expect(tap(31, 200)).toBe(true);
    expect(tap(33, 200)).toBe(false);
    expect(tap(0, 620)).toBe(true);
    expect(tap(0, 780)).toBe(false);
  });

  it('палец движения ложится в стик при любой точке, взгляд — во взгляд; второй палец в стик не берётся', () => {
    const s = new Sticks();
    expect(s.down(1, 380, 700, 0, sticksWidth('pad'))).toBe('walk');
    expect(s.down(2, 10, 700, 0, sticksWidth('pad'))).toBeNull();
    expect(s.down(3, 10, 700, 0, sticksWidth('look'))).toBe('look');
    s.move(1, 380, 700 - 56, 10);
    expect(s.walk().forward).toBeCloseTo(1, 9);
  });
});

// Отзыв тестеров 11.10 (docs/feedback.md): натянутый выстрел нечем было отменить. Палец, уведённый с «Натянуть», ослабляет
// тетиву без выстрела; дрожь держащего пальца — не уход.
describe('отмена натянутого выстрела — палец увели с кнопки', () => {
  it('дрожь до `TAP_SLIP` и сход в размер кнопки — на кнопке; дальше кнопки или в другую половину — ушёл', () => {
    const W = 390;
    const [x0, y0] = [60, 760];
    expect(TAP_SLIP, 'дрожь меньше кнопки').toBeLessThan(SLIDE_OFF);
    expect(zoneAt('bow', x0, W), 'точка внутри области: палец лёг на «Натянуть»').toBe('press');
    expect(slidOff('bow', x0, y0, x0 + TAP_SLIP, y0, W)).toBe(false);
    expect(slidOff('bow', x0, y0, x0, y0 - SLIDE_OFF, W), 'ровно размер кнопки — ещё на ней').toBe(false);
    expect(slidOff('bow', x0, y0, x0, y0 - SLIDE_OFF - 2, W), 'дальше кнопки — ушёл').toBe(true);
    // Лёг у самой середины: шаг через неё — уже другая половина, хоть и ближе размера кнопки.
    expect(slidOff('bow', W / 2 - 10, y0, W / 2 + 10, y0, W), 'в половину пальца движения — ушёл').toBe(true);
  });

  it('сцена: ушёл — тетива ослаблена сразу, отпускание после этого не стреляет; только у лука', () => {
    const stage = readFileSync(join(__dirname, 'stage.ts'), 'utf8');
    expect(stage).toMatch(/this\.layout === 'bow' && !this\.slid && slidOff\([\s\S]{0,120}\)\) \{\s*this\.slid = true;\s*if \(this\.phase === 'play'\) this\.play\.loose\?\.\(this\.t, false\);/);
    expect(stage).toMatch(/if \(this\.phase === 'play' && !this\.slid\) this\.play\.loose\?\.\(this\.t, true\);/);
  });
});
