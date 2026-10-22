// Стабильность державы (docs/stability.md). Тесты держат обещания механики:
//
//  1. ступень — целое −3…+3: давление не выводит за края, сама она выше «Лада» не поднимается, выше +3 не купить;
//  2. цена — прямая до потолка тремя видами очков, трата одной дверью и без половинной покупки;
//  3. полоса идёт к цели со скоростью ропота, вниз вдвое быстрее; ступень двигает цель;
//  4. мятеж на −3 при высоком налоге — реален, на −2 — нет (цель Ц3); поднятый мятеж стоит ступени, встали — не работают;
//  5. исход мятежа: подавили боем — полоса вдвое; не подавили — условия; уступили — налог ниже, полоса в ноль;
//  6. старая партия читается ступенью 0, поле версию сохранения не поднимает.
//
// Область каждого правила названа утверждением в самом тесте (правило 11): точка за границей дала бы зелёный даром.
import { describe, expect, it } from 'vitest';
import type { GameState, StabilityState } from '../types';
import { createInitialState, SAVE_VERSION } from '../state';
import { deserialize, serialize } from '../save';
import { DAY_LENGTH, MUTINY_FUSE, MUTINY_SUPPRESS_MORALE, MUTINY_TOWN_LEAVE, RESOURCE_IDS } from '../constants';
import { POINTS_CAP, REALM_BRANCHES, levelPrice, levelsOf } from '../data/realm';
import { TAX_BY_ID } from '../data/policy';
import { EVENT_BY_ID } from '../data/events';
import { REVOLT_EVENT, TERMS_EVENT } from '../data/stability';
import { freeShare, housingCapacity, moraleBreakdown, orderBreakdown, productionPerDay } from '../derived';
import {
  GROUP_FALL,
  GROUP_RISE,
  STAB_BAND,
  STAB_CALM,
  STAB_DRAG,
  STAB_MAX,
  STAB_MIN,
  STAB_SELF_MAX,
  STAB_STEP,
  discontentOf,
  stabOutputMult,
  stabPrice,
} from '../stabrules';
import { folkCauses, groupsOf, pressureOf, stabForecast, stabLevel, stabOf, stabilityTick, steady, steadyInfo } from './stability';
import { draftStab } from '@/world/notice';
import { REVOLT_NEAR } from '../stabrules';
import { pointsOf } from './points';
import { tick } from './tick';
import { resolveEvent } from './actions';
import { eventId } from './mail';
import { settleGate } from './gate';

/** Спокойный посёлок: обучение пройдено, склад полон, ступень задана. */
function town(level = 0, over: Partial<StabilityState> = {}): GameState {
  const s = createInitialState(7);
  s.tutorialDone = true;
  for (const r of RESOURCE_IDS) s.resources[r] = 2000;
  s.gold = 2000;
  s.stab = { level, drift: 0, folk: 0, hungry: 0, past: [], bought: 0, spent: 0, revolts: 0, held: 0, ...over };
  return s;
}

/** Шаг стабильности без всего остального шага: правило меряется само, хозяйство не мешает. */
const stabFor = (s: GameState, seconds: number, dt = 1): string[] => {
  const raised: string[] = [];
  for (let t = 0; t < seconds; t += dt) {
    s.time += dt;
    const r = stabilityTick(s, dt, moraleBreakdown(s));
    if (r) raised.push(r);
  }
  return raised;
};

/** Очки всех трёх видов: столько и есть, отсчёт — от этой минуты. */
const givePoints = (s: GameState, n: number): void => {
  for (const b of REALM_BRANCHES) s.realm.points[b] = n;
  s.realm.pointsAt = s.time;
};

describe('ступень: целое −3…+3', () => {
  it('давление вниз не выводит ниже −3, вверх сама — не выше «Лада»', () => {
    const low = town(0);
    low.siege = { byName: 'Логово', until: 1e12 } as GameState['siege'];
    expect(pressureOf(low).total, 'точка внутри области: давление тянет вниз').toBeLessThan(0);
    stabFor(low, 200 * DAY_LENGTH, 5);
    expect(stabLevel(low)).toBe(STAB_MIN);
    expect(stabOf(low).drift, 'на дне сдвиг вниз не копится').toBe(0);

    const high = town(0);
    high.tax = 'none';
    expect(pressureOf(high).total, 'точка внутри области: давление тянет вверх').toBeGreaterThan(0);
    stabFor(high, 200 * DAY_LENGTH, 5);
    expect(stabLevel(high), 'сама — только до «Лада»').toBe(STAB_SELF_MAX);
    expect(stabOf(high).drift, 'на «Ладе» сдвиг вверх не копится').toBe(0);
  });

  it('купленная ступень выше «Лада» держится, пока давление не тянет вниз; выше +3 не купить', () => {
    const s = town(STAB_MAX - 1);
    s.tax = 'none';
    givePoints(s, POINTS_CAP);
    expect(steady(s)).toBeNull();
    expect(stabLevel(s)).toBe(STAB_MAX);
    stabFor(s, 50 * DAY_LENGTH, 5);
    expect(stabLevel(s), 'тихие дни купленное не отнимают').toBe(STAB_MAX);
    givePoints(s, POINTS_CAP);
    expect(steadyInfo(s).blocked).toBe('top');
    expect(steady(s)).toBe('top');
    expect(stabLevel(s)).toBe(STAB_MAX);
  });
});

describe('цена: прямая до потолка, три вида сразу', () => {
  it('верхняя ступень стоит потолок, цена растёт к +3, правилом цены технологии', () => {
    expect(stabPrice(STAB_MAX)).toBe(POINTS_CAP);
    for (let l = STAB_MIN + 2; l <= STAB_MAX; l++) expect(stabPrice(l)).toBeGreaterThan(stabPrice(l - 1));
    // Та же прямая, что у ветви длиной в шкалу ступеней: первая бесплатна, последняя — потолок.
    const n = STAB_MAX - STAB_MIN + 1;
    for (let l = STAB_MIN + 1; l <= STAB_MAX; l++) {
      expect(stabPrice(l)).toBe(Math.round((POINTS_CAP * (l - STAB_MIN)) / (n - 1)));
    }
    expect(levelPrice('admin', levelsOf('admin')), 'и у технологии верх — потолок').toBe(POINTS_CAP);
    expect(stabPrice(STAB_MIN), 'на дно не покупают').toBe(0);
  });

  it('укрепление тратит цену каждого вида; не хватает одного — не тратит ничего', () => {
    const s = town(0);
    const price = stabPrice(1);
    givePoints(s, price);
    s.realm.points.diplo = price - 1;
    expect(steady(s), 'дипломатии не хватает').toBe('points');
    expect(steadyInfo(s).short).toEqual(['diplo']);
    for (const b of REALM_BRANCHES) expect(pointsOf(s, b), `${b}: половинной покупки нет`).toBe(b === 'diplo' ? price - 1 : price);
    givePoints(s, price + 5);
    expect(steady(s)).toBeNull();
    for (const b of REALM_BRANCHES) expect(pointsOf(s, b), `${b}: ушла цена`).toBeCloseTo(5, 9);
    expect(stabLevel(s)).toBe(1);
    expect(stabOf(s).bought).toBe(1);
    expect(stabOf(s).spent).toBe(price);
    expect(stabOf(s).drift, 'ступень встаёт ровно').toBe(0);
  });
});

describe('недовольство: полоса идёт к цели со скоростью ропота', () => {
  it('высокий налог — цель податных его просадкой морали; рост — за срок ропота, спад — вдвое быстрее', () => {
    const s = town(0);
    s.tax = 'high';
    const target = groupsOf(s).find((g) => g.id === 'folk')!.target!;
    expect(target, 'вес налога — его просадка морали полосой роста').toBeCloseTo(discontentOf(TAX_BY_ID.high.moralePenalty), 9);
    expect(target, 'точка внутри области: цель выше нуля и ниже мятежа').toBeGreaterThan(0);
    expect(target).toBeLessThan(100);
    stabFor(s, DAY_LENGTH, 1);
    expect(stabOf(s).folk, 'за игровой день — скорость ропота').toBeCloseTo(Math.min(target, GROUP_RISE), 6);
    stabFor(s, 10 * DAY_LENGTH, 1);
    expect(stabOf(s).folk, 'дошла до цели и стоит').toBeCloseTo(target, 6);
    s.tax = 'none';
    const before = stabOf(s).folk;
    stabFor(s, DAY_LENGTH / 2, 1);
    expect(before - stabOf(s).folk, 'причину сняли — тает вдвое быстрее').toBeCloseTo(Math.min(before, GROUP_FALL / 2), 6);
    expect(GROUP_FALL).toBe(2 * GROUP_RISE);
    expect(GROUP_RISE * (MUTINY_FUSE / DAY_LENGTH), 'от нуля до ста — срок ропота').toBeCloseTo(100, 9);
  });

  it('ступень двигает цель: выше — спокойнее, ниже — злее, на шаг ступени', () => {
    const at = (level: number): number => {
      const s = town(level);
      s.tax = 'high';
      return groupsOf(s).find((g) => g.id === 'folk')!.target!;
    };
    expect(at(-1) - at(0)).toBeCloseTo(discontentOf(STAB_STEP), 9);
    expect(at(0) - at(1)).toBeCloseTo(discontentOf(STAB_STEP), 9);
    expect(at(3), 'на «Благоденствии» высокий налог не злит').toBe(0);
  });

  it('голодные: пустые закрома — их мера голода у морали; скудный паёк — доля урезанного', () => {
    const s = town(0);
    s.resources.food = 0;
    const lines = groupsOf(s).find((g) => g.id === 'hungry')!.lines;
    const starving = moraleBreakdown(s).lines.find((l) => l.id === 'starving');
    expect(starving, 'точка внутри области: мораль видит пустые закрома').toBeDefined();
    expect(lines.find((l) => l.id === 'starving')!.value).toBeCloseTo(discontentOf(-starving!.value), 9);
    s.resources.food = 2000;
    s.ration = 'lean';
    const lean = groupsOf(s).find((g) => g.id === 'hungry')!.lines.find((l) => l.id === 'ration')!;
    expect(lean.value).toBeGreaterThan(0);
    s.ration = 'rich';
    expect(groupsOf(s).find((g) => g.id === 'hungry')!.target, 'щедрый паёк голодных не злит').toBe(0);
  });
});

describe('мятеж: на −3 реален, на −2 — нет (цель Ц3)', () => {
  it('цель податных при высоком налоге: на −2 ниже ста, на −3 — выше', () => {
    const at = (level: number): number => {
      const s = town(level);
      s.tax = 'high';
      expect(folkCauses(s).map((l) => l.id), 'точка внутри области: кроме налога и ступени причин нет').toEqual(['tax', 'stab']);
      return groupsOf(s).find((g) => g.id === 'folk')!.target!;
    };
    expect(at(-2)).toBeLessThan(100);
    expect(at(-3)).toBeGreaterThanOrEqual(100);
    // Ступень — середина между границами цели, и ни одна граница не держится на равенстве.
    expect(STAB_STEP).toBeGreaterThan((STAB_BAND - TAX_BY_ID.high.moralePenalty) / 3);
    expect(STAB_STEP).toBeLessThan((STAB_BAND - TAX_BY_ID.high.moralePenalty) / 2);
  });

  it('на −3 при высоком налоге мятеж поднимается за срок ропота: весть на стол, встали — не работают', () => {
    const s = town(-3);
    s.tax = 'high';
    s.pop = 100;
    const work = productionPerDay(s).food;
    const raised = stabFor(s, MUTINY_FUSE + 2, 1);
    expect(raised, 'мятеж податных поднят ровно раз').toEqual([REVOLT_EVENT.folk]);
    expect(stabOf(s).revolt?.rebels).toBe(Math.round(100 * MUTINY_TOWN_LEAVE));
    expect(stabOf(s).revolts).toBe(1);
    expect(freeShare(s), 'вставшие не работают').toBeCloseTo(1 - MUTINY_TOWN_LEAVE, 9);
    expect(productionPerDay(s).food, 'выработка вольных упала на их долю').toBeLessThan(work);
  });

  it('поднятый мятеж стоит ступени', () => {
    const t = town(0, { folk: 99.9 });
    t.tax = 'high';
    t.pop = housingCapacity(t) * 3;
    expect(groupsOf(t).find((g) => g.id === 'folk')!.target, 'точка внутри области: теснота и налог — к мятежу').toBeGreaterThanOrEqual(100);
    expect(stabFor(t, 3, 1)).toEqual([REVOLT_EVENT.folk]);
    expect(stabLevel(t)).toBe(-1);
  });
});

describe('исход мятежа', () => {
  /** Посёлок с поднятым мятежом податных на столе. */
  function risen(): GameState {
    const s = town(0, { folk: 100 });
    s.tax = 'high';
    s.pop = 80;
    tick(s, 1);
    expect(s.inbox.some((e) => e.defId === REVOLT_EVENT.folk), 'точка внутри области: мятеж на столе').toBe(true);
    return s;
  }
  const answer = (s: GameState, i: number): void => {
    const ev = s.inbox.find((e) => e.defId === REVOLT_EVENT.folk || e.defId === TERMS_EVENT)!;
    expect(resolveEvent(s, i, eventId(ev)).error).toBeNull();
  };

  it('подавить: мятежники у ворот тем же вызовом; отбились — полоса вдвое, мораль платит, мятеж кончился', () => {
    const s = risen();
    answer(s, 0);
    const call = s.gate.find((c) => c.foe === 'rebels');
    expect(call, 'вызов к воротам').toBeDefined();
    expect(freeShare(s), 'пока бьются — стоят').toBeLessThan(1);
    const morale = s.morale;
    settleGate(s, { id: 'x', gate: call!.id, battle: 'won' } as never);
    expect(stabOf(s).folk).toBe(50);
    expect(stabOf(s).held).toBe(1);
    expect(stabOf(s).revolt).toBeUndefined();
    expect(freeShare(s)).toBe(1);
    expect(s.morale).toBeCloseTo(Math.max(0, morale - MUTINY_SUPPRESS_MORALE), 9);
  });

  it('не отбились — на стол ложатся условия; не уступать — упадок дольше и ступень вниз', () => {
    const s = risen();
    const level = stabLevel(s);
    answer(s, 0);
    const call = s.gate.find((c) => c.foe === 'rebels')!;
    settleGate(s, { id: 'x', gate: call.id, battle: 'lost' } as never);
    tick(s, 1);
    expect(s.inbox.some((e) => e.defId === TERMS_EVENT), 'условия на столе').toBe(true);
    expect(freeShare(s), 'упадок: стоят').toBeLessThan(1);
    answer(s, EVENT_BY_ID[TERMS_EVENT].silence);
    expect(stabLevel(s)).toBe(level - 1);
    expect(stabOf(s).revolt?.until).toBeGreaterThan(s.time);
  });

  it('уступить податным — налог ступенью ниже, полоса в ноль, мятеж кончился', () => {
    const s = risen();
    answer(s, 1);
    expect(s.tax).toBe('moderate');
    expect(stabOf(s).folk).toBe(0);
    expect(stabOf(s).revolt).toBeUndefined();
    expect(freeShare(s)).toBe(1);
  });

  it('переждать — упадок на срок, потом расходятся', () => {
    const s = risen();
    answer(s, 2);
    expect(freeShare(s)).toBeLessThan(1);
    stabFor(s, MUTINY_FUSE + 1, 1);
    expect(stabOf(s).revolt).toBeUndefined();
    expect(freeShare(s)).toBe(1);
  });

  it('молчание мятежа — «Подавить силой», и оно бесплатно', () => {
    for (const id of [REVOLT_EVENT.folk, REVOLT_EVENT.hungry, TERMS_EVENT]) {
      const def = EVENT_BY_ID[id];
      expect(def.options[def.silence].cost, `${id}: молчание ничего не стоит`).toBeUndefined();
    }
    expect(EVENT_BY_ID[REVOLT_EVENT.folk].silence).toBe(0);
  });
});

describe('что даёт ступень', () => {
  it('выработка и порядок — поправкой морали на шаг ступени; мораль не трогается', () => {
    const a = town(0);
    const b = town(2);
    expect(productionPerDay(b).food / productionPerDay(a).food).toBeCloseTo(stabOutputMult(2), 9);
    expect(stabOutputMult(-3)).toBeLessThan(1);
    expect(moraleBreakdown(b).target, 'мораль та же').toBe(moraleBreakdown(a).target);
    a.bonded = b.bonded = 40;
    expect(orderBreakdown(b).hold).toBeGreaterThan(orderBreakdown(a).hold);
    expect(orderBreakdown(a).lines.some((l) => l.id === 'stab'), 'на нуле строки нет').toBe(false);
  });

  it('давление: тихие дни и тяга недовольных; осада тянет, как группа целиком', () => {
    const s = town(0);
    s.tax = 'none';
    expect(pressureOf(s).total).toBeCloseTo(STAB_CALM, 9);
    s.siege = { byName: 'Логово', until: 1e12 } as GameState['siege'];
    expect(pressureOf(s).total).toBeCloseTo(STAB_CALM - STAB_DRAG, 9);
  });
});

describe('сохранение', () => {
  it('новая и старая партия — ступень 0; поле едет через запись и версию не поднимает', () => {
    const fresh = createInitialState(3);
    expect(fresh.stab, 'у новой партии поля нет').toBeUndefined();
    expect(stabLevel(fresh)).toBe(0);
    const old = deserialize(serialize(fresh))!;
    expect(old.stab).toBeUndefined();
    expect(stabLevel(old)).toBe(0);
    const s = town(-2, { folk: 40, bought: 1, spent: 40 });
    const back = deserialize(serialize(s))!;
    expect(back.stab).toEqual(s.stab);
    expect(back.version).toBe(SAVE_VERSION);
  });
});

describe('вести в бот: прогноз полос', () => {
  it('«мятеж близок» и «мятеж» — по скорости шага: прогноз сходится с самим шагом', () => {
    const s = town(-3);
    s.tax = 'high';
    const f = stabForecast(s).find((x) => x.group === 'folk')!;
    expect(f, 'точка внутри области: полоса растёт к мятежу').toBeDefined();
    expect(f.near).toBeCloseTo((REVOLT_NEAR / GROUP_RISE) * DAY_LENGTH, 6);
    expect(f.revolt).toBeCloseTo((100 / GROUP_RISE) * DAY_LENGTH, 6);
    // Шаг доходит до порога «близок» ровно к прогнозу.
    stabFor(s, Math.ceil(f.near!), 1);
    expect(stabOf(s).folk).toBeGreaterThanOrEqual(REVOLT_NEAR - 1e-6);
    expect(stabOf(s).near).toContain('folk');
  });

  it('полоса не растёт — прогноза нет; черновик — один ключ на случай', () => {
    const calm = town(0);
    calm.tax = 'none';
    expect(stabForecast(calm)).toEqual([]);
    const item = draftStab({ group: 'folk', kind: 'stab-revolt', at: 1_000_000_123, episode: 2 }, 1_000_000_000)!;
    expect(item.key).toBe('stab-revolt:folk:2');
    expect(item.fireAt % 60_000).toBe(0);
    expect(item.p.group).toBe('folk');
    expect(draftStab({ group: 'folk', kind: 'stab-near', at: 1e15, episode: 0 }, 0), 'дальше потолка списка — молчание').toBeNull();
  });
});
