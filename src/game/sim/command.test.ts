// Командиры флангов (ДР-3, docs/siege_v2.md, «Решения ДР-3»): кандидаты механизмом агентов (род по месту, Казармы — ступень),
// назначение и смена только дома, тактика в бой мостом, знать слагаемым лояльности и через неё стабильность, покой, вести знати,
// старое сохранение, одна дверь записи. Каждая точка свойства сначала утверждает, что она внутри области правила (правило 11):
// окно — то же, Казармы дают ступень, место занято или пусто, как спрашивает правило.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Placed } from '@/world/shelter';
import type { Flank, GameState } from '../types';
import { createInitialState } from '../state';
import { QUESTS } from '../data/quests';
import { AGENT_ROLES, recruitAdvance, recruitWage } from '../agentrules';
import {
  COMMONER_SLIGHT,
  FLANKS,
  LORD_FAVOR,
  TACTICS_TOP,
  birthOf,
  commandRetireAge,
  commandTier,
  commanderAt,
  commanderCount,
  commanderFault,
  commanderId,
  slotOfCommander,
  tacticsOf,
} from '../commandrules';
import { DISLOYAL, LOYAL, LOYALTY_BASE, murmurOf } from '../estaterules';
import { MAX_ADVISOR_LEVEL, windowOf } from '../councilrules';
import { activeBoons, buildingOfType, commandLead, commandWagesPerDay, estatesNow, wagesPerDay } from '../derived';
import { AGENT_YEAR } from '../data/agents';
// Таблица событий — раньше вестей державы, как в игре: вести входят в неё (`crownEvents`), и цикл импорта `sim/crown → … →
// data/events` разрешается с её стороны.
import { EVENT_BY_ID } from '../data/events';
import { CROWN_BY_ID } from '../data/crown';
import { estateBoon } from '../data/boons';
import { creditTech } from './tech';
import { commandAge, commandFlanks, commandOf, commandSeat, commandStep, commandWatch, mergeCommand, unseatLowborn } from './command';
import { commandAwayBlock, commandDismissBlock, commandHireBlock, commandersOf, dismissCommander, hireCommander, type CommanderView } from './commanders';
import { folkParts, stabOf } from './stability';
import { pointsOf } from './points';
import { applyCrown } from './crown';
import { livingNames } from './dynasty';
import { deserialize, serialize } from '../save';
import { playerProfile } from '@/world/bridge';

/** Город без случайностей: вера названа, вести не идут, места агентов заняты, Казармы уровня `barracks`. */
function town(seed = 4242, barracks = 7): GameState {
  const s = createInitialState(seed);
  s.tutorialDone = true;
  s.nextEventAt = Infinity;
  s.completedQuests = QUESTS.map((q) => q.id);
  s.faith.id = 'catholic';
  s.gold = 1_000_000;
  for (const id of AGENT_ROLES) s.agents[id].vacant = false;
  creditTech(s);
  buildingOfType(s, 'barracks')!.level = barracks;
  return s;
}

/** Полководец дома и в поле. */
const HOME: Placed = { phase: 'home', departAt: 0 };
const FIELD: Placed = { phase: 'field', departAt: 0 };

/** Первый кандидат рода `birth` в листе окна. */
function first(s: GameState, birth: 'low' | 'noble'): CommanderView {
  const c = commandersOf(s).find((x) => x.birth === birth);
  expect(c, `кандидат рода ${birth} есть`).toBeTruthy();
  return c!;
}

/** Нанять первого кандидата рода `birth` на фланг `f` (полководец дома). */
function seat(s: GameState, f: Flank, birth: 'low' | 'noble'): CommanderView {
  const c = first(s, birth);
  expect(hireCommander(s, f, c.n, HOME), `найм ${birth} на ${f}`).toBeNull();
  return c;
}

describe('кандидаты в командиры — механизмом агентов', () => {
  it('лист окна: Казармы дают ступень и число, род — по месту в списке, в каждом окне есть оба рода', () => {
    for (const lv of [1, 4, 7, 10]) {
      const s = town(77, lv);
      const list = commandersOf(s);
      expect(list.length, `Казармы ${lv}`).toBe(commanderCount(lv));
      expect(list.every((c) => c.tier === commandTier(lv))).toBe(true);
      // Граница области: окно одно — все номера из окна нынешней минуты.
      const w = windowOf(s.time);
      expect(list.every((c) => commanderFault(c.n, w, c.tier) === null)).toBe(true);
      expect(list.map((c) => c.birth)).toEqual(list.map((c) => (slotOfCommander(c.n) % 2 === 0 ? 'low' : 'noble')));
      expect(new Set(list.map((c) => c.birth)).size, `Казармы ${lv}: оба рода`).toBe(2);
    }
  });

  it('кандидат — чистая функция сида, номера и ступени; подъём Казарм не опускает ни одного кандидата окна', () => {
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (let slot = 0; slot < 1 + MAX_ADVISOR_LEVEL; slot++) {
        const n = commanderId(3, slot);
        for (let tier = 1; tier < MAX_ADVISOR_LEVEL; tier++) {
          // Граница области: кандидат стоит в списке обеих ступеней.
          if (slot >= 1 + tier) continue;
          const lo = commanderAt(seed, n, tier);
          const hi = commanderAt(seed, n, tier + 1);
          expect(commanderAt(seed, n, tier)).toEqual(lo);
          expect(hi.level, `сид ${seed}, №${n}: уровень`).toBeGreaterThanOrEqual(lo.level);
          expect(hi.tactics, `сид ${seed}, №${n}: тактика`).toBeGreaterThanOrEqual(lo.tactics);
          expect(hi.traits).toEqual(lo.traits);
          expect(hi.birth).toBe(lo.birth);
          checked += 1;
        }
      }
    }
    expect(checked, 'точек внутри области: 40 сидов × (3 + 2) пар ступеней').toBe(200);
  });

  it('тактика: безродный — выше нуля, лорд — ниже, оба растут с уровнем; вершина — TACTICS_TOP', () => {
    for (let l = 1; l <= MAX_ADVISOR_LEVEL; l++) {
      expect(tacticsOf('low', l)).toBeGreaterThan(0);
      expect(tacticsOf('noble', l)).toBeLessThan(0);
      if (l > 1) {
        expect(tacticsOf('low', l)).toBeGreaterThanOrEqual(tacticsOf('low', l - 1));
        expect(tacticsOf('noble', l)).toBeGreaterThanOrEqual(tacticsOf('noble', l - 1));
      }
    }
    expect(tacticsOf('low', MAX_ADVISOR_LEVEL)).toBe(TACTICS_TOP);
    // Лорд — зеркало: бездарен на столько, на сколько тактик даровит, и ещё на отметку.
    for (let l = 1; l <= MAX_ADVISOR_LEVEL; l++) expect(tacticsOf('noble', l)).toBe(tacticsOf('low', l) - TACTICS_TOP - 1);
  });

  it('кандидат не своего окна, не со своего места или выше ступени — не кандидат', () => {
    expect(commanderFault(commanderId(5, 1), 5, 1)).toBeNull();
    expect(commanderFault(commanderId(5, 1), 6, 1)).toMatch(/не из окна/);
    expect(commanderFault(commanderId(5, 3), 5, 2)).toMatch(/даёт 3/);
    expect(commanderFault(commanderId(5, 0), 5, 4)).toMatch(/вне 1…3/);
    expect(birthOf(commanderId(5, 0))).toBe('low');
    expect(birthOf(commanderId(5, 1))).toBe('noble');
  });
});

describe('назначение, смена и увольнение', () => {
  it('найм: плата снята, место занято, кандидат ушёл из листа, книга сервера считает найм и плату вперёд', () => {
    const s = town();
    const gold = s.gold;
    const c = seat(s, 'left', 'low');
    expect(s.gold).toBeCloseTo(gold - c.price, 6);
    expect(commandSeat(s, 'left')).toMatchObject({ n: c.n, tier: c.tier, name: c.name });
    expect(commandersOf(s).some((x) => x.n === c.n), 'взятый в листе не стоит').toBe(false);
    expect(commandOf(s).hired).toBe(1);
    expect(commandOf(s).fees).toBe(recruitAdvance(c.level, c.traits));
    expect(commandWatch(s)).toEqual({ seats: [{ flank: 'left', n: c.n, tier: c.tier, at: Math.floor(s.time) }], hired: 1, fees: c.advance, paid: 0 });
    expect(livingNames(s)).toContain(c.name);
  });

  it('уволенный в том же окне вторым кандидатом не встаёт', () => {
    const s = town();
    const c = seat(s, 'left', 'low');
    expect(dismissCommander(s, 'left', HOME)).toBeNull();
    expect(commandSeat(s, 'left')).toBeNull();
    expect(commandersOf(s).some((x) => x.n === c.n)).toBe(false);
  });

  it('сменить и уволить — только когда полководец дома; места полководца нет — можно всегда', () => {
    const s = town();
    seat(s, 'left', 'low');
    const other = first(s, 'noble');
    // Граница области: место занято — правило «только дома» спрашивается.
    expect(commandSeat(s, 'left')).not.toBeNull();
    expect(commandHireBlock(s, 'left', other.n, FIELD)).toBe('Отряд в поле — менять дома.');
    expect(commandHireBlock(s, 'left', other.n, { phase: 'moving', departAt: 0 })).toBe('Отряд в пути — менять дома.');
    expect(commandDismissBlock(s, 'left', FIELD)).toBe('Отряд в поле — менять дома.');
    expect(dismissCommander(s, 'left', FIELD)).not.toBeNull();
    expect(commandSeat(s, 'left'), 'в поле не уволен').not.toBeNull();
    expect(commandHireBlock(s, 'left', other.n, HOME)).toBeNull();
    s.agents.general.vacant = true;
    expect(commandAwayBlock(s, FIELD), 'полководца нет — менять можно').toBeNull();
  });

  it('золота нет — найма нет; кандидата нет — найма нет', () => {
    const s = town();
    const c = first(s, 'low');
    s.gold = c.price - 1;
    expect(commandHireBlock(s, 'left', c.n, HOME)).toBe('Не хватает золота.');
    s.gold = 1e6;
    expect(commandHireBlock(s, 'left', 999_999, HOME)).toBe('Этого кандидата уже нет.');
  });

  it('жалованье — в той же ведомости, что войско: ступень совета по уровню и чертам', () => {
    const s = town();
    const before = wagesPerDay(s);
    const c = seat(s, 'right', 'noble');
    expect(commandWagesPerDay(s)).toBe(recruitWage(c.level, c.traits));
    expect(wagesPerDay(s)).toBeCloseTo(before + commandWagesPerDay(s), 9);
  });

  it('покой: командир уходит в возрасте агента, строкой летописи', () => {
    const s = town();
    const c = seat(s, 'left', 'low');
    const left = commandRetireAge(c.traits) - c.age0;
    // Граница области: до покоя есть время — шаг до него человека не трогает.
    expect(left).toBeGreaterThan(1);
    s.time += (left - 0.5) * AGENT_YEAR;
    commandStep(s, 1);
    expect(commandSeat(s, 'left'), 'за полгода до покоя служит').not.toBeNull();
    expect(commandAge(s, 'left')).toBeCloseTo(commandRetireAge(c.traits) - 0.5, 6);
    s.time += AGENT_YEAR;
    commandStep(s, 1);
    expect(commandSeat(s, 'left'), 'на покое — место пусто').toBeNull();
    expect(s.log.some((e) => e.text.includes('ушёл на покой'))).toBe(true);
  });
});

describe('тактика в бой — мостом, там же, где отметки полководца', () => {
  it('тактика мест — поле стороны боя: левый — A, правый — C; пустое место в поле не едет', () => {
    const s = town();
    expect(commandFlanks(s)).toEqual({});
    expect(playerProfile(s).flanks, 'без командиров слепок тот же').toBeUndefined();
    const low = seat(s, 'left', 'low');
    const noble = seat(s, 'right', 'noble');
    expect(commandFlanks(s)).toEqual({ A: low.tactics, C: noble.tactics });
    expect(playerProfile(s).flanks).toEqual({ A: low.tactics, C: noble.tactics });
  });
});

describe('знать: лояльность рыцарства и через неё стабильность', () => {
  it('милость и обида выведены из порогов EU4: Т4–Т7', () => {
    expect(LOYALTY_BASE + 2 * LORD_FAVOR, 'Т4: два лорда — верна').toBeGreaterThanOrEqual(LOYAL);
    expect(LOYALTY_BASE + LORD_FAVOR, 'Т5: один лорд — ещё нет').toBeLessThan(LOYAL);
    expect(LOYALTY_BASE - 2 * COMMONER_SLIGHT, 'Т6: два безродных — ропот').toBeLessThan(DISLOYAL);
    expect(LOYALTY_BASE - COMMONER_SLIGHT, 'Т7: один — ещё нет').toBeGreaterThanOrEqual(DISLOYAL);
  });

  it('лояльность рыцарства — слагаемым «командиры», у прочих сословий его нет', () => {
    const s = town();
    const was = estatesNow(s);
    // Граница области: знать ровная — без привилегий, усилителей и перевеса, слагаемое видно целиком.
    expect(was.knights.loyalty).toBe(LOYALTY_BASE);
    seat(s, 'left', 'low');
    expect(commandLead(s)).toBe(-COMMONER_SLIGHT);
    expect(estatesNow(s).knights.parts.lead).toBe(-COMMONER_SLIGHT);
    expect(estatesNow(s).knights.loyalty).toBe(LOYALTY_BASE - COMMONER_SLIGHT);
    for (const e of ['merchants', 'guilds', 'peasants', 'clergy'] as const) {
      expect(estatesNow(s)[e].loyalty, e).toBe(was[e].loyalty);
      expect(estatesNow(s)[e].parts.lead, e).toBe(0);
    }
    seat(s, 'right', 'noble');
    expect(estatesNow(s).knights.loyalty).toBe(LOYALTY_BASE - COMMONER_SLIGHT + LORD_FAVOR);
  });

  it('два безродных — ропот рыцарства у податных: стабильность ниже; два лорда — ропота нет', () => {
    const calm = town();
    const murmur = (s: GameState): number => folkParts(s).find((p) => p.id === 'estate:knights')?.value ?? 0;
    expect(murmur(calm), 'ровная знать не ропщет').toBe(0);
    const low = town();
    seat(low, 'left', 'low');
    const c = commandersOf(low).find((x) => x.birth === 'low')!;
    expect(hireCommander(low, 'right', c.n, HOME)).toBeNull();
    const k = estatesNow(low).knights;
    expect(k.loyalty).toBeLessThan(DISLOYAL);
    expect(murmur(low)).toBeCloseTo(murmurOf(k.infl, k.loyalty), 9);
    expect(murmur(low)).toBeGreaterThan(0);
    const high = town();
    seat(high, 'left', 'noble');
    const d = commandersOf(high).find((x) => x.birth === 'noble')!;
    expect(hireCommander(high, 'right', d.n, HOME)).toBeNull();
    expect(estatesNow(high).knights.loyalty).toBeGreaterThanOrEqual(LOYAL);
    expect(murmur(high)).toBe(0);
  });
});

describe('вести знати: обиженный лорд и спор за авангард', () => {
  it('без командиров вес обеих — ноль: частота вестей державы не едет', () => {
    expect(EVENT_BY_ID.cr_lord_claim, 'весть в общей таблице').toBeTruthy();
    expect(EVENT_BY_ID.cr_vanguard, 'весть в общей таблице').toBeTruthy();
    const s = town();
    expect(CROWN_BY_ID.cr_lord_claim.weight(s)).toBe(0);
    expect(CROWN_BY_ID.cr_vanguard.weight(s)).toBe(0);
  });

  it('«Обиженный лорд» приходит, пока безродный на месте; «Отозвать» снимает безродного, и обида знати уходит', () => {
    const s = town();
    seat(s, 'left', 'noble');
    expect(CROWN_BY_ID.cr_lord_claim.weight(s), 'лорды не обижают').toBe(0);
    seat(s, 'right', 'low');
    expect(CROWN_BY_ID.cr_lord_claim.weight(s)).toBe(1);
    applyCrown(s, 'cr_lord_claim', 0);
    expect(commandSeat(s, 'right'), 'безродный отозван').toBeNull();
    expect(commandSeat(s, 'left'), 'лорд на месте').not.toBeNull();
    expect(commandLead(s)).toBe(LORD_FAVOR);
    expect(unseatLowborn(s), 'второй раз отзывать некого').toBe(false);
  });

  it('«Одарить знать» — дар рыцарству; «Отказать» — обида рыцарства и день стабильности вниз', () => {
    const s = town();
    seat(s, 'left', 'low');
    applyCrown(s, 'cr_lord_claim', 1);
    expect(activeBoons(s).some((b) => b.def.id === estateBoon('gift', 'knights'))).toBe(true);
    const t = town();
    seat(t, 'left', 'low');
    const stab = stabOf(t).drift;
    applyCrown(t, 'cr_lord_claim', 2);
    expect(activeBoons(t).some((b) => b.def.id === estateBoon('down', 'knights'))).toBe(true);
    expect(stabOf(t).drift).toBeLessThan(stab);
    expect(commandSeat(t, 'left'), 'отказ никого не снимает').not.toBeNull();
  });

  it('«Спор за авангард» — только при лорде и безродном; безродному — очки войны и обида знати', () => {
    const s = town();
    seat(s, 'left', 'low');
    expect(CROWN_BY_ID.cr_vanguard.weight(s), 'спорить не с кем').toBe(0);
    seat(s, 'right', 'noble');
    expect(CROWN_BY_ID.cr_vanguard.weight(s)).toBe(1);
    const war = pointsOf(s, 'war');
    applyCrown(s, 'cr_vanguard', 1);
    expect(pointsOf(s, 'war')).toBeCloseTo(war + 20, 6);
    expect(activeBoons(s).some((b) => b.def.id === estateBoon('down', 'knights'))).toBe(true);
    const t = town();
    seat(t, 'left', 'low');
    seat(t, 'right', 'noble');
    applyCrown(t, 'cr_vanguard', 0);
    expect(activeBoons(t).some((b) => b.def.id === estateBoon('up', 'knights'))).toBe(true);
  });
});

describe('старое сохранение и чтение', () => {
  it('партия без поля — без командиров: слагаемого знати, тактики и жалованья нет', () => {
    const s = town();
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete raw.command;
    const back = deserialize(JSON.stringify(raw))!;
    expect(back.command).toBeUndefined();
    expect(commandFlanks(back)).toEqual({});
    expect(commandLead(back)).toBe(0);
    expect(commandWagesPerDay(back)).toBe(0);
    expect(estatesNow(back).knights.parts.lead).toBe(0);
  });

  it('места переживают запись; чужое место, один человек на двух флангах и место без имени не садятся', () => {
    const s = town();
    seat(s, 'left', 'low');
    seat(s, 'right', 'noble');
    const back = deserialize(serialize(s))!;
    expect(back.command).toEqual(s.command);
    const left = s.command!.seats.left!;
    const read = mergeCommand({
      seats: { left, right: { ...left, name: 'Другой' }, center: left, up: { n: 7, tier: 1, at: 0 } },
      took: { w: 0, n: [0, 999] },
      hired: -3,
    })!;
    expect(Object.keys(read.seats)).toEqual(['left']);
    expect(read.hired).toBe(0);
    expect(mergeCommand(null)).toBeUndefined();
  });
});

describe('одна дверь', () => {
  it('`s.command` пишет только `sim/command`; места командиров меняет только он', () => {
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
    expect(writers(/\.command\s*=[^=]/)).toEqual(['game/sim/command.ts']);
    expect(writers(/command[!?]?\.seats\[[^\]]+\]\s*=[^=]|delete\s+[\w.]*command[!?]?\.seats/)).toEqual(['game/sim/command.ts']);
    expect(FLANKS).toEqual(['left', 'right']);
  });
});
