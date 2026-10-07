// Отклик города на дела игрока (docs/city.md, 14): леса у каждой из 24 построек, груз на блоке, праздник готовности,
// найм строем и добыча над дворами. Тесты-свойства называют свою область (полный цикл блока, вся жизнь выхода отряда,
// праздник целиком) и проверяют, что каждая точка внутри неё (правило 11).
import { describe, expect, it } from 'vitest';
import type { BuildingTypeId, GameState, ResourceId, Resources } from '@/game/types';
import { DAY_LENGTH, RESOURCE_IDS } from '@/game/constants';
import { gameSeconds } from '@/game/pace';
import { createInitialState } from '@/game/state';
import { cityPlan } from './layout';
import { buildStatic } from './budget';
import { CityLife } from './life';
import { CITY_OWNERS, mainSite } from './sites';
import { CityDeeds, DEED_CAP, FEAST, MARCH_V, MUSTER_AT, MUSTER_HOLD, SCAFFOLD_OFF, STRIKE, feastAt, hoistAt, marchAt, marchLife, marchRoute, scaffoldOf } from './deeds';
import { POP_GAP, YieldTally, newsOf, seenOf, type Yard } from './pops';

const plan = cityPlan();
const { sites } = buildStatic(plan, 'medium');
const life = new CityLife({ plan, chimneys: [], flagTops: [], quality: 'medium' });
const street = life.street();

const res = (part: Partial<Resources>): Resources => ({ ...(Object.fromEntries(RESOURCE_IDS.map((r) => [r, 0])) as Resources), ...part });

describe('город: отклик — леса стройки', () => {
  it('у каждой из 24 построек — леса вокруг её места: стойки снаружи коробки, в зазоре лесов', () => {
    for (const type of CITY_OWNERS) {
      const s = mainSite(sites, type);
      expect(s, type).not.toBeNull();
      if (!s) continue;
      for (const q of ['high', 'medium', 'low'] as const) {
        const sc = scaffoldOf(s, q);
        const poles = sc.beams.filter((b) => b.a < 0.2 && b.h > 1);
        expect(poles.length, `${type} ${q}: стойки есть`).toBeGreaterThanOrEqual(4);
        for (const b of poles) {
          // В рамке места: вперёд и вправо от середины.
          const dx = b.x - s.x;
          const dz = b.z - s.z;
          const f = dx * s.fx + dz * s.fz;
          const r = dx * s.fz - dz * s.fx;
          const out = Math.max(Math.abs(f) - s.hf, Math.abs(r) - s.hr);
          expect(out, `${type} ${q}: стойка не в стене`).toBeGreaterThan(SCAFFOLD_OFF - 0.35);
          expect(out, `${type} ${q}: стойка у стены, а не в поле`).toBeLessThan(SCAFFOLD_OFF + 0.35);
        }
        expect(sc.height).toBeGreaterThanOrEqual(4.5);
        expect(sc.height).toBeLessThanOrEqual(15);
        // Три стройки разом (Ратуша строит по одной, а праздник прошлой ещё стоит) помещаются в запас коробок.
        expect(sc.beams.length * 3 + 12, `${type} ${q}: коробок`).toBeLessThanOrEqual(DEED_CAP[q].beams);
      }
    }
  });

  it('груз на блоке ходит вверх и вниз плавно, без скачка, на полном цикле', () => {
    // Область: один полный цикл блока (10 с) с разными сдвигами — каждая точка внутри цикла.
    const STEP = 0.05;
    for (const phase of [0, 3.3, 7.1]) {
      let prev = hoistAt(0, phase);
      let top = 0;
      let bottom = 1;
      for (let t = STEP; t <= 10 + 1e-9; t += STEP) {
        const v = hoistAt(t, phase);
        expect(t).toBeLessThanOrEqual(10 + 1e-9);
        expect(Math.abs(v - prev), `сдвиг ${phase}, ${t.toFixed(2)} с`).toBeLessThan(0.04);
        top = Math.max(top, v);
        bottom = Math.min(bottom, v);
        prev = v;
      }
      expect(top, 'груз доходит до верха').toBe(1);
      expect(bottom, 'и опускается до земли').toBe(0);
    }
  });

  it('праздник: леса уходят за `STRIKE`, вспышка гаснет, стяг поднимается и к концу опускается', () => {
    expect(feastAt(0).scaffold).toBe(1);
    expect(feastAt(STRIKE).scaffold).toBe(0);
    expect(feastAt(0).glow).toBe(1);
    expect(feastAt(0.8).glow).toBe(0);
    expect(feastAt(3).banner).toBe(1);
    expect(feastAt(FEAST).banner).toBe(0);
    // Без скачка по всей длине праздника.
    let prev = feastAt(0);
    for (let a = 0.02; a <= FEAST; a += 0.02) {
      const v = feastAt(a);
      expect(Math.abs(v.scaffold - prev.scaffold)).toBeLessThan(0.05);
      expect(Math.abs(v.banner - prev.banner)).toBeLessThan(0.05);
      prev = v;
    }
  });

  it('стройка видна, праздник кончается, а пока ничего не идёт — ни одного вызова', () => {
    const d = new CityDeeds({ sites, quality: 'medium', street });
    d.update(0, 0, 800);
    expect(d.group.children.every((o) => !o.visible), 'тихо — всё скрыто').toBe(true);
    d.setWorks(['tavern']);
    d.update(1, 0, 800);
    const shown = (name: string): boolean => d.group.getObjectByName(name)?.visible ?? false;
    expect(shown('city-scaffold')).toBe(true);
    expect(shown('city-builders')).toBe(true);
    d.setWorks([]);
    d.done('tavern', 2);
    d.update(2.3, 0, 800);
    expect(shown('city-flash'), 'вспышка').toBe(true);
    d.update(2 + FEAST + 0.1, 0, 800);
    expect(d.busy()).toBe(false);
    expect(d.group.children.every((o) => !o.visible), 'праздник кончился — снова тихо').toBe(true);
  });
});

describe('город: отклик — найм строем', () => {
  const barracks = mainSite(sites, 'barracks');
  if (!barracks) throw new Error('нет казарм');
  const door = { x: barracks.x + barracks.fx * (barracks.hf + 1), z: barracks.z + barracks.fz * (barracks.hf + 1) };
  const route = marchRoute(street.paths, street.junctions, door, MUSTER_AT);

  it('путь из двери казарм на площадь — по улицам, без прыжков', () => {
    expect(route[0]).toEqual(door);
    expect(route[route.length - 1]).toEqual(MUSTER_AT);
    let len = 0;
    for (let k = 1; k < route.length; k++) {
      const d = Math.hypot(route[k].x - route[k - 1].x, route[k].z - route[k - 1].z);
      // Колено по улице или короткая перемычка перекрёстка; прямой подход от двери к улице — не через полгорода.
      expect(d, `колено ${k}`).toBeLessThan(60);
      len += d;
    }
    const straight = Math.hypot(MUSTER_AT.x - door.x, MUSTER_AT.z - door.z);
    expect(len, 'не кругами по городу').toBeLessThan(straight * 2.2);
  });

  it('строй: каждый идёт ровным шагом, на площадь приходят разом, стоят рядами и уходят обратно', () => {
    const len = 180;
    for (const n of [1, 6, 12]) {
      // Область: вся жизнь выхода отряда — от двери до возвращения последнего.
      const life = marchLife(len);
      const STEP = 0.1;
      for (let k = 0; k < n; k++) {
        let prev = marchAt(len, k, n, 0);
        for (let a = STEP; a <= life; a += STEP) {
          expect(a).toBeLessThanOrEqual(life);
          const v = marchAt(len, k, n, a);
          expect(Math.abs(v.s - prev.s), `боец ${k} из ${n}, ${a.toFixed(1)} с`).toBeLessThanOrEqual(MARCH_V * STEP + 1e-6);
          prev = v;
        }
        expect(marchAt(len, k, n, life).seen, 'все вернулись').toBe(false);
      }
      // На площади: все стоят, ряды не налезают друг на друга.
      const at = len / MARCH_V + MUSTER_HOLD / 2;
      const rows = new Set<number>();
      for (let k = 0; k < n; k++) {
        const v = marchAt(len, k, n, at);
        expect(v.moving, `${n}: стоят`).toBe(0);
        expect(v.seen).toBe(true);
        rows.add(Math.round(v.s * 10));
      }
      expect(rows.size, `${n}: рядов`).toBe(Math.ceil(n / 2));
    }
  });

  it('обученные по заказу найма — новость один раз; ушедший заказ отдаёт остаток', () => {
    const s = createInitialState() as GameState;
    s.recruits = [{ id: 7, troop: 'militia' as never, count: 10, done: 2, work: 0, people: 10 }];
    const was = seenOf(s);
    s.recruits[0].done = 5;
    expect(newsOf(was, s).trained).toBe(3);
    const was2 = seenOf(s);
    s.recruits = [];
    expect(newsOf(was2, s).trained, 'заказ снят: обучен остаток').toBe(5);
    expect(newsOf(seenOf(s), s).trained).toBe(0);
  });

  it('стройка кончилась — новость у той постройки, чей уровень вырос, а отмена — не праздник', () => {
    const s = createInitialState() as GameState;
    const b = s.buildings.find((x) => x.type === 'smithy')!;
    b.workRequired = 100;
    const was = seenOf(s);
    b.workRequired = 0;
    expect(newsOf(was, s).done, 'отмена').toEqual([]);
    b.level += 1;
    expect(newsOf(was, s).done).toEqual(['smithy']);
  });
});

describe('город: отклик — добыча над дворами', () => {
  const farm: Yard = { type: 'farm' as BuildingTypeId, perDay: res({ food: 48, hides: 2 }) };
  const mill: Yard = { type: 'sawmill' as BuildingTypeId, perDay: res({ wood: 24 }) };
  const none = new Set<ResourceId>();

  it('по мере прихода: целыми, не чаще `POP_GAP` над двором, и ни одной единицы мимо', () => {
    const tally = new YieldTally();
    let food = 0;
    const last = new Map<string, number>();
    // Область: час настоящего времени шагами цикла по полсекунды — игровых секунд за шаг столько, сколько даёт дверь.
    const STEPS = 7200;
    const dt = gameSeconds(0.5);
    for (let k = 1; k <= STEPS; k++) {
      const now = k * 0.5;
      for (const p of tally.feed([farm, mill], dt, now, none)) {
        const was = last.get(p.type);
        if (was !== undefined) expect(now - was, p.type).toBeGreaterThanOrEqual(POP_GAP);
        last.set(p.type, now);
        for (const it of p.items) {
          expect(Number.isInteger(it.n) && it.n >= 1).toBe(true);
          if (it.r === 'food') food += it.n;
        }
      }
    }
    // Еды за час — 48 в игровой день; всплыло всё, кроме накопленного с последней надписи (меньше единицы или не больше
    // `POP_GAP` настоящих секунд выработки).
    const made = (48 * STEPS * dt) / DAY_LENGTH;
    expect(made, 'за час двор даёт десятки — надписей много').toBeGreaterThan(50);
    const gap = Math.max(1, ((48 * dt) / DAY_LENGTH) * (POP_GAP / 0.5));
    expect(food).toBeGreaterThan(made - gap - 1);
    expect(food).toBeLessThanOrEqual(made);
  });

  it('волна отлучки — всем дворам разом, мимо `POP_GAP`; запас у потолка склада не всплывает', () => {
    const tally = new YieldTally();
    // Секунда игры — меньше единицы: надписи нет, остаток копится и уходит в волну.
    expect(tally.feed([farm, mill], 1, 0, none)).toEqual([]);
    const wave = tally.feed([farm, mill], 6 * 3600, 0.2, new Set<ResourceId>(['wood']), true);
    expect(wave.map((p) => p.type)).toEqual(['farm']);
    expect(wave[0].items[0]).toEqual({ r: 'food', n: Math.floor((48 * (6 * 3600 + 1)) / DAY_LENGTH) });
    expect(wave[0].items.length).toBe(2);
  });
});
