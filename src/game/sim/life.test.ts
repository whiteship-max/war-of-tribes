// Возраст, покой и ступень сохранения смертных агентов.
//
// Области (правило 11):
// - «возраст растёт монотонно» — любые шаги часов деревни, догон и запись с чтением; в
//   прогоне обязаны быть шаги, на которых возраст вправду растёт;
// - «в шестьдесят уходит ровно один раз» — прогон, в котором возраст **пересекает**
//   шестьдесят внутри окна: до пересечения уходов нет, после — ровно один;
// - ступень 12 → 13 — сохранение, в котором `s.time` велик настолько, что без ступени
//   все четверо были бы старше шестидесяти.
import { describe, expect, it } from 'vitest';
import { createInitialState, SAVE_VERSION } from '../state';
import { deserialize, rescaleXp, serialize } from '../save';
import { serverNow } from '@/net/clock';
import { awayGameSeconds, catchUp, tick } from './tick';
import { seeded } from './random';
import { ageOf, agentLevel, retiring } from './agents';
import { AGENT_AGE0, AGENT_YEAR, LEVEL_XP, RETIRE_AGE, levelOf } from '../data/agents';
import type { GameState } from '../types';
import { LocalWorld } from '@/world/local/LocalWorld';
import { applyEffects, playerProfile, syncAway } from '@/world/bridge';
import { awayOf } from '@/world/muster';
import { FIGURE_IDS } from '@/world/data/figures';
import type { FigureView, MarchView, WorldPulse } from '@/world/types';

const START = 1_700_000_000_000;

describe('возраст', () => {
  it('растёт монотонно на любых шагах часов, в догоне и после записи — и только от часов деревни', () => {
    const rnd = seeded(9);
    const s = createInitialState(9);
    let prev = ageOf(s, 'spy');
    let grew = 0;
    for (let i = 0; i < 400; i++) {
      const pick = rnd();
      if (pick < 0.6) tick(s, Math.floor(rnd() * 120));
      else if (pick < 0.8) catchUp(s, Math.floor(rnd() * 3000), 10);
      else {
        const back = deserialize(serialize(s))!;
        expect(ageOf(back, 'spy'), 'запись и чтение возраст не двигают').toBeCloseTo(ageOf(s, 'spy'), 9);
        Object.assign(s, back);
      }
      const now = ageOf(s, 'spy');
      expect(now, `шаг ${i}: возраст не убывает`).toBeGreaterThanOrEqual(prev);
      if (now > prev) grew++;
      prev = now;
    }
    expect(grew, 'возраст вправду рос — правило спрашивалось').toBeGreaterThan(100);
    expect(ageOf(s, 'spy')).toBeCloseTo(AGENT_AGE0 + s.time / AGENT_YEAR, 9);
  });
});

/** Пульс мира, как в `world/store`: слепок → мир → последствия → ушедшие. */
async function pulse(s: GameState, world: LocalWorld, last: { marches: MarchView[]; figures: FigureView[] }): Promise<WorldPulse> {
  const p = await world.sync(playerProfile(s, awayOf(last.marches, last.figures)));
  applyEffects(s, p.effects);
  syncAway(s, p.marches, p.figures);
  last.marches = p.marches;
  last.figures = p.figures;
  return p;
}

describe('покой в шестьдесят', () => {
  it('агент, доживший до шестидесяти у своих ворот, уходит ровно один раз, и место пустует', async () => {
    let now = START;
    const world = new LocalWorld({ seed: 7, now: () => now, storage: null });
    const s = createInitialState(7);
    s.faith.id = 'catholic';
    tick(s, 1);
    // До шестидесяти разведчику — две игровые минуты.
    s.agents.scout.bornAt = s.time - (RETIRE_AGE - AGENT_AGE0) * AGENT_YEAR + 120;
    const last = { marches: [] as MarchView[], figures: [] as FigureView[] };
    let retired = 0;
    let crossed = false;
    for (let i = 0; i < 40; i++) {
      const before = retiring(s, 'scout');
      tick(s, 10);
      now += 10_000;
      const p = await pulse(s, world, last);
      const out = p.effects.filter((e) => e.retired?.agent === 'scout').length;
      if (!before && !crossed && ageOf(s, 'scout') < RETIRE_AGE) expect(out, `шаг ${i}: до шестидесяти не уходят`).toBe(0);
      if (ageOf(s, 'scout') >= RETIRE_AGE) crossed = true;
      retired += out;
    }
    expect(crossed, 'точка внутри области: возраст пересёк шестьдесят в прогоне').toBe(true);
    expect(retired, 'ушёл ровно один раз').toBe(1);
    expect(s.agents.scout.vacant).toBe(true);
    expect(last.figures.find((f) => f.id === 'scout')!.place).toBe('vacant');
    expect(last.figures.find((f) => f.id === 'scout')!.gone).toBe('retired');
    expect(s.log.some((e) => /ушёл на покой в 60 лет/.test(e.text))).toBe(true);
    // Остальные трое на месте.
    for (const id of FIGURE_IDS.filter((x) => x !== 'scout')) expect(s.agents[id].vacant, id).toBe(false);
  });

  it('мир сам уводит на покой один раз, даже когда слепок ещё много пульсов твердит «пора»', async () => {
    let now = START;
    const world = new LocalWorld({ seed: 7, now: () => now, storage: null });
    const s = createInitialState(7);
    const base = playerProfile(s);
    await world.sync(base);
    // Племя ещё не узнало об уходе: последствий оно не применяет, и слепок тот же.
    const stale = { ...base, agents: { spy: { person: 0, retiring: true as const } } };
    let retired = 0;
    for (let i = 0; i < 12; i++) {
      now += 5_000;
      const p = await world.sync(stale);
      retired += p.effects.filter((e) => e.retired?.agent === 'spy').length;
    }
    expect(retired, 'точка внутри области: уход вообще случился').toBeGreaterThan(0);
    expect(retired, 'и ровно один раз').toBe(1);
    expect((await world.figures()).find((f) => f.id === 'spy')!.place).toBe('vacant');
  });

  it('доживший в поле сперва идёт домой и уходит у своих ворот — тоже один раз', async () => {
    let now = START;
    const world = new LocalWorld({ seed: 7, now: () => now, storage: null });
    const s = createInitialState(7);
    s.faith.id = 'catholic';
    tick(s, 1);
    const last = { marches: [] as MarchView[], figures: [] as FigureView[] };
    await pulse(s, world, last);
    const home = (await world.info()).home;
    expect(await world.moveFigure('scout', { x: home.x + 12, y: home.y })).toBeNull();
    for (let i = 0; i < 20; i++) {
      now += 60_000;
      await pulse(s, world, last);
    }
    expect(last.figures.find((f) => f.id === 'scout')!.phase, 'точка внутри области: разведчик стоит в поле').toBe('field');
    s.agents.scout.bornAt = s.time - (RETIRE_AGE - AGENT_AGE0) * AGENT_YEAR - 1;
    expect(retiring(s, 'scout')).toBe(true);
    let retired = 0;
    let walked = false;
    for (let i = 0; i < 40; i++) {
      now += 30_000;
      tick(s, 30);
      const p = await pulse(s, world, last);
      if (last.figures.find((f) => f.id === 'scout')?.phase === 'moving') walked = true;
      retired += p.effects.filter((e) => e.retired?.agent === 'scout').length;
    }
    expect(walked, 'пошёл домой сам').toBe(true);
    expect(retired, 'ушёл у ворот ровно один раз').toBe(1);
    expect(s.agents.scout.vacant).toBe(true);
    expect(await world.moveFigure('scout', { x: home.x + 5, y: home.y }), 'пустому месту приказов нет').toMatch(/место пустует/);
  });
});

describe('ступень сохранения 12 → 13', () => {
  /** Сохранение двенадцатой версии: агенты без людей, герой с именем, партия без сида, часы — за сотню часов. */
  function saveV12(xp: Record<string, number>): string {
    const raw = JSON.parse(serialize(createInitialState(1))) as Record<string, unknown>;
    raw.version = 12;
    delete raw.seed;
    delete raw.rolls;
    delete raw.hires;
    raw.time = 400_000;
    raw.hero = { name: 'Радим Хмурый', kind: 'infantry', downUntil: 0, marchId: null };
    raw.faith = { ...(raw.faith as object), id: 'orthodox' };
    raw.agents = Object.fromEntries(FIGURE_IDS.map((id) => [id, { xp: xp[id] ?? 0, deedAt: null, slots: [null, null, null] }]));
    return JSON.stringify(raw);
  }

  it('без ступени все четверо были бы стариками — и ни один не уходит на покой на загрузке', () => {
    const json = saveV12({});
    expect(AGENT_AGE0 + 400_000 / AGENT_YEAR, 'точка внутри области: умолчание сделало бы всех старше шестидесяти').toBeGreaterThan(RETIRE_AGE);
    const s = deserialize(json)!;
    expect(s.version).toBe(SAVE_VERSION);
    for (const id of FIGURE_IDS) {
      expect(retiring(s, id), `${id} не уходит на покой`).toBe(false);
      expect(ageOf(s, id), `${id}: служба начата сегодня`).toBe(AGENT_AGE0);
      expect(s.agents[id].vacant).toBe(false);
      expect(s.agents[id].name, `${id}: имя дано`).not.toBeNull();
    }
    expect(s.agents.general.name, 'имя героя перешло полководцу').toBe('Радим Хмурый');
    // Служба начинается в минуту входа — после догона офлайна, а не до него.
    const away = JSON.parse(json) as Record<string, unknown>;
    away.lastSaved = serverNow() - 3 * 3600_000;
    const late = deserialize(JSON.stringify(away))!;
    // Сколько догонять, считает та же дверь, что и ступень: под потолком догона в игровых днях.
    const offline = awayGameSeconds(away.lastSaved as number, serverNow());
    expect(offline, 'точка внутри области: догонять есть что').toBeGreaterThan(1000);
    catchUp(late, offline, 10);
    for (const id of FIGURE_IDS) expect(ageOf(late, id), `${id}: догон не состарил`).toBeCloseTo(AGENT_AGE0, 6);
    expect(s.log.some((e) => e.text.startsWith('Агенты получили имена и возраст'))).toBe(true);
  });

  it('опыт переходит на новые пороги, не сдвигая уровня; сид выводится из самого сохранения', () => {
    const old = [0, 5, 19, 20, 45, 59, 60, 100, 129, 130, 200, 239, 240, 999];
    const OLD = [0, 20, 60, 130, 240];
    const oldLevel = (xp: number): number => OLD.filter((t) => xp >= t).length;
    for (const xp of old) {
      expect(levelOf(rescaleXp(xp)), `опыт ${xp}: уровень тот же`).toBe(oldLevel(xp));
      expect(rescaleXp(xp)).toBeLessThanOrEqual(LEVEL_XP[LEVEL_XP.length - 1]);
    }
    const json = saveV12({ scout: 45, spy: 130, general: 239 });
    const a = deserialize(json)!;
    const b = deserialize(json)!;
    expect(agentLevel(a, 'scout')).toBe(2);
    expect(agentLevel(a, 'spy')).toBe(4);
    expect(agentLevel(a, 'general')).toBe(4);
    expect(a.seed, 'дважды загруженное сохранение — тот же сид').toBe(b.seed);
    expect(FIGURE_IDS.map((id) => a.agents[id].name)).toEqual(FIGURE_IDS.map((id) => b.agents[id].name));
  });
});
