// Кто «идёт на нас». Дверей две, и различаются они ровно местом, на которое идут (решение владельца, 28.09.2026):
// - `store.marchesOnHome` — на деревню: строка «Набег» в тревогах и раздел «Оборона» у стены зовут к обороне деревни;
// - `store.marchesOnUs` — на все наши места, деревню и наш лагерь осады: «Идут на нас» в «Походах».
//
// «Чужой» (`MarchView.hostile`) — ещё не «на нас»: мир ставит его всякому не своему отряду, а в живом обзоре у деревни
// ходят и войны логов друг с другом (`LocalWorld.scheduleWar`). Прежде дверь фильтровала по одному `hostile`, и строка
// «Набег» звала к обороне от чужой войны (docs/PROMISES_DEBT.md, запись снята этим тестом). Потом дверь стала одной на
// деревню — и из «Идут на нас» пропала выручка, идущая на наш лагерь: угроза нашему войску.
//
// Проверка на настоящем мире: походы кладутся в сохранение тем же видом, каким их кладёт мир, виды отрядов даёт пульс
// (`viewMarch`), а не рука; наш лагерь ставят приказы. Область правила — чужой отряд в пути, который мир показывает:
// каждая точка стоит в ней (это утверждается в тесте), иначе фильтр по цели проверялся бы даром.
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import type { StoredMarch, WorldSave } from './local/state';
import { distance } from './geo';
import { shieldVillagers } from './lairs';
import { marchesOnHome, marchesOnUs } from './store';
import type { TroopStack } from '@/game/battle/kinds';
import type { FigureView, MarchView, PlayerProfile } from './types';

const START = 1_700_000_000_000;
const HOUR = 3_600_000;

const profile = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Тест',
  // Выше защиты новичка: мир живёт так же, как у настоящей деревни (`lairs.lairShield`).
  pop: shieldVillagers(0.1),
  defense: 30,
  units: { warrior: 10, scout: 4 },
  stock: { food: 4000, wood: 4000, stone: 4000, hides: 4000, bones: 4000, copper: 4000, iron: 4000 },
  stash: 0,
  ...over,
});

/** Чужой набег тем видом, каким его кладёт мир. */
const march = (over: Partial<StoredMarch> & Pick<StoredMarch, 'id' | 'fromId' | 'targetId' | 'from' | 'to'>): StoredMarch => ({
  seed: 1,
  mission: 'raid',
  units: { warrior: 5 },
  own: false,
  fromName: 'откуда',
  toName: 'куда',
  departAt: START,
  arriveAt: START + 2 * HOUR,
  phase: 'out',
  power: 15,
  loot: null,
  ...over,
});

describe('на деревню идут только те, чья цель — дом', () => {
  it('поход логова на логово у самых ворот — не набег, набег на деревню — набег', async () => {
    const now = START;
    const world = new LocalWorld({ seed: 7, now: () => now, storage: null });
    await world.sync(profile());
    const info = await world.info();
    const save = (world as unknown as { save: WorldSave }).save;
    const lairs = (world as unknown as { gen: { settlements: { id: string; name: string }[] } }).gen.settlements;
    expect(lairs.length, 'на карте есть хотя бы два логова').toBeGreaterThanOrEqual(2);
    const [a, b] = lairs;
    const home = info.home;

    // Чужая война в двух клетках от ворот — в круге живого обзора деревни. Цель — второе логово, не дом.
    const war = march({
      id: 'war-test',
      fromId: a.id,
      targetId: b.id,
      from: { x: home.x + 2, y: home.y + 2 },
      to: { x: home.x - 2, y: home.y + 2 },
      fromName: a.name,
      toName: b.name,
    });
    // Набег на деревню — тот же вид, цель — дом.
    const raid = march({
      id: 'raid-test',
      seed: 2,
      fromId: a.id,
      targetId: info.homeId,
      from: { x: home.x + 4, y: home.y },
      to: { x: home.x, y: home.y },
      toName: 'дом',
    });
    save.marches.push(war, raid);

    const views = (await world.sync(profile())).marches;
    const seenWar = views.find((m) => m.id === war.id);
    const seenRaid = views.find((m) => m.id === raid.id);
    // Точки внутри области: мир показывает оба отряда, оба чужие и в пути, и чужая война — не на дом.
    expect(seenWar, 'чужую войну у ворот мир показывает').toBeDefined();
    expect(seenRaid, 'набег на деревню мир показывает').toBeDefined();
    expect(seenWar!.hostile && seenWar!.phase === 'out', 'чужая война помечена чужой и идёт').toBe(true);
    expect(seenWar!.targetId, 'чужая война идёт не на дом').not.toBe(info.homeId);
    expect(seenRaid!.hostile && seenRaid!.phase === 'out', 'набег помечен чужим и идёт').toBe(true);

    for (const [name, door] of [
      ['«Набег»', marchesOnHome],
      ['«Идут на нас»', marchesOnUs],
    ] as const) {
      const ids = door(views, info.homeId).map((m) => m.id);
      expect(ids, `${name}: чужая война — не на нас`).not.toContain(war.id);
      expect(ids, `${name}: набег на деревню — на нас`).toContain(raid.id);
    }
    expect(marchesOnHome(views, info.homeId).every((m) => m.targetId === info.homeId), 'в «Набеге» все идут на дом').toBe(
      true,
    );
    // Пока мир не ответил, чей дом, на деревню не идёт никто.
    expect(marchesOnHome(views, undefined), 'дом не назван').toEqual([]);
  });

  it('из тех, кто идёт на дом, — только те, кто в пути, ближайший первым', () => {
    const HOME = 'home';
    const view = (id: string, over: Partial<MarchView>): MarchView =>
      ({ id, own: false, hostile: true, phase: 'out', targetId: HOME, arriveAt: START + HOUR, ...over }) as MarchView;
    const marches = [
      view('late', { arriveAt: START + 3 * HOUR }),
      view('elsewhere', { targetId: 'lair-2', arriveAt: START }),
      view('camp', { phase: 'stay' }),
      view('leaving', { phase: 'back' }),
      view('ours', { own: true, hostile: false }),
      view('early', { arriveAt: START + HOUR }),
    ];
    // Граница области: чужой в пути не на дом в выборке есть — и он приходит раньше всех, то есть без правила встал бы первым.
    expect(marches.some((m) => m.hostile && m.phase === 'out' && m.targetId !== HOME)).toBe(true);
    expect(marchesOnHome(marches, HOME).map((m) => m.id)).toEqual(['early', 'late']);
    expect(marchesOnUs(marches, HOME).map((m) => m.id)).toEqual(['early', 'late']);
  });
});

describe('на наш лагерь осады идёт выручка: она «идёт на нас», но это не набег', () => {
  it('выручка на наш лагерь — в «Идут на нас» и не в «Набеге»; чужой поход на тот же город — нигде', async () => {
    let now = START;
    const world = new LocalWorld({ seed: 7, now: () => now, storage: null });
    const HOST: TroopStack = { legionary: 30, spearman: 24, archer: 16 };
    const p = profile({ defense: 900, army: { ...HOST } });
    const general = async (): Promise<FigureView> => (await world.figures()).find((f) => f.id === 'general')!;

    // Наш лагерь ставят приказы: дружина, выход к ближайшему логову, «Осадить».
    await world.sync(p);
    expect(await world.setGarrison({ ...HOST })).toBeNull();
    now = Math.max(now, (await general()).readyAt);
    await world.sync(p);
    const info = await world.info();
    const lairs = (world as unknown as { gen: { settlements: { id: string; name: string; x: number; y: number }[] } }).gen
      .settlements;
    const [near, other] = [...lairs].sort((x, y) => distance(info.home, x) - distance(info.home, y));
    expect(await world.moveFigure('general', { x: near.x, y: near.y })).toBeNull();
    now = Math.max(now, (await general()).arriveAt);
    await world.sync(p);
    expect(await world.besiege()).toBeNull();
    expect((await general()).besieging, 'наш полководец стоит лагерем под логовом').toBe(near.id);

    const save = (world as unknown as { save: WorldSave }).save;
    // Выручка осаждённого логова — тем видом, каким её кладёт `LocalWorld.sendRelief`: цель — осаждённый город.
    const relief = march({
      id: 'relief-test',
      seed: 3,
      fromId: other.id,
      targetId: near.id,
      from: { x: near.x + 3, y: near.y },
      to: { x: near.x, y: near.y },
      fromName: other.name,
      toName: near.name,
      departAt: now,
      arriveAt: now + HOUR,
      relief: near.id,
    });
    // Чужой поход на тот же осаждённый город, но не выручка: бьёт по городу, а не по нашему лагерю.
    const passer = march({
      id: 'passer-test',
      seed: 4,
      fromId: other.id,
      targetId: near.id,
      from: { x: info.home.x + 2, y: info.home.y + 2 },
      to: { x: near.x, y: near.y },
      fromName: other.name,
      toName: near.name,
      departAt: now,
      arriveAt: now + HOUR,
    });
    save.marches.push(relief, passer);

    const views = (await world.sync(p)).marches;
    const seenRelief = views.find((m) => m.id === relief.id);
    const seenPasser = views.find((m) => m.id === passer.id);
    // Точки внутри области: мир показывает оба отряда, оба чужие и в пути, и ни один не идёт на дом — по цели выручку
    // не узнать, и дверь деревни её не поймала бы и без правила.
    expect(seenRelief, 'выручку на наш лагерь мир показывает').toBeDefined();
    expect(seenPasser, 'чужой поход у ворот мир показывает').toBeDefined();
    expect(seenRelief!.hostile && seenRelief!.phase === 'out', 'выручка помечена чужой и идёт').toBe(true);
    expect(seenPasser!.hostile && seenPasser!.phase === 'out', 'чужой поход помечен чужим и идёт').toBe(true);
    expect(seenRelief!.targetId, 'выручка идёт не на дом').not.toBe(info.homeId);
    expect(seenRelief!.onCamp, 'мир говорит: выручка идёт на наш лагерь').toBe(true);
    expect(seenPasser!.onCamp, 'поход на тот же город — не на наш лагерь').toBeUndefined();

    const onUs = marchesOnUs(views, info.homeId).map((m) => m.id);
    const onHome = marchesOnHome(views, info.homeId).map((m) => m.id);
    expect(onUs, '«Идут на нас»: выручка на наш лагерь — угроза нашему войску').toContain(relief.id);
    expect(onHome, '«Набег»: выручка на лагерь не зовёт к обороне деревни').not.toContain(relief.id);
    expect(onUs, '«Идут на нас»: поход на осаждённый город — не на нас').not.toContain(passer.id);
    expect(onHome, '«Набег»: поход на осаждённый город — не на нас').not.toContain(passer.id);
  }, 120_000);
});
