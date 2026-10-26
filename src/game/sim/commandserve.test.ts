// Служба командиров флангов (ДР-5, п. 4; docs/siege_v2.md, «Решения ДР-5»): опыт за бои — медленно, лестницей агентов, сжатой на
// лестницу командира; гибель в бою — той же гибелью разбитого, что у полководца (`world/peril.routPeril`), по доле выбитых своего
// фланга; покой по возрасту; весть о пустом месте и выбор нового в «Командующих»; опись несёт опыт. Каждая точка сначала
// утверждает, что она внутри области правила (правило 11): место занято, бой — дальше срока между делами, доля выбитых больше нуля.
import { describe, expect, it } from 'vitest';
import type { GameState } from '../types';
import { createInitialState } from '../state';
import { QUESTS } from '../data/quests';
import { AGENT_ROLES } from '../agentrules';
import { AGENT_YEAR, DEED_GAP, DEED_XP, LEVEL_XP, MAX_AGENT_LEVEL } from '../data/agents';
import { MAX_ADVISOR_LEVEL } from '../councilrules';
import { commandGrowth, commanderAt, servedCommander, tacticsOf } from '../commandrules';
import { buildingOfType, commanderOn, commandWagesPerDay } from '../derived';
import { EVENT_BY_ID } from '../data/events';
import { creditTech } from './tech';
import { tick } from './tick';
import { commandBattle, commandOf, commandSeat, commandVacancyEvent, commandVacancyFlank, commandWatch, mergeCommand } from './command';
import { commandersOf, hireCommander } from './commanders';
import { applyEffects } from '@/world/bridge';

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

const HOME = { phase: 'home', departAt: 0 } as const;

/** Нанять первого кандидата рода `birth` на левый фланг. */
function seated(s: GameState, birth: 'low' | 'noble' = 'low'): number {
  const c = commandersOf(s).find((x) => x.birth === birth)!;
  expect(hireCommander(s, 'left', c.n, HOME), 'найм').toBeNull();
  return c.n;
}

/** Бой полководца в минуту мира `at` (мс): исход и гибель левого фланга. */
const fight = (at: number, ok: boolean, peril = 0, seed = 7) => ({ at, ok, seed, peril: { left: peril } });

describe('опыт командира — медленно, лестницей агентов', () => {
  it('рост выведен: лестница агентов (5 ступеней) сжата на лестницу командира (3)', () => {
    for (let xp = 0; xp <= LEVEL_XP[LEVEL_XP.length - 1]; xp++) {
      const agent = LEVEL_XP.filter((x) => xp >= x).length;
      expect(commandGrowth(xp)).toBe(Math.floor(((agent - 1) * (MAX_ADVISOR_LEVEL - 1)) / (MAX_AGENT_LEVEL - 1)));
    }
    // Медленнее агента: ступень командира — две ступени агента.
    expect(commandGrowth(LEVEL_XP[1])).toBe(0);
    expect(commandGrowth(LEVEL_XP[2])).toBe(1);
    expect(commandGrowth(LEVEL_XP[4])).toBe(2);
  });

  it('выросший командир бьётся выше своего уровня, жалованье — по уровню найма; вершина — не выше лестницы', () => {
    const s = town();
    const c = commanderAt(s.seed, commandersOf(s).find((x) => x.birth === 'low')!.n, 3);
    const top = servedCommander(c, LEVEL_XP[4]);
    expect(top.rank).toBe(Math.min(MAX_ADVISOR_LEVEL, c.level + 2));
    expect(top.tactics).toBe(tacticsOf(c.birth, top.rank!));
    expect(top.level).toBe(c.level);
    // Опыт тактику не опускает ни у какого рода.
    for (const birth of ['low', 'noble'] as const) {
      const base = { ...c, birth, tactics: tacticsOf(birth, 1), level: 1 };
      let was = -Infinity;
      for (let xp = 0; xp <= LEVEL_XP[4]; xp++) {
        const t = servedCommander(base, xp).tactics;
        expect(t).toBeGreaterThanOrEqual(was);
        was = t;
      }
    }
  });

  it('бой даёт опыт удачей и неудачей, не чаще срока между делами; тактика на месте растёт', () => {
    const s = town();
    seated(s);
    const t0 = 1_000_000;
    commandBattle(s, fight(t0, true));
    expect(commandSeat(s, 'left')?.xp).toBe(DEED_XP.ok);
    // Раньше срока — не в счёт.
    commandBattle(s, fight(t0 + DEED_GAP - 1, true));
    expect(commandSeat(s, 'left')?.xp).toBe(DEED_XP.ok);
    commandBattle(s, fight(t0 + DEED_GAP, false));
    expect(commandSeat(s, 'left')?.xp).toBe(DEED_XP.ok + DEED_XP.fail);
    const before = commanderOn(s, 'left')!.tactics;
    const wage = commandWagesPerDay(s);
    for (let k = 2; k < 40 && commandGrowth(commandSeat(s, 'left')!.xp ?? 0) < 1; k++) commandBattle(s, fight(t0 + k * DEED_GAP, true));
    expect(commandGrowth(commandSeat(s, 'left')!.xp ?? 0), 'опыт поднял ступень').toBe(1);
    const after = commanderOn(s, 'left')!;
    expect(after.rank, 'точка внутри области: командир не на вершине').toBeLessThanOrEqual(MAX_ADVISOR_LEVEL);
    expect(after.tactics).toBeGreaterThanOrEqual(before);
    expect(commandWagesPerDay(s)).toBe(wage);
  });
});

describe('гибель в бою и весть', () => {
  it('гибнет по кости боя с долей гибели фланга; пустое место — строка летописи и весть «Командующие»', () => {
    let fell = 0;
    let lived = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const s = town();
      seated(s);
      // Бой приходит последствием мира — той же дверью, что в игре.
      applyEffects(s, [{ id: `b${seed}`, lost: {}, resources: {}, prestige: 0, morale: 0, battle: 'lost', text: 'Бой.', good: false, flanks: fight(1_000_000, false, 0.3, seed) }]);
      if (commandSeat(s, 'left')) {
        lived++;
        continue;
      }
      fell++;
      expect(commandOf(s).left?.left?.why).toBe('fell');
      const ev = s.inbox.find((e) => e.defId === commandVacancyEvent('left'));
      expect(ev, 'весть на столе').toBeTruthy();
      expect(commandVacancyFlank(ev!.defId)).toBe('left');
      expect(EVENT_BY_ID[ev!.defId], 'весть в таблице событий').toBeTruthy();
    }
    // Доля погибших — около доли гибели (набор сидов, правило 17).
    expect(fell / 200).toBeGreaterThan(0.2);
    expect(fell / 200).toBeLessThan(0.4);
    expect(lived).toBeGreaterThan(0);
  });

  it('без выбитых своего фланга не гибнет; пустой фланг боя не касается', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = town();
      seated(s);
      commandBattle(s, { at: 1_000_000, ok: false, seed, peril: { left: 0, right: 0.9 } });
      expect(commandSeat(s, 'left'), `сид ${seed}`).toBeTruthy();
    }
  });

  it('бой доходит до племени последствием мира', () => {
    const s = town();
    seated(s);
    applyEffects(s, [{ id: 'b1', lost: {}, resources: {}, prestige: 0, morale: 0, battle: 'won', text: 'Бой.', good: true, flanks: fight(1_000_000, true) }]);
    expect(commandSeat(s, 'left')?.xp).toBe(DEED_XP.ok);
  });

  it('покой — тоже весть: место пустеет строкой и вестью', () => {
    const s = town();
    seated(s);
    const c = commanderOn(s, 'left')!;
    s.time += 100 * AGENT_YEAR;
    expect(c).toBeTruthy();
    tick(s, 1);
    expect(commandSeat(s, 'left')).toBeNull();
    expect(commandOf(s).left?.left?.why).toBe('rest');
    expect(s.inbox.some((e) => e.defId === commandVacancyEvent('left'))).toBe(true);
  });
});

describe('опись и сохранение', () => {
  it('опыт и отметка дела едут в опись и переживают запись; мусор — без поля', () => {
    const s = town();
    seated(s);
    commandBattle(s, fight(1_000_000, true));
    expect(commandWatch(s)?.seats[0].xp).toBe(DEED_XP.ok);
    const back = mergeCommand(JSON.parse(JSON.stringify(s.command)));
    expect(back?.seats.left?.xp).toBe(DEED_XP.ok);
    expect(back?.seats.left?.deedAt).toBe(1_000_000);
    const junk = mergeCommand({ ...JSON.parse(JSON.stringify(s.command)), seats: { left: { ...s.command!.seats.left, xp: 'много', deedAt: NaN } } });
    expect(junk?.seats.left?.xp).toBeUndefined();
    expect(junk?.seats.left?.deedAt).toBeUndefined();
  });
});
