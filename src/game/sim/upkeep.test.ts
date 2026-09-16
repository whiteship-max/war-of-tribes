// Содержание войска: плата, терпение, уход, роспуск, закят и отсрочка старых партий.
//
// Правила — `sim/upkeep.ts`, числа — `data/upkeep.ts`. Тесты гоняют настоящий шаг
// симуляции при игроке (`tick`) или без него (`catchUp`), а не формулу рядом. Каждая
// точка сначала утверждает, что она внутри области правила: казна пуста или полна,
// войско сыто или голодно, долг есть или нет. Иначе тест проходил бы даром.
import { describe, expect, it } from 'vitest';
import type { GameState, TroopId } from '../types';
import { createInitialState, SAVE_VERSION } from '../state';
import { deserialize, serialize } from '../save';
import { DAY_LENGTH, RESOURCE_IDS } from '../constants';
import { TROOP_IDS } from '../data/troops';
import { QUESTS } from '../data/quests';
import { WAGE_AMNESTY_DAYS } from '../data/upkeep';
import {
  armySize,
  faithTilt,
  foodShortfall,
  payGraceDays,
  taxIncomePerDay,
  wageOf,
  wageShare,
  wagesDue,
  wagesPerDay,
} from '../derived';
import { catchUp, tick } from './tick';
import { dismissSoldiers } from './upkeep';

const DT = 0.5;

/**
 * Посёлок без случайностей: событий нет, задания закрыты (награда едой наполнила бы
 * пустой амбар), склад полон — кроме того, что задано.
 */
function camp(over: (s: GameState) => void): GameState {
  const s = createInitialState(4242);
  s.tutorialDone = true;
  s.nextEventAt = Infinity;
  s.completedQuests = QUESTS.map((q) => q.id);
  for (const r of RESOURCE_IDS) s.resources[r] = 5000;
  over(s);
  return s;
}

/** Шаги живой игры на `days` игровых дней; `each` зовётся раз в шаг. */
function play(s: GameState, days: number, each: (s: GameState) => void = () => {}): void {
  const steps = Math.round((days * DAY_LENGTH) / DT);
  for (let i = 0; i < steps; i++) {
    tick(s, DT);
    // Амбар держим полным: здесь меряется плата, а не голод.
    s.resources.food = Math.max(s.resources.food, 5000);
    each(s);
  }
}

describe('жалованье', () => {
  it('снимается с казны тем же шагом, каким в неё капает налог', () => {
    const s = camp((st) => {
      st.tax = 'moderate';
      st.gold = 100_000;
      st.army.spearman = 50;
    });
    const wages = wagesDue(s);
    const income = taxIncomePerDay(s);
    expect(wages, 'точка внутри области: жалованье есть').toBeGreaterThan(0);
    const before = s.gold;
    play(s, 1);
    expect(s.gold, 'казна не опустела — долга нет').toBeGreaterThan(0);
    expect(s.pay.debt).toBe(0);
    // Доход за день чуть сдвигается приростом; мерка — одна сотая дня жалованья.
    expect(Math.abs(s.gold - before - (income - wages))).toBeLessThan(wages * 0.01 + Math.abs(income) * 0.02);
  });

  it('с бойца строя и с головы: латник дороже дубинщика, но не в восемь раз', () => {
    const s = createInitialState();
    const club = wageOf(s, 'clubman');
    const leg = wageOf(s, 'legionary');
    expect(leg).toBeGreaterThan(club * 4);
    expect(leg).toBeLessThan(club * 8);
  });
});

describe('войско убывает до того, что тянет казна, и не ниже', () => {
  it('казна пуста, войско вдвое больше дохода: уходят, пока жалованье не сойдётся с доходом', () => {
    const s = camp((st) => {
      st.tax = 'moderate';
      st.gold = 0;
      st.army.spearman = 400;
    });
    expect(wagesDue(s) / taxIncomePerDay(s), 'точка внутри области: жалованье больше дохода').toBeGreaterThan(1.5);
    const wage = wageOf(s, 'spearman');
    let lowest = Infinity;
    let peak = 0;
    play(s, 80, (st) => {
      peak = Math.max(peak, st.pay.debt);
      // Ни в одну минуту войско не опускается ниже того, что казна тянет: жалованье не
      // меньше дохода больше чем на двух бойцов (дробь ухода копится до целого).
      lowest = Math.min(lowest, wagesDue(st) - taxIncomePerDay(st));
    });
    expect(lowest, 'ниже потолка не уходили').toBeGreaterThan(-2 * wage);
    expect(armySize(s), 'ушли').toBeLessThan(400);
    expect(wagesDue(s) - taxIncomePerDay(s), 'сошлись с доходом').toBeLessThan(3 * wage);
    // Долг уносят ушедшие: сошлись — от долга остаётся малая доля, а не всё, что
    // копилось, и следующий наём не начнёт уход без терпения.
    expect(peak, 'точка внутри области: долг был').toBeGreaterThan(10 * wage);
    expect(s.pay.debt, 'долг ушёл с ушедшими').toBeLessThan(peak * 0.1);
  });

  it('войско, которое казна тянет, не уходит вовсе', () => {
    const s = camp((st) => {
      st.tax = 'moderate';
      st.gold = 0;
      st.army.spearman = 8;
    });
    expect(wagesDue(s), 'точка внутри области: доход покрывает жалованье').toBeLessThan(taxIncomePerDay(s));
    play(s, 20);
    expect(s.army.spearman).toBe(8);
    expect(s.pay.debt).toBe(0);
  });
});

describe('терпение', () => {
  it('до срока Статуи не уходит никто, после — уходят', () => {
    // Срок — число Статуи: на десятом уровне он дольше первого на все девять ступеней.
    const graceAt = (level: number): number =>
      payGraceDays(camp((st) => (st.buildings.find((b) => b.type === 'statue')!.level = level)));
    expect(graceAt(10), 'выше Статуя — дольше терпят').toBeGreaterThan(graceAt(1) + 4);
    for (const level of [1, 10]) {
      const s = camp((st) => {
        st.tax = 'none';
        st.gold = 0;
        st.army.spearman = 200;
        st.buildings.find((b) => b.type === 'statue')!.level = level;
      });
      const grace = payGraceDays(s);
      play(s, grace - 0.05);
      expect(s.pay.debt, `уровень ${level}: точка внутри области — долг есть`).toBeGreaterThan(0);
      expect(s.army.spearman, `уровень ${level}: до срока все на месте`).toBe(200);
      play(s, 0.5);
      expect(s.army.spearman, `уровень ${level}: срок вышел — уходят`).toBeLessThan(200);
    }
  });

  it('без игрока долг копится, а уход ждёт; вернулся игрок — терпение с начала', () => {
    const s = camp((st) => {
      st.tax = 'none';
      st.gold = 0;
      st.army.spearman = 200;
    });
    const wages = wagesDue(s);
    catchUp(s, 10 * DAY_LENGTH, DT);
    expect(s.army.spearman, 'во сне никто не ушёл').toBe(200);
    expect(s.pay.debt, 'долг за десять дней').toBeGreaterThan(wages * 9.5);
    expect(s.pay.late, 'терпение без игрока не идёт').toBe(0);
    const grace = payGraceDays(s);
    play(s, grace - 0.05);
    expect(s.army.spearman, 'после возвращения — сначала срок, а не уход').toBe(200);
  });

  it('казна погасила долг — уход встаёт, и терпение начинается заново', () => {
    const s = camp((st) => {
      st.tax = 'none';
      st.gold = 0;
      st.army.spearman = 200;
    });
    play(s, payGraceDays(s) + 1);
    const left = s.army.spearman;
    expect(left, 'точка внутри области: уход идёт').toBeLessThan(200);
    s.gold = s.pay.debt + wagesDue(s) * 30;
    tick(s, DT);
    expect(s.pay.debt).toBe(0);
    expect(s.pay.late).toBe(0);
    play(s, 5);
    expect(s.army.spearman, 'доплата остановила уход').toBe(left);
  });
});

describe('уходит равная доля каждого вида', () => {
  it('рода не выбиваются: доля оставшихся у всех видов одна', () => {
    const start: Partial<Record<TroopId, number>> = { clubman: 300, spearman: 200, archer: 120, legionary: 60 };
    const s = camp((st) => {
      st.tax = 'none';
      st.gold = 0;
      for (const [id, n] of Object.entries(start)) st.army[id as TroopId] = n;
    });
    play(s, payGraceDays(s) + 3);
    const shares = Object.entries(start).map(([id, n]) => s.army[id as TroopId] / n);
    const total = armySize(s) / Object.values(start).reduce((a, b) => a + b, 0);
    expect(total, 'точка внутри области: ушла заметная доля').toBeLessThan(0.8);
    for (const [i, [id, n]] of Object.entries(start).entries()) {
      // Дробь копится до целого бойца по виду: расхождение не больше одного бойца вида.
      expect(Math.abs(shares[i] - total), id).toBeLessThanOrEqual(1 / n + 0.01);
    }
  });
});

describe('голод: та же дверь, второй повод', () => {
  it('амбар не прокормит войско — уходит войско, а посёлок не голодает', () => {
    const s = camp((st) => {
      st.tax = 'none';
      st.gold = 1_000_000;
      st.army.spearman = 300;
      st.resources.food = 0;
    });
    const short = foodShortfall(s);
    expect(short.army, 'точка внутри области: войско нечем кормить').toBeGreaterThan(0);
    expect(short.town, 'а посёлок сыт').toBe(false);
    const died = s.stats.died;
    const army = s.army.spearman;
    tick(s, DT);
    expect(s.resources.food, 'амбар и после шага пуст').toBe(0);
    expect(s.army.spearman).toBe(army);
    const steps = Math.round(((payGraceDays(s) + 8) * DAY_LENGTH) / DT);
    for (let i = 0; i < steps; i++) tick(s, DT);
    expect(s.pay.debt, 'платить есть чем — повод не жалованье').toBe(0);
    expect(s.army.spearman, 'ушли голодные').toBeLessThan(300);
    expect(s.stats.died, 'жители за войско не умирали').toBe(died);
    expect(s.starvation).toBe(0);
  });
});

describe('закят: воин не наёмник, а долг', () => {
  it('мусульманская деревня держит столько же войска, сколько соседи, — при любом налоге и уровне храма', () => {
    for (const tax of ['moderate', 'high'] as const) {
      for (const level of [3, 6, 10]) {
        const village = (faith: 'islam' | null): GameState => {
          const s = createInitialState(4242);
          s.pop = 400;
          s.tax = tax;
          s.faith.id = faith;
          s.buildings.find((b) => b.type === 'church')!.level = level;
          return s;
        };
        const m = village('islam');
        const o = village(null);
        const zakat = faithTilt(m).goldPerPop;
        expect(zakat, `${tax}, храм ${level}: точка внутри области — закят есть`).toBeLessThan(0);
        expect(taxIncomePerDay(m), `${tax}, храм ${level}: и сбор его покрывает`).toBeGreaterThan(0);
        // Потолок — там, где жалованье равно доходу. Равны отношения при любой армии —
        // равны и потолки.
        for (const n of [0, 50, 200, 800]) {
          m.army.spearman = n;
          o.army.spearman = n;
          const rm = wagesPerDay(m) - taxIncomePerDay(m) * (wagesPerDay(o) / Math.max(1e-9, taxIncomePerDay(o)));
          expect(Math.abs(rm), `${tax}, храм ${level}, копейщиков ${n}`).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('десятина жалованья не дорожит, и без налога скидки нет', () => {
    const s = createInitialState();
    s.faith.id = 'catholic';
    s.buildings.find((b) => b.type === 'church')!.level = 10;
    expect(wageShare(s)).toBe(1);
    s.faith.id = 'islam';
    s.tax = 'none';
    expect(taxIncomePerDay(s), 'точка внутри области: закят больше сбора').toBeLessThanOrEqual(0);
    expect(wageShare(s)).toBe(1);
  });
});

describe('распустить', () => {
  it('люди — в посёлок, снаряжение — на склад, и только те, кто дома', () => {
    const s = createInitialState();
    s.army.spearman = 10;
    s.warriorsAway = 8;
    const pop = s.pop;
    const spears = s.equipment.spear;
    expect(dismissSoldiers(s, 'spearman', 3), 'дома только двое').toMatch(/2/);
    expect(dismissSoldiers(s, 'spearman', 2)).toBeNull();
    expect(s.army.spearman).toBe(8);
    expect(s.pop).toBe(pop + 2);
    expect(s.equipment.spear).toBe(spears + 2);
  });
});

describe('начатые партии', () => {
  it('отсрочка с минуты входа: платить не надо, пока она идёт, и никто не уходит', () => {
    const s = camp((st) => {
      st.tax = 'none';
      st.gold = 0;
      st.army.spearman = 300;
    });
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    raw.version = 13;
    delete raw.pay;
    // Запись «из будущего»: догона офлайна нет, и минута входа — `s.time`.
    raw.lastSaved = Number.MAX_SAFE_INTEGER;
    const old = deserialize(JSON.stringify(raw))!;
    expect(old.version).toBe(SAVE_VERSION);
    expect(old.pay.from).toBe(s.time + WAGE_AMNESTY_DAYS * DAY_LENGTH);
    expect(old.log.some((e) => /жалованье/.test(e.text)), 'игроку сказано').toBe(true);
    old.nextEventAt = Infinity;
    expect(wagesPerDay(old), 'точка внутри области: жалованье есть, дохода нет').toBeGreaterThan(taxIncomePerDay(old));
    play(old, WAGE_AMNESTY_DAYS - 0.1);
    expect(old.pay.debt, 'в отсрочку долга нет').toBe(0);
    expect(old.army.spearman).toBe(300);
    play(old, payGraceDays(old) + 1);
    expect(old.army.spearman, 'после отсрочки и срока — уходят').toBeLessThan(300);
  });

  it('новая партия платит с первой секунды и начинает с умеренным налогом', () => {
    const s = createInitialState();
    expect(s.pay.from).toBe(0);
    expect(s.tax).toBe('moderate');
    expect(TROOP_IDS.every((id) => wageOf(s, id) > 0)).toBe(true);
  });
});
