// Приоритет жилья у автопилота (ПБ-1, п. 5; docs/siege_v2.md, «Решения ПБ-1»): пока жильё — узкое место, а на его улучшение
// не хватает запасов, прочие стройки ждут — ставится только склад, если цена жилья в него не влезает, и двор, который добывает
// недостающее. Прежде каждый камень уходил в чужую стройку, и партия `pop:report` стояла у крыши часами.
//
// Область правила (правило 11): жители у крыши (`build`: не меньше вместимости без двадцати), жильё не на потолке и не по
// запасам. Каждая точка проверяется утверждением: у крыши, жильё не по карману, а чужая стройка по карману — правилу есть что
// удерживать. Граница — те же запасы вдали от крыши: удерживать нечего, стройка идёт.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { buildingOfType, housingCapacity, isSite, maxLevelFor, storageCap, upgradeInfo } from '@/game/derived';
import type { BuildingTypeId, GameState, ResourceId } from '@/game/types';
import { build } from './autopilot';

/** Посёлок у крыши (или в стороне от неё) с данными запасами; прочие ресурсы — по пятьсот. */
function town(stock: Partial<Record<ResourceId, number>>, atRoof = true, houses = 1): GameState {
  const s = createInitialState(7);
  s.tutorialDone = true;
  buildingOfType(s, 'houses')!.level = houses;
  for (const r of Object.keys(s.resources) as ResourceId[]) s.resources[r] = 500;
  Object.assign(s.resources, stock);
  s.pop = atRoof ? housingCapacity(s) - 5 : Math.max(1, housingCapacity(s) - 40);
  return s;
}

const sites = (s: GameState): BuildingTypeId[] => s.buildings.filter(isSite).map((b) => b.type);
const affordableOther = (s: GameState): BuildingTypeId[] =>
  s.buildings.filter((b) => b.type !== 'houses' && b.type !== 'town_hall' && upgradeInfo(s, b).blocked === null).map((b) => b.type);

describe('приоритет жилья у автопилота (ПБ-1, п. 5)', () => {
  it('у крыши, жильё не по запасам — чужие стройки ждут: камень жилья никуда не уходит', () => {
    const s = town({ wood: 5000, stone: 50 });
    const houses = upgradeInfo(s, buildingOfType(s, 'houses')!);
    expect(houses.cost.stone ?? 0, 'точка внутри области: жилью не хватает камня').toBeGreaterThan(s.resources.stone);
    expect(s.pop).toBeGreaterThanOrEqual(housingCapacity(s) - 20);
    expect(affordableOther(s).length, 'точка внутри области: чужая стройка по карману').toBeGreaterThan(0);
    build(s);
    // Двор камня (Шахта) сам дороже жилья — ставить нечего: ждём.
    expect(sites(s)).toEqual([]);
  });

  it('недостающее добывает двор — ставится он, а не то, что по карману', () => {
    const s = town({ wood: 200, stone: 5000 });
    const houses = upgradeInfo(s, buildingOfType(s, 'houses')!);
    expect(houses.cost.wood ?? 0, 'точка внутри области: жилью не хватает дерева').toBeGreaterThan(s.resources.wood);
    expect(affordableOther(s).filter((t) => t !== 'sawmill').length, 'точка внутри области: по карману и не дерево').toBeGreaterThan(0);
    build(s);
    expect(sites(s), 'дерево добывает лесопилка').toEqual(['sawmill']);
  });

  it('на потолке Жилищ крышу даёт Ратуша; её цена не влезает в склад — сперва склад', () => {
    const s = town({ wood: 4700, stone: 4700 }, true, maxLevelFor('houses'));
    buildingOfType(s, 'town_hall')!.level = maxLevelFor('town_hall') - 1;
    s.pop = housingCapacity(s) - 5;
    const hall = upgradeInfo(s, buildingOfType(s, 'town_hall')!);
    expect(hall.cost.wood ?? 0, 'точка внутри области: цена Ратуши больше склада').toBeGreaterThan(storageCap(s));
    expect(affordableOther(s).filter((t) => t !== 'storage').length, 'точка внутри области: по карману и другое').toBeGreaterThan(0);
    build(s);
    expect(sites(s)).toEqual(['storage']);
  });

  it('жильё по запасам — ставится жильё; вдали от крыши удерживать нечего — стройка идёт', () => {
    const rich = town({ wood: 5000, stone: 5000 });
    build(rich);
    expect(sites(rich)).toEqual(['houses']);
    // Граница области: те же запасы, что в первом случае, но до крыши далеко — правило не спрашивается.
    const far = town({ wood: 5000, stone: 50 }, false);
    expect(far.pop, 'точка вне области: до крыши больше двадцати').toBeLessThan(housingCapacity(far) - 20);
    build(far);
    expect(sites(far).length, 'стройка идёт').toBe(1);
    expect(sites(far)).not.toContain('houses');
  });
});
