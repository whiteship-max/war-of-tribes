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
  ONSLAUGHT_PER_CIRCLE,
  SIGHT_PER_CIRCLE,
  STEALTH_PER_CIRCLE,
  XP_CAP,
  circlesOf,
} from '../data/agents';
import {
  agentLevel,
  emptyAgents,
  mergeAgents,
  onslaughtOf,
  recordDeed,
  regear,
  sightBonusOf,
  stealthOf,
} from './agents';
import { applyEffects, playerProfile } from '@/world/bridge';
import { hireAgent } from './hire';
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

  const FIELDS = ['age0', 'bornAt', 'deedAt', 'hiring', 'name', 'person', 'slots', 'tally', 'vacant', 'xp'];

  it('в партии нет ни уровня, ни кружков, ни возраста, ни черт — только опыт, счёт дел, человек и ячейки', () => {
    const s = createInitialState();
    for (const id of FIGURE_IDS) expect(Object.keys(s.agents[id]).sort()).toEqual(FIELDS);
    // И записанное в сохранение «чужое» поле уровня ничего не решает: уровень — из опыта.
    const json = JSON.parse(serialize(s));
    json.agents.general = { ...json.agents.general, xp: 10, level: 5, circles: 5, age: 59, traits: ['victor'] };
    const back = deserialize(JSON.stringify(json))!;
    expect(agentLevel(back, 'general')).toBe(2);
    expect(Object.keys(back.agents.general).sort()).toEqual(FIELDS);
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
    for (let i = 0; i < 5; i++) recordDeed(s, { agent: 'scout', ok: true, at: t + i * DEED_GAP });
    expect(s.agents.scout.xp).toBe(10);
    expect(LEVEL_XP[1], 'точка внутри области: пять удач переходят порог второго уровня и не доходят до третьего').toBeLessThanOrEqual(10);
    expect(LEVEL_XP[2]).toBeGreaterThan(10);
    expect(s.log.filter((e) => e.text.startsWith('Разведчик дошёл до второго уровня'))).toHaveLength(1);
  });
});

describe('гибель забирает человека, а не часть пути', () => {
  const fell = (agent: 'scout' | 'spy' | 'general', person: number) => ({
    id: `f-${agent}-${person}`,
    lost: {},
    resources: {},
    prestige: 0,
    morale: -4,
    battle: null,
    fell: { agent, person, peril: 0.042, where: 'у Логова', why: ['день: заметнее'] },
    text: '',
    good: false,
  });

  it('весть о гибели освобождает место того, о ком она, — и только его', () => {
    const s = createInitialState();
    s.agents.spy.xp = 40;
    s.agents.spy.name = 'Ян Хромой';
    applyEffects(s, [fell('spy', 0)]);
    expect(s.agents.spy.vacant, 'погибший освободил место').toBe(true);
    expect(s.log.some((e) => e.text.startsWith('Лазутчик Ян Хромой погиб у Логова') && e.text.includes('4,2 %')), 'строка летописи называет кого и риск').toBe(true);
    // Вторая весть о том же — ничего: место уже пустое.
    const lines = s.log.length;
    applyEffects(s, [fell('spy', 0)]);
    expect(s.log.length).toBe(lines);
  });

  it('весть, пришедшая после найма, нового не убивает, и его дел за погибшего не засчитывает', () => {
    const s = createInitialState();
    s.faith.id = 'catholic';
    applyEffects(s, [fell('scout', 0)]);
    s.gold = 10_000;
    expect(hireAgent(s, 'scout')).toBeNull();
    tick(s, s.agents.scout.hiring!.until - s.time);
    expect(s.agents.scout.vacant).toBe(false);
    expect(s.agents.scout.person, 'новый человек — новый номер').toBe(1);
    expect(s.agents.scout.xp, 'новичок начинает с нуля').toBe(0);
    applyEffects(s, [fell('scout', 0)]);
    expect(s.agents.scout.vacant, 'весть о прежнем нового не трогает').toBe(false);
    expect(recordDeed(s, { agent: 'scout', ok: true, at: 1_700_000_000_000, person: 0 }), 'дело прежнего не засчитывается').toBe(0);
    expect(recordDeed(s, { agent: 'scout', ok: true, at: 1_700_000_000_000, person: 1 })).toBe(DEED_XP.ok);
  });

  it('задержание места не освобождает: дело-неудача, опыт при нём', () => {
    const s = createInitialState();
    s.agents.scout.xp = 10;
    applyEffects(s, [
      {
        id: 'b',
        lost: {},
        resources: {},
        prestige: 0,
        morale: -4,
        battle: null,
        deed: { agent: 'scout', ok: false, at: 1_700_000_000_000, person: 0 },
        text: 'Разведчик попался часовым у логова. Отпустят не скоро.',
        good: false,
      },
    ]);
    expect(s.agents.scout.xp).toBe(11);
    expect(s.agents.scout.vacant).toBe(false);
  });

  it('старая весть строкой («выбыл на десять минут») не убивает никого', () => {
    const s = createInitialState();
    s.agents.scout.xp = 30;
    applyEffects(s, [{ ...fell('scout', 0), fell: 'scout' as never }]);
    expect(s.agents.scout.vacant).toBe(false);
    expect(s.agents.scout.xp).toBe(30);
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
    expect(['onslaught', 'sightBonus', 'stealth', 'veil', 'agents'].filter((k) => k in p), 'слепок первого уровня не везёт полей навыка и мест').toEqual([]);
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
    expect(merged.general).toEqual({ ...emptyAgents().general, xp: 0, deedAt: null, slots: [null, 'меч', null] });
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
      expect(err, `отказ в фазе ${where.phase}`).not.toBeNull();
      expect(err).toMatch(/переодева|переодеться/);
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
