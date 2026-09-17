// Агент, укрывшийся в своём городе: место у него одно.
//
// Три свойства, и все три меряются теми, кто агента **читает**, а не самим правилом:
// `placeOf` в одну строку проверять незачем, ломается не оно, а читатель, который
// спросил фазу вместо места. Читателей два набора — мир (кто стоит у ворот, живой
// обзор, приказы) и карта (кого можно взять тапом, на ком стоит камера). Как агента
// рисует кадр и что это стоит земле, проверяет `ui/map/shelter.test.ts`.
//
// Область, где правило вообще спрашивается, — живые агенты: выбывший не на карте и не
// в городе, это третье, прежнее состояние. Каждый прогон утверждает, что его точки
// внутри области, а не надеется на это.
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import { cameraAnchor, figuresOn, useWorld } from './store';
import { seeded } from '@/game/sim/random';
import { FIGURE_IDS } from './data/figures';
import { FIGURE_TOUCH } from './data/tuning';
import { distance } from './geo';
import type { SightDisc } from './fog';
import type { Coord, FigureId, FigureView, PlayerProfile } from './types';

const START = 1_700_000_000_000;
const MINUTE = 60_000;

function makeWorld(seed: number) {
  let now = START;
  const world = new LocalWorld({ seed, now: () => now, storage: null });
  return {
    world,
    advance: (ms: number): void => {
      now += ms;
    },
    now: (): number => now,
  };
}

const profile = (): PlayerProfile => ({
  name: 'Тест',
  pop: 120,
  defense: 30,
  units: { warrior: 10, scout: 4 },
  army: { spearman: 12 },
  stock: { food: 120, wood: 80 },
  stash: 0,
});

type W = ReturnType<typeof makeWorld>;

/** Пульс, как в игре: мир догоняет часы, карта получает фигуры. */
async function pulse(w: W): Promise<FigureView[]> {
  const p = await w.world.sync(profile());
  useWorld.setState({ figures: p.figures, info: await w.world.info() });
  return p.figures;
}

const cellOf = (f: FigureView): Coord => ({ x: Math.round(f.at.x), y: Math.round(f.at.y) });
const discs = (w: W): SightDisc[] =>
  (w.world as unknown as { sightDiscs(now: number): SightDisc[] }).sightDiscs(w.now());

/** Дойти до клетки: приказ, часы до прибытия, пульс. */
async function walk(w: W, id: FigureId, to: Coord): Promise<FigureView> {
  const err = await w.world.moveFigure(id, to);
  let f = (await pulse(w)).find((x) => x.id === id) as FigureView;
  if (err === null) {
    w.advance(Math.max(0, f.arriveAt - w.now()) + 1);
    f = (await pulse(w)).find((x) => x.id === id) as FigureView;
  }
  return f;
}

/**
 * Где агента видно на карте и в мире — всеми читателями, кроме самого `place`.
 * Возвращает список мест, где его нашли: «карта» — если его видит хоть один
 * читатель карты или мира, «город» — если мир числит его в городе.
 */
async function seenAt(w: W, f: FigureView): Promise<{ map: string[]; city: boolean }> {
  const map: string[] = [];
  if (figuresOn(cellOf(f).x, cellOf(f).y, w.now()).some((x) => x.id === f.id)) map.push('тап по клетке');
  useWorld.setState({ anchor: f.id });
  if (cameraAnchor(w.now())?.id === f.id) map.push('камера');
  useWorld.setState({ anchor: 'home' });
  if (f.phase === 'home') {
    const card = await w.world.settlement('home');
    if (card?.figuresHere.includes(f.id)) map.push('у своих ворот');
  }
  if (f.id === 'spy' && f.watching && discs(w).some((d) => d.r === f.sight && d.x === f.at.x && d.y === f.at.y)) {
    map.push('живой обзор');
  }
  return { map, city: f.place === 'city' };
}

describe('агент всегда ровно в одном месте: на карте или в городе', () => {
  it('на случайных приказах, часах и входах-выходах — никогда в обоих и никогда нигде', async () => {
    let cityVisits = 0;
    let gateVisits = 0;
    let fieldVisits = 0;
    let leftFromCity = 0;
    for (const seed of [3, 11, 29]) {
      const w = makeWorld(seed);
      const home = (await w.world.info()).home;
      const rnd = seeded(seed * 7919);
      // Модель игрока: в городе агент, которого ввели и с тех пор никуда не водили.
      const inside: Partial<Record<FigureId, boolean>> = {};
      const entered: Partial<Record<FigureId, Coord>> = {};
      await pulse(w);
      for (let step = 0; step < 140; step++) {
        const id = FIGURE_IDS[Math.floor(rnd() * FIGURE_IDS.length)];
        const roll = rnd();
        const before = (await pulse(w)).find((x) => x.id === id) as FigureView;
        if (roll < 0.2) {
          // К своим воротам: на саму клетку дома или вплотную к ней.
          const to = { x: home.x + Math.floor(rnd() * 3) - 1, y: home.y + Math.floor(rnd() * 3) - 1 };
          if ((await w.world.moveFigure(id, to)) === null) {
            if (inside[id]) leftFromCity++;
            inside[id] = false;
          }
        } else if (roll < 0.32) {
          const to = { x: home.x + 4 + Math.floor(rnd() * 5), y: home.y - 3 + Math.floor(rnd() * 6) };
          if ((await w.world.moveFigure(id, to)) === null) {
            if (inside[id]) leftFromCity++;
            inside[id] = false;
          }
        } else if (roll < 0.52) {
          if ((await w.world.shelter(id, true)) === null && !inside[id]) {
            // Войти удаётся только стоя у своих ворот — и тогда агент в городе.
            expect(before.phase, `${id} вошёл в город не от ворот`).toBe('home');
            inside[id] = true;
            entered[id] = cellOf(before);
          }
        } else if (roll < 0.64) {
          if ((await w.world.shelter(id, false)) === null) inside[id] = false;
        } else if (roll < 0.7) {
          await w.world.watch(rnd() < 0.7);
        } else if (roll < 0.76) {
          if ((await w.world.recallFigure(id)) === null) {
            if (inside[id]) leftFromCity++;
            inside[id] = false;
          }
        } else {
          w.advance(Math.round(rnd() * 3 * MINUTE));
        }

        for (const f of await pulse(w)) {
          // Область правила: живые агенты. Выбывший — третье состояние, и здесь его
          // быть не должно (прогон держится у дома, где агентов не убивают).
          expect(f.phase, `${f.id} выбыл посреди прогона — точка вне области`).not.toBe('down');
          const seen = await seenAt(w, f);
          const where = `сид ${seed}, шаг ${step}, ${f.id}: карта [${seen.map.join(', ')}], город ${seen.city}`;
          expect(seen.city && seen.map.length > 0, `в двух местах — ${where}`).toBe(false);
          expect(!seen.city && seen.map.length === 0, `нигде — ${where}`).toBe(false);
          expect(seen.city, `в городе без приказа или вне его после приказа — ${where}`).toBe(Boolean(inside[f.id]));
          if (seen.city) {
            cityVisits++;
            expect(cellOf(f), `укрывшийся сдвинулся — ${where}`).toEqual(entered[f.id]);
          } else if (f.phase === 'home') gateVisits++;
          else fieldVisits++;
        }
      }
    }
    // Прогон не пустой: побывали во всех трёх положениях и уходили прямо из города.
    expect(cityVisits).toBeGreaterThan(100);
    expect(gateVisits).toBeGreaterThan(100);
    expect(fieldVisits).toBeGreaterThan(100);
    expect(leftFromCity).toBeGreaterThan(5);
  });
});

describe('укрывшийся агент не виден там, где виден стоящий', () => {
  it('ни тапом по клетке, ни камерой, ни у своих ворот, ни живым обзором — и не работает', async () => {
    const w = makeWorld(5);
    const home = (await w.world.info()).home;
    await pulse(w);
    // Лазутчик у ворот, наблюдает: стоящего видят все читатели разом.
    expect(await w.world.watch(true)).toBeNull();
    const standing = (await pulse(w)).find((f) => f.id === 'spy') as FigureView;
    expect(standing.phase, 'точка внутри области: стоит у ворот').toBe('home');
    expect(distance(standing.at, home)).toBeLessThanOrEqual(FIGURE_TOUCH);
    expect((await seenAt(w, standing)).map).toEqual(['тап по клетке', 'камера', 'у своих ворот', 'живой обзор']);
    expect(standing.watchSight).toBeGreaterThan(0);

    expect(await w.world.shelter('spy', true)).toBeNull();
    const hidden = (await pulse(w)).find((f) => f.id === 'spy') as FigureView;
    expect(hidden.place).toBe('city');
    expect((await seenAt(w, hidden)).map).toEqual([]);
    expect(hidden.watchSight, 'из-за стены не наблюдают').toBe(0);
    expect(hidden.watching, 'наблюдение снято на входе').toBe(false);
    expect(discs(w).some((d) => d.r === standing.sight)).toBe(false);
    expect(await w.world.watch(true)).toMatch(/Из-за стены/);

    // Полководец в городе дружину не собирает — сначала выйти.
    expect(await w.world.shelter('general', true)).toBeNull();
    expect(await w.world.setGarrison({ spearman: 5 })).toMatch(/укрылся в городе/);
    expect(await w.world.shelter('general', false)).toBeNull();
    expect(await w.world.setGarrison({ spearman: 5 })).toBeNull();
  });

  it('в город входят только от своих ворот: не из поля и не с дороги', async () => {
    const w = makeWorld(5);
    const home = (await w.world.info()).home;
    await pulse(w);
    const out = await walk(w, 'scout', { x: home.x + 6, y: home.y + 2 });
    expect(out.phase, 'точка внутри области: стоит в поле').toBe('field');
    expect(await w.world.shelter('scout', true)).toMatch(/от своих ворот/);
    expect(await w.world.moveFigure('scout', { ...home })).toBeNull();
    const road = (await pulse(w)).find((f) => f.id === 'scout') as FigureView;
    expect(road.phase, 'точка внутри области: в пути').toBe('moving');
    expect(await w.world.shelter('scout', true)).toMatch(/в пути/);
    expect(road.place).toBe('map');
  });
});

describe('выход из города возвращает агента туда же, откуда он вошёл', () => {
  it('с каждой клетки у ворот и после часов в городе', async () => {
    const w = makeWorld(17);
    const home = (await w.world.info()).home;
    await pulse(w);
    const cells: Coord[] = [
      { x: home.x, y: home.y },
      { x: home.x + 1, y: home.y },
      { x: home.x - 1, y: home.y + 1 },
      { x: home.x, y: home.y - 1 },
    ];
    let checked = 0;
    for (const id of ['scout', 'diplomat', 'general', 'spy'] as FigureId[]) {
      for (const cell of cells) {
        const at = await walk(w, id, cell);
        expect(at.phase, `точка внутри области: ${id} стоит у ворот на ${cell.x}|${cell.y}`).toBe('home');
        expect(cellOf(at)).toEqual(cell);
        expect(await w.world.shelter(id, true)).toBeNull();
        // В городе проходят часы и пульсы: мир живёт, агента не трогает.
        for (let i = 0; i < 12; i++) {
          w.advance(10 * MINUTE);
          const f = (await pulse(w)).find((x) => x.id === id) as FigureView;
          expect(f.place, `${id} в городе через ${(i + 1) * 10} мин`).toBe('city');
        }
        expect(await w.world.shelter(id, false)).toBeNull();
        const back = (await pulse(w)).find((x) => x.id === id) as FigureView;
        expect(back.place).toBe('map');
        expect(back.phase).toBe('home');
        expect(cellOf(back), `${id} вышел не туда, откуда вошёл`).toEqual(cell);
        checked++;
      }
    }
    expect(checked).toBe(16);
  });
});
