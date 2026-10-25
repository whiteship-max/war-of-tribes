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
  SIGHT_PER_CIRCLE,
  STEALTH_PER_CIRCLE,
  THIRD_SLOT_LEVEL,
  XP_CAP,
  circlesOf,
} from '../data/agents';
import {
  agentLevel,
  emptyAgents,
  mergeAgents,
  pipsAt,
  pipsOf,
  recordDeed,
  regear,
  sightBonusOf,
  stealthOf,
} from './agents';
import { applyEffects, playerProfile } from '@/world/bridge';
import { hireRecruit, recruitsOf } from './recruits';
import { creditTech } from './tech';
import { FIGURE_IDS } from '@/world/data/figures';
import { PIP_IDS, type Pips } from '@/battle';
import { maxLevelFor, tradition } from '../derived';
import type { ItemId } from '../data/items';
import type { GameState } from '../types';

/**
 * Сыгранная партия, а не новая: место лазутчика у неё есть.
 *
 * Новая партия начинает без него — место отпирает вторая ступень дипломатической ветви
 * (`sim/tech`), — а проверки ниже про опыт, гибель и ячейки, а не про гейт. Ступень
 * засчитывает та же дверь, какой её засчитывают приведённой партии и посёлку мерки:
 * второго правила засчитывания в проекте нет.
 */
const played = (s: GameState): GameState => {
  s.agents.spy.vacant = false;
  creditTech(s);
  return s;
};

/** Уровень, посчитанный с нуля по таблице порогов, — независимо от `levelOf`. */
const byTable = (xp: number): number => LEVEL_XP.filter((t) => xp >= t).length;

describe('уровень и кружки выводятся из опыта', () => {
  it('на каждом опыте от нуля до потолка кружков ровно столько, сколько уровень по таблице', () => {
    const s = played(createInitialState());
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
      const pips = pipsOf(s);
      expect(Object.values(pips).reduce((n, x) => n + (x ?? 0), 0), `отметок на опыте ${xp}`).toBe(level - 1);
      expect(pips, `отметки на опыте ${xp} — склонность того же человека`).toEqual(pipsAt(s.seed, s.agents.general.person, level));
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
    expect(s.log.filter((e) => e.text.startsWith('Разведчик дошёл до ур. 2'))).toHaveLength(1);
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
    const s = played(createInitialState());
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
    // Найм — в Ратуше из кандидатов окна (АГ-1): сразу, без срока.
    const first = recruitsOf(s, 'scout')[0];
    expect(hireRecruit(s, 'scout', first.n, null)).toBeNull();
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
    expect(['pips', 'sightBonus', 'stealth', 'veil', 'agents'].filter((k) => k in p), 'слепок первого уровня не везёт полей навыка и мест').toEqual([]);
    // Опыт копится, но пока уровень первый — слепок тот же, байт в байт.
    old.agents.general.xp = LEVEL_XP[1] - 1;
    expect(JSON.stringify(playerProfile(old))).toBe(JSON.stringify(p));
    old.agents.general.xp = LEVEL_XP[1];
    expect(Object.values(playerProfile(old).pips ?? {}).reduce((n, x) => n + (x ?? 0), 0), 'второй уровень — одна отметка').toBe(1);
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
    const s = played(createInitialState());
    expect(regear(s, 'spy', 0, 'кинжал' as ItemId, home, ['кинжал' as ItemId])).toBe('Такой вещи нет.');
    expect(regear(s, 'spy', 2, null, home, [])).toMatch(new RegExp(`на ур\\. ${THIRD_SLOT_LEVEL}`));
    s.agents.spy.xp = LEVEL_XP[3];
    expect(regear(s, 'spy', 2, null, home, [])).toBeNull();
  });
});

describe('отметки полководца — склад человека, а не выбор игрока', () => {
  // Область: уровни со второго по пятый — на первом отметок нет, и сравнивать нечего. Людей
  // двести подряд: номер человека и есть то, от чего склад зависит.
  const PEOPLE = 200;

  it('каждый кружок сверх первого — ровно одна отметка, и прежние остаются на месте', () => {
    for (let person = 0; person < PEOPLE; person++) {
      expect(pipsAt(7, person, 1), 'первый уровень — ни одной отметки').toEqual({});
      for (let level = 2; level <= MAX_AGENT_LEVEL; level++) {
        const was = pipsAt(7, person, level - 1);
        const now = pipsAt(7, person, level);
        let grown = 0;
        for (const pip of PIP_IDS) {
          const d = (now[pip] ?? 0) - (was[pip] ?? 0);
          expect(d, `человек ${person}, уровень ${level}: отметка ${pip} не убывает`).toBeGreaterThanOrEqual(0);
          grown += d;
        }
        expect(grown, `человек ${person}, уровень ${level}: прибавилась ровно одна`).toBe(1);
      }
    }
  });

  it('склад у людей разный: на втором уровне каждая из четырёх отметок — у заметной доли', () => {
    const first: Record<string, number> = {};
    for (let person = 0; person < PEOPLE; person++) {
      const [pip] = Object.keys(pipsAt(7, person, 2));
      first[pip] = (first[pip] ?? 0) + 1;
    }
    for (const pip of PIP_IDS) expect(first[pip] ?? 0, `первая отметка ${pip}`).toBeGreaterThan(PEOPLE * 0.15);
  });

  it('склад — из сида и номера человека: кость партии не двигается, другой сид — другие люди', () => {
    const s = createInitialState();
    s.agents.general.xp = XP_CAP;
    const rolls = s.rolls;
    expect(pipsOf(s)).toEqual(pipsAt(s.seed, s.agents.general.person, MAX_AGENT_LEVEL));
    expect(s.rolls, 'отметки не бросают кость партии').toBe(rolls);
    let differ = 0;
    for (let person = 0; person < PEOPLE; person++) {
      if (JSON.stringify(pipsAt(7, person, MAX_AGENT_LEVEL)) !== JSON.stringify(pipsAt(8, person, MAX_AGENT_LEVEL))) differ++;
    }
    expect(differ, 'другой сид партии — другой склад у тех же номеров').toBeGreaterThan(PEOPLE / 2);
    s.agents.general.vacant = true;
    expect(pipsOf(s), 'пустое место — ни одной отметки').toEqual({});
  });
});

describe('воинская традиция: Статуя растит кружки полководца той же дверью', () => {
  it('два уровня Статуи на кружок — из длин двух лестниц; отметки новичка — первые кружки его склада, ветерана выше пяти не поднять', () => {
    // П4 (docs/battle_eu4.md, 14.35, п. 9 слова владельца): соответствие уровней Статуи отметкам выводится из диапазонов двух
    // лестниц — уровней Статуи и кружков полководца, — а не назначается. Граница области: обе лестницы той длины, из которой
    // вывод и сделан, и на первом уровне Статуи традиции нет, как нет отметок у первого кружка.
    const max = maxLevelFor('statue');
    expect(max, 'уровней Статуи').toBe(10);
    expect(MAX_AGENT_LEVEL, 'кружков полководца').toBe(5);
    const at = (level: number): GameState => {
      const s = createInitialState();
      s.buildings.find((b) => b.type === 'statue')!.level = level;
      return s;
    };
    const ladder = Array.from({ length: max }, (_, i) => tradition(at(i + 1)));
    expect(ladder, 'по два уровня на кружок, кружков сверх первого — 0…4').toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    const count = (p: Pips): number => PIP_IDS.reduce((n, id) => n + (p[id] ?? 0), 0);
    for (let level = 1; level <= max; level += 1) {
      const s = at(level);
      expect(agentLevel(s, 'general'), 'полководец — новичок').toBe(1);
      expect(pipsOf(s), `Статуя ${level}: не пустое место`).toBeDefined();
      // Новичок: отметок ровно столько, сколько кружков дала традиция, и лежат они туда же, куда легли бы кружки опыта.
      expect(count(pipsOf(s)), `Статуя ${level}: отметок у новичка — кружки традиции`).toBe(tradition(s));
      expect(pipsOf(s)).toEqual(pipsAt(s.seed, s.agents.general.person, 1 + tradition(s)));
      // Ветеран пятого уровня: лестница отметок та же, 0…4, — Статуя по ней только поднимает.
      s.agents.general.xp = XP_CAP;
      expect(count(pipsOf(s)), `Статуя ${level}: ветеран`).toBe(MAX_AGENT_LEVEL - 1);
    }
    // Статуя уезжает в мир отметками полководца — тем же слепком, что всё остальное.
    const top = at(max);
    expect(playerProfile(top).pips).toEqual(pipsOf(top));
  });
});
