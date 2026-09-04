// Снаряжение, войска и власть вождя: то, что игрок покупает людьми и железом.
import { beforeEach, describe, expect, it } from 'vitest';
import type { BuildingTypeId, GameState } from '../types';
import { createInitialState } from '../state';
import { catchUp, tick } from './tick';
import { setDecree, setRation } from './actions';
import { setForging } from './smithy';
import { cancelRecruit, recruitCheck, startRecruit } from './army';
import { addVillager } from './population';
import { assignWorker } from './workers';
import { seeded, setRandom } from './random';
import { DAY_LENGTH, RESOURCE_IDS, STARVATION_DEATH } from '../constants';
import { SEASONS, SEASON_DAYS, SEASON_SECONDS } from '../data/seasons';
import { DECREE_BY_ID, RATION_BY_ID } from '../data/policy';
import { QUESTS } from '../data/quests';
import {
  armyPower,
  armySize,
  foodConsumptionPerDay,
  forgeInfo,
  housingCapacity,
  policyMoralePerDay,
  productionPerDay,
} from '../derived';

beforeEach(() => setRandom(seeded(7)));

/** Ставит готовое здание нужного уровня — короче, чем прогонять стройку. */
function place(s: GameState, type: BuildingTypeId, level = 1): void {
  const exist = s.buildings.find((b) => b.type === type);
  if (exist) {
    exist.level = level;
    exist.work = 0;
    exist.workRequired = 0;
    return;
  }
  s.buildings.push({ id: s.nextId++, type, slot: 0, level, work: 0, workRequired: 0 });
}

/** Племя с казармами, кузницей и запасом: с него начинаются военные проверки. */
function warband(pop = 10): GameState {
  const s = createInitialState();
  s.techs.push('chiefdom', 'stone_tools', 'spears', 'warband', 'metallurgy', 'bows');
  while (s.villagers.length < pop) addVillager(s, { age: 24, talent: null });
  for (const v of s.villagers) {
    v.job = 'idle';
    v.workplace = null;
  }
  place(s, 'barracks', 2);
  place(s, 'smithy', 2);
  place(s, 'hut', 4);
  for (const r of RESOURCE_IDS) s.resources[r] = 200;
  // Награды за задания посыпались бы в первый же тик и подменили собой запас,
  // а проверяем мы именно запас — поэтому задания считаем уже закрытыми.
  s.completedQuests = QUESTS.map((q) => q.id);
  return s;
}

describe('снаряжение', () => {
  it('кузнец кует выбранное и кладёт на склад', () => {
    const s = warband();
    const smithy = s.buildings.find((b) => b.type === 'smithy')!;
    expect(assignWorker(s, smithy.id)).toBeNull();
    expect(setForging(s, 'spear')).toBeNull();
    const wood0 = s.resources.wood;
    catchUp(s, 60, 0.5);
    expect(s.equipment.spear).toBeGreaterThan(0);
    expect(s.resources.wood).toBeLessThan(wood0);
  });

  it('без кузнеца кузница молчит и объясняет почему', () => {
    const s = warband();
    expect(setForging(s, 'spear')).toBeNull();
    catchUp(s, 60, 0.5);
    expect(s.equipment.spear).toBe(0);
    expect(forgeInfo(s).blocked).toMatch(/никто не работает/);
  });

  it('неизученное снаряжение ковать нельзя', () => {
    const s = warband();
    expect(setForging(s, 'sword')).toMatch(/Нужно изучить/);
    expect(s.forging).toBeNull();
  });

  it('без материалов заготовка ждёт, а не пропадает', () => {
    const s = warband();
    const smithy = s.buildings.find((b) => b.type === 'smithy')!;
    assignWorker(s, smithy.id);
    setForging(s, 'spear');
    for (const r of RESOURCE_IDS) s.resources[r] = 0;
    catchUp(s, 60, 0.5);
    expect(s.equipment.spear).toBe(0);
    expect(forgeInfo(s).blocked).toMatch(/материалов/);
    // Материалы завезли — предмет выходит сразу, накопленная работа не потеряна.
    s.resources.wood = 50;
    s.resources.stone = 50;
    tick(s, 1, { offline: true });
    expect(s.equipment.spear).toBe(1);
  });
});

describe('казармы', () => {
  it('без снаряжения бойца не нанять', () => {
    const s = warband();
    s.equipment.spear = 0;
    const check = recruitCheck(s, 'spearman', 1);
    expect(check.missing).toEqual([{ id: 'spear', have: 0, need: 1 }]);
    expect(check.blocked).toMatch(/Не хватает: копья 1/);
    expect(startRecruit(s, 'spearman', 1)).toBe(check.blocked);
    expect(armySize(s)).toBe(0);
    // Ресурсы при отказе не списываются.
    expect(s.resources.food).toBe(200);
  });

  it('дубинщику снаряжение не нужно', () => {
    const s = warband();
    expect(recruitCheck(s, 'clubman', 1).blocked).toBeNull();
    expect(startRecruit(s, 'clubman', 1)).toBeNull();
  });

  it('нанятый житель уходит из рабочих и появляется в армии', () => {
    const s = warband();
    s.equipment.spear = 2;
    const pop0 = s.villagers.length;
    const food0 = s.resources.food;
    expect(startRecruit(s, 'spearman', 2)).toBeNull();

    // Плата снимается сразу: люди, снаряжение и припас.
    expect(s.villagers.length).toBe(pop0 - 2);
    expect(s.equipment.spear).toBe(0);
    expect(s.resources.food).toBe(food0 - 28);
    expect(armySize(s)).toBe(0);

    const born0 = s.stats.born;
    catchUp(s, 120, 0.5);
    expect(s.army.spearman).toBe(2);
    expect(s.recruits).toHaveLength(0);
    // Бойцы не вернулись в жители: они больше не добывают и не строят.
    // Родившиеся за это время — отдельная история, их считаем прямо.
    expect(s.villagers.length).toBe(pop0 - 2 + (s.stats.born - born0));
    expect(armyPower(s)).toBe(8);
  });

  it('нельзя набрать больше, чем есть свободных жителей', () => {
    const s = warband(6);
    s.equipment.spear = 20;
    const free = s.villagers.filter((v) => v.job === 'idle').length;
    expect(recruitCheck(s, 'spearman', free + 1).blocked).toMatch(/Свободных жителей только/);
    expect(recruitCheck(s, 'spearman', free).freeAfter).toBe(0);
  });

  it('отмена возвращает всё: людей, снаряжение и припас', () => {
    const s = warband();
    s.equipment.spear = 3;
    const names = s.villagers.map((v) => v.name).sort();
    const pop0 = s.villagers.length;
    const food0 = s.resources.food;

    expect(startRecruit(s, 'spearman', 3)).toBeNull();
    expect(s.villagers.length).toBe(pop0 - 3);
    const order = s.recruits[0];
    expect(cancelRecruit(s, order.id)).toBeNull();

    expect(s.villagers.length).toBe(pop0);
    expect(s.equipment.spear).toBe(3);
    expect(s.resources.food).toBe(food0);
    expect(s.recruits).toHaveLength(0);
    // Возвращаются те же люди, а не безымянные головы.
    expect(s.villagers.map((v) => v.name).sort()).toEqual(names);
  });

  it('отмена наполовину обученного набора возвращает только недоучившихся', () => {
    const s = warband();
    s.equipment.spear = 3;
    const pop0 = s.villagers.length;
    startRecruit(s, 'spearman', 3);
    // Копейщик учится 25 очков, казармы 2 уровня дают 1.1 в секунду.
    catchUp(s, 30, 0.5);
    expect(s.army.spearman).toBe(1);
    const left = s.recruits[0].count - s.recruits[0].done;
    cancelRecruit(s, s.recruits[0].id);
    expect(s.equipment.spear).toBe(left);
    expect(s.villagers.length).toBe(pop0 - 3 + left);
  });

  it('очередь идёт последовательно, а не всё разом', () => {
    const s = warband(14);
    s.equipment.spear = 2;
    startRecruit(s, 'clubman', 2);
    startRecruit(s, 'spearman', 2);
    expect(s.recruits).toHaveLength(2);
    catchUp(s, 20, 0.5);
    // Первый заказ уже идёт, второй ещё не тронут.
    expect(s.recruits[0].troop).toBe('clubman');
    expect(s.recruits[1].work).toBe(0);
    catchUp(s, 120, 0.5);
    expect(s.army.clubman).toBe(2);
    expect(s.army.spearman).toBe(2);
  });

  it('бойцы едят, но жильё им не нужно', () => {
    const s = warband();
    const eat0 = foodConsumptionPerDay(s);
    const housing0 = housingCapacity(s);
    s.army.spearman = 5;
    expect(foodConsumptionPerDay(s)).toBeCloseTo(eat0 + 5 * 1.2, 5);
    expect(housingCapacity(s)).toBe(housing0);
  });
});

describe('указ и рацион', () => {
  /** Одинаковые племена: разница между ними — только в указе или рационе. */
  const twin = (): [GameState, GameState] => [warband(12), warband(12)];

  it('указ меняет выработку ровно на заявленную величину', () => {
    const s = warband(12);
    s.villagers[0].job = 'woodcutter';
    const base = productionPerDay(s).wood;
    expect(setDecree(s, 'order')).toBeNull();
    expect(productionPerDay(s).wood).toBeCloseTo(base * DECREE_BY_ID.order.output, 6);
    expect(setDecree(s, 'freedom')).toBeNull();
    expect(productionPerDay(s).wood).toBeCloseTo(base * DECREE_BY_ID.freedom.output, 6);
    expect(setDecree(s, 'none')).toBeNull();
    expect(productionPerDay(s).wood).toBeCloseTo(base, 6);
  });

  it('рацион меняет расход еды ровно на заявленную величину', () => {
    const s = warband(12);
    const base = foodConsumptionPerDay(s);
    expect(setRation(s, 'lean')).toBeNull();
    expect(foodConsumptionPerDay(s)).toBeCloseTo(base * RATION_BY_ID.lean.food, 6);
    expect(setRation(s, 'rich')).toBeNull();
    expect(foodConsumptionPerDay(s)).toBeCloseTo(base * RATION_BY_ID.rich.food, 6);
  });

  it('указ и рацион двигают мораль ровно на заявленную величину в день', () => {
    const [a, b] = twin();
    setDecree(b, 'order');
    expect(policyMoralePerDay(a)).toBe(0);
    expect(policyMoralePerDay(b)).toBe(-0.5);
    // Запасов вдоволь, поэтому целевая мораль у обоих одна и та же.
    tick(a, DAY_LENGTH, { offline: true });
    tick(b, DAY_LENGTH, { offline: true });
    expect(a.morale - b.morale).toBeCloseTo(0.5, 4);

    const [c, d] = twin();
    setRation(d, 'rich');
    tick(c, DAY_LENGTH, { offline: true });
    tick(d, DAY_LENGTH, { offline: true });
    expect(d.morale - c.morale).toBeCloseTo(0.6, 4);
  });

  it('на скудном пайке рождений нет', () => {
    const s = warband(6);
    setRation(s, 'lean');
    s.morale = 90;
    const pop0 = s.villagers.length;
    catchUp(s, 4 * DAY_LENGTH, 1);
    expect(s.villagers.length).toBe(pop0);
    expect(s.growth).toBe(0);
  });

  it('скудный рацион не убивает племя за одну зиму, а вытягивает его', () => {
    /** Одно и то же племя перед голодной зимой второго года. */
    const hungry = (): GameState => {
      const s = warband(12);
      // Двенадцать ртов зимой съедают 16.8 в день на обычном пайке и 11.76 на скудном.
      // На пять зимних дней нужно 84 или 59 — с запасом в 42 обычный паёк не дотянет.
      s.resources.food = 42;
      s.resources.wood = 60;
      s.time = (SEASONS.indexOf('winter') + SEASONS.length) * SEASON_SECONDS;
      return s;
    };
    const winter = SEASON_DAYS * DAY_LENGTH;

    const fed = hungry();
    catchUp(fed, winter, 1);
    expect(fed.stats.died, 'на обычном пайке такая зима стоит людей').toBeGreaterThan(0);

    const lean = hungry();
    setRation(lean, 'lean');
    const pop0 = lean.villagers.length;
    catchUp(lean, winter, 1);
    expect(lean.villagers.length).toBe(pop0);
    expect(lean.stats.died).toBe(0);
    // Голодно было и на скудном, но до смертельного порога дело не дошло.
    expect(lean.starvation).toBeLessThan(STARVATION_DEATH);
    expect(lean.starvation).toBeLessThan(fed.starvation);
  });

  it('щедрый рацион не разгоняет население быстрее жилья', () => {
    const s = warband(8);
    setRation(s, 'rich');
    s.morale = 100;
    for (const r of RESOURCE_IDS) s.resources[r] = 900;
    catchUp(s, SEASON_DAYS * DAY_LENGTH * 4, 1);
    expect(s.villagers.length).toBeGreaterThan(8);
    expect(s.villagers.length).toBeLessThanOrEqual(housingCapacity(s));
  });
});
