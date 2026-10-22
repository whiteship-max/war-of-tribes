// Голос здания (docs/city_v3.md, ЗВ-1): у каждого здания свой, короткий, тихий, без повторов подряд и не чаще раза в 4 с;
// уровень слышен, ночь и тревога звучат своим; выключенный звук молчит.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '@/game/data/buildings';
import type { BuildingTypeId } from '@/game/types';
import { ALARM_VOICES, HALL_GAP, HALL_LOUD, HALL_MAX, HALL_MIN, HALL_MIX, HALL_SWAP, HALL_VOICES, HallVoices, layersAt, type HallMood } from './halls';
import { HALL_LATE, HallCue, type HallPlayer } from './hallcue';
import { seeded } from './rng';
import type { Kit } from './synth';

interface Call {
  k: string;
  v: number;
  at: number;
}

/** Поддельный контекст: источники с мигом старта, у каждого усилителя — его вызовы громкости. */
function fake(seed = 5): { kit: Kit; starts: number[]; gains: Call[][] } {
  const starts: number[] = [];
  const gains: Call[][] = [];
  const param = (log?: Call[]): Record<string, unknown> => {
    const p: Record<string, unknown> = { value: 0 };
    for (const k of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime']) {
      p[k] = (v: number, at: number) => {
        log?.push({ k, v, at });
        return p;
      };
    }
    return p;
  };
  const node = (log?: Call[], source = false): unknown =>
    new Proxy({} as Record<string | symbol, unknown>, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'start') return (at: number) => source && starts.push(at);
        if (k === 'connect' || k === 'disconnect' || k === 'stop') return () => undefined;
        if (k === 'type' || k === 'buffer' || k === 'loop') return undefined;
        t[k] = param(k === 'gain' ? log : undefined);
        return t[k];
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    });
  const ctx = {
    sampleRate: 22050,
    createOscillator: () => node(undefined, true),
    createBufferSource: () => node(undefined, true),
    createGain: () => {
      const log: Call[] = [];
      gains.push(log);
      return node(log);
    },
    createBiquadFilter: () => node(),
    createStereoPanner: () => node(),
    createBuffer: (_c: number, n: number) => ({ length: n, duration: n / 22050, getChannelData: () => new Float32Array(n) }),
  } as unknown as BaseAudioContext;
  const buf = { duration: 2 } as AudioBuffer;
  const kit: Kit = { ctx, rnd: seeded(seed), lite: false, white: buf, brown: buf, plucks: new Map(), space: null };
  return { kit, starts, gains };
}

const TYPES = BUILDINGS.map((b) => b.id as BuildingTypeId);
const MOODS: HallMood[] = ['day', 'night', 'alarm'];

describe('голос здания: у каждого свой', () => {
  it('у каждого здания игры — четыре варианта и два слоя богатства, и каждый звучит', () => {
    expect(TYPES.length).toBeGreaterThanOrEqual(24);
    for (const type of TYPES) {
      const def = HALL_VOICES[type];
      expect(def, `${type}: есть голос`).toBeDefined();
      expect(def.day.length, type).toBe(4);
      expect(def.more.length, type).toBe(2);
      for (let v = 0; v < 4; v++) {
        const f = fake(v + 1);
        def.day[v]({ kit: f.kit, out: {} as AudioNode, r: f.kit.rnd, t: 0, dur: 2, end: 1.7, v: HALL_MIX[type] });
        expect(f.starts.length, `${type}, вариант ${v} звучит`).toBeGreaterThan(0);
      }
    }
    // Лишних голосов — у зданий, которых нет, — не держим.
    expect(Object.keys(HALL_VOICES).sort()).toEqual([...TYPES].sort());
  });

  it('звучит днём, ночью и в тревогу; ночью молчит только кузница — горн погашен', () => {
    for (const type of TYPES)
      for (const mood of MOODS) {
        const f = fake();
        const got = new HallVoices(f.kit, {} as AudioNode).play(type, 5, mood, 0);
        if (type === 'smithy' && mood === 'night') {
          expect(got, 'кузница ночью').toBeNull();
          expect(f.starts.length).toBe(0);
          continue;
        }
        expect(got, `${type} ${mood}`).not.toBeNull();
        expect(f.starts.length, `${type} ${mood} звучит`).toBeGreaterThan(0);
      }
  });

  it('подряд один и тот же вариант не звучит, а за сотню касаний звучат все четыре', () => {
    for (const type of TYPES)
      for (const mood of MOODS) {
        if (type === 'smithy' && mood === 'night') continue;
        const h = new HallVoices(fake(11).kit, {} as AudioNode);
        const seen: number[] = [];
        for (let i = 0; i < 100; i++) seen.push(h.play(type, 5, mood, i * HALL_GAP)!.variant);
        for (let i = 1; i < seen.length; i++) expect(seen[i], `${type} ${mood}: касание ${i} повторило прежнее`).not.toBe(seen[i - 1]);
        expect(new Set(seen).size, `${type} ${mood}`).toBe(4);
      }
  });
});

describe('голос здания: не раздражает', () => {
  it('одно здание — не чаще раза в 4 с; другое — сразу', () => {
    const h = new HallVoices(fake().kit, {} as AudioNode);
    expect(h.play('tavern', 3, 'day', 10)).not.toBeNull();
    // Точки — по обе стороны границы `HALL_GAP`, утверждением.
    const early = 10 + HALL_GAP - 0.01;
    expect(early - 10).toBeLessThan(HALL_GAP);
    expect(h.play('tavern', 3, 'day', 10.5)).toBeNull();
    expect(h.play('tavern', 3, 'day', early)).toBeNull();
    expect(h.play('market', 3, 'day', 10.5)).not.toBeNull();
    expect(h.play('tavern', 3, 'day', 10 + HALL_GAP)).not.toBeNull();
  });

  it('длина — от 1,5 до 3 с: огибающая закрыта к концу, и ничто не начинается после неё', () => {
    for (const type of TYPES)
      for (const mood of MOODS)
        for (const level of [1, 10]) {
          const f = fake(level * 31 + type.length);
          const got = new HallVoices(f.kit, {} as AudioNode).play(type, level, mood, 3);
          if (!got) continue;
          expect(got.dur, type).toBeGreaterThanOrEqual(HALL_MIN);
          expect(got.dur, type).toBeLessThanOrEqual(HALL_MAX);
          const shape = f.gains[1];
          const last = shape[shape.length - 1];
          expect(last.v, `${type}: огибающая гаснет в ноль`).toBe(0);
          expect(last.at, type).toBeCloseTo(3 + got.dur, 6);
          for (const at of f.starts) expect(at, `${type} ${mood} ур. ${level}: звук после огибающей`).toBeLessThan(3 + got.dur - 0.05);
        }
  });

  it('новое касание мягко гасит прежний голос: голоса не наслаиваются', () => {
    const f = fake();
    const h = new HallVoices(f.kit, {} as AudioNode);
    h.play('tavern', 3, 'day', 1);
    const fadeA = f.gains[0];
    h.play('smithy', 3, 'day', 1.4);
    expect(fadeA).toContainEqual({ k: 'setTargetAtTime', v: 0, at: 1.4 });
    expect(HALL_SWAP).toBeLessThanOrEqual(0.1);
    // Гасится только прежний: у нового своей смены нет.
    const fades = f.gains.filter((g) => g.some((c) => c.k === 'setTargetAtTime'));
    expect(fades).toEqual([fadeA]);
  });

  it('тише событий фона: сила каждого здания в своём потолке, и ни один слой его не превышает', () => {
    // Сам уровень на выходе меряет стенд (`npm run audio:samples`, образцы `zv1-*`): пики −22…−26 дБ, ниже событий фона.
    for (const type of TYPES) {
      expect(HALL_MIX[type], type).toBeGreaterThan(0);
      expect(HALL_MIX[type], type).toBeLessThanOrEqual(HALL_LOUD);
      for (const mood of MOODS) {
        const p = new HallVoices(fake().kit, {} as AudioNode).play(type, 10, mood, 0);
        if (p) expect(p.peak, `${type} ${mood}`).toBeLessThanOrEqual(HALL_MIX[type] * 1.4);
      }
    }
  });
});

describe('голос здания: уровень, ночь, тревога', () => {
  it('у высокого уровня богаче: слоёв и голосов больше', () => {
    expect([1, 3, 4, 7, 8, 10].map(layersAt)).toEqual([1, 1, 2, 2, 3, 3]);
    for (const type of TYPES)
      for (const mood of MOODS) {
        if (type === 'smithy' && mood === 'night') continue;
        // Одно зерно — тот же вариант и та же длина: разница — только слои уровня.
        const at = (level: number): { n: number; layers: number } => {
          const f = fake(7);
          const p = new HallVoices(f.kit, {} as AudioNode).play(type, level, mood, 0)!;
          return { n: f.starts.length, layers: p.layers };
        };
        const [a, b, c] = [at(1), at(5), at(10)];
        expect(b.layers, `${type} ${mood}`).toBe(a.layers + 1);
        expect(c.layers, `${type} ${mood}`).toBe(a.layers + 2);
        expect(b.n, `${type} ${mood}: уровень 5 богаче 1`).toBeGreaterThan(a.n);
        expect(c.n, `${type} ${mood}: уровень 10 богаче 5`).toBeGreaterThan(b.n);
      }
  });

  it('ночью дома тише, а трактир громче; в тревогу — звон оружия поверх дома', () => {
    const peak = (type: BuildingTypeId, mood: HallMood): number => new HallVoices(fake().kit, {} as AudioNode).play(type, 1, mood, 0)!.peak;
    for (const type of ['market', 'church', 'barracks', 'farm'] as const) expect(peak(type, 'night'), type).toBeLessThan(peak(type, 'day'));
    expect(peak('tavern', 'night')).toBeGreaterThan(peak('tavern', 'day'));
    expect(ALARM_VOICES.length).toBe(4);
    const f = fake();
    const p = new HallVoices(f.kit, {} as AudioNode).play('farm', 1, 'alarm', 0)!;
    expect(p.layers, 'тревога — звон и дом под ним').toBe(2);
    expect(f.starts.length).toBeGreaterThan(0);
  });
});

describe('голос здания: дверь', () => {
  const player = (log: string[]): HallPlayer => ({
    play: (type, level, mood) => (log.push(`${type}:${level}:${mood}`), null),
  });

  it('выключенный звук молчит и куска не качает', async () => {
    const log: string[] = [];
    let loads = 0;
    const cue = new HallCue(
      async () => (loads++, player(log)),
      () => 0,
      () => false,
      () => 'day',
    );
    cue.tap('tavern', 3);
    await Promise.resolve();
    expect(loads).toBe(0);
    expect(log).toEqual([]);
  });

  it('первое касание качает кусок один раз и звучит, когда он доехал; опоздавшее и выключенное за это время — молчат', async () => {
    const log: string[] = [];
    let loads = 0;
    let now = 0;
    let on = true;
    const make = (): HallCue =>
      new HallCue(
        async () => (loads++, player(log)),
        () => now,
        () => on,
        () => 'night',
      );
    const a = make();
    a.tap('tavern', 3);
    a.tap('market', 2);
    await new Promise((r) => setTimeout(r, 0));
    expect(loads).toBe(1);
    // Звучит последнее касание до приезда куска — одно.
    expect(log).toEqual(['market:2:night']);
    a.tap('church', 4);
    expect(log).toEqual(['market:2:night', 'church:4:night']);

    // Граница `HALL_LATE`: опоздал — молчит.
    const b = make();
    log.length = 0;
    now = 0;
    b.tap('tavern', 3);
    now = HALL_LATE + 0.01;
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual([]);

    // Выключили, пока кусок ехал, — молчит.
    const c = make();
    now = 0;
    c.tap('tavern', 3);
    on = false;
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual([]);
  });

  it('кусок голосов — своей докачкой из звука города, на выходе «эффектов» и только при включённом звуке', () => {
    const src = readFileSync(join(__dirname, 'index.ts'), 'utf8');
    expect(src).toMatch(/import\('\.\/halls'\)/);
    expect(src).not.toMatch(/^import [^t].*from '\.\/halls'/m);
    expect(src).toMatch(/new m\.HallVoices\(kit, uiOut\)/);
    expect(src).toMatch(/soundOn\(\) && ctx\.state === 'running'/);
  });
});
