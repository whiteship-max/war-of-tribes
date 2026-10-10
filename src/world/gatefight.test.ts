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
import { EVENT_BY_ID, GATE_POP, GATE_POWER, gateMen, gatePower, weakVillage } from '@/game/data/events';
import { eventId, lapseEvent, raiseEvent, resolveEvent } from '@/game/sim/mail';
import type { BuildingTypeId, GameState } from '@/game/types';
import { LocalWorld } from './local/LocalWorld';
import { tribePulse, type PulseTribe } from './bridge';
import { groundAt } from './place';
import { menOfPower } from './garrison';
import { distance } from './geo';
import { shieldPower, shieldVillagers } from './lairs';
import { troopPower } from '@/game/battle/price';
import { DAY_LENGTH } from '@/game/constants';
import { openSky, townAt, type Inside } from '../../scripts/autopilot';
import { goldFlight } from '../../scripts/pop-gold';
import { setRandom } from '@/game/sim/random';
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

describe('волки и разбойники — настоящий бой', () => {
  // Наследник теста «волки и разбойники соразмерны обороне, а не числу из прошлого века» (`sim/tick.test.ts`, удалён
  // поставкой 3): «стая волков не должна быть безобидной строкой лога; это настоящий бой».
  //
  // Утверждение «посёлок на 30 и на 700 жителей почти всегда отбивается» (больше 15 побед из 20) снято словом владельца по
  // 14.35, п. 6 (docs/battle_eu4.md): сила стаи была долей нашей обороны (0.55), то есть масштабом под нашу силу, а стала
  // таблицей по уровню посёлка — ровный бой гарнизона мерки уровня, делённый на 1.1: типичный отбивается чаще, сильный — ещё
  // чаще, слабый — реже (тесты «сила у ворот» ниже). Посёлок из этого теста — не мерка своего уровня: у него стартовое войско
  // при жильё на потолке, и «почти всегда» ему больше никто не обещает. Посёлок на 700 жителей логово замечает, и волки к нему
  // не приходят вовсе (волки — угроза слабого); разбойники на 700 — тест ниже.
  it('стая бьётся ядром у слабого посёлка, и бой стоит людей', async () => {
    let costly = 0;
    for (let i = 0; i < 20; i++) {
      const f = await fightAtGate(30, 11 + i, 'wolves');
      // Граница области: посёлок на 30 — слабый, волки к нему и приходят.
      expect(weakVillage(f.s), 'посёлок на 30 — слабый').toBe(true);
      // Точка внутри области: бой дошёл до ядра, стая — одной лёгкой конницей, у ворот — ополчение.
      expect(f.input, `бой ${i} дошёл до ядра`).toBeDefined();
      const wolves = kindsIn(f.input!.attacker);
      expect(total(wolves), 'стая в бою').toBeGreaterThan(0);
      expect(wolves.cavalry, 'стая — лёгкая конница, и только она').toBe(total(wolves));
      expect(total(kindsIn(f.input!.defender)), 'у ворот стоят люди').toBeGreaterThan(0);
      expect(f.report?.battle?.beasts, 'в записи боя — звери').toBe('attacker');
      // Место для показа (ролик TW): бой перед воротами.
      expect(f.report?.battle?.site, 'место — у ворот').toBe('gate');
      if (f.report!.battle!.result.sides.defender.total.losses > 0) costly++;
    }
    expect(costly, 'бой со стаей стоит людей — это бой, а не строка').toBeGreaterThan(0);
  }, 120_000);

  it('разбойники — люди родами ядра, и бьются так же настоящим боем', async () => {
    let fought = 0;
    for (let i = 0; i < 10; i++) {
      const f = await fightAtGate(700, 31 + i, 'raiders');
      expect(f.input, `бой ${i} дошёл до ядра`).toBeDefined();
      const band = kindsIn(f.input!.attacker);
      expect(total(band) - (band.cavalry ?? 0), 'разбойники — пешие рода людей').toBeGreaterThan(0);
      expect(f.report?.battle?.beasts, 'разбойники — не звери').toBeUndefined();
      expect(f.report?.battle?.site, 'место — у ворот').toBe('gate');
      if (f.report!.battle!.result.sides.defender.total.losses > 0) fought++;
    }
    expect(fought, 'бой с разбойниками стоит людей').toBeGreaterThan(0);
  }, 120_000);
});

describe('сила у ворот — таблица по уровню посёлка', () => {
  // Слово владельца по 14.35, пп. 4 и 6 (docs/battle_eu4.md): сила пришедших — таблица по уровню посёлка, для гарнизона мерки
  // уровня ровный бой, делённый на 1.1 (`data/events.GATE_POWER`, выводит `raid-mix:report`, раздел 4б). Уровень —
  // жители против жителей мерки (`GATE_POP`), войска в нём нет: масштаба под нашу силу нет, стать сильнее имеет смысл.

  it('сила — строка таблицы на жителях мерки уровня и прямая между ними; ни войско, ни оборона её не двигают', () => {
    // Граница области: жители мерки — все десять уровней и растут с уровнем; мерка своего уровня встречает ровно свою строку.
    expect(GATE_POP).toHaveLength(MAX_BUILDING_LEVEL);
    for (let l = 1; l < GATE_POP.length; l++) expect(GATE_POP[l]).toBeGreaterThan(GATE_POP[l - 1]);
    for (let l = 1; l <= GATE_POP.length; l++) expect(townAt(l).pop, `жители мерки ${l}-го уровня`).toBe(GATE_POP[l - 1]);
    for (const foe of ['wolves', 'raiders'] as const) {
      const row = GATE_POWER[foe];
      expect(row).toHaveLength(MAX_BUILDING_LEVEL);
      for (let l = 1; l < row.length; l++) expect(row[l], `${foe}: ${l + 1}-й уровень не слабее ${l}-го`).toBeGreaterThanOrEqual(row[l - 1]);
      for (let level = 1; level <= row.length; level++) {
        const s = village(30, 7);
        s.pop = GATE_POP[level - 1];
        expect(gatePower(s, foe), `${foe}, ${level}-й уровень`).toBe(row[level - 1]);
        if (level < row.length) {
          s.pop = (GATE_POP[level - 1] + GATE_POP[level]) / 2;
          expect(gatePower(s, foe), `${foe}: между ${level}-м и ${level + 1}-м — середина`).toBeCloseTo((row[level - 1] + row[level]) / 2, 6);
          s.pop = GATE_POP[level - 1];
        }
        const armed = village(30, 7);
        armed.pop = s.pop;
        armed.army.legionary = (armed.army.legionary ?? 0) + 200;
        armed.buildings.find((b) => b.type === 'palisade')!.level = MAX_BUILDING_LEVEL;
        expect(gatePower(armed, foe), `${foe}, ${level}-й уровень: войско и частокол силу пришедших не двигают`).toBe(gatePower(s, foe));
      }
    }
  });

  it('типичный гарнизон уровня — игрок «по умолчанию» на жителях мерки — отбивается от таблицы чаще, чем проигрывает, а ослабленный вдвое — реже его', async () => {
    // Мерка таблицы — слово владельца 30.09.2026 (docs/battle_eu4.md, 14.35): типичный гарнизон уровня — гарнизон игрока «по
    // умолчанию» спора за золото (`pop-gold.goldFlight`: высокий налог, найм по средствам, мир тихий) в минуту, когда его
    // жители доходят до жителей мерки уровня (`GATE_POP`), всё войско дома, вера — его. Так таблицу выводит `raid-mix:report`,
    // раздел 4б — медианой ровного боя по двенадцати потокам случайности; здесь — медианой побед по трём, на двадцати сидах
    // каждый (правило 17). Ослабленный — тот же снимок с половиной войска: пришедшие те же (сила от жителей).
    //
    // Прежде тест мерил на посёлке мерки `townAt`, у которого войско набрано смесью мерки, и после смены мерки на 1-м уровне
    // стаю таблицы не брали ни мерка, ни её половина — 20 из 20 у обеих: точка вне области правила (правило 11).
    const SEEDS = 20;
    const STREAMS = [1, 2, 3];
    const LEVELS = [1, 5];
    const top = Math.max(...LEVELS);
    const towns: GameState[][] = [];
    try {
      for (const stream of STREAMS) {
        const got: GameState[] = [];
        let level = 0;
        await goldFlight({
          masters: false,
          seconds: 720 * DAY_LENGTH,
          stream,
          watch: {
            after: ({ g }) => {
              for (; level < top && g.pop >= GATE_POP[level]; level += 1) got[level] = structuredClone(g);
            },
          },
          until: () => level >= top,
        });
        // Граница области: партия правда дошла до жителей мерки каждого проверяемого уровня.
        for (const l of LEVELS) expect(got[l - 1], `поток ${stream}: дошёл до жителей мерки ${l}-го уровня`).toBeDefined();
        towns.push(got);
      }
    } finally {
      // Поток случайности партии подменён (`goldFlight`) — остальные тесты файла идут на своём.
      setRandom(null);
    }
    const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1];
    for (const level of LEVELS) {
      for (const foe of ['wolves', 'raiders'] as const) {
        const wins = async (town: GameState, half: boolean): Promise<number> => {
          // Снимок партии: вызовы, ждавшие боя в минуту снимка, в бой мерки не идут — как у раздела 4б (`benchTown`).
          const g: GameState = { ...structuredClone(town), gate: [] };
          if (half) for (const id of Object.keys(g.army) as (keyof typeof g.army)[]) g.army[id] = Math.floor((g.army[id] ?? 0) / 2);
          const sky = openSky(g, { seed: 7, pulse: 30, raids: true });
          await sky.pulse();
          const w: Inside = sky.world;
          const power = gatePower(g, foe);
          let n = 0;
          for (let i = 1; i <= SEEDS; i++) {
            const call = { id: `table${i}`, foe, power, seed: i * 7919 };
            if (!w.gateField(w.gateParty(call), call.seed, w.save.home, sky.now()).field.won) n++;
          }
          return n;
        };
        const typical: number[] = [];
        const weak: number[] = [];
        for (const t of towns) {
          typical.push(await wins(t[level - 1], false));
          weak.push(await wins(t[level - 1], true));
        }
        expect(median(typical), `${level}-й уровень, ${foe}: типичный отбивается чаще, чем проигрывает (${typical.join(', ')} из ${SEEDS})`).toBeGreaterThan(SEEDS / 2);
        expect(median(weak), `${level}-й уровень, ${foe}: ослабленный отбивается реже типичного (${weak.join(', ')} против ${typical.join(', ')})`).toBeLessThan(median(typical));
      }
    }
  }, 300_000);

  it('волки — угроза слабого: к посёлку, который логово замечает, они не приходят; разбойники — к любому', () => {
    const after = (s: GameState): GameState => {
      s.time = 6 * DAY_LENGTH;
      return s;
    };
    const weak = after(village(30, 7));
    const armed = after(village(30, 7));
    armed.army.legionary = (armed.army.legionary ?? 0) + Math.ceil(shieldPower(0) / troopPower({ legionary: 1 })) + 1;
    const grown = after(village(700, 7));
    // Граница области: слабый — слабый, а малый посёлок с сильным войском и посёлок на 700 жителей — нет.
    expect(weakVillage(weak)).toBe(true);
    expect(weakVillage(armed), 'малый посёлок с сильным войском').toBe(false);
    expect(weakVillage(grown), 'посёлок на 700 жителей').toBe(false);
    expect(EVENT_BY_ID.wolves.weight(weak), 'к слабому волки приходят').toBeGreaterThan(0);
    expect(EVENT_BY_ID.wolves.weight(armed), 'к посёлку с сильным войском — нет').toBe(0);
    expect(EVENT_BY_ID.wolves.weight(grown), 'к выросшему — нет').toBe(0);
    for (const s of [weak, armed, grown]) expect(EVENT_BY_ID.raiders.weight(s), 'разбойники — к любому').toBeGreaterThan(0);
  });
});

describe('что сказано — то и бьётся', () => {
  // Текст письма стражи (docs/voice.md, 11): «к утру насчитали N» — число то же, что прежнее «Их N».
  it('«насчитали N» в тексте события — ровно столько волков выходит на ядро', async () => {
    const f = await fightAtGate(30, 5, 'wolves');
    const n = Number(/насчитали (\d+)\./.exec(f.shown)?.[1]);
    expect(n, 'в тексте есть число').toBeGreaterThan(0);
    expect(n, 'число текста — мерой боя').toBe(menOfPower(f.call.power));
    expect(total(kindsIn(f.input!.attacker)), 'столько волков и вышло').toBe(n);
    expect(gateMen(f.s, 'wolves'), 'одна функция на текст и вызов').toBe(menOfPower(gatePower(f.s, 'wolves')));
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
      expect(call.power, `${foe}: сила — таблица уровня`).toBe(gatePower(t.s, foe));
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
    stock: { food: 4000, wood: 4000, stone: 4000, hides: 4000, charcoal: 4000, copper: 4000, iron: 4000 },
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
