import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stackTotal, UNIT_KINDS, type Stack } from '@/battle';
import { kindsOf, type TroopStack } from '@/game/battle/kinds';
import { LocalWorld } from './local/LocalWorld';
import { menOfPower } from './garrison';
import { CAMP_GATE_CLEAR, CAMP_WORKS_PASS, CAMP_WORKS_RIPE } from './data/tuning';
import {
  campPass,
  campWorks,
  gateBusyText,
  gateFree,
  passKinds,
  refusedAtGate,
  sortieForecast,
  throughWorks,
  worksRipeAt,
} from './works';
import type { PlayerProfile, WorldPulse } from './types';

const START = 1_700_000_000_000;
const MIN = 60_000;

/**
 * Деревня, которую штурмовать бессмысленно (набег упирается в силу логова и
 * садится лагерем), с гарнизоном, которым есть чем выйти. Тот же слепок, на
 * котором до укреплений были сняты числа голода ниже.
 */
const holdout: PlayerProfile = {
  name: 'Тест',
  pop: 120,
  defense: 100_000,
  warriorPower: 3,
  units: { warrior: 10, scout: 4 },
  command: 100,
  army: { legionary: 40, spearman: 30, archer: 20 },
  stock: { food: 600, wood: 400 },
  stash: 0,
  food: 6000,
  foodPerHour: 6000,
  soldierFoodPerHour: 60,
};
const GARRISON: TroopStack = { legionary: 40, spearman: 30, archer: 20 };

function memory(data: string | null = null) {
  return {
    read: (): string | null => data,
    write: (json: string): void => {
      data = json;
    },
  };
}

interface Frozen {
  seed: number;
  save: string;
  siege: NonNullable<WorldPulse['siege']>;
}

/** Мир до первой осады деревни — и его сохранение в эту минуту. */
async function freeze(seed: number): Promise<Frozen> {
  let now = START;
  const store = memory();
  const world = new LocalWorld({ seed, now: () => now, storage: store });
  await world.sync(holdout);
  for (let i = 0; i < 3000; i++) {
    now += 20_000;
    const pulse = await world.sync(holdout);
    if (pulse.siege) return { seed, save: store.read() as string, siege: pulse.siege };
  }
  throw new Error('осады так и не случилось');
}

/** Поднять замороженный мир на минуте `at`; `variant` сдвигает сид боя. */
async function thaw(fz: Frozen, at: number, variant = 0) {
  let now = at;
  const save = JSON.parse(fz.save);
  save.nextMarch = (save.nextMarch ?? 0) + variant * 7;
  const world = new LocalWorld({ seed: fz.seed, now: () => now, storage: memory(JSON.stringify(save)) });
  const pulse = await world.sync(holdout);
  return { world, pulse, set: (t: number): void => void (now = t) };
}

type CampBattle = (
  id: string,
  at: number,
  seed: number,
  attacker: { own: TroopStack; setup: null },
) => {
  refused: boolean;
  field: { won: boolean; result: { sides: { attacker: { total: { initial: number } }; defender: { total: { initial: number } } } } | null };
  camp: { men: number; kinds: Record<string, number> };
  through: { kinds: Record<string, number>; went: number; passed: number };
} | null;

const campBattle = (w: LocalWorld): CampBattle =>
  (w as unknown as { campBattle: CampBattle }).campBattle.bind(w);

/** Окно осады деревни в сохранении мира — прямо то, что пишет бой. */
const homeWindow = (w: LocalWorld): { gateAt?: number } =>
  (w as unknown as { save: { sieges: Record<string, { gateAt?: number }> } }).save.sieges.home;

/**
 * Освободить проход перед точкой замера. Тесты ниже меряют укрепление во времени,
 * сотни боёв на одном мире подряд, — а каждый бой занимает проход. Без этого точка
 * мерила бы не рогатки своей минуты, а очередь за предыдущими боями; поток
 * проверяется своими тестами.
 */
const freeGate = (w: LocalWorld): void => {
  delete homeWindow(w).gateAt;
};

describe('укрепления лагеря: чистая функция времени', () => {
  const SINCE = START + 17 * MIN;
  const times = Array.from({ length: 80 }, (_, i) => SINCE - 5 * MIN + i * 30_000);

  it('тот же вход — тот же выход, в любом порядке вопросов', () => {
    const forward = times.map((t) => campWorks(SINCE, t));
    // Порядок перемешан детерминированно: каждый седьмой шаг по кругу.
    const order = times.map((_, i) => (i * 7) % times.length);
    const shuffled: number[] = [];
    for (const i of order) shuffled[i] = campWorks(SINCE, times[i]);
    expect(shuffled).toEqual(forward);
    const going = kindsOf(GARRISON);
    const again = times.map((t) => throughWorks(8, SINCE, t, going));
    expect(times.map((t) => throughWorks(8, SINCE, t, going))).toEqual(again);
    expect(going).toEqual(kindsOf(GARRISON));
    // И вход не трогается: отряд остаётся тем, чем был.
    expect(GARRISON).toEqual({ legionary: 40, spearman: 30, archer: 20 });
  });

  it('укрепление не убывает, не превышает потолка и встаёт на нём', () => {
    let prev = -1;
    for (const t of times) {
      const w = campWorks(SINCE, t);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
      expect(w, `на ${(t - SINCE) / MIN} мин укрепление убыло`).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
    expect(campWorks(SINCE, SINCE)).toBe(0);
    expect(campWorks(SINCE, worksRipeAt(SINCE))).toBe(1);
    expect(campWorks(SINCE, worksRipeAt(SINCE) + 10 * 60 * MIN)).toBe(1);
    // Растёт по-настоящему: на полпути — половина, а не ноль и не единица.
    expect(campWorks(SINCE, SINCE + CAMP_WORKS_RIPE / 2)).toBeCloseTo(0.5, 9);
  });

  it('проход не расширяется со временем и на дозревших рогатках равен объявленному', () => {
    for (const men of [1, 5, 8, 11, 77, 424]) {
      let prev = Infinity;
      for (const t of times) {
        const pass = campPass(men, campWorks(SINCE, t));
        expect(pass, `${men} в лагере, ${(t - SINCE) / MIN} мин`).toBeLessThanOrEqual(prev);
        expect(pass).toBeGreaterThanOrEqual(1);
        prev = pass;
      }
      expect(prev).toBe(Math.max(1, Math.round(men * CAMP_WORKS_PASS)));
    }
  });

  it('через рогатки проходит одна доля строя от каждого рода и не больше пропуска', () => {
    // Латники тяжёлые: восемь бойцов строя на голову. Проход режет строй, а не
    // головы, — иначе при пропуске меньше восьми латник не прошёл бы никогда.
    const going = kindsOf({ clubman: 13, spearman: 31, archer: 17, legionary: 9, rider: 4 });
    const total = stackTotal(going);
    let prev = 0;
    for (let pass = 1; pass <= total + 3; pass++) {
      const k = passKinds(going, pass);
      const share = Math.min(1, pass / total);
      for (const kind of UNIT_KINDS) {
        expect(k[kind]).toBeLessThanOrEqual(going[kind]);
        // Доля одна на всех: ни один род не отстаёт от неё больше чем на бойца.
        expect(Math.abs(k[kind] - going[kind] * share), `пропуск ${pass}, ${kind}`).toBeLessThan(1 + 1e-9);
      }
      expect(stackTotal(k), `пропуск ${pass}`).toBe(Math.min(pass, total));
      expect(stackTotal(k), 'шире проход — не меньше прошедших').toBeGreaterThanOrEqual(prev);
      prev = stackTotal(k);
    }
    expect(passKinds(going, Infinity)).toEqual(going);
    expect(passKinds(going, 8).infantry, 'тяжёлые проходят и в узкий проход').toBeGreaterThan(0);
  });

  it('укрепления не знают ни голода, ни окна осады, и окно — о них', () => {
    const siege = readFileSync(path.join(process.cwd(), 'src/world/siege.ts'), 'utf8');
    expect(siege).not.toMatch(/works/);
    const works = readFileSync(path.join(process.cwd(), 'src/world/works.ts'), 'utf8').replace(/\/\/.*$/gm, '');
    expect(works).not.toMatch(/starvesAt|consumptionPerHour|foodAtStart/);
  });
});

describe('укрепления лагеря: бой, голод и то, что видит игрок', () => {
  it('шанс вылазки не растёт по мере того, как рогатки строятся, — ни на одном шаге', async () => {
    const fz = await freeze(7);
    const { world } = await thaw(fz, fz.siege.since);
    const battle = campBattle(world);
    const SEEDS = 60;
    const wins: number[] = [];
    // До дозревания и не дальше: окно голода в этом слепке — 31.6 мин, и за ним
    // лагеря нет вовсе, а «ноль побед» без лагеря ничего не доказывает.
    for (let d = 0; d <= CAMP_WORKS_RIPE / MIN; d += 2) {
      let won = 0;
      for (let i = 0; i < SEEDS; i++) {
        freeGate(world);
        const out = battle('home', fz.siege.since + d * MIN, 9000 + i * 131, { own: GARRISON, setup: null });
        expect(out, `на ${d} мин лагерь обязан стоять`).not.toBeNull();
        expect(out!.refused, `на ${d} мин проход свободен`).toBe(false);
        if (out!.field.won) won++;
      }
      wins.push(won);
    }
    for (let i = 1; i < wins.length; i++) {
      expect(wins[i], `шаг ${i * 2} мин: ${wins.join(' ')}`).toBeLessThanOrEqual(wins[i - 1]);
    }
    // И кривая не плоская: сразу после постановки — почти всегда, на дозревших — почти никогда.
    expect(wins[0] / SEEDS, wins.join(' ')).toBeGreaterThanOrEqual(0.9);
    expect(wins[wins.length - 1] / SEEDS, wins.join(' ')).toBeLessThanOrEqual(0.2);
  }, 120_000);

  it('лагерь в бою — ровно те, кто в нём стоит: прибавки за готовность нет нигде', async () => {
    const fz = await freeze(7);
    const { world, pulse } = await thaw(fz, fz.siege.since);
    const battle = campBattle(world);
    const save = JSON.parse(fz.save) as { marches: { id: string; power: number }[]; sieges: { home: { campId: string } } };
    const camp = save.marches.find((m) => m.id === save.sieges.home.campId)!;
    expect(pulse.siege!.campMen, 'панель видит тот же лагерь').toBe(menOfPower(camp.power));
    for (const d of [0, 7, 14, 28, 31]) {
      freeGate(world);
      const out = battle('home', fz.siege.since + d * MIN, 777 + d, { own: GARRISON, setup: null })!;
      expect(out.refused, `${d} мин: проход свободен`).toBe(false);
      expect(out.camp.men, `${d} мин`).toBe(menOfPower(camp.power));
      // Мерка — сам бой: сколько стояло в лагере в его начале.
      expect(out.field.result!.sides.defender.total.initial, `${d} мин`).toBe(out.camp.men);
      // А у нападающих в бою — только прошедшие через рогатки.
      expect(out.field.result!.sides.attacker.total.initial).toBe(out.through.passed);
    }
    // И в исходниках прежней прибавки не осталось ни в игре, ни в отчётах.
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('works.test.ts')) files.push(p);
      }
    };
    walk(path.join(process.cwd(), 'src'));
    walk(path.join(process.cwd(), 'scripts'));
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/SORTIE_CAMP_BONUS|campMen\(/);
    }
    const lw = readFileSync(path.join(process.cwd(), 'src/world/local/LocalWorld.ts'), 'utf8');
    expect(lw).toMatch(/private campArmy\(w: SiegeWindow\)/);
  }, 120_000);

  it('осада без вылазки даёт те же числа, что и до укреплений', async () => {
    // Сняты на 7569f8e, до правки: те же сиды, тот же слепок, те же минуты.
    for (const seed of [7, 11]) {
      const fz = await freeze(seed);
      expect(fz.siege.since, `сид ${seed}`).toBe(1_700_001_020_000);
      expect(fz.siege.starvesAt).toBeCloseTo(1_700_002_914_736.842, 2);
      expect(fz.siege.garrison).toBe(90);
      const { world, set } = await thaw(fz, fz.siege.since);
      // Рогатки растут от нуля до дозревших — часы голода не шелохнулись.
      for (const d of [1, 9, 17, 25, 31]) {
        set(fz.siege.since + d * MIN);
        const pulse = await world.sync(holdout);
        expect(pulse.siege!.starvesAt, `сид ${seed}, ${d} мин`).toBeCloseTo(1_700_002_914_736.842, 2);
      }
      set(Math.ceil(fz.siege.starvesAt));
      const after = await world.sync(holdout);
      const effect = after.effects.find((e) => e.text.includes('Осада'));
      expect(effect?.lostTroops).toEqual({ spearman: 15, archer: 10, legionary: 20 });
      expect(effect?.resources).toEqual({ food: -600, wood: -400 });
    }
  }, 120_000);

  it('панель вылазки и запись боя показывают то, что посчитал бой', async () => {
    const fz = await freeze(7);
    const picks: TroopStack[] = [GARRISON, { spearman: 12, archer: 5 }, { legionary: 3, archer: 2 }];
    for (const d of [0, 3, 9, 16, 28, 31]) {
      for (const [k, going] of picks.entries()) {
        const at = fz.siege.since + d * MIN;
        const { world, pulse } = await thaw(fz, at, k);
        // Ровно то, что панель считает из того, что ей отдал мир.
        const fc = sortieForecast(pulse.siege!, kindsOf(going), at);
        const res = await world.sortie(going);
        expect(res.error).toBeNull();
        const report = (await world.reports()).find((r) => r.id === res.reportId)!;
        const label = `${d} мин, отряд ${k}`;
        // Запись после боя: «пробились N из M» — то же, что панель обещала.
        expect(report.through, label).toEqual({ went: fc.now.went, passed: fc.now.passed });
        // Сам бой: дрались ровно те, кого панель назвала прошедшими, — по родам.
        const sides = report.battle!.result.sides.attacker;
        expect(sides.total.initial, label).toBe(fc.now.passed);
        for (const kind of UNIT_KINDS) expect(sides.initial[kind], `${label}, ${kind}`).toBe(fc.now.kinds[kind]);
        // Пропуск панели — пропуск боя: больше него в строю нападающих не было.
        expect(sides.total.initial, label).toBeLessThanOrEqual(fc.now.pass);
        if (fc.now.passed < fc.now.went) {
          expect(report.text, label).toContain(`пробились ${fc.now.passed} бойцов строя из ${fc.now.went}`);
        }
      }
    }
    // Панель не держит своей арифметики прохода: она зовёт прогноз и только его.
    const panel = readFileSync(path.join(process.cwd(), 'src/ui/panels/SortiePanel.tsx'), 'utf8');
    expect(panel).toMatch(/sortieForecast\(siege, kindsOf\(picked\), now\)/);
    expect(panel).not.toMatch(/passTroops|campPass|campWorks|throughWorks|CAMP_WORKS/);
  }, 180_000);
});

describe('проход через рогатки — поток, а не порция', () => {
  const SINCE = START + 17 * MIN;
  /** Дозревшие рогатки: пропуск больше не сужается, и поток считается точно. */
  const RIPE = SINCE + CAMP_WORKS_RIPE;
  const MEN = 11;

  it('свободная доля растёт со временем до единицы, а старое окно без отметки свободно', () => {
    expect(gateFree(undefined, RIPE), 'нет отметки — проход свободен').toBe(1);
    const gateAt = RIPE + CAMP_GATE_CLEAR;
    let prev = -1;
    for (let t = RIPE; t <= gateAt + 60_000; t += 15_000) {
      const f = gateFree(gateAt, t);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      expect(f, `${(t - RIPE) / 1000} с`).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    expect(gateFree(gateAt, RIPE)).toBe(0);
    expect(gateFree(gateAt, RIPE + CAMP_GATE_CLEAR / 2)).toBeCloseTo(0.5, 9);
    expect(gateFree(gateAt, gateAt)).toBe(1);
  });

  it('дробление не проводит к рогаткам больше потока — как ни дели', () => {
    const pass = campPass(MEN, 1);
    const going = kindsOf(GARRISON);
    const T = 90_000;
    const ways: [string, number, Stack][] = [
      ['одна всем', T + 1, going],
      ['всем каждые 3 с', 3_000, going],
      ['всем каждые 30 с', 30_000, going],
      ['по одному каждые 3 с', 3_000, { spear: 1, infantry: 0, archer: 0, cavalry: 0 }],
    ];
    const totals: Record<string, number> = {};
    for (const [name, step, g] of ways) {
      let gateAt: number | undefined;
      let total = 0;
      for (let t = RIPE; t <= RIPE + T; t += step) {
        // Граница области: рогатки дозрели на каждой точке, пропуск постоянен.
        expect(campWorks(SINCE, t), `${name}: точка до дозревания`).toBe(1);
        const th = throughWorks(MEN, SINCE, t, g, gateAt);
        total += th.passed;
        gateAt = th.gateAt;
        if (gateAt !== undefined) {
          expect(gateAt - t, `${name}: проход занят дольше полного`).toBeLessThanOrEqual(CAMP_GATE_CLEAR + 1e-6);
        }
      }
      totals[name] = total;
      // Предел потока: полный пропуск сразу плюс то, что освободилось за T.
      expect(total, `${name}: ${JSON.stringify(totals)}`).toBeLessThanOrEqual(
        Math.floor(pass * (1 + T / CAMP_GATE_CLEAR)),
      );
    }
    expect(totals['одна всем']).toBe(pass);
  });

  it('частые вылазки подряд проводят не больше потока и получают отказ до боя', async () => {
    const fz = await freeze(7);
    const at = fz.siege.since + CAMP_WORKS_RIPE;
    expect(at, 'минута внутри окна голода').toBeLessThan(fz.siege.starvesAt - 60_000);
    const { world, set } = await thaw(fz, at);
    const first = await world.sortie(GARRISON);
    expect(first.error).toBeNull();
    const firstPassed = (await world.reports()).find((r) => r.id === first.reportId)!.through!.passed;
    expect(firstPassed).toBeGreaterThan(0);
    let passedAfter = 0;
    let refusals = 0;
    for (let i = 1; i <= 20; i++) {
      const t = at + i * 3_000;
      set(t);
      const view = (await world.sync(holdout)).siege!;
      const fc = sortieForecast(view, kindsOf(GARRISON), t);
      const res = await world.sortie(GARRISON);
      if (res.error) {
        refusals++;
        // Отказ до боя — те же слова, что панель показала до нажатия.
        expect(res.error).toBe(gateBusyText(fc.now.waitMs));
        expect(res.reportId).toBeNull();
      } else {
        passedAfter += (await world.reports()).find((r) => r.id === res.reportId)!.through!.passed;
      }
    }
    expect(refusals, 'проход занят — вылазки подряд получают отказ').toBeGreaterThan(0);
    // Шестьдесят секунд — шестая часть потока; больше неё не прошло.
    const pass = campPass(fz.siege.campMen, 1);
    expect(passedAfter, `за минуту после первой прошло ${passedAfter}`).toBeLessThanOrEqual(
      Math.floor((pass * 60_000) / CAMP_GATE_CLEAR),
    );
  }, 120_000);

  it('волна через десять минут проходит целиком: проход освободился сам, без пульсов', async () => {
    const fz = await freeze(7);
    const at = fz.siege.since + 14 * MIN;
    const again = at + CAMP_GATE_CLEAR;
    expect(again, 'вторая волна внутри окна голода').toBeLessThan(fz.siege.starvesAt);
    // Первая волна — два копейщика: она заведомо не снимает осаду и занимает проход.
    let first = null as Awaited<ReturnType<typeof thaw>> | null;
    for (let v = 0; v < 10 && !first; v++) {
      const t = await thaw(fz, at, v);
      const res = await t.world.sortie({ spearman: 2 });
      if (res.error === null && !res.won) first = t;
    }
    expect(first, 'нашёлся сид, где первая волна отбита').toBeTruthy();
    const { world, set } = first!;
    expect(homeWindow(world).gateAt, 'проход занят').toBeGreaterThan(at);
    // Ни одного пульса за десять минут — офлайн.
    set(again);
    const view = (await world.sync(holdout)).siege!;
    expect(view, 'осада стоит').toBeTruthy();
    // Вторая волна — без копейщиков: первая могла их недосчитаться.
    const wave: TroopStack = { legionary: 40, archer: 20 };
    const fc = sortieForecast(view, kindsOf(wave), again);
    expect(fc.now.free, 'через десять минут проход свободен целиком').toBe(1);
    const res = await world.sortie(wave);
    expect(res.error).toBeNull();
    const r = (await world.reports()).find((x) => x.id === res.reportId)!;
    expect(r.through?.passed, 'вторая волна прошла полным пропуском').toBe(Math.min(fc.now.went, fc.now.pass));
  }, 120_000);

  it('окно без отметки — как в старом сохранении — читается свободным проходом', async () => {
    const fz = await freeze(7);
    const at = fz.siege.since + CAMP_WORKS_RIPE;
    const { world } = await thaw(fz, at);
    expect(homeWindow(world).gateAt, 'сохранение без отметки').toBeUndefined();
    const view = (await world.sync(holdout)).siege!;
    const fc = sortieForecast(view, kindsOf(GARRISON), at);
    expect(fc.now.free).toBe(1);
    const res = await world.sortie(GARRISON);
    expect(res.error).toBeNull();
    const r = (await world.reports()).find((x) => x.id === res.reportId)!;
    expect(r.through?.passed).toBe(campPass(view.campMen, 1));
  }, 120_000);

  it('проход один: вылазка и удар полководца берут из одной занятости', async () => {
    let now = START;
    const world = new LocalWorld({ seed: 7, now: () => now, storage: memory() });
    await world.sync(holdout);
    // Дружина собирается дома заранее: во время осады её уже не вывести.
    expect(await world.setGarrison({ legionary: 20 })).toBeNull();
    const g = (await world.figures()).find((f) => f.id === 'general')!;
    now = Math.max(now, g.readyAt);
    await world.sync(holdout);
    let siege: WorldPulse['siege'] = null;
    for (let i = 0; i < 3000 && !siege; i++) {
      now += 20_000;
      siege = (await world.sync(holdout)).siege;
    }
    expect(siege, 'осада встала').toBeTruthy();
    now = siege!.since + CAMP_WORKS_RIPE;
    expect(now, 'минута внутри окна голода').toBeLessThan(siege!.starvesAt);
    await world.sync(holdout);
    // Вылазка из гарнизона занимает проход целиком…
    expect((await world.sortie({ legionary: 20, spearman: 30, archer: 20 })).error).toBeNull();
    expect(homeWindow(world).gateAt).toBeGreaterThan(now);
    now += 3_000;
    await world.sync(holdout);
    // …и полководцу, бьющему от своих ворот, пройти уже некому — те же слова.
    const hit = await world.attack({ setup: null });
    expect(hit.error ?? '', 'удар полководца упёрся в тот же проход').toMatch(/К рогаткам сейчас не пробиться/);
    expect(hit.reportId).toBeNull();
  }, 120_000);

  it('снятая осада уносит проход с собой: у новой осады он свободен', async () => {
    let now = START;
    const world = new LocalWorld({ seed: 7, now: () => now, storage: memory() });
    const siegeNow = async (): Promise<NonNullable<WorldPulse['siege']>> => {
      for (let i = 0; i < 6000; i++) {
        now += 20_000;
        const p = await world.sync(holdout);
        if (p.siege) return p.siege;
      }
      throw new Error('осады так и не случилось');
    };
    await world.sync(holdout);
    const first = await siegeNow();
    now = first.since + CAMP_WORKS_RIPE;
    await world.sync(holdout);
    const lost = await world.sortie({ spearman: 1 });
    expect(lost.error).toBeNull();
    expect(lost.won, 'один копейщик на дозревших рогатках не снимает осаду').toBe(false);
    const busy = homeWindow(world).gateAt;
    expect(busy, 'проход первой осады занят').toBeGreaterThan(now);
    // Город доеден — окно снято.
    now = Math.ceil((await world.sync(holdout)).siege!.starvesAt);
    expect((await world.sync(holdout)).siege).toBeNull();
    const second = await siegeNow();
    expect(second.since).toBeGreaterThan(first.since);
    expect(homeWindow(world).gateAt, 'новая осада начинает со свободного прохода').toBeUndefined();
    expect(second.gateAt).toBeUndefined();
  }, 240_000);

  it('панель показывает занятость прохода той же функцией, что и бой', async () => {
    const fz = await freeze(7);
    let checked = 0;
    let refusedSeen = 0;
    for (const d of [16, 28]) {
      const at = fz.siege.since + d * MIN;
      const { world, set } = await thaw(fz, at);
      const picks: TroopStack[] = [{ spearman: 2 }, { spearman: 12, archer: 5 }, GARRISON, GARRISON];
      for (const [k, going] of picks.entries()) {
        const t = at + k * 20_000;
        expect(t, 'точка внутри окна голода').toBeLessThan(fz.siege.starvesAt);
        set(t);
        const view = (await world.sync(holdout)).siege;
        if (!view) break;
        const fc = sortieForecast(view, kindsOf(going), t);
        const res = await world.sortie(going);
        const label = `${d} мин, заход ${k}`;
        checked++;
        if (refusedAtGate(fc.now)) {
          refusedSeen++;
          expect(res.error, label).toBe(gateBusyText(fc.now.waitMs));
          continue;
        }
        expect(res.error, label).toBeNull();
        const r = (await world.reports()).find((x) => x.id === res.reportId)!;
        expect(r.through, label).toEqual({ went: fc.now.went, passed: fc.now.passed });
        expect(r.battle!.result.sides.attacker.total.initial, label).toBe(fc.now.passed);
        if (!res.won) expect(homeWindow(world).gateAt, `${label}: отметка боя`).toBe(fc.now.gateAt);
      }
    }
    expect(checked).toBeGreaterThan(4);
    expect(refusedSeen, 'в прогоне был и отказ — проверено и его слово').toBeGreaterThan(0);
  }, 120_000);
});
