// ЗД-1 (docs/city_v3.md, «Решения ЗД-1»): объединённые дворы. Переход старого сохранения при разных уровнях пары, рабочие на
// делах, цена и добыча бит в бит прежние у того, кто качал оба здания вровень, потолок выработки сервера, и ни задания, ни
// обучение не ссылаются на ушедшие здания.
//
// Цены прежних зданий записаны здесь числами — как они стояли в `data/buildings.ts` до объединения (`6553d47`): тест сверяет
// новую цену с прежней, а не с самой собой.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BuildingTypeId, GameState, JobId, ResourceId } from './types';
import { MAX_BUILDING_LEVEL, RESOURCE_IDS, SLOTS_PER_LEVEL } from './constants';
import { BUILDINGS, BUILDING_BY_ID, jobsOf } from './data/buildings';
import { YARDS, YARD_BY_JOB } from './data/yards';
import { MINIGAMES } from './data/minigames';
import { QUESTS } from './data/quests';
import { TUTORIAL } from './data/tutorial';
import { cancelRefund, upgradeCost, upgradeWork } from './labour';
import { createInitialState } from './state';
import { deserialize, serialize, loadFold } from './save';
import { prodCeil } from './build';
import { buildingOfType, deedProduction, deedSlots, levelsOf, peasantsMult, productionPerDay, workerMultiplier } from './derived';
import { assignWorker } from './sim/workers';
import { MERGED_INTO, foldLevels, foldSites, foldTown, keptType, oldUpgradeCost } from './yardmerge';

// Партии младше 24-й читаются дверью перехода ЗД-1 — своей докачкой, как её подгружает вход (`save.loadFold`).
beforeAll(() => loadFold());

/** Прежние здания пар — цена и профессия, как до объединения. */
const OLD: Record<string, { cost: Partial<Record<ResourceId, number>>; work: number; job: JobId }> = {
  gathering: { cost: { wood: 119 }, work: 245, job: 'gatherer' },
  quarry: { cost: { wood: 119, stone: 63 }, work: 364, job: 'stonecutter' },
  hunter_hut: { cost: { wood: 168, charcoal: 49 }, work: 420, job: 'hunter' },
  mine: { cost: { wood: 476, stone: 364 }, work: 1092, job: 'miner' },
  farm: { cost: { wood: 364, stone: 63 }, work: 728, job: 'farmer' },
  pen: { cost: { wood: 476, hides: 63 }, work: 728, job: 'herder' },
};
const PAIRS: [BuildingTypeId, string][] = [
  ['farm', 'pen'],
  ['hunter_hut', 'gathering'],
  ['mine', 'quarry'],
];

/** Порядок построек сборки до объединения (24 постройки): двор пары стоит на своём прежнем месте. */
const OLD_ORDER = [
  'campfire',
  'town_hall',
  'houses',
  'storage',
  'gathering',
  'sawmill',
  'quarry',
  'hunter_hut',
  'mine',
  'workshop',
  'farm',
  'pen',
  ...BUILDINGS.map((b) => b.id).filter((t) => !['campfire', 'town_hall', 'houses', 'storage', 'sawmill', 'hunter_hut', 'mine', 'workshop', 'farm'].includes(t)),
];

interface OldParty {
  levels?: Record<string, number>;
  /** Рабочие по прежнему зданию. */
  workers?: Record<string, number>;
  bonded?: number;
  bondedWork?: Record<string, number>;
  /** Стройки по порядку очереди: тип и сделанная работа; уровень — следующий. */
  sites?: { type: string; done: number }[];
}

/** Запись партии 23-й версии: 24 постройки, рабочие и невольники — по номеру постройки. */
function oldSave(o: OldParty): { json: string; idOf: (t: string) => number } {
  const raw = JSON.parse(serialize(createInitialState(11))) as Record<string, unknown> & { resources: Record<string, number>; stats: Record<string, number> };
  const idOf = (t: string): number => OLD_ORDER.indexOf(t) + 1;
  const levelOf = (t: string): number => o.levels?.[t] ?? 1;
  raw.buildings = OLD_ORDER.map((type) => {
    const site = o.sites?.find((x) => x.type === type);
    const old = OLD[type];
    const need = site ? upgradeWork(old ?? BUILDING_BY_ID[type as BuildingTypeId], levelOf(type) + 1) : 0;
    return { id: idOf(type), type, level: levelOf(type), work: site ? site.done : 0, workRequired: need };
  });
  raw.nextId = OLD_ORDER.length + 1;
  raw.buildQueue = (o.sites ?? []).map((x) => idOf(x.type));
  raw.workers = Object.fromEntries(Object.entries(o.workers ?? {}).map(([t, n]) => [String(idOf(t)), n]));
  raw.bonded = o.bonded ?? 0;
  raw.bondedWork = Object.fromEntries(Object.entries(o.bondedWork ?? {}).map(([t, n]) => [String(idOf(t)), n]));
  raw.pop = 300;
  raw.version = 23;
  return { json: JSON.stringify(raw), idOf };
}

const load = (o: OldParty): GameState => {
  const s = deserialize(oldSave(o).json);
  expect(s, 'запись 23-й версии читается').not.toBeNull();
  return s!;
};

describe('переход 23 → 24: уровни, рабочие, стройка', () => {
  it('уровень двора — больший из двух прежних, в обе стороны; ушедших построек нет, прочие не тронуты', () => {
    const s = load({ levels: { farm: 3, pen: 5, hunter_hut: 4, gathering: 2, mine: 1, quarry: 6, sawmill: 7, houses: 4 } });
    expect(s.version).toBe(24);
    expect(buildingOfType(s, 'farm')!.level, 'загон выше поля').toBe(5);
    expect(buildingOfType(s, 'hunter_hut')!.level, 'домик выше навеса').toBe(4);
    expect(buildingOfType(s, 'mine')!.level, 'каменоломня выше рудника').toBe(6);
    expect(buildingOfType(s, 'sawmill')!.level).toBe(7);
    expect(buildingOfType(s, 'houses')!.level).toBe(4);
    for (const gone of Object.keys(MERGED_INTO)) expect(s.buildings.some((b) => (b.type as string) === gone), gone).toBe(false);
    expect(s.buildings).toHaveLength(BUILDINGS.length);
    expect(new Set(s.buildings.map((b) => b.id)).size, 'номера построек не повторяются').toBe(BUILDINGS.length);
  });

  it('рабочие и невольники — на своих делах; места двора не меньше прежних, и никто не потерян', () => {
    const s = load({
      levels: { farm: 2, pen: 4, hunter_hut: 3, gathering: 1, mine: 2, quarry: 2 },
      workers: { farm: 20, pen: 30, hunter_hut: 9, gathering: 12, mine: 5, quarry: 18, smithy: 4, workshop: 6 },
      bonded: 10,
      bondedWork: { farm: 4, quarry: 6 },
    });
    expect(s.workers).toMatchObject({ farmer: 20, herder: 30, hunter: 9, gatherer: 12, miner: 5, stonecutter: 18, smith: 4, crafter: 6 });
    expect(s.bondedWork).toEqual({ farmer: 4, stonecutter: 6 });
    // Точка внутри области: у загона 30 рук на четвёртом уровне — поле второго уровня столько бы не вместило.
    expect(30).toBeGreaterThan(2 * SLOTS_PER_LEVEL);
    expect(deedSlots(buildingOfType(s, 'farm')!)).toBe(4 * SLOTS_PER_LEVEL);
  });

  it('стройка обеих частей на один уровень — одной стройкой двора: сделанное — сумма, труд — более долгой части, цена — уже оплачена', () => {
    const s = load({ levels: { farm: 3, pen: 3 }, sites: [{ type: 'pen', done: 50 }, { type: 'farm', done: 0 }] });
    const farm = buildingOfType(s, 'farm')!;
    expect(farm.level).toBe(3);
    expect(farm.work).toBe(50);
    expect(farm.workRequired, 'труд двора — работа более долгой из двух прежних (ПБ-1)').toBe(Math.max(upgradeWork(OLD.farm, 4), upgradeWork(OLD.pen, 4)));
    expect(farm.workRequired).toBe(upgradeWork(BUILDING_BY_ID.farm, 4));
    expect(s.buildQueue).toEqual([farm.id]);
    // Сделано обеими больше труда двора — стройка стоит готовой, а не сверх своего труда.
    const need = upgradeWork(BUILDING_BY_ID.farm, 4);
    const over = load({ levels: { farm: 3, pen: 3 }, sites: [{ type: 'pen', done: need - 1 }, { type: 'farm', done: need - 1 }] });
    expect(buildingOfType(over, 'farm')!.work, 'точка внутри области: сумма сделанного больше труда').toBe(need);
  });

  it('стройка, которую не на что перенести, возвращает цену прежнего здания целиком — разовым делом описи', () => {
    const before = load({ levels: { mine: 1, quarry: 6 } });
    const s = load({ levels: { mine: 1, quarry: 6 }, sites: [{ type: 'mine', done: 90 }] });
    const back = oldUpgradeCost('mine', 2);
    // Точка внутри области: рудник строился до второго, а Шахта уже шестая — переносить некуда.
    expect(buildingOfType(s, 'mine')!.level).toBe(6);
    expect(buildingOfType(s, 'mine')!.workRequired).toBe(0);
    expect(s.buildQueue).toEqual([]);
    for (const r of ['wood', 'stone'] as const) expect(s.resources[r] - before.resources[r], r).toBe(back[r]);
    expect(s.stats.windfalls - before.stats.windfalls, 'возврат — разовое дело: сервер не сочтёт его спрятанным добром').toBe(1);

    // Стройка одной части на тот же уровень, что у второй, — тоже возврат: цена двора — две цены, оплачена одна.
    const one = load({ levels: { farm: 2, pen: 2 }, sites: [{ type: 'farm', done: 10 }] });
    expect(buildingOfType(one, 'farm')!.workRequired).toBe(0);
  });

  it('партия без старых построек проходит ступень как есть: назначения по делам не теряются', () => {
    const s = createInitialState(4);
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    raw.version = 23;
    const back = deserialize(JSON.stringify(raw))!;
    expect(back.workers).toEqual(s.workers);
    expect(back.buildings.map((b) => [b.type, b.level])).toEqual(s.buildings.map((b) => [b.type, b.level]));
  });
});

describe('цена и добыча — бит в бит прежние у того, кто качал оба вровень', () => {
  it('цена и возврат отмены двора на каждом уровне — сумма двух прежних, труд — больший из двух (ПБ-1), каждое своим округлением', () => {
    let differs = 0;
    for (const [kept, gone] of PAIRS) {
      for (let level = 2; level <= MAX_BUILDING_LEVEL; level++) {
        const def = BUILDING_BY_ID[kept];
        const a = upgradeCost(OLD[kept], level);
        const b = upgradeCost(OLD[gone], level);
        const sum = Object.fromEntries(RESOURCE_IDS.filter((r) => (a[r] ?? 0) + (b[r] ?? 0) > 0).map((r) => [r, (a[r] ?? 0) + (b[r] ?? 0)]));
        expect(upgradeCost(def, level), `${kept} ${level}`).toEqual(sum);
        expect(upgradeWork(def, level), `${kept} ${level}: труд — более долгой части`).toBe(Math.max(upgradeWork(OLD[kept], level), upgradeWork(OLD[gone], level)));
        for (const started of [false, true]) {
          const ra = cancelRefund(OLD[kept], level, started);
          const rb = cancelRefund(OLD[gone], level, started);
          for (const r of RESOURCE_IDS) expect(cancelRefund(def, level, started)[r] ?? 0, `${kept} ${level} ${r}`).toBe((ra[r] ?? 0) + (rb[r] ?? 0));
        }
        // Граница области: правило «по делам» спрашивается там, где округление суммы баз дало бы другое число.
        const base = { cost: def.cost, work: def.work };
        if (JSON.stringify(upgradeCost(base, level)) !== JSON.stringify(sum)) differs++;
        // Труд — больший, а не сумма: точка внутри области — обе части трудятся, сумма строго больше большей.
        expect(Math.min(upgradeWork(OLD[kept], level), upgradeWork(OLD[gone], level)), `${kept} ${level}: обе части трудятся`).toBeGreaterThan(0);
        expect(upgradeWork(def, level)).toBeLessThan(upgradeWork(OLD[kept], level) + upgradeWork(OLD[gone], level));
      }
    }
    expect(differs, 'точки внутри области: сумма баз округлилась бы иначе').toBeGreaterThan(0);
  });

  it('места и выработка дела — как у прежнего здания того же уровня', () => {
    for (const y of YARDS) {
      for (let level = 1; level <= MAX_BUILDING_LEVEL; level++) {
        const s = createInitialState(5);
        s.pop = 2000;
        s.workers = {};
        const b = buildingOfType(s, y.building)!;
        b.level = level;
        expect(deedSlots(b), `${y.job} ${level}: места`).toBe(level * SLOTS_PER_LEVEL);
        expect(assignWorker(s, b.id, 7, y.job)).toBeNull();
        const made = deedProduction(s, b, y.job);
        // Уровень двора двигает влияние крестьянства (РТ-2): его множитель дворов — тот же, что кладёт добро.
        const mult = workerMultiplier(s, y.job, b) * peasantsMult(s);
        for (const r of RESOURCE_IDS) expect(made[r], `${y.job} ${level} ${r}`).toBeCloseTo(7 * (y.yield[r] ?? 0) * mult, 9);
        // Соседнее дело того же двора от этих рук не работает.
        for (const other of jobsOf(y.building).filter((j) => j !== y.job)) {
          expect(RESOURCE_IDS.every((r) => deedProduction(s, b, other)[r] === 0), `${other}: чужие руки`).toBe(true);
        }
      }
    }
  });

  it('выход всего посёлка — сумма дел: два дела двора дают ровно столько, сколько два прежних здания', () => {
    const s = createInitialState(6);
    s.pop = 500;
    s.workers = { farmer: 20, herder: 15, hunter: 8, gatherer: 9, miner: 6, stonecutter: 11, woodcutter: 10 };
    const all = productionPerDay(s);
    const each = Object.fromEntries(RESOURCE_IDS.map((r) => [r, 0])) as Record<ResourceId, number>;
    for (const y of YARDS) {
      const made = deedProduction(s, buildingOfType(s, y.building)!, y.job);
      for (const r of RESOURCE_IDS) each[r] += made[r];
    }
    for (const r of RESOURCE_IDS) expect(all[r], r).toBeCloseTo(each[r], 9);
  });
});

describe('потолок выработки сервера (правило «prod») знает дела', () => {
  it('честный посёлок — все дела полны, лучшие множители — не выше потолка мест; каждое дело двора в потолке своё', () => {
    for (const level of [1, 4, MAX_BUILDING_LEVEL]) {
      const s = createInitialState(8);
      for (const b of s.buildings) b.level = Math.min(level, BUILDING_BY_ID[b.type].maxLevel ?? MAX_BUILDING_LEVEL);
      s.morale = 100;
      s.decree = 'order';
      s.workers = {};
      s.freeJobs = {};
      s.pop = 5000;
      for (const y of YARDS) s.workers[y.job] = deedSlots(buildingOfType(s, y.building)!);
      const made = productionPerDay(s);
      // Вольного сбора нет — потолок без него (`pop` = 0): он держит только места дел.
      const ceil = prodCeil(levelsOf(s), 0);
      // Точка внутри области: второе дело двора работает — загон Фермы кормит, каменотёсы Шахты дают камень.
      expect(deedProduction(s, buildingOfType(s, 'farm')!, 'herder').food, `${level}: загон`).toBeGreaterThan(0);
      expect(deedProduction(s, buildingOfType(s, 'mine')!, 'stonecutter').stone, `${level}: камень`).toBeGreaterThan(0);
      for (const r of RESOURCE_IDS) expect(made[r], `${level} ${r}`).toBeLessThanOrEqual(ceil[r] + 1e-6);
    }
  });
});

describe('сервер и мир — той же дверью', () => {
  it('уровни: двор — больший из двух; без ушедших — тот же объект', () => {
    expect(foldLevels({ farm: 2, pen: 7, mine: 3 })).toEqual({ farm: 7, mine: 3 });
    expect(foldLevels({ gathering: 4 })).toEqual({ hunter_hut: 4 });
    const plain = { farm: 2, houses: 3 };
    expect(foldTown({ levels: plain })).toEqual({ levels: plain });
  });

  it('очередь: обе части на один уровень — одна стройка на месте первой; одна часть — возврат; чужая стройка — как есть', () => {
    const levels = { farm: 2, pen: 2, mine: 3, quarry: 1, houses: 1 };
    const out = foldSites(levels, [
      { type: 'houses', level: 2, done: 5 },
      { type: 'pen', level: 3, done: 7 },
      { type: 'quarry', level: 2, done: 0 },
      { type: 'farm', level: 3, done: 3 },
    ]);
    expect(out.sites).toEqual([
      { type: 'houses', level: 2, done: 5 },
      { type: 'farm', level: 3, done: 10 },
    ]);
    expect(out.refunds).toEqual([{ type: 'quarry', level: 2, done: 0 }]);
  });

  it('прежний тип в донесении, вести и выстреле — его двор; незнакомый — ничей', () => {
    expect(keptType('pen')).toBe('farm');
    expect(keptType('gathering')).toBe('hunter_hut');
    expect(keptType('quarry')).toBe('mine');
    expect(keptType('smithy')).toBe('smithy');
    expect(keptType('toString')).toBeNull();
    expect(keptType('nope')).toBeNull();
  });
});

describe('ни задания, ни обучение, ни промыслы не ссылаются на ушедшие здания', () => {
  const gone = Object.keys(MERGED_INTO);
  const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  it('данные: цель обучения — постройка игры, промысел — дело двора', () => {
    for (const step of TUTORIAL) {
      if (step.target.kind === 'building') expect(step.target.type in BUILDING_BY_ID, step.id).toBe(true);
      if (step.target.kind === 'dom') {
        const m = /data-tut="(?:list|upgrade)-([a-z_]+)"/.exec(step.target.sel);
        if (m) expect(m[1] in BUILDING_BY_ID, `${step.id}: ${m[1]}`).toBe(true);
      }
    }
    for (const g of MINIGAMES) expect(YARD_BY_JOB.has(g.deed), g.id).toBe(true);
    expect(QUESTS.length).toBeGreaterThan(0);
  });

  it('исходники заданий, обучения, задания дня и подсказок — без прежних типов и прежних имён', () => {
    const files = ['data/quests.ts', 'data/tutorial.ts', 'data/daily.ts', 'data/hints.ts', 'sim/hints.ts', 'sim/daily.ts', 'data/survey.ts'];
    for (const f of files) {
      const src = strip(readFileSync(join(__dirname, f), 'utf8'));
      for (const t of gone) expect(src, `${f}: '${t}'`).not.toMatch(new RegExp(`['"\`]${t}['"\`]`));
      expect(src, `${f}: прежнее имя`).not.toMatch(/Навес собирателей|Каменоломн|Охотничий домик|Рудник\b/);
    }
  });
});
