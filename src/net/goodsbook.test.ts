import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { RESOURCE_IDS } from '@/game/constants';
import {
  bondedTotal,
  currentSite,
  foodConsumptionPerDay,
  heatingWoodPerDay,
  housingCapacity,
  maxLevelFor,
  recruitsQueued,
  storageCap,
  taxIncomePerDay,
  upgradeInfo,
  wagesDue,
} from '@/game/derived';
import { startUpgrade, throwFeast } from '@/game/sim/actions';
import { recruitCheck, startRecruit } from '@/game/sim/army';
import { forgeCheck, startForge } from '@/game/sim/smithy';
import { startSurvey } from '@/game/sim/survey';
import { buyGoods, marketCheck } from '@/game/sim/market';
import { hireRecruit, recruitsOf } from '@/game/sim/recruits';
import { holdRite, riteInfo } from '@/game/sim/faith';
import { addBonded } from '@/game/sim/population';
import { creditTech } from '@/game/sim/tech';
import { tick } from '@/game/sim/tick';
import { EQUIPMENT_IDS } from '@/game/data/equipment';
import { TROOP_IDS } from '@/game/data/troops';
import { GOODS } from '@/game/data/market';
import { RATIONS } from '@/game/data/policy';
import { FAITHS } from '@/game/data/faiths';
import { SEASON_SECONDS } from '@/game/data/seasons';
import type { GameState } from '@/game/types';
import { gameDaysOfMs, gameDaysPerHour, gameSeconds } from '@/game/pace';
import { playerProfile } from '@/world/bridge';
import type { WatchCard } from '../../netlify/lib/contract';
import { GOODS_SLACK, drainCeil, goodsStep, holdsBetween, type GoodsBook, type GoodsCtx } from '../../netlify/lib/goods';
import { CLOCK_SKEW_SECONDS } from '../../netlify/lib/initdata';
import { eatFloorOf } from '../../netlify/lib/town';
import { watchOf } from './snapshot';

/** Минута дневного привоза — рынок РН-1 считает привоз по настоящим часам. */
const NOW = Date.UTC(2026, 9, 23, 10);

/**
 * Книга запасов сервера (`netlify/lib/goods.ts`, docs/security.md, ЗЩ-2) на настоящей партии игры: опись — та, что шлёт
 * игра (`watchOf`), траты — двери игры, время — `sim/tick`. Честный посёлок, который тратит всем, чем игра позволяет, ни
 * разу не получает «склад меньше подтверждённого»; та же запись, где счётчик трат не сдвинулся, — получает.
 */

/** Что сервер подтверждает у честного игрока — то, что называет опись (книги стройки и войска честного равны ей). */
const ctxOf = (c: WatchCard): GoodsCtx => ({
  levels: c.buildings,
  pop: c.pop,
  soldiers: Object.values(c.troops).reduce((t, n) => t + n, 0) + c.wounded + c.queued,
});

/** Книга, лёгшая с первой описью: равна ей. */
const bookOf = (c: WatchCard, at: number): GoodsBook => goodsStep(null, undefined, 0, c, at, ctxOf(c)).book;

/** Посёлок, которому есть чем платить: склад наполовину, казна, снаряжение, ступени, мораль. */
function town(seed = 5): GameState {
  const s = createInitialState(seed);
  for (const r of RESOURCE_IDS) s.resources[r] = Math.floor(storageCap(s) / 2);
  for (const id of EQUIPMENT_IDS) s.equipment[id] = 100;
  s.gold = 5000;
  s.faith.id = FAITHS[0].id;
  creditTech(s);
  s.morale = 100;
  for (const b of s.buildings) b.level = Math.min(maxLevelFor(b.type), 5);
  return s;
}

describe('каждая дверь трат — разовая трата описи', () => {
  /** Трата: первый вызов делает её и возвращает отказ или `null`. */
  const spends: [string, (s: GameState) => string | null][] = [
    [
      'стройка',
      (s) => {
        const b = s.buildings.find((x) => x.level < maxLevelFor(x.type) && !upgradeInfo(s, x).blocked)!;
        return startUpgrade(s, b.id);
      },
    ],
    ['найм', (s) => startRecruit(s, TROOP_IDS.find((t) => !recruitCheck(s, t, 5).blocked)!, 5)],
    ['ковка', (s) => startForge(s, EQUIPMENT_IDS.find((id) => !forgeCheck(s, id, 40).blocked)!, 40)],
    ['разведка округи', (s) => startSurvey(s)],
    ['пир', (s) => throwFeast(s)],
    ['покупка на рынке', (s) => buyGoods(s, GOODS.find((g) => !marketCheck(s, g.id, 1, NOW).blocked)!.id, 1, NOW)],
    [
      'наём агента',
      (s) => {
        // Место разведчика пустует (агент погиб): нанимать есть на что.
        s.agents.scout.vacant = true;
        const first = recruitsOf(s, 'scout')[0];
        return first ? hireRecruit(s, 'scout', first.n, null) : 'кандидатов нет';
      },
    ],
    ['обряд', (s) => (riteInfo(s).blocked ? riteInfo(s).blocked : holdRite(s))],
  ];

  it.each(spends)('%s: счётчик трат +1, книга не держит; та же запись без траты — держит, где убыль больше расхода', (name, spend) => {
    const s = town();
    const a = watchOf(s);
    const book = bookOf(a, 0);
    expect(spend(s), name).toBeNull();
    tick(s, gameSeconds(30));
    const b = watchOf(s);
    expect((b.outlays ?? 0) - (a.outlays ?? 0), `${name}: трата засчитана`).toBeGreaterThanOrEqual(1);
    expect(goodsStep(book, a, 0, b, 30_000, ctxOf(b)).hidden, `${name}: честная запись`).toEqual([]);
    // Подделка той же записи — траты будто не было. Где убыль больше потолка расхода полуминуты, правило спрошено.
    const forged = goodsStep(book, a, 0, { ...b, outlays: a.outlays, deeds: a.deeds }, 30_000, ctxOf(b));
    // Позволенная убыль — той же арифметикой, что у книги: потолок расхода за дни, которые могли пройти, с запасом.
    const days = gameDaysOfMs(30_000 + CLOCK_SKEW_SECONDS * 1000);
    const could = drainCeil(b.buildings, b.pop, b.bonded ?? 0, ctxOf(b).soldiers);
    const over = Object.keys(a.stock).some((k) => (a.stock[k] ?? 0) - (b.stock[k] ?? 0) > (could[k] ?? 0) * days * GOODS_SLACK + 1);
    if (over) expect(forged.hidden.length, `${name}: та же запись без траты`).toBeGreaterThan(0);
  });
});

describe('честная партия тратит всем, чем может: «склад меньше подтверждённого» — ни разу', () => {
  it('шесть часов записей раз в минуту: стройка, найм, ковка, пир, рынок, обряд и тихие минуты; подделка тихой минуты — поймана', () => {
    const s = town(11);
    s.army.spearman = 60;
    s.army.rider = 20;
    addBonded(s, 30);
    // Лишние рты — свободные руки до потолка жилья: хлеб в тихую минуту убывает расходом, и правило спрашивается (точки внутри
    // области, правило 11). Прежде убыль давал сам посёлок, вымиравший от двойного ухода рабочих (ECO-4).
    s.pop = housingCapacity(s);
    let a = watchOf(s);
    let book = bookOf(a, 0);
    let asked = 0;
    let caught = 0;
    const acts: ((s: GameState) => unknown)[] = [
      (x) => {
        if (currentSite(x)) return;
        const b = x.buildings.filter((y) => y.level < maxLevelFor(y.type) && !upgradeInfo(x, y).blocked)[0];
        if (b) startUpgrade(x, b.id);
      },
      (x) => {
        const t = TROOP_IDS.find((id) => !recruitCheck(x, id, 3).blocked);
        if (t) startRecruit(x, t, 3);
      },
      (x) => {
        const e = EQUIPMENT_IDS.find((id) => !forgeCheck(x, id, 5).blocked);
        if (e) startForge(x, e, 5);
      },
      (x) => throwFeast(x),
      (x) => {
        const g = GOODS.find((y) => !marketCheck(x, y.id, 1, NOW).blocked);
        if (g) buyGoods(x, g.id, 1, NOW);
      },
      (x) => (riteInfo(x).blocked ? null : holdRite(x)),
    ];
    for (let m = 1; m <= 360; m++) {
      // Каждая третья минута — с делом, остальные тихие: в них склад убывает только расходом.
      if (m % 3 === 0) acts[(m / 3) % acts.length](s);
      tick(s, gameSeconds(60));
      const b = watchOf(s);
      const step = goodsStep(book, a, (m - 1) * 60_000, b, m * 60_000, ctxOf(b));
      expect(step.hidden, `минута ${m}`).toEqual([]);
      // Точка внутри правила: промежуток тихий и склад убыл расходом — правило спрошено. Подделка той же минуты прячет
      // казну и хлеб целиком.
      if (holdsBetween(a, b, 60_000) && RESOURCE_IDS.concat().some((r) => (b.stock[r] ?? 0) < (a.stock[r] ?? 0))) {
        asked++;
        const forged = { ...b, stock: { ...b.stock, gold: 0, food: 0 } };
        if (goodsStep(book, a, (m - 1) * 60_000, forged, m * 60_000, ctxOf(b)).hidden.length > 0) caught++;
      }
      book = step.book;
      a = b;
    }
    expect(asked, 'правило спрошено').toBeGreaterThanOrEqual(100);
    expect(caught).toBe(asked);
  });

  it('опись без счётчика трат (старый клиент) — книга не держит: каждый промежуток с тратой', () => {
    const s = town();
    const a = { ...watchOf(s), outlays: undefined };
    tick(s, gameSeconds(60));
    const b = { ...watchOf(s), outlays: undefined, stock: {} };
    expect(goodsStep(bookOf(a, 0), a, 0, b, 60_000, ctxOf(b)).hidden).toEqual([]);
  });
});

/** Посёлки на всех сезонах, пайках и верах, с войском, конными, невольниками и наёмными мастерами. */
function towns(): GameState[] {
  const out: GameState[] = [];
  let seed = 1;
  for (const ration of RATIONS) {
    for (let season = 0; season < 8; season++) {
      for (const faith of FAITHS) {
        const s = town(seed++);
        s.ration = ration.id;
        s.time = season * SEASON_SECONDS + 10;
        s.faith.id = faith.id;
        // Без налога закят веры раздаёт казну (`derived.taxIncomePerDay` ниже нуля) — точка внутри области правила.
        if (season % 2 === 0) s.tax = 'none';
        s.army.spearman = 40;
        s.army.knight = 10;
        s.masters = 3;
        if (season % 2) addBonded(s, 25);
        out.push(s);
      }
    }
  }
  return out;
}

describe('потолок расхода без дела — не ниже расхода игры', () => {
  it('хлеб, дрова и казна на каждом сезоне, пайке и вере: расход игры не выше потолка; зимой дрова и закят — не ноль', () => {
    let heat = 0;
    let zakat = 0;
    // Каждый посёлок — и с войском и мастерами, и без них: без них казну убывает один закят, и потолок держит его отдельно.
    for (const s of towns().flatMap((x) => [x, { ...x, army: {}, masters: 0 } as GameState])) {
      const soldiers = TROOP_IDS.reduce((n, t) => n + (s.army[t] ?? 0), 0) + recruitsQueued(s);
      const levels: Record<string, number> = Object.fromEntries(s.buildings.map((b) => [b.type, b.level]));
      // Без мастеров их места в потолок не идут: так закят держит своё слагаемое, а не жалованье мастеров.
      if (!s.masters) levels.workshop = 0;
      const ceil = drainCeil(levels, s.pop, bondedTotal(s), soldiers);
      const where = `паёк ${s.ration}, вера ${s.faith.id}, время ${s.time}`;
      expect(foodConsumptionPerDay(s), where).toBeLessThanOrEqual(ceil.food * (1 + 1e-12));
      expect(heatingWoodPerDay(s), where).toBeLessThanOrEqual(ceil.wood * (1 + 1e-12));
      const out = wagesDue(s) + Math.max(0, -taxIncomePerDay(s));
      expect(out, where).toBeLessThanOrEqual(ceil.gold * (1 + 1e-12));
      if (heatingWoodPerDay(s) > 0) heat++;
      if (taxIncomePerDay(s) < 0 && wagesDue(s) === 0) zakat++;
    }
    // Потолок здесь вплотную к расходу (щедрый паёк в голодный сезон): сравнение — с точностью дроби, а не с запасом.
    // Точки внутри области: зима топит, и есть вера, что раздаёт казну.
    expect(heat).toBeGreaterThan(0);
    expect(zakat).toBeGreaterThan(0);
  });
});

describe('пол расхода хлеба в осаде — не выше честного', () => {
  it('на каждом сезоне, пайке и вере расход моста не ниже пола; скудный паёк летом — ровно пол', () => {
    let tight = 0;
    for (const s of towns()) {
      const p = playerProfile(s);
      const floor = eatFloorOf(s.pop, bondedTotal(s));
      const where = `паёк ${s.ration}, время ${s.time}`;
      expect(p.foodPerHour ?? 0, where).toBeGreaterThanOrEqual(floor.townPerHour * (1 - 1e-9));
      expect(p.soldierFoodPerHour ?? 0, where).toBeGreaterThanOrEqual(floor.perManPerHour * (1 - 1e-9));
      // Без мастеров, на скудном пайке в сытый сезон честный расход совпадает с полом: пол не ниже нужного.
      const bare = { ...s, masters: 0 };
      const q = playerProfile(bare);
      if (Math.abs((q.soldierFoodPerHour ?? 0) - floor.perManPerHour) < 1e-9 && Math.abs((q.foodPerHour ?? 0) - floor.townPerHour) < 1e-6) tight++;
    }
    expect(tight, 'пол достигается честным посёлком').toBeGreaterThan(0);
    expect(gameDaysPerHour()).toBeGreaterThan(0);
  });
});
