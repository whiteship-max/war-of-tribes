// Разорение: чистая часть и то, как она живёт в мире.
//
// Разделено надвое так же, как у логов, осады и писем. Первая половина не знает
// ни про мир, ни про часы — она проверяет договор `world/sack.ts`: окно это
// чистая функция от времени, одинаковый вход даёт одинаковый выход, а часы
// поселения тормозятся по объединению окон, а не по их сумме. Вторая гоняет
// настоящий `LocalWorld` с ручными часами: выигранный набег оставляет след,
// второй набег подряд приносит крохи, срок кончается ровно там, где обещано,
// отношения портятся и отвечают войной — с потолком, — а игрок разоряется теми
// же правилами и не разоряется в своё отсутствие.
import { describe, expect, it, vi } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import { distance } from './geo';
import { haltElapsed, sackActive, sackLeft, sackLook, sackPower, sackWindow } from './sack';
import { revoltWindow } from './spy';
import { plunder } from './spoils';
import {
  LAIR_RUIN,
  REVOLT_DURATION,
  REVENGE_ATTITUDE,
  REVENGE_WARS_MAX,
  SACK_DURATION,
  SACK_POWER_LOSS,
} from './data/tuning';
import { DAY_LENGTH, realMs } from '@/game/pace';
import type { GenSettlement } from './gen';
import type { Loot, PlayerProfile, SettlementView } from './types';
import type { WorldSave } from './local/state';
import { shieldVillagers } from './lairs';

// Энергия агентов здесь не предмет проверки (docs/agent_energy.md): сценарии этого файла водят агентов по карте помногу
// — дорога здесь энергию не берёт. Цены дел и отдых дома остаются; энергию держат `energy.test.ts` и
// `energyworld.test.ts`.
vi.mock('@/world/data/energy', async (actual) => ({ ...(await actual<object>()), ENERGY_ROAD: Infinity }));

/**
 * Спящие случаи. Чужих дворов на карте не осталось ни одного: мир стал общим, а
 * замки на нём появятся при регистрации живых игроков. Механика цела — участников
 * у неё пока нет, и притворяться, что случай проверен, нельзя. Полный список:
 * `grep -rn waitsForPlayers src`.
 */
const waitsForPlayers = it.skip;

const MIN = 60_000;
const HOUR = 60 * MIN;
const START = 1_700_000_000_000;

// ------------------------------------------------ чистая часть ---

describe('разорение — чистая функция от времени', () => {
  it('одинаковый вход даёт одинаковый выход, и никакой памяти между вызовами', () => {
    const w = sackWindow(START, 'Соседи');
    for (const age of [0, MIN, HOUR, SACK_DURATION, SACK_DURATION * 3]) {
      expect(sackActive(w, START + age)).toBe(sackActive(w, START + age));
      expect(sackLeft(w, START + age)).toBe(sackLeft(w, START + age));
    }
    // Ни один вызов не двигает само окно: это данные, а не счётчик.
    expect(w).toEqual(sackWindow(START, 'Соседи'));
  });

  it('держится ровно объявленный срок и ни секундой дольше', () => {
    const w = sackWindow(START);
    expect(sackActive(w, START)).toBe(true);
    expect(sackActive(w, START + SACK_DURATION - 1)).toBe(true);
    expect(sackActive(w, START + SACK_DURATION)).toBe(false);
    expect(sackLeft(w, START)).toBe(SACK_DURATION);
    expect(sackLeft(w, START + SACK_DURATION)).toBe(0);
    expect(sackLeft(undefined, START)).toBe(0);
  });

  it('срок — игровое время, ступень лестницы трёх сроков мира', () => {
    // Разорение — событие мира, а не защита игрока (решение владельца, docs/time.md, раздел 16):
    // меряется игровыми днями, и лестница «бунт — разорение — пепелище» сохранена отношениями
    // 3 : 4 : 6 к неделе пепелища. Прежде тест держал обратное — настоящие часы.
    expect(REVOLT_DURATION).toBeLessThan(SACK_DURATION);
    expect(SACK_DURATION).toBeLessThan(LAIR_RUIN);
    expect(SACK_DURATION / LAIR_RUIN).toBeCloseTo(4 / 6, 9);
    expect(REVOLT_DURATION / LAIR_RUIN).toBeCloseTo(3 / 6, 9);
    expect(LAIR_RUIN, 'неделя игрового времени').toBe(realMs(7 * DAY_LENGTH));
  });

  it('повторный набег не складывает сроки, а заводит окно заново', () => {
    const first = sackWindow(START);
    const second = sackWindow(START + HOUR);
    expect(second.until - second.since).toBe(first.until - first.since);
    expect(second.until).toBe(START + HOUR + SACK_DURATION);
  });

  it('просадка мощи объявлена и держится ровно на время окна', () => {
    expect(sackPower(true)).toBeCloseTo(1 - SACK_POWER_LOSS, 6);
    expect(sackPower(false)).toBe(1);
  });

  it('вид разорения читается по остатку, и у целого двора его нет', () => {
    const w = sackWindow(START);
    expect(sackLook(w, START)).not.toBe('');
    expect(sackLook(w, START + SACK_DURATION * 0.5)).not.toBe(sackLook(w, START));
    expect(sackLook(w, START + SACK_DURATION * 0.9)).not.toBe(
      sackLook(w, START + SACK_DURATION * 0.5),
    );
    expect(sackLook(w, START + SACK_DURATION)).toBe('');
    expect(sackLook(undefined, START)).toBe('');
  });
});

describe('часы поселения тормозятся по объединению окон, а не по сумме', () => {
  it('одно окно — просто его длина, обрезанная нынешней минутой', () => {
    const w = sackWindow(START);
    expect(haltElapsed([w], START)).toBe(0);
    const part = SACK_DURATION / 4;
    expect(part, 'точка внутри области: четверть срока — внутри окна').toBeLessThan(SACK_DURATION);
    expect(haltElapsed([w], START + part)).toBe(part);
    expect(haltElapsed([w], START + SACK_DURATION * 3)).toBe(SACK_DURATION);
    expect(haltElapsed([undefined, undefined], START + HOUR)).toBe(0);
  });

  it('пересекающиеся окна считаются один раз', () => {
    // Бунт с середины разорения. Сложи их — и поселение поехало бы во времени
    // назад: часы пошли бы вспять, а с ними задним числом починился бы
    // разбитый гарнизон и наполнился склад.
    const sack = sackWindow(START);
    const revolt = revoltWindow(START + SACK_DURATION / 2);
    const end = Math.max(sack.until, revolt.until);
    expect(haltElapsed([sack, revolt], end)).toBe(end - START);
    expect(haltElapsed([sack, revolt], end)).toBeLessThan(
      haltElapsed([sack], end) + haltElapsed([revolt], end),
    );
  });

  it('часы никогда не идут назад: с ростом now потерянное время только растёт', () => {
    const sack = sackWindow(START);
    const revolt = revoltWindow(START + 10 * MIN);
    let prevLive = -Infinity;
    let prevLost = -1;
    for (let t = START; t <= START + 12 * HOUR; t += 7 * MIN) {
      const lost = haltElapsed([sack, revolt], t);
      expect(lost).toBeGreaterThanOrEqual(prevLost);
      const live = t - lost;
      expect(live).toBeGreaterThanOrEqual(prevLive);
      prevLive = live;
      prevLost = lost;
    }
  });

  it('раздельные окна складываются, потому что не пересекаются', () => {
    const a = { since: START, until: START + HOUR };
    const b = { since: START + 3 * HOUR, until: START + 4 * HOUR };
    expect(haltElapsed([b, a], START + 10 * HOUR)).toBe(2 * HOUR);
  });
});

// ------------------------------------------------ разорение в мире ---

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

/** Настоящее состояние мира: тесту про разорение положено видеть и то, что скрыто. */
const saveOf = (w: LocalWorld): WorldSave => (w as unknown as { save: WorldSave }).save;

/** Список поселений внутри мира — по нему тест выбирает цели. */
const listOf = (w: LocalWorld): GenSettlement[] =>
  (w as unknown as { gen: { settlements: GenSettlement[] } }).gen.settlements;

/**
 * Та самая дверь, из которой набег отвечает войной. Зовётся она из `attackAt` и
 * ниоткуда больше; здесь её дёргают напрямую только там, где проверяется
 * **потолок**: довести полководца до трёх дворов и ударить по каждому трижды —
 * это девять походов, и проверка потолка стоила бы минут прогона, ничего к нему
 * не добавив.
 */
const avengeOf = (w: LocalWorld) =>
  (w as unknown as { avenge(s: GenSettlement, at: number): void }).avenge.bind(w);

/** Сильное племя: набег на обычного соседа обязан удаваться, иначе мерить нечего. */
const profile = (over: Partial<PlayerProfile> = {}): PlayerProfile =>
  ({
    name: 'Тест',
    pop: 600,
    defense: 4000,
    units: { warrior: 200, scout: 8 },
    army: { legionary: 120, spearman: 90, archer: 60 },
    warning: 120,
    resources: { food: 2000, wood: 1500 },
    stock: { food: 2000, wood: 1500 },
    food: 20000,
    foodPerHour: 9000,
    soldierFoodPerHour: 60,
    ...over,
  }) as PlayerProfile;

const lootTotal = (loot: Loot | null): number =>
  loot ? Object.values(loot).reduce((n, v) => n + Math.abs(v ?? 0), 0) : 0;

/** Поселения вокруг деревни глазами карты. */
async function onMap(world: LocalWorld): Promise<SettlementView[]> {
  const info = await world.info();
  const chunk = await world.region({ x: info.home.x - 26, y: info.home.y - 26, w: 53, h: 53 });
  return chunk.settlements.filter((s) => !s.mine);
}

/** Ведёт полководца с дружиной к указанной клетке и ждёт прибытия. */
async function lead(w: ReturnType<typeof makeWorld>, p: PlayerProfile, to: SettlementView) {
  expect(await w.world.moveFigure('general', { x: to.x, y: to.y })).toBeNull();
  for (let i = 0; i < 600; i++) {
    w.advance(MIN);
    await w.world.sync(p);
    const g = (await w.world.figures()).find((f) => f.id === 'general');
    if (g && g.phase !== 'moving') break;
  }
}

/** Собирает дружину и приводит полководца к ближайшему обычному соседу. */
async function bringGeneral(w: ReturnType<typeof makeWorld>, p: PlayerProfile) {
  await w.world.sync(p);
  expect(await w.world.setGarrison({ legionary: 120, spearman: 90, archer: 60 })).toBeNull();
  for (let i = 0; i < 200; i++) {
    w.advance(MIN);
    await w.world.sync(p);
    const g = (await w.world.figures()).find((f) => f.id === 'general');
    if (g && g.readyAt === 0) break;
  }
  const info = await w.world.info();
  const near = (await onMap(w.world)).filter((s) => s.relation !== 'barbarian' && !s.ruin);
  expect(near.length, 'в округе есть обычный сосед').toBeGreaterThan(0);
  const target = near.sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];
  await lead(w, p, target);
  return target;
}

describe('разорение чужого двора', () => {
  waitsForPlayers('выигранный набег оставляет след: двор разорён, это видно на карте и в карточке', async () => {
    const w = makeWorld(11);
    const p = profile();
    const target = await bringGeneral(w, p);

    const before = await w.world.settlement(target.id);
    expect(before?.sack, 'до набега двор цел').toBeNull();

    const res = await w.world.attack({});
    expect(res.error).toBeNull();
    expect(res.won, 'дружина заметно сильнее двора').toBe(true);

    // Поселение никуда не делось: владельца оно не меняет и с карты не пропадает.
    const view = (await onMap(w.world)).find((s) => s.id === target.id);
    expect(view, 'двор стоит на месте').toBeTruthy();
    expect(view?.ruin, 'это не пепелище: сжечь можно только логово').toBe(false);
    expect(view?.sacked, 'но с одного взгляда видно, что тут побывали').toBe(true);

    const card = await w.world.settlement(target.id);
    expect(card?.sack, 'карточка говорит о разорении').not.toBeNull();
    expect(card?.sack?.look, 'и говорит словами, а не часами').not.toBe('');

    // Мощь просела: и потому, что гарнизон разбит, и потому, что двор стоит.
    const power = (w.world as unknown as { powerNow(s: GenSettlement, now: number): number });
    const gen = listOf(w.world).find((s) => s.id === target.id)!;
    const now = w.now();
    const sacked = power.powerNow.call(w.world, gen, now);
    saveOf(w.world).sacks = {};
    saveOf(w.world).damage = {};
    const whole = power.powerNow.call(w.world, gen, now);
    expect(sacked).toBeLessThan(whole * (1 - SACK_POWER_LOSS) + 1);
  }, 180_000);

  waitsForPlayers('второй набег подряд приносит крохи, а после срока склад возвращается', async () => {
    const w = makeWorld(11);
    const p = profile();
    const target = await bringGeneral(w, p);

    const first = await w.world.attack({});
    expect(first.won).toBe(true);
    const firstLoot = lootTotal(
      (await w.world.reports()).find((r) => r.id === first.reportId)?.loot ?? null,
    );
    expect(firstLoot, 'первый набег что-то приносит').toBeGreaterThan(0);

    // Второй удар сразу же: полководец никуда не уходил, добро брать неоткуда.
    w.advance(MIN);
    await w.world.sync(p);
    const second = await w.world.attack({});
    expect(second.won).toBe(true);
    const secondLoot = lootTotal(
      (await w.world.reports()).find((r) => r.id === second.reportId)?.loot ?? null,
    );
    expect(secondLoot, 'грабить нечего: склад пуст').toBeLessThan(firstLoot * 0.25);

    // Час спустя внутри окна — по-прежнему крохи: часы двора стоят, и склад по
    // ним же не наполняется. Это и есть «восстанавливается вместе с поселением».
    w.advance(HOUR);
    await w.world.sync(p);
    const third = await w.world.attack({});
    const thirdLoot = lootTotal(
      (await w.world.reports()).find((r) => r.id === third.reportId)?.loot ?? null,
    );
    expect(thirdLoot, 'внутри окна время двору не идёт').toBeLessThan(firstLoot * 0.25);
    expect((await w.world.settlement(target.id))?.sack, 'окно ещё держится').not.toBeNull();

    // Срок вышел — двор отстроился, и склад снова наполняется своим чередом.
    const until = saveOf(w.world).sacks[target.id].until;
    w.at(until + 40 * MIN);
    await w.world.sync(p);
    expect((await w.world.settlement(target.id))?.sack, 'разорение снялось ровно в срок').toBeNull();
    expect((await onMap(w.world)).find((s) => s.id === target.id)?.sacked).toBe(false);
    const fourth = await w.world.attack({});
    const fourthLoot = lootTotal(
      (await w.world.reports()).find((r) => r.id === fourth.reportId)?.loot ?? null,
    );
    expect(fourthLoot, 'после срока брать снова есть что').toBeGreaterThan(thirdLoot);
  }, 240_000);

  it('проигранный набег отношения портит, а двор не разоряет', async () => {
    const w = makeWorld(11);
    // Слабое племя: полководец ведёт горстку и заведомо проигрывает.
    const p = profile({ army: { clubman: 3 }, defense: 40, pop: 60 });
    await w.world.sync(p);
    expect(await w.world.setGarrison({ clubman: 3 })).toBeNull();
    for (let i = 0; i < 200; i++) {
      w.advance(MIN);
      await w.world.sync(p);
      const g = (await w.world.figures()).find((f) => f.id === 'general');
      if (g && g.readyAt === 0) break;
    }
    const info = await w.world.info();
    const near = (await onMap(w.world)).filter((s) => s.relation !== 'barbarian' && !s.ruin);
    const target = near.sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];
    await lead(w, p, target);

    const before = saveOf(w.world).diplomacy[target.id]?.attitude ?? 0;
    const res = await w.world.attack({});
    expect(res.won, 'трое дубинщиков двор не берут').toBe(false);
    // Врагов наживают нападением, а не победой.
    expect(saveOf(w.world).diplomacy[target.id].attitude).toBeLessThan(before);
    // А разорение — следствие победы: не взял двор, не разорил и его.
    expect(saveOf(w.world).sacks[target.id], 'двор цел').toBeUndefined();
    expect((await w.world.settlement(target.id))?.sack).toBeNull();
  }, 180_000);
});

describe('отношения портятся, и это отзывается', () => {
  waitsForPlayers('набеги ведут двор от неприязни к вражде, а вражда — к объявленной войне', async () => {
    const w = makeWorld(11);
    const p = profile();
    const target = await bringGeneral(w, p);
    const save = saveOf(w.world);

    const moods: number[] = [];
    let declared = 0;
    for (let i = 0; i < 3; i++) {
      const res = await w.world.attack({});
      expect(res.error).toBeNull();
      moods.push(save.diplomacy[target.id].attitude);
      if (save.diplomacy[target.id].standing === 'war') declared = i + 1;
      w.advance(MIN);
      await w.world.sync(p);
    }
    // Лестница: каждый следующий набег холоднее предыдущего.
    expect(moods[1]).toBeLessThan(moods[0]);
    expect(moods[0]).toBeLessThanOrEqual(0);
    // И она доводит до войны — не с первого удара, но доводит.
    expect(declared, 'война объявлена, и не первым же набегом').toBeGreaterThan(1);
    expect(save.diplomacy[target.id].standing).toBe('war');
    expect(save.diplomacy[target.id].attitude).toBeLessThanOrEqual(REVENGE_ATTITUDE);

    // Ответ настоящий: из воюющего двора набеги идут (`raidWeight` даёт войне
    // вес, а нейтралитету — почти ноль), и игрок узнаёт об объявлении.
    const news = (await w.world.reports()).find((r) => r.title.includes('объявили войну'));
    expect(news, 'об объявлении сказано, а не сделано молча').toBeTruthy();
  }, 240_000);

  waitsForPlayers('месть упирается в потолок: больше объявленных войн разом не бывает', async () => {
    const w = makeWorld(11);
    const p = profile();
    await w.world.sync(p);
    const save = saveOf(w.world);
    const avenge = avengeOf(w.world);
    const now = w.now();

    // Все соседи в округе доведены до дна шкалы: дальше злить некуда.
    const neighbours = listOf(w.world).filter((s) => s.tribeId);
    expect(neighbours.length).toBeGreaterThan(REVENGE_WARS_MAX);
    for (const s of neighbours) {
      save.diplomacy[s.id] = {
        attitude: -100,
        standing: 'neutral',
        since: now,
        until: 0,
        breakAt: 0,
      };
    }
    for (const s of neighbours) avenge(s, now);

    const wars = neighbours.filter((s) => save.diplomacy[s.id].standing === 'war');
    expect(wars.length, 'потолок держится').toBe(REVENGE_WARS_MAX);

    // Выход есть: мир возвращает нейтралитет, и освободившееся место снова
    // может занять другой обиженный. Кара без выхода — это не последствие.
    save.diplomacy[wars[0].id].standing = 'neutral';
    const spare = neighbours.find((s) => save.diplomacy[s.id].standing === 'neutral' && s.id !== wars[0].id);
    expect(spare).toBeTruthy();
    avenge(spare!, now);
    expect(save.diplomacy[spare!.id].standing).toBe('war');
  }, 60_000);

  waitsForPlayers('до порога войну не объявляют, и дважды одному двору тоже', () => {
    const w = makeWorld(3);
    const save = saveOf(w.world);
    const avenge = avengeOf(w.world);
    const now = w.now();
    const s = listOf(w.world).find((x) => x.tribeId)!;

    save.diplomacy[s.id] = { attitude: REVENGE_ATTITUDE + 1, standing: 'neutral', since: now, until: 0, breakAt: 0 };
    avenge(s, now);
    expect(save.diplomacy[s.id].standing, 'обида ещё не та').toBe('neutral');

    save.diplomacy[s.id].attitude = REVENGE_ATTITUDE;
    avenge(s, now);
    expect(save.diplomacy[s.id].standing).toBe('war');
    const since = save.diplomacy[s.id].since;
    avenge(s, now + HOUR);
    expect(save.diplomacy[s.id].since, 'второй раз объявлять нечего').toBe(since);
  });
});

describe('симметрия: разорение чужого двора и своей деревни', () => {
  /**
   * Играет, не пропадая с глаз, пока чужой набег не прорвётся в деревню.
   * Возвращает последствие и отчёт о нём: пульс отдаёт их один раз, и ловить их
   * надо на том шаге, где они появились.
   */
  async function untilSacked(w: ReturnType<typeof makeWorld>, p: PlayerProfile) {
    for (let i = 0; i < 20_000; i++) {
      w.advance(10_000);
      const pulse = await w.world.sync(p);
      const effect = pulse.effects.find((e) => e.battle === 'lost');
      if (effect) return { effect, report: pulse.reports.find((r) => r.id === effect.id) };
    }
    throw new Error('набег так и не прорвался');
  }

  it('прорвавшийся набег чистит наш склад тем же правилом, что и мы — чужой', async () => {
    const w = makeWorld(5);
    // Беззащитная деревня со складом и тайником: набег прорвётся наверняка, но
    // в осаду не сядет — штурм удался бы, и лагерем отряд не встаёт (`LocalWorld.sitsDown`).
    const stock = { food: 4000, wood: 4000, stone: 4000 };
    const p = profile({
      pop: shieldVillagers(0.1),
      defense: 30,
      army: {},
      units: { warrior: 0, scout: 0 },
      stock,
      stash: 500,
    });
    const { effect, report } = await untilSacked(w, p);
    const taken = Object.values(effect.resources).reduce((n, v) => n + Math.abs(v ?? 0), 0);
    expect(taken, 'что-то унесли').toBeGreaterThan(0);
    // Верхняя граница — открытая часть склада: ниже тайника не уносят никогда,
    // как бы велик ни был отряд. Точную арифметику держит `spoils.test.ts`,
    // здесь проверяется, что деревня игрока идёт через то же правило.
    expect(taken).toBeLessThanOrEqual(plunder(stock, 500, Infinity).takenTotal);
    // Спрятанное осталось: тайник прячет по 500 каждого из трёх припасов.
    expect(report?.hidden, 'в отчёте сказано, сколько уцелело').toBe(1500);
    // И ни одного припаса не унесли ниже тайника.
    for (const [r, n] of Object.entries(effect.resources) as [keyof typeof stock, number][]) {
      expect(stock[r] + n, `${r} не ушёл ниже тайника`).toBeGreaterThanOrEqual(500);
    }
  }, 240_000);

  it('нет игрока — набег всё равно доходит, и склад делит тот же бой, что при игроке', async () => {
    // Прежде здесь стояло обратное: «нет игрока — нет набега». Правило отсутствия
    // снято решением владельца (docs/DEFEAT_LADDER.md): враг подходит, в игре хозяин
    // или нет. Держит тест то, что осталось от прежнего обещания, — отсутствие не
    // делает набег ни хуже, ни лучше: отряд приходит и разбирается своим боем.
    const w = makeWorld(5);
    const p = profile({ pop: shieldVillagers(0.1), defense: 30, army: {}, units: { warrior: 0, scout: 0 } });
    // Дожидаемся вышедшего отряда — и пропадаем: пульса нет до самого прихода.
    let raidId: string | null = null;
    for (let i = 0; i < 4000 && !raidId; i++) {
      w.advance(10_000);
      const pulse = await w.world.sync(p);
      raidId = pulse.marches.find((m) => !m.own && m.phase === 'out')?.id ?? null;
    }
    expect(raidId, 'набег вышел').toBeTruthy();
    const raid = saveOf(w.world).marches.find((m) => m.id === raidId)!;
    // Граница области: до прихода больше одного пульса — отсутствие было.
    expect(raid.arriveAt - w.now()).toBeGreaterThan(10_000);

    w.at(raid.arriveAt + HOUR);
    const pulse = await w.world.sync(p);
    expect(pulse.reports.some((r) => r.title === 'Набег не состоялся'), '«не состоялся» не бывает').toBe(false);
    const met = pulse.reports.find((r) => r.id === `${raidId}-defense` || r.id === `${raidId}-siege`);
    expect(met, 'отряд дошёл и встретил заслон').toBeTruthy();
    // Прорвался — склад ушёл в последствие тем же отчётом; отбит — не ушло ничего.
    const effect = pulse.effects.find((e) => e.id === `${raidId}-defense`);
    if (met!.id.endsWith('-defense')) {
      expect(effect, 'у боя есть последствие').toBeTruthy();
      expect(effect!.resources).toEqual(met!.won ? {} : (met!.loot ?? {}));
    }
  }, 240_000);
});

describe('формат сохранения', () => {
  it('новые поля приезжают со значением по умолчанию и версию не поднимают', async () => {
    // Проверка по коду разбора, а не по памяти: `parseWorldSave` мержит
    // прочитанное поверх новой партии, поэтому сохранение без `sacks` читается
    // как целая округа — ровно то, что было до появления разорений.
    const { parseWorldSave, createWorldSave, WORLD_SAVE_VERSION } = await import('./local/state');
    const base = createWorldSave(7, { x: 500, y: 800 }, null, START);
    const old = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    delete old.sacks;
    const read = parseWorldSave(JSON.stringify(old));
    expect(read).not.toBeNull();
    expect(read!.v).toBe(WORLD_SAVE_VERSION);
    expect(read!.sacks).toEqual({});
  });
});
