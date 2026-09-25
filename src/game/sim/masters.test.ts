// Наёмные мастера (docs/admin_branch.md, раздел 4.1): спор за золото, одна ведомость, одна дверь
// ухода, места Мастерской.
//
// Ценность механики — не прибавка к стройке, а спор за золото: одна казна платит либо копейщику,
// либо почти пятерым мастерам. Тесты держат то, без чего спор размывается: жалованье — формула
// бойца, ведомость одна, уход — дверь войска, прибавка — головы, а не процент. Каждая точка
// сначала утверждает, что она внутри области правила (CLAUDE.md, правило 11).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameState } from '../types';
import { createInitialState } from '../state';
import { DAY_LENGTH, RESOURCE_IDS } from '../constants';
import { QUESTS } from '../data/quests';
import { TAX_PER_POP } from '../data/policy';
import { WAGE_HEAD } from '../data/upkeep';
import { ADMIN_LEVELS, MASTERS_AT } from '../data/realm';
import {
  armySize,
  armyWagesPerDay,
  buildRate,
  buildingOfType,
  buildingSlots,
  crafterBuildShare,
  faithTilt,
  foodShortfall,
  handsCount,
  housingCapacity,
  masterWage,
  mastersBuildShare,
  mastersCount,
  mastersFoodPerDay,
  mastersWagesPerDay,
  payGraceDays,
  townFoodPerDay,
  upkeepInfo,
  wageOf,
  wageShare,
  wagesPerDay,
} from '../derived';
import { upkeepTick } from './upkeep';
import { hireMasters, mastersInfo, releaseMasters } from './masters';
import { assignWorker, normalizeAssignments } from './workers';
import { mastersCap } from './tech';
import { playerProfile } from '@/world/bridge';

const DT = 0.5;

/** Посёлок без случайностей, Мастерская десятого уровня, ветвь изучена до верха. */
function camp(over: (s: GameState) => void = () => {}): GameState {
  const s = createInitialState(4242);
  s.tutorialDone = true;
  s.nextEventAt = Infinity;
  s.completedQuests = QUESTS.map((q) => q.id);
  for (const r of RESOURCE_IDS) s.resources[r] = 5000;
  s.buildings.find((b) => b.type === MASTERS_AT)!.level = 10;
  s.realm.tech.admin = ADMIN_LEVELS;
  over(s);
  return s;
}

const hall = (s: GameState) => buildingOfType(s, MASTERS_AT)!;

describe('жалованье: одна формула и одна ведомость', () => {
  it('мастер получает то же, что боец, без строя и снаряжения', () => {
    const s = camp();
    expect(masterWage(s)).toBeCloseTo(TAX_PER_POP * WAGE_HEAD * wageShare(s), 12);
    // Спор, ради которого механика заведена: копейщик стоит нескольких мастеров.
    expect(wageOf(s, 'spearman') / masterWage(s), 'копейщик дороже мастера в разы').toBeGreaterThan(3);
  });

  /**
   * Закят множит обоих одной долей, и соотношение «копейщик против мастеров» от веры не зависит.
   * Область: у мусульманской деревни доля и правда меньше единицы — иначе сравнивать нечего.
   */
  it('закят не сдвигает спор: копейщик стоит тех же мастеров при любой вере', () => {
    const village = (faith: 'islam' | null): GameState =>
      camp((s) => {
        s.pop = 400;
        s.tax = 'high';
        s.faith.id = faith;
        s.buildings.find((b) => b.type === 'church')!.level = 10;
      });
    const m = village('islam');
    const o = village(null);
    expect(faithTilt(m).goldPerPop, 'точка внутри области: закят есть').toBeLessThan(0);
    expect(wageShare(m), 'и доля жалованья меньше единицы').toBeLessThan(1);
    expect(wageOf(m, 'spearman') / masterWage(m)).toBeCloseTo(wageOf(o, 'spearman') / masterWage(o), 12);
  });

  it('ведомость одна: мастера в ней, и её части сходятся', () => {
    const s = camp((st) => {
      st.army.spearman = 40;
    });
    const army = armyWagesPerDay(s);
    const before = wagesPerDay(s);
    s.masters = 12;
    expect(armyWagesPerDay(s), 'войску столько же').toBe(army);
    expect(wagesPerDay(s) - before, 'ведомость выросла ровно на мастеров').toBeCloseTo(12 * masterWage(s), 9);
    const up = upkeepInfo(s);
    expect(up.armyWages + up.mastersWages).toBeCloseTo(up.wages, 9);
    expect(up.mastersWages).toBeCloseTo(mastersWagesPerDay(s), 12);
    expect(up.masters).toBe(12);
  });
});

describe('стройка: головы, а не процент', () => {
  /**
   * Мастер прибавляет стройке ровно то, что прибавил бы ещё один ремесленник, — и прибавка не
   * зависит от того, сколько строит остальной посёлок. Процент к скорости рос бы вместе со
   * свободными руками; головы — нет. Область: свободные руки и правда разные в двух точках.
   */
  it('мастер добавляет ставку ремесленника, и она не растёт со свободными руками', () => {
    const add = (idle: number): number => {
      const s = camp((st) => {
        st.pop = 30 + idle;
      });
      const base = buildRate(s);
      s.masters = 6;
      return buildRate(s) - base;
    };
    const few = add(0);
    const many = add(300);
    expect(few, 'точка внутри области: мастера что-то прибавили').toBeGreaterThan(0);
    expect(many, 'прибавка та же при вдесятеро больших свободных руках').toBeCloseTo(few, 9);

    // Голова мастера весит ровно голову ремесленника: вклад Мастерской делится между ними по головам.
    const t = camp();
    assignWorker(t, hall(t).id, 4);
    const base = buildRate(t);
    t.masters = 6;
    const crafters = t.workers[hall(t).id];
    expect(crafters, 'точка внутри области: в Мастерской есть и свои люди').toBe(4);
    expect(mastersBuildShare(t), 'панель показывает ровно прибавку').toBeCloseTo(buildRate(t) - base, 9);
    expect(mastersBuildShare(t), 'шесть мастеров — шесть голов из десяти').toBeCloseTo(crafterBuildShare(t) * (6 / 10), 9);
  });
});

describe('уход — дверь войска: неуплата и голод', () => {
  // Шаг содержания зовётся напрямую, как в тестах войска: иначе прирост мешает отличить «ушёл
  // жителем» от «родился».
  const unpaid = (): { s: GameState; armyGone: number; mastersGone: number; came: number } => {
    const s = camp((st) => {
      st.tax = 'moderate';
      st.gold = 0;
      st.army.spearman = 400;
      for (const b of st.buildings) if (b.type === 'houses') b.level = 10;
      st.pop = 60;
    });
    s.masters = 40;
    s.pay.debt = 1000;
    s.pay.late = payGraceDays(s) * DAY_LENGTH;
    const army = armySize(s);
    const pop = s.pop;
    for (let i = 0; i < Math.round((20 * DAY_LENGTH) / DT); i++) upkeepTick(s, DT, 0);
    return { s, armyGone: army - armySize(s), mastersGone: 40 - mastersCount(s), came: s.pop - pop };
  };

  it('нечем платить — мастера уходят той же долей, что войско', () => {
    const { s, armyGone, mastersGone } = unpaid();
    expect(armyGone, 'точка внутри области: войско уходит').toBeGreaterThan(20);
    expect(mastersGone, 'и мастера уходят').toBeGreaterThan(2);
    // Доля одна: дробь копится до целого, расхождение не больше одной головы.
    expect(Math.abs(mastersGone / 40 - armyGone / 400), 'доля та же').toBeLessThanOrEqual(1 / 40 + 0.01);
    expect(housingCapacity(s) - s.pop, 'крыши и после ухода остались').toBeGreaterThan(0);
  });

  it('ушедший мастер жителем не остаётся — жителями возвращаются только бойцы', () => {
    const { armyGone, mastersGone, came } = unpaid();
    expect(mastersGone, 'точка внутри области: мастера ушли').toBeGreaterThan(2);
    expect(came, 'жителей прибыло ровно столько, сколько ушло бойцов').toBe(armyGone);
  });

  /**
   * Мастер ест последним, вместе с войском: за его хлеб жители не голодают. Точка построена так,
   * что посёлок сам себя кормит, а на мастеров не хватает: нехватка есть, и вся она — их.
   */
  it('нечем кормить — нехватка ложится на мастеров, а не на жителей', () => {
    const s = camp((st) => {
      st.resources.food = 0;
    });
    expect(foodShortfall(s), 'точка внутри области: без мастеров посёлок сыт').toEqual({ army: 0, town: false });
    s.masters = 1000;
    const short = foodShortfall(s);
    expect(short.army, 'нехватка есть — у мастеров').toBeGreaterThan(0);
    expect(short.town, 'а жители не голодают').toBe(false);
  });

  it('нечем кормить — мастера уходят голодом той же дверью', () => {
    const s = camp((st) => {
      st.gold = 1_000_000;
      st.resources.food = 0;
    });
    // Мастеров больше, чем прокормит излишек посёлка: дверь ухода мест не спрашивает, спрашивает хлеб.
    s.masters = 1000;
    s.pay.late = payGraceDays(s) * DAY_LENGTH;
    const short = foodShortfall(s);
    expect(short.army, 'точка внутри области: мастеров нечем кормить').toBeGreaterThan(0);
    for (let i = 0; i < Math.round((10 * DAY_LENGTH) / DT); i++) upkeepTick(s, DT, short.army);
    expect(s.pay.debt, 'платить есть чем — повод голод').toBe(0);
    expect(mastersCount(s), 'голодные ушли').toBeLessThan(1000);
  });
});

describe('места: мастер стоит на месте Мастерской', () => {
  it('наём — не больше свободных мест и не больше того, что пускает ветвь', () => {
    const s = camp((st) => {
      st.pop = 400;
    });
    const slots = buildingSlots(hall(s));
    expect(slots, 'точка внутри области: мест в Мастерской много').toBeGreaterThan(20);
    assignWorker(s, hall(s).id, slots - 10);
    expect(mastersInfo(s).room, 'свободно десять').toBe(10);
    expect(hireMasters(s, 11), 'сверх мест — отказ').toMatch(/мест/);
    expect(hireMasters(s, 10)).toBeNull();
    expect(handsCount(s, hall(s).id), 'мастера на местах').toBe(slots);
    expect(assignWorker(s, hall(s).id, 1), 'ремесленник на занятое место не встаёт').not.toBeNull();
    expect(mastersInfo(s).blocked, 'и ещё мастера не взять').toMatch(/мест/);

    const low = camp((st) => {
      st.realm.tech.admin = 2;
    });
    expect(mastersCap(low), 'точка внутри области: ветвь пускает меньше, чем мест').toBeLessThan(buildingSlots(hall(low)));
    expect(hireMasters(low, mastersCap(low) + 1), 'сверх открытого ветвью — её отказ').toMatch(/уровень административной ветви/);
    expect(hireMasters(low, mastersCap(low))).toBeNull();
    expect(releaseMasters(low, mastersCap(low))).toBeNull();
    expect(mastersCount(low)).toBe(0);
  });

  it('мест стало меньше — первыми уходят наёмные', () => {
    const s = camp((st) => {
      st.pop = 400;
    });
    const b = hall(s);
    const slots = buildingSlots(b);
    assignWorker(s, b.id, slots - 20);
    expect(hireMasters(s, 20)).toBeNull();
    const workers = s.workers[b.id];
    b.level -= 1;
    const over = handsCount(s, b.id) - buildingSlots(b);
    expect(over, 'точка внутри области: мест не хватает').toBeGreaterThan(0);
    expect(over, 'и мастеров хватает, чтобы уйти за всех').toBeLessThanOrEqual(20);
    normalizeAssignments(s);
    expect(s.workers[b.id], 'люди Мастерской на местах').toBe(workers);
    expect(mastersCount(s), 'ушли наёмные').toBe(20 - over);
  });
});

describe('осада: мастера едят из амбара города', () => {
  it('расход города в слепке мира растёт ровно на их паёк', () => {
    const s = camp();
    const without = playerProfile(s).foodPerHour ?? 0;
    const town = townFoodPerDay(s);
    expect(town, 'точка внутри области: город ест').toBeGreaterThan(0);
    s.masters = 30;
    const withM = playerProfile(s).foodPerHour ?? 0;
    expect(withM / without).toBeCloseTo((town + mastersFoodPerDay(s)) / town, 9);
  });
});

// ---------- Замок по исходникам ----------

const SRC = join(process.cwd(), 'src');

function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
  };
  walk(SRC);
  return out;
}

const bare = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('замки мастеров', () => {
  it('в число мастеров пишет одна дверь', () => {
    const allowed = [join('src', 'game', 'sim', 'masters.ts')];
    const bad: string[] = [];
    for (const file of sources()) {
      if (allowed.some((a) => file.endsWith(a))) continue;
      if (/\bs\.masters\s*([-+]?=(?!=)|\+\+|--)/.test(bare(file))) bad.push(file);
    }
    expect(bad, 'число мастеров правят мимо двери').toEqual([]);
  });

  it('у мастера нет своей ставки стройки и своей формулы жалованья', () => {
    const derived = bare(join(SRC, 'game', 'derived.ts'));
    const wage = derived.slice(derived.indexOf('export const masterWage'), derived.indexOf(';', derived.indexOf('export const masterWage')));
    expect(wage, 'жалованье мастера — формула бойца').toMatch(/wageAt\(s, 0, 0\)/);
    const rate = derived.slice(derived.indexOf('export function crafterBuildRate'), derived.indexOf('\n}', derived.indexOf('export function crafterBuildRate')));
    expect(rate, 'ставка мастера — ставка ремесленника').toMatch(/CRAFTER_BUILD \* \(workerCount\(s, shop\.id\) \+ mastersOn\(s, shop\.id\)\)/);
  });
});
