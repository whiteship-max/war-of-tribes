// Совет Ратуши (РТ-1, docs/city_v3.md, «Решения РТ-1»): дверь `sim/council` — просители, найм, польза, жалованье, уход,
// очки правителя и старое сохранение. Каждая точка свойства сначала утверждает, что она внутри области правила (правило 11):
// окно — то же, ратуша — та, что даёт ступень, место — сидит.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AdvisorPost, GameState } from '../types';
import { createInitialState } from '../state';
import { DAY_LENGTH } from '../constants';
import { QUESTS } from '../data/quests';
import { AGENT_YEAR, RETIRE_AGE } from '../data/agents';
import { MAX_RULER_SKILL, REALM_BRANCHES } from '../data/realm';
import {
  ADVISOR_POSTS,
  COUNCIL_STEP,
  MAX_ADVISOR_LEVEL,
  POST_BRANCH,
  WINDOW_DAYS,
  advisorWage,
  candidateCount,
  councilTier,
  giftCeil,
  giftOf,
  hirePrice,
  windowOf,
} from '../councilrules';
import {
  buildRate,
  buildingOfType,
  councilWagesPerDay,
  deedProduction,
  faithGoldPerDay,
  freeRangeProduction,
  payGraceDays,
  population,
  stewardMult,
  taxIncomePerDay,
  treasurerMult,
  wagesPerDay,
} from '../derived';
import { TAX_BY_ID, TAX_PER_POP } from '../data/policy';
import { YARD_BY_JOB } from '../data/yards';
import { jobsOf } from '../data/buildings';
import { councilOf, councilStep, dismissAdvisor, mergeCouncil, vacancyEvent, vacancyPost } from './council';
import { bestCandidate, candidatesOf, hireAdvisor } from './candidates';
import { branchRate, pointsOf, rulerRate } from './points';
import { livingNames } from './dynasty';
import { tick } from './tick';
import { deserialize, serialize } from '../save';
import { resolveEvent } from './mail';
import { EVENT_BY_ID } from '../data/events';
import { playerProfile } from '@/world/bridge';
import { resolvePoints } from '../spiritrules';
import { spiritView } from './spirit';
import { assignWorker } from './workers';

/** Город без случайностей: вера названа, вести не идут, задания закрыты, ратуша уровня `hall`. */
function town(seed = 4242, hall = 1, over: (s: GameState) => void = () => {}): GameState {
  const s = createInitialState(seed);
  s.tutorialDone = true;
  s.nextEventAt = Infinity;
  s.completedQuests = QUESTS.map((q) => q.id);
  s.faith.id = 'catholic';
  s.gold = 100_000;
  buildingOfType(s, 'town_hall')!.level = hall;
  over(s);
  return s;
}

/** Назначить лучшего просителя должности. */
function hire(s: GameState, post: AdvisorPost): void {
  const c = bestCandidate(s, post);
  expect(c, `${post}: просители есть`).not.toBeNull();
  expect(hireAdvisor(s, post, c!.n)).toBeNull();
}

describe('просители: выводятся из сида, окна и ратуши', () => {
  it('старая и новая партия — без совета: польза единица, жалованья нет, ставка очков — правителя', () => {
    const s = town();
    expect(s.council).toBeUndefined();
    expect(stewardMult(s)).toBe(1);
    expect(treasurerMult(s)).toBe(1);
    expect(councilWagesPerDay(s)).toBe(0);
    for (const b of REALM_BRANCHES) expect(branchRate(s, b)).toBe(rulerRate(s, b));
  });

  it('ступень и длина списка — по ратуше: 1–3 → ур. 1 и двое, 4–6 → до 2 и трое, 7–10 → до 3 и четверо', () => {
    expect(COUNCIL_STEP).toBe(3);
    const want: [number, number, number][] = [
      [1, 1, 2], [3, 1, 2], [4, 2, 3], [6, 2, 3], [7, 3, 4], [10, 3, 4],
    ];
    for (const [hall, tier, count] of want) {
      expect(councilTier(hall), `ратуша ${hall}`).toBe(tier);
      expect(candidateCount(hall), `ратуша ${hall}`).toBe(count);
      for (const seed of [1, 2, 3, 77, 4242]) {
        const s = town(seed, hall);
        for (const post of ADVISOR_POSTS) {
          const list = candidatesOf(s, post);
          expect(list.length, `${seed}/${hall}/${post}`).toBe(count);
          for (const c of list) expect(c.level, `${seed}/${hall}/${post}`).toBeLessThanOrEqual(tier);
        }
      }
    }
  });

  it('тот же сид и окно — те же просители; новое окно — новые', () => {
    const a = town(9, 7);
    const b = town(9, 7);
    for (const post of ADVISOR_POSTS) expect(candidatesOf(a, post)).toEqual(candidatesOf(b, post));
    const before = candidatesOf(a, 'steward').map((c) => c.n);
    a.time += WINDOW_DAYS * DAY_LENGTH;
    expect(windowOf(a.time), 'следующее окно').toBe(windowOf(b.time) + 1);
    const after = candidatesOf(a, 'steward').map((c) => c.n);
    for (const n of after) expect(before).not.toContain(n);
  });

  it('свойство: подъём ратуши не опускает ни одного просителя окна — только поднимает или добавляет', () => {
    let points = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (let hall = 1; hall < 10; hall++) {
        const lo = town(seed, hall);
        const hi = town(seed, hall + 1);
        // Внутри области: окно одно, ратуша выше на уровень.
        expect(windowOf(lo.time)).toBe(windowOf(hi.time));
        for (const post of ADVISOR_POSTS) {
          const up = new Map(candidatesOf(hi, post).map((c) => [c.n, c.level]));
          for (const c of candidatesOf(lo, post)) {
            expect(up.has(c.n), `${seed}/${hall}/${post}: проситель ${c.n} остался`).toBe(true);
            expect(up.get(c.n)!, `${seed}/${hall}/${post}`).toBeGreaterThanOrEqual(c.level);
            points++;
          }
        }
      }
    }
    expect(points).toBeGreaterThan(1000);
  });

  it('имена просителей — без тёзок среди живых: дома, агентов и совета', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = town(seed, 10);
      hire(s, 'steward');
      const living = new Set(livingNames(s));
      expect(living.has(councilOf(s).seats.steward!.name), 'советник — среди живых поимённых').toBe(true);
      for (const post of ADVISOR_POSTS) for (const c of candidatesOf(s, post)) expect(living.has(c.name), `${seed}: ${c.name}`).toBe(false);
    }
  });

  it('вера не названа — просителей нет', () => {
    const s = town();
    s.faith.id = null;
    for (const post of ADVISOR_POSTS) expect(candidatesOf(s, post)).toEqual([]);
  });
});

describe('найм и отставка', () => {
  it('найм снимает плату за сезон вперёд, садит просителя, и второй раз его не взять', () => {
    const s = town(5, 7);
    const c = bestCandidate(s, 'treasurer')!;
    const gold = s.gold;
    const outlays = s.stats.outlays ?? 0;
    expect(hireAdvisor(s, 'treasurer', c.n)).toBeNull();
    expect(s.gold).toBe(gold - c.price);
    expect(c.price).toBe(hirePrice(c.level, c.trait));
    expect(s.stats.outlays ?? 0, 'плата — разовая трата описи').toBe(outlays + (c.price > 0 ? 1 : 0));
    const co = councilOf(s);
    expect(co.seats.treasurer?.n).toBe(c.n);
    expect(co.hired).toBe(1);
    expect(co.fees).toBe(c.price);
    expect(candidatesOf(s, 'treasurer').map((x) => x.n)).not.toContain(c.n);
    expect(hireAdvisor(s, 'treasurer', c.n)).not.toBeNull();
  });

  it('золота не хватает — отказ, и ничего не меняется', () => {
    const s = town(5, 7);
    const c = candidatesOf(s, 'marshal').find((x) => x.price > 0)!;
    s.gold = c.price - 1;
    expect(hireAdvisor(s, 'marshal', c.n)).toBe('Не хватает золота.');
    expect(s.council).toBeUndefined();
  });

  it('отставленный в том же окне вторым просителем не встаёт', () => {
    const s = town(5, 7);
    const c = bestCandidate(s, 'steward')!;
    hireAdvisor(s, 'steward', c.n);
    expect(dismissAdvisor(s, 'steward')).toBeNull();
    expect(councilOf(s).seats.steward).toBeUndefined();
    expect(candidatesOf(s, 'steward').map((x) => x.n)).not.toContain(c.n);
  });
});

describe('польза: Староста, Казначей, Воевода', () => {
  it('Староста множит стройку и добычу дворов ровно на свою пользу, а горн и вольный сбор — нет', () => {
    const s = town(3, 7, (g) => {
      g.pop += 12;
    });
    for (const job of jobsOf('farm')) assignWorker(s, buildingOfType(s, 'farm')!.id, 4, job);
    const rate = buildRate(s);
    const farm = buildingOfType(s, 'farm')!;
    const field = deedProduction(s, farm, 'farmer').food;
    const free = freeRangeProduction(s);
    expect(rate, 'стройка идёт').toBeGreaterThan(0);
    expect(field, 'поле работает').toBeGreaterThan(0);
    hire(s, 'steward');
    const a = councilOf(s).seats.steward!;
    const g = giftOf('steward', a.level, a.trait);
    expect(stewardMult(s)).toBeCloseTo(1 + g, 12);
    expect(buildRate(s)).toBeCloseTo(rate * (1 + g), 9);
    expect(deedProduction(s, farm, 'farmer').food).toBeCloseTo(field * (1 + g), 9);
    expect(YARD_BY_JOB.has('farmer')).toBe(true);
    // Вольный сбор — не двор: его выработка та же.
    expect(freeRangeProduction(s)).toEqual(free);
  });

  it('Казначей множит налог, а десятину прихода — нет', () => {
    const s = town(3, 7);
    s.faith.id = 'catholic';
    const tax = TAX_BY_ID[s.tax].perPop * population(s) * TAX_PER_POP;
    expect(tax, 'налог идёт').toBeGreaterThan(0);
    hire(s, 'treasurer');
    const a = councilOf(s).seats.treasurer!;
    expect(taxIncomePerDay(s)).toBeCloseTo(tax * (1 + giftOf('treasurer', a.level, a.trait)) + faithGoldPerDay(s), 9);
  });

  it('Воевода поднимает мораль и дисциплину дружины строкой духа — тем полем, что едет в мир (ДР-1)', () => {
    const s = town(3, 7);
    const before = playerProfile(s).spirit!;
    // Точка внутри области: шкалы не у верха — прибавка не срезана краем.
    expect(before.morale + resolvePoints(giftCeil('marshal')), 'мораль не у верха').toBeLessThan(100);
    hire(s, 'marshal');
    const a = councilOf(s).seats.marshal!;
    const gift = resolvePoints(giftOf('marshal', a.level, a.trait));
    expect(gift, 'польза Воеводы').toBeGreaterThan(0);
    expect(spiritView(s).morale.lines.find((l) => l.id === 'marshal')?.value).toBeCloseTo(gift, 9);
    const after = playerProfile(s).spirit!;
    expect(after.morale).toBeCloseTo(before.morale + gift, 0);
    expect(after.discipline).toBeCloseTo(before.discipline + gift, 0);
    // Своей прибавки стойкости больше нет: стойкость — строка морали.
    expect((playerProfile(s) as unknown as Record<string, unknown>).fervour).toBeUndefined();
  });
});

describe('жалованье и уход', () => {
  it('жалованье совета — в одной ведомости с войском, и книга совета считает уплаченное', () => {
    const s = town(3, 7);
    const before = wagesPerDay(s);
    hire(s, 'steward');
    hire(s, 'treasurer');
    const a = councilOf(s).seats;
    const wage = advisorWage(a.steward!.level, a.steward!.trait) + advisorWage(a.treasurer!.level, a.treasurer!.trait);
    expect(councilWagesPerDay(s)).toBeCloseTo(wage, 12);
    expect(wagesPerDay(s)).toBeCloseTo(before + wage, 12);
    const gold = s.gold;
    for (let i = 0; i < 2 * DAY_LENGTH; i++) tick(s, 1);
    expect(councilOf(s).paid).toBeCloseTo(2 * wage, 6);
    expect(s.gold, 'казна платит').toBeLessThan(gold + 2 * taxIncomePerDay(s) + 1);
  });

  it('неуплата дольше терпения Статуи — уходит самый дорогой, и о пустом месте ложится весть', () => {
    const s = town(3, 10);
    hire(s, 'steward');
    hire(s, 'marshal');
    s.gold = 0;
    s.tax = 'none' as typeof s.tax;
    const seats = councilOf(s).seats;
    const dear: AdvisorPost = advisorWage(seats.steward!.level, seats.steward!.trait) >= advisorWage(seats.marshal!.level, seats.marshal!.trait) ? 'steward' : 'marshal';
    let gone: AdvisorPost | null = null;
    for (let t = 0; t < 40 * DAY_LENGTH && !gone; t++) {
      tick(s, 1);
      for (const p of ['steward', 'marshal'] as const) if (!councilOf(s).seats[p]) gone = p;
    }
    expect(s.pay.late, 'внутри области: терпение кончилось').toBeGreaterThanOrEqual(payGraceDays(s) * DAY_LENGTH);
    expect(gone).toBe(dear);
    expect(councilOf(s).left?.[dear]?.why).toBe('unpaid');
    expect(s.inbox.map((e) => e.defId)).toContain(vacancyEvent(dear));
  });

  it('конец службы — по часам: покой или смерть, место пустеет, весть ложится один раз', () => {
    const s = town(11, 10);
    hire(s, 'treasurer');
    const a = councilOf(s).seats.treasurer!;
    expect(a.until).toBeGreaterThan(s.time);
    expect(a.until - a.at, 'не дольше, чем до покоя').toBeLessThanOrEqual((RETIRE_AGE - a.age0) * AGENT_YEAR + 1e-6);
    s.time = a.until - 1;
    expect(councilStep(s, 1)).toEqual([]);
    s.time = a.until;
    expect(councilStep(s, 1)).toEqual(['treasurer']);
    expect(councilOf(s).left?.treasurer?.why).toBe(a.dies ? 'died' : 'rest');
    expect(councilStep(s, 1)).toEqual([]);
  });

  it('весть о пустом месте: один ответ «Подождать» даром, место не занимает; выбор нового — окном совета', () => {
    const s = town(11, 10);
    hire(s, 'treasurer');
    s.time = councilOf(s).seats.treasurer!.until;
    tick(s, 1);
    const ev = s.inbox.find((e) => e.defId === vacancyEvent('treasurer'))!;
    expect(ev).toBeTruthy();
    const def = EVENT_BY_ID[ev.defId];
    expect(def.options.map((o) => o.label)).toEqual(['Подождать']);
    expect(def.silence).toBe(0);
    const gold = s.gold;
    const r = resolveEvent(s, 0, `${ev.defId}:${ev.at}`);
    expect(r.error).toBeNull();
    expect(councilOf(s).seats.treasurer).toBeUndefined();
    expect(s.gold).toBe(gold);
    expect(vacancyPost(ev.defId)).toBe('treasurer');
    expect(vacancyPost('wolves')).toBeNull();
    // Выбор — в совете: тот же лучший проситель назначается окном.
    expect(hireAdvisor(s, 'treasurer', bestCandidate(s, 'treasurer')!.n)).toBeNull();
    expect(councilOf(s).seats.treasurer).toBeTruthy();
  });
});

describe('очки правителя: совет дотягивает до лучшего правителя и не обгоняет его', () => {
  it('ставка вида — правитель плюс уровень советника, не выше лучшего правителя', () => {
    for (const skill of [1, 3, 5]) {
      const s = town(2, 10);
      for (const b of REALM_BRANCHES) s.realm.ruler.skills[b] = skill;
      for (const post of ADVISOR_POSTS) hire(s, post);
      for (const post of ADVISOR_POSTS) {
        const b = POST_BRANCH[post];
        const a = councilOf(s).seats[post]!;
        expect(branchRate(s, b)).toBe(Math.min(MAX_RULER_SKILL, skill + a.level + (a.trait === 'scholar' ? 1 : 0)));
        expect(branchRate(s, b)).toBeLessThanOrEqual(MAX_RULER_SKILL);
      }
    }
  });

  it('смена советника перекладывает базу: накопленное до минуты смены не теряется и не прибавляется задним числом', () => {
    const s = town(2, 10);
    for (const b of REALM_BRANCHES) s.realm.ruler.skills[b] = 1;
    s.time += 3 * DAY_LENGTH;
    const before = pointsOf(s, 'admin');
    hire(s, 'steward');
    expect(pointsOf(s, 'admin'), 'найм не трогает накопленное').toBeCloseTo(before, 9);
    s.time += DAY_LENGTH;
    const mid = pointsOf(s, 'admin');
    expect(mid - before).toBeCloseTo(branchRate(s, 'admin'), 9);
    dismissAdvisor(s, 'steward');
    expect(pointsOf(s, 'admin'), 'отставка не трогает накопленное').toBeCloseTo(mid, 9);
    s.time += DAY_LENGTH;
    expect(pointsOf(s, 'admin') - mid).toBeCloseTo(rulerRate(s, 'admin'), 9);
  });
});

describe('сохранение', () => {
  it('совет переживает запись и чтение, а партия без совета читается без него', () => {
    const s = town(8, 10);
    for (const post of ADVISOR_POSTS) hire(s, post);
    const back = deserialize(serialize(s))!;
    expect(back.council).toEqual(s.council);
    const old = town(8, 1);
    expect(deserialize(serialize(old))!.council).toBeUndefined();
  });

  it('место с чужой должностью, уровнем вне лестницы или неизвестной чертой не садится', () => {
    const good = { n: 1, name: 'Гуго Тихий', level: 2, trait: 'frugal', age0: 40, at: 0, until: 100, dies: false, look: 5 };
    const c = mergeCouncil({ seats: { steward: good, treasurer: { ...good, trait: 'king' }, marshal: { ...good, level: 99 }, judge: good }, hired: -3 })!;
    expect(Object.keys(c.seats).sort()).toEqual(['marshal', 'steward']);
    expect(c.seats.marshal!.level).toBe(MAX_ADVISOR_LEVEL);
    expect(c.hired).toBe(0);
  });
});

describe('одна дверь', () => {
  it('`GameState.council` пишет только `sim/council`', () => {
    const root = join(__dirname, '..', '..');
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) files.push(p);
      }
    };
    walk(root);
    const writers = files
      .filter((f) => /\.council\s*(=[^=]|\?\?=)|council\.(seats|took|hired|fees|paid|owed|left)\s*(=[^=]|\+=|-=)|seats\[[^\]]+\]\s*=[^=]/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f).split(sep).join('/'));
    expect(writers).toEqual(['game/sim/council.ts']);
  });
});
