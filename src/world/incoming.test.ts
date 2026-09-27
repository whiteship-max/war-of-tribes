// Кто «идёт на нас»: строка «Набег» в тревогах, «Идут на нас» в «Походах» и раздел «Оборона» у стены читают одну
// дверь — `store.incomingMarches`.
//
// «Чужой» (`MarchView.hostile`) — ещё не «на нас»: мир ставит его всякому не своему отряду, а в живом обзоре у деревни
// ходят и войны логов друг с другом (`LocalWorld.scheduleWar`). Прежде дверь фильтровала по одному `hostile`, и строка
// «Набег» звала к обороне от чужой войны (docs/PROMISES_DEBT.md, запись снята этим тестом).
//
// Проверка на настоящем мире: походы кладутся в сохранение тем же видом, каким их кладёт мир, виды отрядов даёт пульс
// (`viewMarch`), а не рука. Область правила — чужой отряд в пути, который мир показывает: точка «чужая война» стоит в
// ней (это утверждается в тесте), иначе фильтр по цели проверялся бы даром.
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import type { StoredMarch, WorldSave } from './local/state';
import { shieldVillagers } from './lairs';
import { incomingMarches } from './store';
import type { MarchView, PlayerProfile } from './types';

const START = 1_700_000_000_000;
const HOUR = 3_600_000;

const profile = (): PlayerProfile => ({
  name: 'Тест',
  // Выше защиты новичка: мир живёт так же, как у настоящей деревни (`lairs.lairShield`).
  pop: shieldVillagers(0.1),
  defense: 30,
  units: { warrior: 10, scout: 4 },
  stock: { food: 4000, wood: 4000, stone: 4000, hides: 4000, bones: 4000, copper: 4000, iron: 4000 },
  stash: 0,
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
    const war: StoredMarch = {
      id: 'war-test',
      seed: 1,
      mission: 'raid',
      units: { warrior: 5 },
      own: false,
      fromId: a.id,
      targetId: b.id,
      from: { x: home.x + 2, y: home.y + 2 },
      to: { x: home.x - 2, y: home.y + 2 },
      fromName: a.name,
      toName: b.name,
      departAt: now,
      arriveAt: now + 2 * HOUR,
      phase: 'out',
      power: 15,
      loot: null,
    };
    // Набег на деревню — тот же вид, цель — дом.
    const raid: StoredMarch = {
      ...war,
      id: 'raid-test',
      seed: 2,
      targetId: info.homeId,
      from: { x: home.x + 4, y: home.y },
      to: { x: home.x, y: home.y },
      toName: 'дом',
    };
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

    const incoming = incomingMarches(views, info.homeId);
    expect(incoming.map((m) => m.id), 'чужая война — не набег').not.toContain(war.id);
    expect(incoming.map((m) => m.id), 'набег на деревню — набег').toContain(raid.id);
    expect(incoming.every((m) => m.targetId === info.homeId), 'все, кто «идёт на нас», идут на дом').toBe(true);
    // Пока мир не ответил, чей дом, на деревню не идёт никто.
    expect(incomingMarches(views, undefined), 'дом не назван').toEqual([]);
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
    expect(incomingMarches(marches, HOME).map((m) => m.id)).toEqual(['early', 'late']);
  });
});
