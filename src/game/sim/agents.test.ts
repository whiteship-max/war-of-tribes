// Опыт агентов: свойства, а не случаи.
//
// Области, где правила вообще спрашиваются, названы и проверяются в самих
// тестах (CLAUDE.md, правило 11):
// - уровень и кружки — опыт от нуля до потолка (`XP_CAP`); выше потолка опыт не копится;
// - «не чаще раза в пять минут» — только пары дел **ближе** `DEED_GAP`: прогон
//   обязан их содержать, иначе правило не спрашивалось;
// - гибель — опыт ниже потолка, и среди точек обязаны быть обе границы: где путь к
//   уровню короче полушага и где полушаг короче пути.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { deserialize, serialize } from '../save';
import { tick } from './tick';
import { seeded } from './random';
import {
  DEED_GAP,
  DEED_XP,
  LEVEL_XP,
  MAX_AGENT_LEVEL,
  ONSLAUGHT_PER_CIRCLE,
  SIGHT_PER_CIRCLE,
  STEALTH_PER_CIRCLE,
  XP_CAP,
  circlesOf,
  levelOf,
} from '../data/agents';
import {
  agentLevel,
  emptyAgents,
  fallLoss,
  mergeAgents,
  onslaughtOf,
  recordDeed,
  recordFall,
  regear,
  sightBonusOf,
  stealthOf,
} from './agents';
import { applyEffects, playerProfile } from '@/world/bridge';
import { FIGURE_IDS } from '@/world/data/figures';
import type { ItemId } from '../data/items';

/** Уровень, посчитанный с нуля по таблице порогов, — независимо от `levelOf`. */
const byTable = (xp: number): number => LEVEL_XP.filter((t) => xp >= t).length;

describe('уровень и кружки выводятся из опыта', () => {
  it('на каждом опыте от нуля до потолка кружков ровно столько, сколько уровень по таблице', () => {
    const s = createInitialState();
    const seen = new Set<number>();
    for (let xp = 0; xp <= XP_CAP; xp++) {
      expect(xp, 'точка внутри области: опыт от нуля до потолка').toBeLessThanOrEqual(XP_CAP);
      s.agents.general.xp = xp;
      s.agents.scout.xp = xp;
      s.agents.spy.xp = xp;
      const level = byTable(xp);
      seen.add(level);
      expect(circlesOf(xp), `кружков на опыте ${xp}`).toBe(level);
      expect(agentLevel(s, 'general'), `уровень полководца на опыте ${xp}`).toBe(level);
      // Действие навыка — от тех же кружков сверх первого, и ни от чего другого.
      expect(onslaughtOf(s), `натиск на опыте ${xp}`).toBe(ONSLAUGHT_PER_CIRCLE * (level - 1));
      expect(sightBonusOf(s), `зоркость на опыте ${xp}`).toBe(SIGHT_PER_CIRCLE * (level - 1));
      expect(stealthOf(s), `скрытность на опыте ${xp}`).toBeCloseTo(STEALTH_PER_CIRCLE * (level - 1), 12);
    }
    expect([...seen].sort(), 'прогон прошёл все пять уровней').toEqual([1, 2, 3, 4, 5]);
  });

  it('в партии нет ни уровня, ни кружков — только опыт, отметка дела и ячейки', () => {
    const s = createInitialState();
    for (const id of FIGURE_IDS) expect(Object.keys(s.agents[id]).sort()).toEqual(['deedAt', 'slots', 'xp']);
    // И записанное в сохранение «чужое» поле уровня ничего не решает: уровень — из опыта.
    const json = JSON.parse(serialize(s));
    json.agents.general = { xp: 25, deedAt: null, slots: [null, null, null], level: 5, circles: 5 };
    const back = deserialize(JSON.stringify(json))!;
    expect(agentLevel(back, 'general')).toBe(2);
    expect(Object.keys(back.agents.general).sort()).toEqual(['deedAt', 'slots', 'xp']);
  });
});

describe('опыт не убывает сам и не растёт быстрее, чем раз в пять минут', () => {
  it('на случайных делах: засчитанные дела не ближе DEED_GAP, опыт не падает, сверх потолка не растёт', () => {
    let closePairs = 0;
    let rejected = 0;
    for (const seed of [1, 7, 42, 99]) {
      const rnd = seeded(seed);
      const s = createInitialState();
      let at = 1_700_000_000_000;
      const counted: number[] = [];
      let last = 0;
      for (let i = 0; i < 400; i++) {
        // Шаги от нуля до девяти минут: половина дел приходит раньше срока.
        const step = Math.floor(rnd() * 9 * 60_000);
        if (step < DEED_GAP) closePairs++;
        at += step;
        const before = s.agents.spy.xp;
        const got = recordDeed(s, { agent: 'spy', ok: rnd() < 0.5, at });
        expect(s.agents.spy.xp, 'опыт от дела не убывает').toBeGreaterThanOrEqual(before);
        expect(s.agents.spy.xp).toBeLessThanOrEqual(XP_CAP);
        if (got > 0) counted.push(at);
        else if (s.agents.spy.xp < XP_CAP) rejected++;
        last = s.agents.spy.xp;
      }
      for (let i = 1; i < counted.length; i++) {
        expect(counted[i] - counted[i - 1], `засчитанные дела ${i - 1} и ${i}`).toBeGreaterThanOrEqual(DEED_GAP);
      }
      // Сами по себе — часы игры, сохранение — опыт не трогают.
      tick(s, 600);
      expect(s.agents.spy.xp).toBe(last);
      expect(deserialize(serialize(s))!.agents.spy.xp).toBe(last);
    }
    expect(closePairs, 'в прогоне есть дела ближе пяти минут — правило спрашивалось').toBeGreaterThan(100);
    expect(rejected, 'и оно отказывало').toBeGreaterThan(50);
  });

  it('удача — два опыта, неудача — один, дело раньше прошлого засчитанного не засчитывается', () => {
    const s = createInitialState();
    const t = 1_700_000_000_000;
    expect(recordDeed(s, { agent: 'general', ok: true, at: t })).toBe(DEED_XP.ok);
    expect(recordDeed(s, { agent: 'general', ok: false, at: t + DEED_GAP })).toBe(DEED_XP.fail);
    expect(recordDeed(s, { agent: 'general', ok: true, at: t + DEED_GAP / 2 }), 'дело из прошлого').toBe(0);
    expect(recordDeed(s, { agent: 'general', ok: true, at: t + DEED_GAP * 2 - 1 }), 'на миллисекунду раньше').toBe(0);
  });

  it('уровень, взятый делом, пишется в летопись один раз', () => {
    const s = createInitialState();
    const t = 1_700_000_000_000;
    for (let i = 0; i < 10; i++) recordDeed(s, { agent: 'scout', ok: true, at: t + i * DEED_GAP });
    expect(s.agents.scout.xp).toBe(20);
    expect(s.log.filter((e) => e.text.startsWith('Разведчик дошёл до второго уровня'))).toHaveLength(1);
  });
});

describe('гибель отнимает не больше половины шага до следующего уровня', () => {
  it('на каждом опыте ниже потолка: уровень не падает, потеря не больше полушага и не больше пути', () => {
    let pathBinds = 0;
    let halfBinds = 0;
    for (let xp = 0; xp < XP_CAP; xp++) {
      const level = byTable(xp);
      expect(level, 'точка внутри области: есть следующий уровень').toBeLessThan(MAX_AGENT_LEVEL);
      const floor = LEVEL_XP[level - 1];
      const step = LEVEL_XP[level] - floor;
      const s = createInitialState();
      s.agents.general.xp = xp;
      const loss = recordFall(s, 'general');
      expect(loss, `потеря на опыте ${xp}`).toBeLessThanOrEqual(step / 2);
      expect(loss, `потеря на опыте ${xp}`).toBeLessThanOrEqual(xp - floor);
      expect(byTable(s.agents.general.xp), `уровень после гибели на опыте ${xp}`).toBe(level);
      // Теряется ровно путь к уровню, пока он не длиннее полушага.
      expect(loss).toBe(Math.min(xp - floor, Math.floor(step / 2)));
      if (xp - floor < step / 2) pathBinds++;
      if (xp - floor > step / 2) halfBinds++;
    }
    expect(pathBinds, 'есть точки, где путь короче полушага').toBeGreaterThan(0);
    expect(halfBinds, 'есть точки, где полушаг короче пути').toBeGreaterThan(0);
  });

  it('на пятом уровне пути нет, и гибель не отнимает ничего', () => {
    expect(fallLoss(XP_CAP)).toBe(0);
    expect(levelOf(XP_CAP)).toBe(MAX_AGENT_LEVEL);
  });
});

describe('дело и гибель приходят из мира последствием', () => {
  it('племя записывает опыт по полям последствия, а строку летописи — только если она есть', () => {
    const s = createInitialState();
    const t = 1_700_000_000_000;
    s.agents.scout.xp = 30;
    const logged = s.log.length;
    applyEffects(s, [
      { id: 'a', lost: {}, resources: {}, prestige: 0, morale: 0, battle: null, deed: { agent: 'scout', ok: true, at: t }, text: '', good: true },
    ]);
    expect(s.agents.scout.xp).toBe(32);
    expect(s.log.length, 'пустая строка в летопись не пишется').toBe(logged);
    applyEffects(s, [
      {
        id: 'b',
        lost: {},
        resources: {},
        prestige: 0,
        morale: -4,
        battle: null,
        deed: { agent: 'scout', ok: false, at: t + DEED_GAP },
        fell: 'scout',
        text: 'Разведчик попался часовым. Вернётся не скоро.',
        good: false,
      },
    ]);
    // 32 + 1 = 33, путь к третьему уровню 13 при полушаге 20: теряется весь путь.
    expect(s.agents.scout.xp).toBe(LEVEL_XP[1]);
    expect(agentLevel(s, 'scout')).toBe(2);
  });
});

describe('агент первого уровня — это сегодняшний агент', () => {
  it('партия до опыта приезжает агентами первого уровня, и слепок для мира без единого поля навыка', () => {
    const s = createInitialState();
    const json = JSON.parse(serialize(s));
    delete json.agents;
    const old = deserialize(JSON.stringify(json))!;
    for (const id of FIGURE_IDS) {
      expect(agentLevel(old, id)).toBe(1);
      expect(old.agents[id].slots).toEqual([null, null, null]);
    }
    const p = playerProfile(old);
    expect('onslaught' in p || 'sightBonus' in p || 'stealth' in p).toBe(false);
    // Опыт копится, но пока уровень первый — слепок тот же, байт в байт.
    old.agents.general.xp = LEVEL_XP[1] - 1;
    expect(JSON.stringify(playerProfile(old))).toBe(JSON.stringify(p));
    old.agents.general.xp = LEVEL_XP[1];
    expect(playerProfile(old).onslaught).toBe(ONSLAUGHT_PER_CIRCLE);
  });

  it('разбор сохранения ставит в ячейку только имя: всё прочее — пустое место', () => {
    const merged = mergeAgents({
      general: { xp: -5, deedAt: 'вчера', slots: [{ id: 'меч', onslaught: 99 }, 'меч', 7] },
      spy: { xp: 10_000 },
    });
    expect(merged.general).toEqual({ xp: 0, deedAt: null, slots: [null, 'меч', null] });
    expect(merged.spy.xp).toBe(XP_CAP);
    expect(merged.scout).toEqual(emptyAgents().scout);
  });
});

describe('ячейки: переодеться можно только дома', () => {
  const home = { phase: 'home' as const, departAt: 5 };
  const city = { phase: 'home' as const, departAt: 5, sheltered: 5 };
  const away = [
    { phase: 'moving' as const, departAt: 5 },
    { phase: 'field' as const, departAt: 5 },
    { phase: 'down' as const, departAt: 5 },
  ];

  it('дома — у ворот и в городе — снять можно, в пути, в поле и выбывшему — отказ словами', () => {
    for (const where of [home, city]) {
      const s = createInitialState();
      s.agents.scout.slots[0] = 'сапоги' as ItemId;
      expect(regear(s, 'scout', 0, null, where, [])).toBeNull();
      expect(s.agents.scout.slots[0]).toBeNull();
    }
    for (const where of away) {
      const s = createInitialState();
      s.agents.scout.slots[0] = 'сапоги' as ItemId;
      const err = regear(s, 'scout', 0, null, where, []);
      expect(err, `отказ в фазе ${where.phase}`).toMatch(/переодева|переодеться/);
      expect(s.agents.scout.slots[0]).toBe('сапоги');
    }
  });

  it('надеть можно только то, что есть в таблице и во владении; третье место — с четвёртого уровня', () => {
    const s = createInitialState();
    expect(regear(s, 'spy', 0, 'кинжал' as ItemId, home, ['кинжал' as ItemId])).toBe('Такого предмета нет.');
    expect(regear(s, 'spy', 2, null, home, [])).toMatch(/четвёртого уровня/);
    s.agents.spy.xp = LEVEL_XP[3];
    expect(regear(s, 'spy', 2, null, home, [])).toBeNull();
  });
});
