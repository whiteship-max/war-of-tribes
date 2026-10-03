/**
 * Промыслы: энергия — функция от времени, добыча — доля потолка, потолок — доля суточной выработки, зерно — от отметки,
 * старое сохранение — с полным запасом (docs/minigames.md, разделы 1–2, 9).
 *
 * Область каждого правила названа и проверена утверждением (правило 11): энергия — между пустым и полным запасом
 * (точки берутся внутри суток после траты, и это утверждается); потолок — на городах с ненулевой выработкой
 * обоих запасов игр (еды и шкур), при шкале времени, отличной от единицы.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { RESOURCE_IDS } from '../constants';
import { buildingOfType, productionPerDay, storageCap } from '../derived';
import { deserialize, serialize } from '../save';
import { setTimeScale, timeScale } from '../pace';
import { DAY_MS } from '../time';
import { SEASON_SECONDS } from '../data/seasons';
import { ENERGY_MAX, ENERGY_REFILL, MINIGAME_COST, MINIGAME_SHARE, MINIGAMES, type MinigameId } from '../data/minigames';
import type { GameState } from '../types';
import {
  canPlay,
  dailyOutput,
  energyAt,
  energyFullIn,
  energyReadyIn,
  energyShown,
  harvest,
  minigameCap,
  minigameHaul,
  minigameSeed,
  minigameShares,
  type Harvest,
} from './minigames';

afterEach(() => setTimeScale());

const T0 = Date.UTC(2026, 9, 4, 6, 0, 0);

/** Город с выработкой обоих запасов игр: пастухи в загоне, охотники и собиратели — как в новой партии. */
function town(herders = 6): GameState {
  const s = createInitialState();
  s.resources.food = 0;
  s.resources.hides = 0;
  const pen = buildingOfType(s, 'pen');
  if (pen) s.workers[pen.id] = herders;
  s.pop += herders;
  return s;
}

const done = (r: Harvest | string): Harvest => {
  if (typeof r === 'string') throw new Error(r);
  return r;
};

describe('энергия — чистая функция от времени', () => {
  it('новая партия и партия без поля — полный запас в любую минуту', () => {
    const s = createInitialState();
    expect(s.energyFull).toBeUndefined();
    for (const now of [0, T0, T0 + 123_456_789]) expect(energyAt(s, now)).toBe(ENERGY_MAX);
    expect(energyFullIn(s, T0)).toBe(0);
    expect(canPlay(s, T0)).toBe(true);
  });

  it('трата сдвигает отметку на долю суток, запас копится сам и за сутки полон', () => {
    const s = town();
    done(harvest(s, 'berries', T0, 1));
    expect(energyAt(s, T0)).toBeCloseTo(ENERGY_MAX - MINIGAME_COST, 9);
    // Область: точки — внутри окна пополнения (отметка после траты — в будущем, не дальше суток).
    const left = energyFullIn(s, T0);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(ENERGY_REFILL);
    for (const k of [0.1, 0.25, 0.5, 0.9]) {
      const t = T0 + left * k;
      expect(energyFullIn(s, t)).toBeGreaterThan(0);
      // Копится ровно со скоростью «полный запас за сутки».
      expect(energyAt(s, t) - energyAt(s, T0)).toBeCloseTo((ENERGY_MAX * (t - T0)) / ENERGY_REFILL, 6);
    }
    expect(energyAt(s, T0 + left)).toBe(ENERGY_MAX);
    // Сутки — полный запас от нуля: четыре траты подряд опустошают, через сутки снова полон.
    const z = town();
    for (let i = 0; i < ENERGY_MAX / MINIGAME_COST; i++) done(harvest(z, 'berries', T0, 1));
    expect(energyAt(z, T0)).toBeCloseTo(0, 9);
    expect(energyAt(z, T0 + ENERGY_REFILL / 2)).toBeCloseTo(ENERGY_MAX / 2, 6);
    expect(energyAt(z, T0 + ENERGY_REFILL)).toBe(ENERGY_MAX);
    expect(ENERGY_REFILL).toBe(DAY_MS);
  });

  it('прочитанная по частям энергия — та же, что целиком: ничего не копится в чтении', () => {
    const a = town();
    const b = town();
    done(harvest(a, 'herd', T0, 0.5));
    done(harvest(b, 'herd', T0, 0.5));
    // Один читает каждую минуту, другой — раз в конце: чтение отметку не двигает.
    for (let m = 1; m <= 600; m++) energyAt(a, T0 + m * 60_000);
    expect(a.energyFull).toBe(b.energyFull);
    expect(energyAt(a, T0 + 600 * 60_000)).toBe(energyAt(b, T0 + 600 * 60_000));
  });

  it('без энергии игра отказывает и не меняет ни склада, ни отметки', () => {
    const s = town();
    for (let i = 0; i < ENERGY_MAX / MINIGAME_COST; i++) done(harvest(s, 'berries', T0, 1));
    const food = s.resources.food;
    const mark = s.energyFull;
    expect(canPlay(s, T0)).toBe(false);
    expect(harvest(s, 'berries', T0 + 1000, 1)).toBe('Энергии не хватает');
    expect(s.resources.food).toBe(food);
    expect(s.energyFull).toBe(mark);
    // Срок до игры — ровно когда граница пройдена, ни миллисекундой позже.
    const wait = energyReadyIn(s, T0);
    expect(wait).toBeCloseTo((MINIGAME_COST / ENERGY_MAX) * ENERGY_REFILL, 3);
    expect(canPlay(s, T0 + wait - 1)).toBe(false);
    expect(canPlay(s, T0 + wait)).toBe(true);
  });

  it('на экране — целая вниз: обещать игру, которой нет, нельзя', () => {
    const s = town();
    for (let i = 0; i < ENERGY_MAX / MINIGAME_COST; i++) done(harvest(s, 'berries', T0, 1));
    const t = T0 + energyReadyIn(s, T0) - 1;
    expect(energyAt(s, t)).toBeLessThan(MINIGAME_COST);
    expect(energyShown(s, t)).toBe(MINIGAME_COST - 1);
  });
});

describe('добыча — доля потолка', () => {
  it('доли двора: ягоды — вся еда, скот — еда и шкуры пастуха, в сумме единица', () => {
    expect(minigameShares('berries')).toEqual({ food: 1 });
    const herd = minigameShares('herd');
    expect(herd.food).toBeCloseTo(6 / 7.4, 9);
    expect(herd.hides).toBeCloseTo(1.4 / 7.4, 9);
    for (const g of MINIGAMES) expect(Object.values(minigameShares(g.id)).reduce((n, x) => n + (x ?? 0), 0)).toBeCloseTo(1, 9);
  });

  it('подделанный итог даёт не больше потолка, мусор — ноль', () => {
    const s = town();
    for (const g of MINIGAMES) {
      const top = minigameHaul(s, g.id, 1);
      // Область: у игры есть что добывать.
      expect(Object.keys(top).length).toBeGreaterThan(0);
      for (const forged of [1.0001, 2, 1e9]) expect(minigameHaul(s, g.id, forged)).toEqual(top);
      for (const junk of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -5, 0]) expect(minigameHaul(s, g.id, junk)).toEqual({});
      const cap = minigameCap(s, g.id);
      for (const r of RESOURCE_IDS) expect(top[r] ?? 0).toBeLessThanOrEqual(cap[r]);
    }
  });

  it('умение влияет на добычу: больше собрал — не меньше добыл', () => {
    const s = town();
    for (const g of MINIGAMES) {
      let was = -1;
      for (let q = 0; q <= 1.0001; q += 0.05) {
        const h = minigameHaul(s, g.id, q);
        const n = RESOURCE_IDS.reduce((sum, r) => sum + (h[r] ?? 0), 0);
        expect(n).toBeGreaterThanOrEqual(was);
        was = n;
      }
      expect(was).toBeGreaterThan(0);
    }
  });

  /**
   * Главное обещание: полный запас энергии на потолке — не больше `MINIGAME_SHARE` суточной выработки каждого запаса,
   * в какие бы игры его ни потратили. Набор: города новой партии, с пастухами и без, четыре сезона, шкалы 30 и 7.
   */
  it('полный запас приносит не больше доли суточной выработки — по любому запасу и любому выбору игр', () => {
    for (const scale of [30, 7]) {
      setTimeScale(scale);
      expect(timeScale()).not.toBe(1);
      for (const herders of [0, 3, 12]) {
        for (const season of [0, 1, 2, 3]) {
          const base = town(herders);
          base.time = season * SEASON_SECONDS + 30;
          const day = dailyOutput(base);
          // Область: у города есть выработка обоих запасов игр.
          expect(day.food).toBeGreaterThan(0);
          expect(day.hides).toBeGreaterThan(0);
          const plans: MinigameId[][] = [
            ['berries', 'berries', 'berries', 'berries'],
            ['herd', 'herd', 'herd', 'herd'],
            ['berries', 'herd', 'herd', 'berries'],
          ];
          for (const plan of plans) {
            const s = town(herders);
            s.time = base.time;
            let now = T0;
            const sum: Record<string, number> = {};
            for (const id of plan) {
              const h = done(harvest(s, id, now, 1));
              for (const r of RESOURCE_IDS) sum[r] = (sum[r] ?? 0) + (h.got[r] ?? 0);
              now += 1000;
            }
            expect(plan.length * MINIGAME_COST).toBe(ENERGY_MAX);
            for (const r of RESOURCE_IDS) expect(sum[r] ?? 0, `${scale} ${herders} ${season} ${plan} ${r}`).toBeLessThanOrEqual(MINIGAME_SHARE * day[r] + 1e-6);
            // Внутри области потолок не пустой: еда за полный запас ягод — почти вся доля.
            if (plan[0] === 'berries' && plan[1] === 'berries') expect(sum.food).toBeGreaterThan(MINIGAME_SHARE * day.food - plan.length);
          }
        }
      }
    }
  });

  it('потолок — сутки выработки города в долях: та же выработка, что в подсказке запаса', () => {
    const s = town();
    const perDay = productionPerDay(s);
    const days = ENERGY_REFILL / 1000 / timeScale() / 60;
    expect(dailyOutput(s).food).toBeCloseTo(perDay.food * days, 6);
    // При шкале ×30 игра на потолке — ровно игровой день выработки ягод (docs/minigames.md, раздел 2).
    expect(timeScale()).toBe(30);
    expect(minigameCap(s, 'berries').food).toBeCloseTo(perDay.food, 6);
  });

  it('на склад — не выше вместимости, и итог говорит, сколько легло', () => {
    const s = town();
    const cap = storageCap(s);
    s.resources.food = cap - 3;
    const h = done(harvest(s, 'berries', T0, 1));
    expect(h.got.food).toBeGreaterThan(3);
    expect(h.stored.food).toBe(3);
    expect(s.resources.food).toBe(cap);
  });
});

describe('зерно и сохранение', () => {
  it('зерно — от партии, игры и отметки: ушедший без траты заходит в ту же раскладку, после игры — новая', () => {
    const s = town();
    const a = minigameSeed(s, 'berries');
    expect(minigameSeed(s, 'berries')).toBe(a);
    expect(minigameSeed(s, 'herd')).not.toBe(a);
    const other = town();
    other.seed = s.seed + 1;
    expect(minigameSeed(other, 'berries')).not.toBe(a);
    done(harvest(s, 'herd', T0, 0));
    expect(minigameSeed(s, 'berries')).not.toBe(a);
  });

  it('старое сохранение без поля читается с полным запасом; с полем — отметка доезжает как была', () => {
    const s = town();
    const old = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete old.energyFull;
    const back = deserialize(JSON.stringify(old));
    expect(back).not.toBeNull();
    expect(back!.energyFull).toBeUndefined();
    expect(energyAt(back!, T0)).toBe(ENERGY_MAX);
    expect(back!.version).toBe(s.version);

    done(harvest(s, 'berries', T0, 1));
    const again = deserialize(serialize(s));
    expect(again!.energyFull).toBe(s.energyFull);
    expect(energyAt(again!, T0 + 3_600_000)).toBe(energyAt(s, T0 + 3_600_000));
  });
});
