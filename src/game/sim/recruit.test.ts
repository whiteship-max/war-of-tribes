// Агенты в Ратуше (АГ-1, docs/city_v3.md, «Решения АГ-1»): кандидаты тем же механизмом, что просители совета; найм, смена и
// увольнение каждой роли; влияние характеристик на дела одной дверью; черты; жалованье; весть о пустом месте; старое сохранение;
// одна дверь записи. Каждая точка свойства сначала утверждает, что она внутри области правила (правило 11): окно — то же, ратуша
// даёт ступень, человек — на месте и дома.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FigureId } from '@/world/types';
import type { Placed } from '@/world/shelter';
import type { GameState } from '../types';
import { createInitialState } from '../state';
import { DAY_LENGTH } from '../constants';
import { QUESTS } from '../data/quests';
import { AGENT_YEAR, DEED_XP, MAX_AGENT_LEVEL, RETIRE_AGE, SIGHT_PER_CIRCLE, STEALTH_PER_CIRCLE } from '../data/agents';
import { HIRE_GOLD_PER_POP } from '../data/hire';
import {
  AGENT_ROLES,
  ELOQUENCE_STEP,
  SABOTAGE_STEP,
  SERVICE_SHIFT,
  recruitAdvance,
  recruitAt,
  recruitId,
  recruitWage,
  roleOfRecruit,
  windowOfRecruit,
  type AgentTrait,
} from '../agentrules';
import { MAX_ADVISOR_LEVEL, WINDOW_DAYS, candidateCount, councilTier, windowEnd, windowOf } from '../councilrules';
import { agentWagesPerDay, buildingOfType, population, wagesPerDay } from '../derived';
import {
  agentLevel,
  eloquenceOf,
  headOf,
  mergeAgents,
  pipsOf,
  recordDeed,
  retireAgeAt,
  retiring,
  sabotageOf,
  sightBonusOf,
  stealthOf,
  traitsBorn,
  veilOf,
} from './agents';
import { veilAt } from '@/world/peril';
import { bestRecruit, hireBlock, hireRecruit, recruitsOf } from './recruits';
import { agentVacancyEvent, agentVacancyRole, dismissAgent, mergeRecruit, recruitBook, recruitStep } from './recruit';
import { settleHires } from './hire';
import { livingNames } from './dynasty';
import { creditTech } from './tech';
import { deserialize, serialize } from '../save';
import { EVENT_BY_ID } from '../data/events';
import { applyEffects, playerProfile } from '@/world/bridge';
import { rivalHarm } from '@/world/rivalspy';
import { tributeAsk } from '@/world/parley';

/** Город без случайностей: вера названа, вести не идут, задания закрыты, все места открыты, ратуша уровня `hall`. */
function town(seed = 4242, hall = 1): GameState {
  const s = createInitialState(seed);
  s.tutorialDone = true;
  s.nextEventAt = Infinity;
  s.completedQuests = QUESTS.map((q) => q.id);
  s.faith.id = 'catholic';
  s.gold = 1_000_000;
  // Сыгранная партия, как у отчётов (`autopilot.played`): люди на местах — и ступени засчитаны той же дверью.
  for (const id of AGENT_ROLES) s.agents[id].vacant = false;
  creditTech(s);
  buildingOfType(s, 'town_hall')!.level = hall;
  return s;
}

/** Где стоит человек: дома у своих ворот или в поле. */
const HOME: Placed = { phase: 'home', departAt: 0 };
const FIELD: Placed = { phase: 'field', departAt: 0 };

/** Нанять лучшего кандидата места (дома). */
function hire(s: GameState, role: FigureId): void {
  const c = bestRecruit(s, role);
  expect(c, `${role}: кандидаты есть`).not.toBeNull();
  expect(hireRecruit(s, role, c!.n, HOME)).toBeNull();
}

/** Найти в окнах, начиная с нынешнего, кандидата места с условием; время партии встаёт в его окно. */
function seek(s: GameState, role: FigureId, ok: (r: ReturnType<typeof recruitsOf>[number]) => boolean): ReturnType<typeof recruitsOf>[number] {
  for (let i = 0; i < 400; i++) {
    const c = recruitsOf(s, role).find(ok);
    if (c) return c;
    s.time = windowEnd(windowOf(s.time));
  }
  throw new Error(`${role}: кандидата нет за 400 окон`);
}

describe('кандидаты: тем же механизмом, что просители совета', () => {
  it('сколько и каких: ратуша даёт ступень и на одного больше кандидатов; тот же сид — те же люди; новое окно — новые', () => {
    for (const hall of [1, 4, 7, 10]) {
      const s = town(77, hall);
      const tier = councilTier(hall);
      for (const role of AGENT_ROLES) {
        const list = recruitsOf(s, role);
        expect(list, `${role}, ратуша ${hall}: кандидатов — на одного больше ступени`).toHaveLength(candidateCount(hall));
        for (const c of list) {
          expect(roleOfRecruit(c.n), 'номер кодирует место').toBe(role);
          expect(windowOfRecruit(c.n), 'и окно').toBe(windowOf(s.time));
          expect(c.level).toBeGreaterThanOrEqual(1);
          expect(c.level, 'не выше ступени ратуши').toBeLessThanOrEqual(tier);
          const head = Object.values(c.head).reduce((t, x) => t + (x ?? 0), 0);
          expect(head, 'врождённого — на кружок меньше уровня').toBe(c.level - 1);
          expect(c.traits.length).toBeGreaterThanOrEqual(1);
          expect(c.traits.length).toBeLessThanOrEqual(2);
          expect(c.price, 'плата — по ртам и жалованье вперёд').toBe(Math.ceil(HIRE_GOLD_PER_POP * population(s)) + recruitAdvance(c.level, c.traits));
        }
      }
      expect(recruitsOf(town(77, hall), 'spy'), 'тот же сид — те же кандидаты').toEqual(recruitsOf(s, 'spy'));
    }
    const s = town(77, 4);
    const before = recruitsOf(s, 'scout').map((c) => c.n);
    s.time = windowEnd(windowOf(s.time));
    expect(recruitsOf(s, 'scout').map((c) => c.n).some((n) => before.includes(n)), 'новое окно — новые номера').toBe(false);
  });

  it('свойство: подъём ратуши не опускает ни одного кандидата окна (уровень и врождённое — только растут)', () => {
    let points = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const role of AGENT_ROLES) {
        for (let slot = 0; slot < 2; slot++) {
          const n = recruitId(seed % 7, role, slot);
          for (let tier = 1; tier < MAX_ADVISOR_LEVEL; tier++) {
            const lo = recruitAt(seed, n, tier);
            const hi = recruitAt(seed, n, tier + 1);
            expect(hi.level, 'точка внутри области: ступень выше').toBeGreaterThanOrEqual(lo.level);
            for (const [k, v] of Object.entries(lo.head)) expect(hi.head[k as keyof typeof hi.head] ?? 0).toBeGreaterThanOrEqual(v ?? 0);
            expect(hi.traits, 'черты от ступени не зависят').toEqual(lo.traits);
            expect(hi.age0).toBe(lo.age0);
            points++;
          }
        }
      }
    }
    expect(points).toBe(40 * 4 * 2 * 2);
  });

  it('взятый в окне не встаёт снова, имена — без тёзок среди живых, вера не названа — кандидатов нет', () => {
    const s = town(9, 7);
    hire(s, 'scout');
    const n = s.agents.scout.cand!.n;
    expect(recruitsOf(s, 'scout').map((c) => c.n), 'нанятый ушёл из листа').not.toContain(n);
    expect(dismissAgent(s, 'scout', HOME)).toBeNull();
    expect(recruitsOf(s, 'scout').map((c) => c.n), 'уволенный в том же окне вторым не встаёт').not.toContain(n);
    // Сменённый тем же окном: его метки на месте больше нет — помнит только книга взятых (`took`).
    const next = bestRecruit(s, 'scout')!;
    expect(hireRecruit(s, 'scout', next.n, HOME)).toBeNull();
    expect(s.agents.scout.cand?.n, 'точка внутри области: на месте другой').not.toBe(n);
    expect(recruitsOf(s, 'scout').map((c) => c.n), 'сменённый в том же окне вторым не встаёт').not.toContain(n);
    const living = new Set(livingNames(s));
    for (const role of AGENT_ROLES) for (const c of recruitsOf(s, role)) expect(living.has(c.name), `${c.name}: тёзки нет`).toBe(false);
    const blind = town(9, 7);
    blind.faith.id = null;
    expect(recruitsOf(blind, 'spy')).toEqual([]);
  });
});

describe('найм, смена и увольнение — каждой роли', () => {
  it('найм на пустое место: плата со склада, человек встаёт сразу — новый номер, опыт с нуля, метка кандидата', () => {
    for (const role of AGENT_ROLES) {
      const s = town(31, 7);
      s.agents[role].vacant = true;
      const c = bestRecruit(s, role)!;
      const gold = s.gold;
      const person = s.agents[role].person;
      expect(hireRecruit(s, role, c.n, null), `${role}: на пустое место — без «где»`).toBeNull();
      expect(s.gold, `${role}: плата снята`).toBe(gold - c.price);
      expect(s.agents[role].vacant).toBe(false);
      expect(s.agents[role].person, `${role}: новый человек — новый номер`).toBe(person + 1);
      expect(s.agents[role].xp).toBe(0);
      expect(s.agents[role].name).toBe(c.name);
      expect(s.agents[role].cand).toEqual({ n: c.n, tier: c.tier, at: s.time });
      expect(s.agents[role].age0).toBe(c.age0);
      expect(recruitBook(s).hired).toBe(1);
      expect(recruitBook(s).fees).toBe(c.advance);
    }
  });

  it('смена: дома — новый на месте, прежний отставлен; в поле и вне строя — отказ словами, ничего не тронуто', () => {
    for (const role of AGENT_ROLES) {
      const s = town(32, 7);
      const c = bestRecruit(s, role)!;
      const before = { ...s.agents[role] };
      const gold = s.gold;
      const away = hireRecruit(s, role, c.n, FIELD);
      expect(away, `${role}: в поле — отказ`).toBe('В поле — менять дома.');
      expect(hireRecruit(s, role, c.n, { phase: 'down', departAt: 0 }), `${role}: вне строя — отказ`).toBe('Вне строя — менять дома.');
      expect(s.gold, 'плата не ушла').toBe(gold);
      expect(s.agents[role]).toEqual(before);
      expect(hireRecruit(s, role, c.n, HOME), `${role}: дома — меняют`).toBeNull();
      expect(s.agents[role].person).toBe(before.person + 1);
      expect(s.agents[role].cand?.n).toBe(c.n);
    }
  });

  it('увольнение: только дома; место пустеет без вести и без строки родословной; плата вперёд не возвращается', () => {
    for (const role of AGENT_ROLES) {
      const s = town(33, 7);
      hire(s, role);
      const gold = s.gold;
      expect(dismissAgent(s, role, FIELD), `${role}: в поле не увольняют`).toBe('В поле — менять дома.');
      expect(s.agents[role].vacant).toBe(false);
      expect(dismissAgent(s, role, HOME)).toBeNull();
      expect(s.agents[role].vacant).toBe(true);
      expect(s.gold, 'плата вперёд не вернулась').toBe(gold);
      expect(s.inbox.some((e) => e.defId === agentVacancyEvent(role)), 'уволенный — не весть').toBe(false);
      expect(s.lineage?.[role] ?? [], 'родословная уволенного не помнит').toEqual([]);
      expect(dismissAgent(s, role, HOME)).toBe('Место и так пустует.');
    }
  });

  it('отказы найма: нет золота, кандидата нет, прежний найм ещё идёт, место закрыто державой', () => {
    const s = town(34, 7);
    s.agents.scout.vacant = true;
    const c = bestRecruit(s, 'scout')!;
    s.gold = c.price - 1;
    expect(hireBlock(s, 'scout', c.n, null)).toBe('Не хватает золота.');
    s.gold = 1e6;
    expect(hireBlock(s, 'scout', 999_999, null)).toBe('Этого кандидата уже нет.');
    s.agents.scout.hiring = { until: s.time + 100, name: 'Ян', age0: 24 };
    expect(hireBlock(s, 'scout', c.n, null)).toBe('Прежний найм ещё идёт.');
    const fresh = createInitialState(35);
    fresh.faith.id = 'catholic';
    fresh.gold = 1e6;
    fresh.agents.spy.vacant = true;
    expect(hireBlock(fresh, 'spy', 0, null), 'место лазутчика закрыто державой — та же строка, что у ступени').toMatch(/./);
  });
});

describe('характеристики: каждая — одной дверью в своё дело', () => {
  it('разведчик: зоркость — кружки уровня и врождённого, той же лестницей (`SIGHT_PER_CIRCLE`)', () => {
    const s = town(41, 10);
    const c = seek(s, 'scout', (x) => (x.head.sight ?? 0) >= 1);
    expect(sightBonusOf(s), 'свой разведчик первого уровня — без зоркости').toBe(0);
    expect(hireRecruit(s, 'scout', c.n, HOME)).toBeNull();
    expect(agentLevel(s, 'scout'), 'точка внутри области: первый уровень').toBe(1);
    expect(sightBonusOf(s)).toBe(SIGHT_PER_CIRCLE * (c.head.sight ?? 0));
    expect(playerProfile(s).sightBonus, 'в мир — слепком').toBe(sightBonusOf(s));
  });

  it('лазутчик: скрытность в поимке и гибели, диверсия — в силе дела против соседа', () => {
    const s = town(42, 10);
    const c = seek(s, 'spy', (x) => (x.head.stealth ?? 0) >= 1 && (x.head.sabotage ?? 0) >= 1);
    expect(hireRecruit(s, 'spy', c.n, HOME)).toBeNull();
    expect(stealthOf(s)).toBeCloseTo(STEALTH_PER_CIRCLE * (c.head.stealth ?? 0), 9);
    expect(veilOf(s)).toBeCloseTo(veilAt(1 + (c.head.stealth ?? 0)), 9);
    expect(veilOf(s), 'гибель реже, чем у новичка').toBeLessThan(1);
    expect(sabotageOf(s)).toBeCloseTo(1 + SABOTAGE_STEP * (c.head.sabotage ?? 0), 9);
    const city = { stock: { wood: 1000, food: 1000 }, gold: 1000, stash: 0, pop: 400 };
    const base = rivalHarm('fire', city);
    const strong = rivalHarm('fire', city, sabotageOf(s));
    const sum = (x: Record<string, number> | undefined): number => Object.values(x ?? {}).reduce((t, v) => t + v, 0);
    expect(sum(strong.burned), 'диверсия жжёт больше').toBeGreaterThan(sum(base.burned));
    expect(sum(rivalHarm('theft', city, sabotageOf(s)).stolen), 'и уносит больше').toBeGreaterThan(sum(rivalHarm('theft', city).stolen));
    expect(rivalHarm('unrest', city, 2).lured ?? 0).toBeGreaterThan(rivalHarm('unrest', city).lured ?? 0);
  });

  it('дипломат: красноречие сбавляет дань за снятие осады; новичок и пустое место — справедливая', () => {
    const s = town(43, 10);
    expect(eloquenceOf(s), 'свой дипломат первого уровня — без красноречия').toBe(0);
    expect(playerProfile(s).eloquence, 'ноль в слепок не едет').toBeUndefined();
    const c = seek(s, 'diplomat', (x) => (x.head.eloquence ?? 0) >= 1);
    expect(hireRecruit(s, 'diplomat', c.n, HOME)).toBeNull();
    expect(eloquenceOf(s)).toBeCloseTo(ELOQUENCE_STEP * (c.head.eloquence ?? 0), 9);
    expect(playerProfile(s).eloquence).toBe(eloquenceOf(s));
    expect(tributeAsk(1000, eloquenceOf(s)), 'дань меньше справедливой').toBeLessThan(1000);
    expect(tributeAsk(1000, 0)).toBe(1000);
    s.agents.diplomat.vacant = true;
    expect(eloquenceOf(s)).toBe(0);
  });

  it('полководец: врождённые отметки — фора на той же лестнице; склонность — по номеру кандидата; потолок прежний', () => {
    const s = town(44, 10);
    buildingOfType(s, 'statue')!.level = 1;
    const c = seek(s, 'general', (x) => (x.head.pips ?? 0) >= 2);
    const total = (p: ReturnType<typeof pipsOf>): number => Object.entries(p).reduce((t, [k, v]) => (k === 'siege' ? t : t + (v ?? 0)), 0);
    expect(total(pipsOf(s)), 'свой полководец первого уровня при Статуе 1 — без отметок').toBe(0);
    expect(hireRecruit(s, 'general', c.n, HOME)).toBeNull();
    expect(agentLevel(s, 'general'), 'точка внутри области: первый уровень').toBe(1);
    expect(total(pipsOf(s)), 'отметок — столько, сколько врождённого').toBe(c.head.pips);
    s.agents.general.xp = 1e6;
    expect(total(pipsOf(s)), 'вершина лестницы — прежняя: четыре отметки').toBe(MAX_AGENT_LEVEL - 1);
  });
});

describe('черты, опыт, возраст и цена', () => {
  /** Человек на месте `role` с чертой `t`. */
  function withTrait(seed: number, role: FigureId, t: AgentTrait): GameState {
    const s = town(seed, 10);
    const c = seek(s, role, (x) => x.traits.includes(t));
    expect(hireRecruit(s, role, c.n, HOME)).toBeNull();
    expect(traitsBorn(s, role)).toContain(t);
    return s;
  }

  it('«способный»: удача даёт опыта на единицу больше; прочим — как прежде', () => {
    const s = withTrait(51, 'scout', 'apt');
    expect(recordDeed(s, { agent: 'scout', ok: true, at: 1e12, person: s.agents.scout.person })).toBe(DEED_XP.ok + 1);
    const t = town(51, 10);
    expect(recordDeed(t, { agent: 'scout', ok: true, at: 1e12, person: t.agents.scout.person }), 'свой человек').toBe(DEED_XP.ok);
  });

  it('«крепкий» и «хворый»: покой на ступень возраста позже и раньше; свой человек — в RETIRE_AGE', () => {
    const hale = withTrait(52, 'spy', 'hale');
    expect(retireAgeAt(hale, 'spy')).toBe(RETIRE_AGE + SERVICE_SHIFT);
    const frail = withTrait(53, 'spy', 'frail');
    expect(retireAgeAt(frail, 'spy')).toBe(RETIRE_AGE - SERVICE_SHIFT);
    const p = frail.agents.spy;
    frail.time = p.bornAt + (RETIRE_AGE - SERVICE_SHIFT - p.age0) * AGENT_YEAR - 1;
    expect(retiring(frail, 'spy'), 'за секунду до покоя — служит').toBe(false);
    frail.time += 2;
    expect(retiring(frail, 'spy'), 'хворый уходит раньше').toBe(true);
    expect(retireAgeAt(town(54), 'spy')).toBe(RETIRE_AGE);
  });

  it('«корыстный» — жалованье ступенью выше, «бережливый» — без платы вперёд', () => {
    expect(recruitWage(1, ['greedy'])).toBe(recruitWage(2, []));
    expect(recruitAdvance(2, ['frugal'])).toBe(0);
    expect(recruitAdvance(2, [])).toBe(Math.round(recruitWage(2, []) * WINDOW_DAYS));
  });

  it('жалованье — в одной ведомости с войском и советом; книга сервера считает уплаченное', () => {
    const s = town(55, 10);
    const wages0 = wagesPerDay(s);
    expect(agentWagesPerDay(s), 'свои люди служат без жалованья').toBe(0);
    hire(s, 'general');
    const r = recruitAt(s.seed, s.agents.general.cand!.n, s.agents.general.cand!.tier);
    expect(agentWagesPerDay(s)).toBe(recruitWage(r.level, r.traits));
    expect(wagesPerDay(s)).toBeCloseTo(wages0 + agentWagesPerDay(s), 9);
    recruitStep(s, DAY_LENGTH);
    expect(recruitBook(s).paid, 'казна полна — уплачено всё').toBeCloseTo(agentWagesPerDay(s), 6);
  });
});

describe('весть, старое сохранение и одна дверь', () => {
  it('гибель и покой — весть о пустом месте с дверью в Ратушу; случаем она не выпадает', () => {
    const s = town(61, 4);
    const person = s.agents.scout.person;
    applyEffects(s, [{ id: 'f1', lost: {}, resources: {}, prestige: 0, morale: 0, battle: null, fell: { agent: 'scout', person, peril: 0.04, where: 'у логова', why: [] }, text: '', good: false }]);
    expect(s.agents.scout.vacant).toBe(true);
    const ev = s.inbox.find((e) => e.defId === agentVacancyEvent('scout'));
    expect(ev, 'весть легла').toBeTruthy();
    expect(agentVacancyRole(ev!.defId)).toBe('scout');
    const def = EVENT_BY_ID[agentVacancyEvent('scout')];
    expect(def.weight(s), 'случаем не выпадает').toBe(0);
    expect(typeof def.text === 'function' ? def.text(s) : def.text).toMatch(/погиб/);
    const r = town(62, 4);
    applyEffects(r, [{ id: 'r1', lost: {}, resources: {}, prestige: 0, morale: 0, battle: null, retired: { agent: 'diplomat', person: r.agents.diplomat.person }, text: '', good: true }]);
    expect(r.inbox.some((e) => e.defId === agentVacancyEvent('diplomat')), 'покой — тоже весть').toBe(true);
  });

  it('старое сохранение: агенты без метки — ровные, без черт и жалованья; идущий прежний найм доходит, как раньше', () => {
    const s = town(71, 10);
    const old = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete old.recruit;
    const back = deserialize(JSON.stringify(old))!;
    for (const role of AGENT_ROLES) {
      expect(back.agents[role].cand, `${role}: метки нет`).toBeUndefined();
      expect(headOf(back, role)).toEqual({});
      expect(traitsBorn(back, role)).toEqual([]);
    }
    expect(agentWagesPerDay(back)).toBe(0);
    expect(back.recruit).toBeUndefined();
    // Прежний найм, начатый в здании до АГ-1, доходит своим сроком и ставит ровного человека.
    back.agents.spy.vacant = true;
    back.agents.spy.hiring = { until: back.time + 60, name: 'Ян Тихий', age0: 22 };
    back.time += 61;
    settleHires(back);
    expect(back.agents.spy.vacant).toBe(false);
    expect(back.agents.spy.name).toBe('Ян Тихий');
    expect(back.agents.spy.cand, 'пришёл прежним наймом — ровный').toBeUndefined();
  });

  it('чтение: метка и книга с проверкой — чужая ступень, дробный номер или чужое окно не садятся', () => {
    const a = mergeAgents({ spy: { xp: 0, cand: { n: 3.5, tier: 1, at: 0 } }, scout: { xp: 0, cand: { n: 1, tier: 9, at: 0 } }, general: { xp: 0, cand: { n: 8, tier: 2, at: 5 } } });
    expect(a.spy.cand).toBeUndefined();
    expect(a.scout.cand).toBeUndefined();
    expect(a.general.cand).toEqual({ n: 8, tier: 2, at: 5 });
    const b = mergeRecruit({ took: { w: 0, n: [1, 2, 9999] }, hired: -4, fees: 'x', paid: 3 });
    expect(b!.took.n, 'номер чужого окна не прячет никого').toEqual([1, 2]);
    expect(b!.hired).toBe(0);
    expect(b!.fees).toBe(0);
    expect(mergeRecruit(undefined)).toBeUndefined();
  });

  it('сохранение туда и обратно: нанятый остаётся тем же человеком с теми же числами', () => {
    const s = town(72, 10);
    for (const role of AGENT_ROLES) hire(s, role);
    const back = deserialize(serialize(s))!;
    for (const role of AGENT_ROLES) {
      expect(back.agents[role].cand).toEqual(s.agents[role].cand);
      expect(headOf(back, role)).toEqual(headOf(s, role));
    }
    expect(back.recruit).toEqual(s.recruit);
  });

  it('одна дверь: `s.recruit` пишет только `sim/recruit`, метку `cand` — только `sim/agents.seat`', () => {
    const root = join(__dirname, '..', '..');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) files.push(p);
      }
    };
    walk(root);
    const writers = (re: RegExp): string[] => files.filter((f) => re.test(readFileSync(f, 'utf8'))).map((f) => relative(root, f).split(sep).join('/'));
    expect(writers(/\.recruit\s*=[^=]/)).toEqual(['game/sim/recruit.ts']);
    expect(writers(/\.cand\s*=[^=]/)).toEqual(['game/sim/agents.ts']);
  });
});
