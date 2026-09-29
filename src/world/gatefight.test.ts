// Волки и разбойники — бой ядром у своих ворот той же дверью, что набег (docs/battle_eu4.md, 14.28; слово владельца).
// Прежде они считались своим боем мимо ядра (`sim/battle.resolveBattle`): наша сила не меньше 0.85 обороны против 0.55
// или 0.85, победа при «не меньше» — бой не проигрывался никогда и не стоил ни одного человека, а тест держал обещание
// «настоящий бой» даром.
//
// Проверка на настоящем мире и настоящем пульсе племени: событие приходит на стол, ответ или молчание кладут вызов, мир
// бьётся на пульсе. Вход ядра перехватывается без подмены — бой идёт насквозь (`vi.mock('@/battle')`).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { BattleInput, Stack } from '@/battle';
import { createInitialState } from '@/game/state';
import { MAX_BUILDING_LEVEL, RESOURCE_IDS } from '@/game/constants';
import { EVENT_BY_ID, RAIDER_SHARE, WOLF_SHARE, foePower, gateMen } from '@/game/data/events';
import { eventId, lapseEvent, raiseEvent, resolveEvent } from '@/game/sim/mail';
import type { BuildingTypeId, GameState } from '@/game/types';
import { LocalWorld } from './local/LocalWorld';
import { tribePulse, type PulseTribe } from './bridge';
import { groundAt } from './place';
import { menOfPower } from './garrison';
import { distance } from './geo';
import { shieldVillagers } from './lairs';
import type { WorldSave } from './local/state';
import type { FigureView, GateFoe, MarchView, PlayerProfile, Report } from './types';
import type { TroopStack } from '@/game/battle/kinds';

const seen = vi.hoisted(() => [] as BattleInput[]);
vi.mock('@/battle', async (orig) => {
  const real = await orig<typeof import('@/battle')>();
  return {
    ...real,
    simulateBattle: vi.fn((input: BattleInput) => {
      seen.push(input);
      return real.simulateBattle(input);
    }),
  };
});

const START = 1_700_000_000_000;

/** Все роды стороны по секторам — то, что встало в бой. */
const kindsIn = (side: BattleInput['attacker']): Stack => {
  const out: Record<string, number> = {};
  for (const stack of Object.values(side.sectors)) {
    for (const [k, n] of Object.entries(stack)) out[k] = (out[k] ?? 0) + (n ?? 0);
  }
  return out as Stack;
};
const total = (st: Stack): number => Object.values(st).reduce((n, v) => n + (v ?? 0), 0);

/** Посёлок нужного размера — тем же приёмом, что в тестах тика: жильё и склад на потолке, запас, мораль. */
function village(pop: number, seed: number): GameState {
  const s = createInitialState();
  s.seed = seed;
  s.rolls = 0;
  s.tutorialDone = true;
  const place = (type: BuildingTypeId): void => {
    const b = s.buildings.find((x) => x.type === type)!;
    b.level = MAX_BUILDING_LEVEL;
    b.work = 0;
    b.workRequired = 0;
  };
  place('houses');
  place('storage');
  s.pop = pop;
  for (const r of RESOURCE_IDS) s.resources[r] = 5000;
  s.morale = 70;
  return s;
}

/** Посёлок и мир на одном пульсе, как в игре. */
async function gatePair(pop: number, seed: number) {
  const s = village(pop, seed);
  const world = new LocalWorld({ seed, now: () => START, storage: null });
  const tribe: PulseTribe = { get: () => s, apply: (change) => change(s) };
  let last: { marches: MarchView[]; figures: FigureView[] } = { marches: [], figures: [] };
  const pulse = async () => {
    const p = await tribePulse(world, tribe, last);
    last = { marches: p.marches, figures: p.figures };
    return p;
  };
  await pulse();
  return { s, world, pulse };
}

/** Ответ на событие у ворот — боем (или молчанием) — и пульс мира: вход ядра, отчёт и последствие этого вызова. */
async function fightAtGate(pop: number, seed: number, foe: GateFoe, silent = false) {
  const t = await gatePair(pop, seed);
  expect(raiseEvent(t.s, foe), 'событие легло на стол').toBe(true);
  const ev = t.s.inbox.find((e) => e.defId === foe)!;
  const text = EVENT_BY_ID[foe].text;
  const shown = typeof text === 'function' ? text(t.s) : text;
  const option = EVENT_BY_ID[foe].options.findIndex((o) => !o.cost);
  if (silent) lapseEvent(t.s, eventId(ev));
  else expect(resolveEvent(t.s, option, eventId(ev)).error).toBeNull();
  const call = t.s.gate[t.s.gate.length - 1];
  expect(call?.foe, 'ответ положил вызов к воротам').toBe(foe);
  seen.length = 0;
  const p = await t.pulse();
  const input = seen.find((i) => i.seed === call.seed);
  const report = p.reports.find((r) => r.id === `${call.id}-gate`) as Report | undefined;
  const effect = p.effects.find((e) => e.gate === call.id);
  return { ...t, call, input, report, effect, shown };
}

describe('бой у ворот — одна дверь на набег и событие', () => {
  it('своего боя у событий нет: `resolveBattle` ушёл, события не зовут ядро, мир бьётся только дверью у ворот', () => {
    const strip = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(existsSync(path.resolve('src/game/sim/battle.ts')), 'своего боя у события больше нет').toBe(false);
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && /\bresolveBattle\b/.test(strip(readFileSync(p, 'utf8')))) {
          hits.push(path.relative(process.cwd(), p));
        }
      }
    };
    walk(path.resolve('src'));
    expect(hits, 'боя мимо ядра нет нигде').toEqual([]);
    const events = strip(readFileSync(path.resolve('src/game/data/events.ts'), 'utf8'));
    expect(events, 'события не зовут ядро сами').not.toMatch(/from '@\/battle'|simulateBattle|resolveField/);
    const world = strip(readFileSync(path.resolve('src/world/local/LocalWorld.ts'), 'utf8'));
    const from = world.indexOf('private gateFight(');
    const end = world.indexOf('\n  }\n', from);
    expect(from > 0 && end > from, 'тело боя у ворот найдено').toBe(true);
    const body = world.slice(from, end);
    expect(body, 'бой события — дверью у ворот').toMatch(/this\.gateField\(/);
    expect(body, 'своей сборки сторон у боя события нет').not.toMatch(/resolveField\(|simulateBattle\(/);
  });
});

describe('волки и разбойники — настоящий бой на любом размере посёлка', () => {
  // Наследник теста «волки и разбойники соразмерны обороне, а не числу из прошлого века» (`sim/tick.test.ts`, удалён
  // поставкой 3): «при семи сотнях жителей стая волков не должна быть безобидной строкой лога; волки слабее обороны:
  // почти всегда отбиваемся, но это настоящий бой». Прежний держал его даром — бой не проигрывался и не стоил людей.
  // Точки те же — посёлки на 30 и 700 жителей, по двадцать боёв; порог — прежнее обещание, не подогнанный.
  // КРАСНЫЙ с охвата одним правилом (docs/battle_eu4.md, 14.35, пункт 1), честно: посёлок на 30 отбивается в 15 боях из 20
  // при пороге «больше 15» (700 — зелёный). Сила стаи здесь — доля обороны 0.55; её заменяет таблица силы у ворот и защита
  // слабого (шаг 6 пересмотра, п. 8 слова владельца) — там тест и переписывается.
  for (const pop of [30, 700]) {
    it(`посёлок на ${pop}: стая бьётся ядром, отбиваемся почти всегда, но бой стоит людей`, async () => {
      let won = 0;
      let costlyWin = 0;
      for (let i = 0; i < 20; i++) {
        const f = await fightAtGate(pop, 11 + i, 'wolves');
        // Точка внутри области: бой дошёл до ядра, стая — одной лёгкой конницей, у ворот — ополчение.
        expect(f.input, `бой ${i} дошёл до ядра`).toBeDefined();
        const wolves = kindsIn(f.input!.attacker);
        expect(total(wolves), 'стая в бою').toBeGreaterThan(0);
        expect(wolves.cavalry, 'стая — лёгкая конница, и только она').toBe(total(wolves));
        expect(total(kindsIn(f.input!.defender)), 'у ворот стоят люди').toBeGreaterThan(0);
        expect(f.report?.battle?.beasts, 'в записи боя — звери').toBe('attacker');
        const ours = f.report!.battle!.result.sides.defender.total.losses;
        if (f.effect!.battle === 'won') {
          won++;
          if (ours > 0) costlyWin++;
        }
      }
      expect(won, `посёлок на ${pop}: почти всегда отбиваемся`).toBeGreaterThan(15);
      expect(costlyWin, `посёлок на ${pop}: и победа стоит людей — это бой, а не строка`).toBeGreaterThan(0);
    }, 120_000);
  }

  it('разбойники — люди родами ядра, и бьются так же настоящим боем', async () => {
    let fought = 0;
    for (let i = 0; i < 10; i++) {
      const f = await fightAtGate(700, 31 + i, 'raiders');
      expect(f.input, `бой ${i} дошёл до ядра`).toBeDefined();
      const band = kindsIn(f.input!.attacker);
      expect(total(band) - (band.cavalry ?? 0), 'разбойники — пешие рода людей').toBeGreaterThan(0);
      expect(f.report?.battle?.beasts, 'разбойники — не звери').toBeUndefined();
      if (f.report!.battle!.result.sides.defender.total.losses > 0) fought++;
    }
    expect(fought, 'бой с разбойниками стоит людей').toBeGreaterThan(0);
  }, 120_000);
});

describe('что сказано — то и бьётся', () => {
  it('«Их N» в тексте события — ровно столько волков выходит на ядро', async () => {
    const f = await fightAtGate(700, 5, 'wolves');
    const n = Number(/Их (\d+)\./.exec(f.shown)?.[1]);
    expect(n, 'в тексте есть число').toBeGreaterThan(0);
    expect(n, 'число текста — мерой боя').toBe(menOfPower(f.call.power));
    expect(total(kindsIn(f.input!.attacker)), 'столько волков и вышло').toBe(n);
    expect(gateMen(f.s, WOLF_SHARE), 'одна функция на текст и вызов').toBe(menOfPower(foePower(f.s, WOLF_SHARE)));
  }, 60_000);

  it('молчание — тот же бой: вызов кладётся, склад не тронут', async () => {
    for (const foe of ['wolves', 'raiders'] as const) {
      const t = await gatePair(700, 7);
      const stock = { ...t.s.resources };
      expect(raiseEvent(t.s, foe)).toBe(true);
      const ev = t.s.inbox.find((e) => e.defId === foe)!;
      lapseEvent(t.s, eventId(ev));
      expect(t.s.gate.map((c) => c.foe), `${foe}: молчание положило вызов`).toEqual([foe]);
      expect(t.s.resources, `${foe}: молчание со склада не платит`).toEqual(stock);
      const call = t.s.gate[0];
      const share = foe === 'wolves' ? WOLF_SHARE : RAIDER_SHARE;
      expect(call.power, `${foe}: сила — доля обороны`).toBe(foePower(t.s, share));
      const p = await t.pulse();
      expect(p.effects.filter((e) => e.gate === call.id), `${foe}: бой по молчанию`).toHaveLength(1);
    }
  }, 60_000);
});

describe('полководец и место боя — как у стены', () => {
  const HOST: TroopStack = { legionary: 30, spearman: 24, archer: 16 };
  const PIPS = { fire: 2, shock: 1 };
  const profile = (gate?: PlayerProfile['gate']): PlayerProfile => ({
    name: 'Тест',
    pop: shieldVillagers(0.1),
    defense: 900,
    militia: 40,
    units: { warrior: 10, scout: 4 },
    army: { ...HOST },
    stock: { food: 4000, wood: 4000, stone: 4000, hides: 4000, bones: 4000, copper: 4000, iron: 4000 },
    stash: 0,
    pips: PIPS,
    ...(gate ? { gate } : {}),
  });

  it('отметки полководца — только при дружине у ворот; штраф места — нападающему, клетка дома', async () => {
    let now = START;
    const world = new LocalWorld({ seed: 7, now: () => now, storage: null });
    const general = async (): Promise<FigureView> => (await world.figures()).find((f) => f.id === 'general')!;
    await world.sync(profile());
    expect(await world.setGarrison({ ...HOST })).toBeNull();
    now = Math.max(now, (await general()).readyAt);
    await world.sync(profile());
    const info = await world.info();
    const seed = (world as unknown as { save: WorldSave }).save.seed;

    const fight = async (id: string) => {
      seen.length = 0;
      const call = { id, foe: 'wolves' as const, power: 60, seed: 4242 };
      await world.sync(profile([call]));
      return seen.find((i) => i.seed === call.seed)!;
    };

    // Дружина собрана и стоит у ворот — полководец ведёт оборону со всеми отметками.
    const home = await fight('gate-home');
    expect(home, 'бой у ворот дошёл до ядра').toBeDefined();
    expect(home.defender.pips, 'дружина у ворот — отметки полководца в бою').toEqual(PIPS);
    expect(home.attacker.ground ?? {}, 'штраф места нападающему — земля клетки дома').toEqual(
      groundAt(seed, info.home, info.home),
    );
    expect(home.defender.ground, 'обороняющемуся штраф не кладут').toBeUndefined();

    // Дружина ушла с полководцем в поле — у ворот его отметок нет.
    const lairs = (world as unknown as { gen: { settlements: { x: number; y: number }[] } }).gen.settlements;
    const [near] = [...lairs].sort((a, b) => distance(info.home, a) - distance(info.home, b));
    expect(await world.moveFigure('general', { x: near.x, y: near.y })).toBeNull();
    now = Math.max(now, (await general()).arriveAt);
    const away = await fight('gate-away');
    expect(away, 'бой у ворот дошёл до ядра').toBeDefined();
    expect(away.defender.pips ?? {}, 'дружина в поле — у ворот отметок нет').toEqual({});
  }, 120_000);
});
