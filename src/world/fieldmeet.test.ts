// Бой в поле против набега (отзыв тестеров 18.10, docs/feedback.md, ОТ-1, пункт 1). Игрок ночью вывел полководца с
// войском навстречу набегу — приказом «идти» в точку на его пути — и не нашёл ни боя, ни донесения, ни вести.
//
// Так устроен мир, и механика не менялась: отряды идут по прямой и сквозь фигуры, бой в поле — только перехват
// (`LocalWorld.intercept` → `resolveChase`). Чинилось объяснение и весть:
// - касание полководцем дороги набега открывает меню с перехватом (`store.raidAcross`), а не ведёт молча;
// - погоня за набегом — весть о бое в поле в минуту встречи (`notice.draftNotices`, `raid-fight` с `field`).
//
// Проверка на настоящем мире, днём и ночью (часов суток мир не знает — тест держит и это): набег кладётся в сохранение
// тем видом, каким его кладёт мир. Граница области — набег в пути, полководец с отрядом в поле до прихода: точка встречи
// и точка «встать на пути» лежат раньше прихода, это утверждается в тесте.
import { describe, expect, it, vi } from 'vitest';
import { NotifyingWorld } from './local/NotifyingWorld';
import type { StoredMarch, WorldSave } from './local/state';
import { shieldVillagers } from './lairs';
import { marchPosition } from './geo';
import { raidAcross } from './store';
import type { TroopStack } from '@/game/battle/kinds';
import type { FigureView, PlayerProfile } from './types';

// Энергия здесь не предмет проверки (как в `chase.test.ts`): дорога её не берёт.
vi.mock('@/world/data/energy', async (actual) => ({ ...(await actual<object>()), ENERGY_ROAD: Infinity }));

const START = 1_700_000_000_000;
const HOUR = 3_600_000;
const HOST: TroopStack = { legionary: 30, spearman: 24, archer: 16 };

const profile = (): PlayerProfile => ({
  name: 'Тест',
  pop: shieldVillagers(0.1),
  defense: 900,
  units: { warrior: 10, scout: 4 },
  army: { ...HOST },
  stock: { food: 4000, wood: 4000, stone: 4000, hides: 4000, charcoal: 4000, copper: 4000, iron: 4000 },
  stash: 0,
});

async function meet(hour: number, way: 'stand' | 'chase') {
  let now = START + hour * HOUR;
  const world = new NotifyingWorld({ seed: 7, now: () => now, storage: null });
  const p = profile();
  const general = async (): Promise<FigureView> => (await world.figures()).find((f) => f.id === 'general')!;
  await world.sync(p);
  expect(await world.setGarrison({ ...HOST })).toBeNull();
  now = Math.max(now, (await general()).readyAt);
  await world.sync(p);
  const info = await world.info();
  const raid: StoredMarch = {
    id: 'raid-field',
    seed: 5,
    mission: 'raid',
    units: { warrior: 5 },
    own: false,
    fromId: 'lair-field',
    targetId: info.homeId,
    from: { x: info.home.x + 30, y: info.home.y },
    to: { x: info.home.x, y: info.home.y },
    fromName: 'Логово',
    toName: 'дом',
    departAt: now,
    arriveAt: now + 6 * HOUR,
    phase: 'out',
    power: 15,
    loot: null,
  };
  (world as unknown as { save: WorldSave }).save.marches.push(raid);
  // Вид отряда для карты: тот же отряд, чужой (мир показывает его с минуты Дозора — здесь важна только дорога).
  const view = { ...raid, hostile: true } as unknown as Parameters<typeof raidAcross>[0][number];
  // Точка на пути набега, до его прихода: та самая, куда игрок вёл полководца.
  const mid = marchPosition(raid, now + 3 * HOUR);
  const spot = { x: Math.round(mid.x), y: Math.round(mid.y) };
  expect(raidAcross([view], spot, now, info.homeId)?.id, 'точка лежит на дороге набега').toBe(raid.id);
  if (way === 'stand') expect(await world.moveFigure('general', spot)).toBeNull();
  else expect(await world.intercept(raid.id)).toBeNull();
  const g = await general();
  expect(g.arriveAt, 'полководец на месте до прихода набега').toBeLessThan(raid.arriveAt);
  const drafts = await world.notices();
  now += 8 * HOUR;
  await world.sync(p);
  return { reports: await world.reports(), drafts, chaseAt: g.arriveAt };
}

describe('бой в поле против набега', () => {
  for (const [hour, when] of [
    [14, 'днём'],
    [2, 'ночью'],
  ] as const) {
    it(`встать на пути — боя нет, набег идёт к стенам; перехват — бой в поле, донесение и весть (${when})`, async () => {
      const stand = await meet(hour, 'stand');
      expect(stand.reports.map((r) => r.kind), 'стоявший на пути полководец боя не дал').toEqual(['defense']);
      expect(stand.drafts.items.map((i) => i.kind), 'вести — о набеге у стен').toEqual(['raid', 'raid-fight']);

      const chase = await meet(hour, 'chase');
      expect(chase.reports.map((r) => r.kind), 'перехват — донесение о бое в поле').toEqual(['raid']);
      expect(chase.reports[0].title).toMatch(/^Перехват/);
      const field = chase.drafts.items.filter((i) => i.p.field);
      expect(field.length, 'весть о бое в поле').toBe(1);
      expect(field[0].fireAt, 'в минуту встречи').toBe(chase.chaseAt);
    }, 120_000);
  }
});

describe('дорога набега под пальцем полководца (`raidAcross`)', () => {
  const homeId = 'home';
  const view = {
    id: 'm1',
    own: false,
    hostile: true,
    phase: 'out',
    targetId: homeId,
    from: { x: 40, y: 10 },
    to: { x: 10, y: 10 },
    departAt: 0,
    arriveAt: 30 * HOUR,
  } as unknown as Parameters<typeof raidAcross>[0][number];

  it('впереди отряда на его дороге — набег; позади, в стороне, у чужой цели и у своего отряда — нет', () => {
    const now = 10 * HOUR; // отряд в (30, 10)
    expect(raidAcross([view], { x: 20, y: 11 }, now, homeId)?.id).toBe('m1');
    expect(raidAcross([view], { x: 35, y: 10 }, now, homeId), 'позади — уже прошли').toBeNull();
    expect(raidAcross([view], { x: 20, y: 13 }, now, homeId), 'в стороне').toBeNull();
    expect(raidAcross([{ ...view, targetId: 'other' }], { x: 20, y: 10 }, now, homeId), 'идут не на нас').toBeNull();
    expect(raidAcross([{ ...view, hostile: false, own: true }], { x: 20, y: 10 }, now, homeId), 'свой поход').toBeNull();
  });
});
