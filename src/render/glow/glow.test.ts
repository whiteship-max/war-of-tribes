// Ночной свет (docs/polish.md, П-9): огни только у видимых источников, мягкий спад без обрезки, предел без засветки,
// зажигание по очереди, мерцание в пределах, настоящих огней не больше уровня и без щелчка, двойник шейдера.
import { describe, expect, it } from 'vitest';
import { LAMP, LAMP_FADE_S, LAMP_KNEE, LAMP_SPEC, LampSlots, MAX_LAMPS, lampFacing, lampFall, lampFlicker, lampKnee, lampLife, lampOn, lampThreshold, type Lamp, type LampKind } from './lamps';
import { LAMP_GLSL } from './glsl';
import { buildStatic } from '../city/budget';
import { cityPlan } from '../city/layout';
import { TW_SPEC } from '../reel/spec';
import { QUALITIES } from '../quality';
import { sparkThreshold, sparksOf } from '@/ui/map/tw/night';

const KINDS = Object.keys(LAMP) as LampKind[];
const plan = cityPlan();
const city = buildStatic(plan, 'medium');

describe('ночной свет: спад, нормаль, предел', () => {
  it('спад мягкий и без обрезки: единица у огня, убывает, у края досягаемости — ноль без ступени', () => {
    for (const k of KINDS) {
      const r = LAMP[k].reach;
      expect(lampFall(0, r)).toBe(1);
      let prev = 1;
      // Граница области: точки — внутри досягаемости (0 < d < r), где спад вообще считается.
      for (let d = 0.05; d < r; d += 0.05) {
        expect(d).toBeLessThan(r);
        const v = lampFall(d * d, r);
        expect(v, `${k}: ${d.toFixed(2)} м`).toBeLessThanOrEqual(prev);
        expect(v).toBeGreaterThan(0);
        prev = v;
      }
      expect(lampFall((r - 1e-3) ** 2, r), `${k}: у края — почти ноль, без кольца`).toBeLessThan(1e-5);
      expect(lampFall(r * r, r)).toBe(0);
      expect(lampFall((r * 1.5) ** 2, r)).toBe(0);
    }
  });

  it('по нормали: к огню — полный свет, вскользь — немного, со спины — ноль (стена не горит кругом и не светит насквозь)', () => {
    expect(lampFacing(1)).toBe(1);
    expect(lampFacing(0)).toBeCloseTo(0.2, 6);
    expect(lampFacing(-0.25)).toBe(0);
    expect(lampFacing(-1)).toBe(0);
  });

  it('сумма огней не выбеливает камень: канал не выше предела, сколько ни сложи', () => {
    let prev = 0;
    for (let m = 0; m <= 200; m += 0.25) {
      const v = lampKnee(m);
      expect(v).toBeLessThan(LAMP_KNEE);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // Сам предел меньше двух: альбедо камня (до половины) даёт меньше единицы — не белое.
    expect(LAMP_KNEE * 0.5).toBeLessThan(1);
  });

  it('шейдер — тот же расчёт, что двойник: спад, обёртка нормали, предел, число мест', () => {
    const glsl = LAMP_GLSL.replace(/\s+/g, ' ');
    expect(glsl).toContain('win * win / (1.0 + 9.0 * x)');
    expect(lampFall(0.25, 1)).toBeCloseTo((1 - 0.0625) ** 2 / (1 + 9 * 0.25), 12);
    expect(glsl).toContain('* 0.8 + 0.2, 0.0, 1.0)');
    expect(glsl).toContain(`acc / (1.0 + m / ${LAMP_KNEE.toFixed(2)})`);
    expect(glsl).toContain(`gLampPos[${MAX_LAMPS}]`);
    expect(glsl).toContain('if (i >= gLampN) break;');
  });
});

describe('ночной свет: когда горит и как мерцает', () => {
  const lamps = city.lamps;

  it('днём не горит ни один огонь, глубокой ночью — все; в сумерках — часть (зажигаются по очереди)', () => {
    expect(lamps.length).toBeGreaterThan(40);
    for (const l of lamps) {
      expect(lampOn(l, 0)).toBe(0);
      expect(lampOn(l, 1)).toBe(1);
    }
    // Граница области: доля ночи внутри разброса порогов — от первого загоревшегося до последнего.
    const th = lamps.map(lampThreshold).sort((a, b) => a - b);
    const mid = (th[0] + th[th.length - 1]) / 2;
    expect(mid).toBeGreaterThan(th[0]);
    expect(mid).toBeLessThan(th[th.length - 1]);
    const lit = lamps.filter((l) => lampOn(l, mid) > 0.5).length;
    expect(lit, 'в сумерках горит часть огней').toBeGreaterThan(0);
    expect(lit).toBeLessThan(lamps.length);
    // И внутри вида огни горят не разом: факелы города загораются в разные минуты сумерек.
    const torches = lamps.filter((l) => l.kind === 'torch').map(lampThreshold);
    expect(Math.max(...torches) - Math.min(...torches), 'факелы — по очереди').toBeGreaterThan(LAMP.torch.span * 0.5);
    // Ворота и дозор (факелы) — раньше фонарей улиц: порог факела не позже порога фонаря того же разброса.
    expect(LAMP.torch.from).toBeLessThan(LAMP.lantern.from);
  });

  it('огонь разгорается и гаснет монотонно по доле ночи — на рассвете в обратном порядке', () => {
    for (const l of lamps.slice(0, 30)) {
      let prev = 0;
      for (let n = 0; n <= 1.0001; n += 0.01) {
        const v = lampOn(l, n);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = v;
      }
    }
  });

  it('мерцание — в пределах размаха вида, и пламя дышит (не стоит на месте)', () => {
    for (const k of KINDS) {
      const l: Lamp = { x: 3.3, y: 2, z: -7.1, kind: k, dx: 0, dz: 0, lift: 2 };
      const a = LAMP[k].flicker;
      let lo = Infinity;
      let hi = -Infinity;
      for (let t = 0; t < 30; t += 0.013) {
        const v = lampFlicker(l, t);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      expect(lo).toBeGreaterThanOrEqual(1 - a - 1e-9);
      expect(hi).toBeLessThanOrEqual(1 + a + 1e-9);
      expect(hi - lo, `${k}: мерцает`).toBeGreaterThan(a * 0.8);
    }
  });

  it('огонь со своим часом (пожар ролика): до начала не горит, разгорается, после конца гаснет за секунду', () => {
    const l: Lamp = { x: 0, y: 1, z: 0, kind: 'fire', dx: 0, dz: 0, lift: 1, from: 10, to: 20 };
    expect(lampLife(l, 9.9)).toBe(0);
    expect(lampLife(l, 10.75)).toBeCloseTo(0.5, 6);
    expect(lampLife(l, 15)).toBe(1);
    expect(lampLife(l, 20.5)).toBeCloseTo(0.5, 6);
    expect(lampLife(l, 21.2)).toBe(0);
    expect(lampLife({ ...l, from: undefined, to: undefined }, 0)).toBe(1);
  });
});

describe('ночной свет: настоящих огней — не больше уровня, смена без щелчка', () => {
  const row = (n: number): Lamp[] => Array.from({ length: n }, (_, i) => ({ x: i * 5, y: 3, z: 0, kind: 'torch', dx: 0, dz: 0, lift: 3 }));

  it('уровни: низкий < средний < высокий ≤ мест в шейдере; ролики берут те же числа', () => {
    expect(LAMP_SPEC.low.real).toBeLessThan(LAMP_SPEC.medium.real);
    expect(LAMP_SPEC.medium.real).toBeLessThan(LAMP_SPEC.high.real);
    expect(LAMP_SPEC.high.real).toBeLessThanOrEqual(MAX_LAMPS);
    for (const q of QUALITIES) expect(TW_SPEC[q].lamps).toBe(LAMP_SPEC[q].real);
  });

  it('стоя — ровно `cap` ближних к взгляду; мест не больше шейдерных и во время смены; вес за кадр — не больше шага наплыва', () => {
    const lamps = row(60);
    const on = new Float32Array(lamps.length).fill(1);
    for (const q of QUALITIES) {
      const cap = LAMP_SPEC[q].real;
      const slots = new LampSlots(lamps);
      let act = slots.step(0, 0, on, cap, 0.016);
      expect(act.length).toBe(cap);
      expect(Math.max(...act)).toBe(cap - 1);
      // Взгляд уходит на другой конец ряда: старые гаснут, новые наплывают.
      const dt = 0.016;
      let inside = false;
      for (let f = 0; f < 120; f++) {
        const before = Float32Array.from(slots.w);
        act = slots.step(295, 0, on, cap, dt);
        expect(act.length).toBeLessThanOrEqual(MAX_LAMPS);
        for (let i = 0; i < lamps.length; i++) {
          expect(Math.abs(slots.w[i] - before[i]), `огонь ${i}, кадр ${f}`).toBeLessThanOrEqual(dt / LAMP_FADE_S + 1e-6);
          if (slots.w[i] > 0 && slots.w[i] < 1) inside = true;
        }
      }
      // Граница области: смена правда шла (были огни на полпути), иначе «без щелчка» проверять нечем.
      expect(inside).toBe(true);
      expect(act.length).toBe(cap);
      expect(Math.min(...act)).toBe(lamps.length - cap);
    }
  });

  it('негорящий огонь настоящим не становится', () => {
    const lamps = row(10);
    const on = new Float32Array(10);
    on[7] = 1;
    const slots = new LampSlots(lamps);
    expect(slots.step(0, 0, on, 4, 0.016)).toEqual([7]);
  });
});

describe('ночной свет города: у каждого огня — видимый источник', () => {
  const pos = city.b.pos;
  const owner = city.b.cfg;
  const near = (l: Lamp, r: number, own0: boolean): boolean => {
    for (let k = 0; k < pos.length / 3; k++) {
      if (own0 && owner[k * 4 + 3] !== 0) continue;
      const dx = pos[k * 3] - l.x;
      const dy = pos[k * 3 + 1] - l.y;
      const dz = pos[k * 3 + 2] - l.z;
      if (dx * dx + dy * dy + dz * dz < r * r) return true;
    }
    return false;
  };

  it('есть все виды: факелы стен и ворот, фонари улиц и дверей, жаровня площади, горн кузницы', () => {
    const count = (k: LampKind): number => city.lamps.filter((l) => l.kind === k).length;
    expect(count('torch')).toBeGreaterThanOrEqual(20);
    expect(count('lantern')).toBeGreaterThanOrEqual(15);
    expect(count('brazier')).toBe(1);
    expect(count('forge')).toBe(1);
    // Фонари на столбах улиц и площади — стоят сами, ниже кровель.
    const posts = city.lamps.filter((l) => l.kind === 'lantern' && l.dx === 0 && l.dz === 0 && l.lift < 4);
    expect(posts.length).toBeGreaterThanOrEqual(8);
  });

  it('у огня на стене — железо (кронштейн, древко, клетка) вплотную; у прочих — их держатель рядом', () => {
    for (const l of city.lamps) {
      const wall = l.dx !== 0 || l.dz !== 0;
      expect(near(l, wall ? 0.6 : 0.9, wall), `${l.kind} у ${l.x.toFixed(1)}, ${l.z.toFixed(1)}`).toBe(true);
    }
  });

  it('стена огня — наружу, единичный вектор в плане; огонь над землёй', () => {
    for (const l of city.lamps) {
      const len = Math.hypot(l.dx, l.dz);
      expect(len === 0 || Math.abs(len - 1) < 1e-9).toBe(true);
      expect(l.lift).toBeGreaterThan(0.3);
    }
  });
});

describe('ночной свет карты', () => {
  it('огоньков у города больше, чем у деревни; у пепелища — ни одного; загораются в сумерках разно', () => {
    expect(sparksOf({ look: { kind: 'ruin' } } as never)).toBe(0);
    const id = 'eski-kale';
    const th = Array.from({ length: 11 }, (_, j) => sparkThreshold(id, j));
    for (const v of th) {
      expect(v).toBeGreaterThanOrEqual(0.08);
      expect(v).toBeLessThan(0.8);
    }
    expect(Math.max(...th) - Math.min(...th)).toBeGreaterThan(0.3);
  });
});
