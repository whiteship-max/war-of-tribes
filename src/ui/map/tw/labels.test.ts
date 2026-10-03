// Подписи холста карты нового вида (docs/ui_audit.md, 13): плашка имени и пилюля срока — испечённые, и закон кадра
// (docs/world-map.md) держится и для них: одна плашка на (имя, своё, цвет стороны, плотность), одна пилюля на (ширину,
// сторону, плотность), и ширина пилюли идёт ступенями — тикающий срок не печёт по пилюле в секунду.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SIDE_COLOR } from '@/side';
import { RELATION_META } from '@/world/data/meta';
import { realLeft } from '@/ui/parts/wait';
import { fakeCanvasEnv } from '../fakecanvas';
import { dropLabels, labelSprite, timerSprite, timerTextWidth, timerWidth } from './labels';

let env: ReturnType<typeof fakeCanvasEnv>;
beforeAll(() => {
  env = fakeCanvasEnv();
});
afterAll(() => env.restore());

describe('плашка имени места', () => {
  it('одна на имя, своё, цвет и плотность: повтор берётся из кэша, другой цвет стороны — своя плашка', () => {
    dropLabels();
    const a = labelSprite('Белая Гора', false, 2, RELATION_META.enemy.color);
    const made = env.created();
    expect(labelSprite('Белая Гора', false, 2, RELATION_META.enemy.color), 'повтор — тот же спрайт').toBe(a);
    expect(env.created(), 'повтор не печёт').toBe(made);
    const b = labelSprite('Белая Гора', false, 2, RELATION_META.barbarian.color);
    expect(b, 'цвет стороны — в ключе').not.toBe(a);
    const own = labelSprite('Белая Гора', true, 2, SIDE_COLOR.ours);
    expect(own.h, 'своё — крупнее').toBeGreaterThan(a.h);
  });

  it('плашка шире имени на поля и растёт с ним', () => {
    dropLabels();
    const short = labelSprite('Брод', false, 1, RELATION_META.neutral.color);
    const long = labelSprite('Каменный Брод у старой мельницы', false, 1, RELATION_META.neutral.color);
    expect(long.w).toBeGreaterThan(short.w);
    expect(short.w).toBeGreaterThan(timerTextWidth('Брод'));
  });
});

describe('пилюля срока похода', () => {
  it('ширина — ступенями по 6 px и не уже строки с полями', () => {
    // Область: ширины строк срока от пустой до самой длинной («23:59:59» и длиннее).
    let last = 0;
    for (let w = 0; w <= 120; w += 0.5) {
      const p = timerWidth(w);
      expect(p % 6, `${w}`).toBe(0);
      expect(p, `${w}: поля`).toBeGreaterThanOrEqual(w + 12);
      expect(p, `${w}: не убывает`).toBeGreaterThanOrEqual(last);
      last = p;
    }
  });

  it('час тикающего срока печёт считанные пилюли, а не по одной на секунду', () => {
    dropLabels();
    const widths = new Set<number>();
    // Область: срок от часа до нуля, каждую секунду — столько строк видит кадр за час похода.
    for (let sec = 3600; sec >= 0; sec--) widths.add(timerWidth(timerTextWidth(realLeft(sec))));
    expect(widths.size).toBeGreaterThan(1);
    expect(widths.size, 'пилюль за час').toBeLessThanOrEqual(6);
    for (const w of widths) {
      const p = timerSprite(w, false, 2);
      expect(timerSprite(w, false, 2), 'повтор — из кэша').toBe(p);
      expect(timerSprite(w, true, 2), 'своя сторона — своя пилюля').not.toBe(p);
    }
  });
});
