import '@/game/pace.minute';
// Логова: чистая часть и то, как она живёт в мире.
//
// Разделено надвое так же, как у писем и осады. Первая половина не знает ни про
// мир, ни про часы — она проверяет договор `world/lairs.ts`: сила выводится из
// двух отметок времени, одинаковый вход даёт одинаковый выход, потолок держится
// сколько бы ни прошло. Вторая гоняет настоящий `LocalWorld` с ручными часами:
// победа убирает логово с карты, пепелище сходит в срок, новое заводится не
// быстрее объявленного темпа, добыча растёт с силой, а счёт в профиле совпадает
// с числом побед.
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import { generateWorld, isLair, lairAnchor } from './gen';
import { distance } from './geo';
import { lairArms, lairArmsBase, lairGold, lairLoot, lairPhase, lairPop, lairPower, lairRipeness, ruinLeft } from './lairs';
import {
  AI_RANGE,
  LAIR_ANCHOR_MID,
  LAIR_CAP,
  LAIR_NEAR_CAP,
  LAIR_RIPE,
  LAIR_RUIN,
  LAIR_SPAWN_MIN,
  LAIR_START,
} from './data/tuning';
import { applyExpedition } from '@/game/sim/expedition';
import { createInitialState } from '@/game/state';
import { toOutcome } from './bridge';
import type { HomeEffect, PlayerProfile, SettlementView } from './types';
import type { WorldSave } from './local/state';

const MIN = 60_000;
const HOUR = 60 * MIN;
const START = 1_700_000_000_000;

const rec = (bornAt = 0, burnedAt = 0) => ({ bornAt, burnedAt });
/** Жители города, от которых считается логово в чистых проверках. */
const V = 400;

// ------------------------------------------------ логово — чистая функция ---

describe('логово — чистая функция от времени появления', () => {
  it('одинаковый вход даёт одинаковый выход, и никакой памяти между вызовами', () => {
    for (const age of [0, MIN, HOUR, LAIR_RIPE, LAIR_RIPE * 3]) {
      const a = lairPower(50, rec(START), START + age, V);
      const b = lairPower(50, rec(START), START + age, V);
      expect(a).toBe(b);
    }
  });

  it('растёт от объявленного начала к объявленному потолку', () => {
    const anchor = 50;
    const ripe = lairPower(anchor, rec(START), START + LAIR_RIPE, V);
    expect(lairPower(anchor, rec(START), START, V)).toBeCloseTo((ripe * LAIR_START) / LAIR_CAP, 6);
    // Свежее логово — самое слабое, что есть вокруг: слабее собственного потолка
    // заметно, иначе рост не был бы виден между заходами.
    expect(lairPower(anchor, rec(START), START, V)).toBeLessThan(ripe * 0.75);
  });

  it('потолок держится, сколько бы ни прошло: месяц не крепче срока', () => {
    const anchor = 50;
    const ripe = lairPower(anchor, rec(START), START + LAIR_RIPE, V);
    for (const days of [1, 3, 7, 30, 365]) {
      expect(lairPower(anchor, rec(START), START + days * 24 * HOUR, V)).toBe(ripe);
    }
    expect(lairRipeness(rec(START), START + 365 * 24 * HOUR)).toBe(1);
  });

  it('сила соразмерна опоре: вдвое дальше опора — вдвое крепче логово', () => {
    expect(lairPower(100, rec(START), START + LAIR_RIPE, V)).toBeCloseTo(
      lairPower(50, rec(START), START + LAIR_RIPE, V) * 2,
      6,
    );
  });

  it('город растёт — растёт и логово', () => {
    let prev = 0;
    for (const v of [0, 100, 306, 518, 755, 1000]) {
      const p = lairPower(LAIR_ANCHOR_MID, rec(START), START + LAIR_RIPE, v);
      expect(p, `${v} жителей`).toBeGreaterThan(prev);
      prev = p;
    }
  });

  it('часы назад силы не убавляют: до появления логова его возраст ноль', () => {
    expect(lairPower(50, rec(START), START - 10 * HOUR, V)).toBeCloseTo(lairPower(50, rec(START), START, V), 6);
  });

  it('добро и золото растут с силой, а оружие — нет: у предметов своя дверь', () => {
    const young = lairPower(50, rec(START), START, V);
    const ripe = lairPower(50, rec(START), START + LAIR_RIPE, V);
    expect(lairLoot(ripe)).toBeGreaterThan(lairLoot(young));
    expect(lairGold(ripe)).toBeGreaterThan(lairGold(young));
    expect(lairLoot(ripe) / lairLoot(young)).toBeCloseTo(ripe / young, 1);
    expect(lairPop(ripe)).toBeGreaterThan(lairPop(young));
    // Большой город растит логово вчетверо и больше — а оружия от этого не прибавляется
    // ни одного: оно считается от опоры и возраста, где жителей нет.
    const small = lairPower(50, rec(START), START + LAIR_RIPE, 100);
    const big = lairPower(50, rec(START), START + LAIR_RIPE, 1000);
    expect(big).toBeGreaterThan(small * 3);
    expect(lairArms(lairArmsBase(50, rec(START), START + LAIR_RIPE))).toBe(lairArms(50 * LAIR_CAP));
    expect(lairArms(lairArmsBase(50, rec(START), START))).toBeLessThan(lairArms(lairArmsBase(50, rec(START), START + LAIR_RIPE)));
  });

  it('пепелище живёт ровно объявленный срок и ни секундой дольше', () => {
    const burned = rec(START, START + HOUR);
    expect(lairPhase(rec(START), START + 5 * HOUR)).toBe('alive');
    expect(lairPhase(burned, START + HOUR)).toBe('ruin');
    expect(lairPhase(burned, START + HOUR + LAIR_RUIN - 1)).toBe('ruin');
    expect(lairPhase(burned, START + HOUR + LAIR_RUIN)).toBe('gone');
    expect(ruinLeft(burned, START + HOUR)).toBe(LAIR_RUIN);
    expect(ruinLeft(burned, START + HOUR + LAIR_RUIN)).toBe(0);
    expect(ruinLeft(rec(START), START + HOUR)).toBe(0);
  });
});

// ------------------------------------------------------ логова в мире ---

/** Мир с ручными часами и без сохранения. */
function makeWorld(seed: number) {
  let now = START;
  const world = new LocalWorld({ seed, now: () => now, storage: null, reveal: true });
  return {
    world,
    at: (t: number): void => {
      now = t;
    },
    advance: (ms: number): void => {
      now += ms;
    },
    now: (): number => now,
  };
}

const profile = (): PlayerProfile =>
  ({
    name: 'Тест',
    pop: 300,
    defense: 900,
    units: { warrior: 40, scout: 6 },
    army: { legionary: 40, spearman: 30, archer: 20 },
    warning: 120,
    stock: { food: 900, wood: 600 },
    stash: 0,
    food: 9000,
    foodPerHour: 6000,
    soldierFoodPerHour: 40,
  }) as PlayerProfile;

/** Настоящее состояние мира: тесту про логова положено видеть и то, что скрыто. */
const saveOf = (w: LocalWorld): WorldSave => (w as unknown as { save: WorldSave }).save;

/** Все логова вокруг деревни глазами карты. */
async function lairsOnMap(world: LocalWorld): Promise<SettlementView[]> {
  const info = await world.info();
  const chunk = await world.region({
    x: info.home.x - AI_RANGE,
    y: info.home.y - AI_RANGE,
    w: AI_RANGE * 2 + 1,
    h: AI_RANGE * 2 + 1,
  });
  return chunk.settlements.filter((s) => !s.mine && s.relation === 'barbarian');
}

/**
 * Подводит полководца с дружиной к ближайшему логову. Возвращает его карточку:
 * дальше по ней и бьют.
 */
async function bringGeneral(w: ReturnType<typeof makeWorld>, p: PlayerProfile) {
  await w.world.sync(p);
  expect(await w.world.setGarrison({ legionary: 40, spearman: 30, archer: 20 })).toBeNull();
  for (let i = 0; i < 120; i++) {
    w.advance(MIN);
    await w.world.sync(p);
    const g = (await w.world.figures()).find((f) => f.id === 'general');
    if (g && g.readyAt === 0) break;
  }
  const info = await w.world.info();
  const lairs = (await lairsOnMap(w.world)).filter((s) => !s.ruin);
  expect(lairs.length, 'в округе есть логово').toBeGreaterThan(0);
  const target = lairs.sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];
  expect(await w.world.moveFigure('general', { x: target.x, y: target.y })).toBeNull();
  for (let i = 0; i < 400; i++) {
    w.advance(MIN);
    await w.world.sync(p);
    const g = (await w.world.figures()).find((f) => f.id === 'general');
    if (g && g.phase !== 'moving') break;
  }
  return target;
}

describe('логова в мире', () => {
  it('победа убирает логово с карты, и набеги оттуда прекращаются', async () => {
    const w = makeWorld(11);
    const p = profile();
    const target = await bringGeneral(w, p);

    // Отряд, вышедший из логова, обязан исчезнуть вместе с ним: обещание
    // «оттуда больше никто не идёт» держится не словами, а списком походов.
    const save = saveOf(w.world);
    save.marches.push({
      id: 'raid-test',
      seed: 1,
      mission: 'raid',
      units: { warrior: 5 },
      own: false,
      fromId: target.id,
      targetId: 'home',
      from: { x: target.x, y: target.y },
      to: { ...save.home },
      fromName: target.name,
      toName: 'Наша деревня',
      departAt: w.now(),
      arriveAt: w.now() + 30 * MIN,
      phase: 'out',
      power: 10,
      loot: null,
    });

    const res = await w.world.attack({});
    expect(res.error).toBeNull();
    expect(res.won, 'дружина втрое сильнее логова — она побеждает').toBe(true);

    const report = (await w.world.reports()).find((r) => r.id === res.reportId);
    expect(report?.title).toContain('Логово сожжено');
    expect(save.marches.some((m) => m.fromId === target.id), 'набеги оттуда сняты').toBe(false);

    // На карте вместо логова пепелище, и второй раз его не разграбить.
    const onMap = (await lairsOnMap(w.world)).find((s) => s.id === target.id);
    expect(onMap?.ruin, 'на месте пепелище').toBe(true);
    const again = await w.world.attack({});
    expect(again.error, 'сожжённое второй раз не грабится').toBeTruthy();

    const card = await w.world.settlement(target.id);
    expect(card?.ruin).toBe(true);
    expect(card?.can.raid).toBe(false);
    expect(card?.can.scout).toBe(false);
    expect(card?.ruinLeft).toBeGreaterThan(0);
  }, 120_000);

  it('удар по логову — бой в поле: павшие дружины отданы как павшие при полководце', async () => {
    // Лазарет кладёт раненых полководца при нём, а не в лазарет, пока дружина не вернулась
    // (docs/infirmary.md, решение 6). Узнаёт он это из последствия, а не по имени боя.
    const w = makeWorld(11);
    const p = profile();
    await bringGeneral(w, p);
    const res = await w.world.attack({});
    expect(res.error).toBeNull();
    const e = saveOf(w.world).effects.find((x) => x.id === `${res.reportId}-battle`);
    const lost = Object.values(e?.lostTroops ?? {}).reduce((n, v) => n + (v ?? 0), 0);
    expect(lost, 'точка внутри области: удар стоил людей').toBeGreaterThan(0);
    expect(e?.field).toEqual(e?.lostTroops);
    expect(e?.routed).toBeUndefined();
  }, 120_000);

  it('пепелище исчезает ровно в срок, и клетка становится пустой', async () => {
    const w = makeWorld(11);
    const p = profile();
    const target = await bringGeneral(w, p);
    expect((await w.world.attack({})).won).toBe(true);
    const burnedAt = saveOf(w.world).lairs[target.id].burnedAt;

    w.at(burnedAt + LAIR_RUIN - MIN);
    await w.world.sync(p);
    expect((await w.world.settlement(target.id))?.ruin, 'до срока след ещё виден').toBe(true);

    w.at(burnedAt + LAIR_RUIN + MIN);
    await w.world.sync(p);
    expect(await w.world.settlement(target.id), 'после срока карточки нет').toBeNull();
    expect((await lairsOnMap(w.world)).some((s) => s.id === target.id), 'и значка нет').toBe(false);
  }, 120_000);

  it('новое логово заводится, но не быстрее объявленного темпа и не выше потолка', async () => {
    const w = makeWorld(11);
    const p = profile();
    await w.world.sync(p);
    const save = saveOf(w.world);

    // Первый слот назначается пульсом, а не конструктором: расписание одно на
    // все логова, и второй формулы у него быть не должно.
    expect(save.nextLairAt).toBeGreaterThanOrEqual(START + LAIR_SPAWN_MIN);

    const born: number[] = [];
    for (let m = 1; m <= 24 * 60; m++) {
      w.at(START + m * MIN);
      await w.world.sync(p);
      for (const l of save.spawned) {
        const at = save.lairs[l.id]?.bornAt ?? 0;
        if (at > 0 && !born.includes(at)) born.push(at);
      }
    }
    expect(save.spawned.length, 'за сутки мир завёл хоть одно новое логово').toBeGreaterThan(0);
    born.sort((a, b) => a - b);
    for (let i = 1; i < born.length; i++) {
      expect(born[i] - born[i - 1], 'между новыми логовами не меньше паузы').toBeGreaterThanOrEqual(
        LAIR_SPAWN_MIN,
      );
    }

    // Потолок числа держится: карта не зарастает.
    const gen = generateWorld(save.seed);
    const spots = [
      ...gen.settlements.filter((s) => isLair(s)).map((s) => ({ id: s.id, x: s.x, y: s.y })),
      ...save.spawned,
    ];
    const alive = spots.filter(
      (s) =>
        distance(s, save.home) <= AI_RANGE &&
        lairPhase(save.lairs[s.id] ?? rec(save.createdAt), w.now()) === 'alive',
    );
    // Потолок гасит **новые** логова, а не сносит старые: генерация на щедром
    // сиде может рассыпать вокруг дома и больше четырёх, и трогать их никто не
    // вправе. Проверяется поэтому то, что и обещано: сверх потолка мир сам
    // ничего не заводит.
    const first = generateWorld(save.seed).settlements.filter(
      (x) => isLair(x) && distance(x, save.home) <= AI_RANGE,
    ).length;
    expect(alive.length).toBeLessThanOrEqual(Math.max(LAIR_NEAR_CAP, first));

    // И каждое новое логово начинает слабым, а не с потолка.
    for (const l of save.spawned) {
      const anchor = lairAnchor(save.home, l);
      const at = save.lairs[l.id].bornAt;
      expect(lairPower(anchor, save.lairs[l.id], at, p.pop)).toBeCloseTo(
        (lairPower(anchor, save.lairs[l.id], at + LAIR_RIPE, p.pop) * LAIR_START) / LAIR_CAP,
        6,
      );
    }
  }, 120_000);

  it('добыча растёт с силой логова и укладывается в объявленные границы', async () => {
    const gen = generateWorld(51);
    const lairs = gen.settlements.filter((s) => isLair(s) && distance(s, gen.home) <= AI_RANGE);
    expect(lairs.length).toBeGreaterThan(0);
    const anchor = lairAnchor(gen.home, lairs[0]);

    const v = profile().pop;
    const weak = lairPower(anchor, rec(START), START, v);
    const ripe = lairPower(anchor, rec(START), START + LAIR_RIPE, v);
    // Слабое логово даёт заметно меньше выросшего — иначе расти было бы незачем.
    expect(lairLoot(ripe)).toBeGreaterThan(lairLoot(weak) * 1.5);
    // И даже выросшее не заменяет хозяйство: за то же время посёлок добывает
    // больше — это и есть граница, за которой производство стало бы декорацией.
    expect(lairLoot(ripe) + lairArms(lairArmsBase(anchor, rec(START), START + LAIR_RIPE)) * 10).toBeLessThan(687 * 4);
  });

  it('оружие из логова ложится в снаряжение, а не на склад', () => {
    const s = createInitialState();
    const before = { ...s.equipment };
    const effect: HomeEffect = {
      id: 'e1',
      lost: {},
      resources: { wood: 20, stone: 20 },
      arms: 8,
      lair: true,
      prestige: 0,
      morale: 0,
      battle: 'won',
      text: 'Логово сожжено.',
      good: true,
    };
    applyExpedition(s, toOutcome(effect));
    const got = Object.keys(s.equipment).reduce(
      (n, id) => n + (s.equipment[id as keyof typeof s.equipment] - (before[id as keyof typeof before] ?? 0)),
      0,
    );
    expect(got, 'все восемь предметов дошли').toBe(8);
  });

  it('счёт сожжённых логов в профиле совпадает с числом побед', () => {
    const s = createInitialState();
    expect(s.stats.lairs).toBe(0);
    const effect = (won: boolean, lair: boolean): HomeEffect => ({
      id: `e${Math.random()}`,
      lost: {},
      resources: {},
      lair: lair || undefined,
      prestige: 0,
      morale: 0,
      battle: won ? 'won' : 'lost',
      text: 'бой',
      good: won,
    });
    // Три сожжённых логова, одна победа над обычным поселением и одно поражение.
    applyExpedition(s, toOutcome(effect(true, true)));
    applyExpedition(s, toOutcome(effect(true, true)));
    applyExpedition(s, toOutcome(effect(true, true)));
    applyExpedition(s, toOutcome(effect(true, false)));
    applyExpedition(s, toOutcome(effect(false, false)));
    expect(s.stats.lairs).toBe(3);
    expect(s.stats.battlesWon).toBe(4);
  });

  it('новые поля не поднимают версию сохранения мира: старая партия читается целиком', async () => {
    const w = makeWorld(77);
    await w.world.sync(profile());
    const save = saveOf(w.world);
    const json = JSON.stringify({ ...save, lairs: undefined, spawned: undefined, nextLair: undefined, nextLairAt: undefined });
    // Ровно тот разбор, которым читается сохранение с диска.
    const { parseWorldSave } = await import('./local/state');
    const back = parseWorldSave(json);
    expect(back, 'сохранение без новых полей читается').toBeTruthy();
    expect(back?.lairs).toEqual({});
    expect(back?.spawned).toEqual([]);
    expect(back?.nextLair).toBe(1);
    expect(back?.nextLairAt).toBe(0);
    expect(back?.v).toBe(save.v);
  });
});
