import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { buildQueue, buildingOfType, currentSite, isSite, queuePlace, storageCap, upgradeCost, upgradeInfo } from '../derived';
import { BUILD_QUEUE_MAX, RESOURCE_IDS } from '../constants';
import { BUILDING_BY_ID } from '../data/buildings';
import { cancelRefund } from '../labour';
import type { BuildingTypeId, GameState } from '../types';
import { cancelUpgrade, moveBlock, moveUpgrade, startUpgrade } from './actions';
import { rushFree, rushQueued } from './rush';
import { tick } from './tick';
import { deserialize, serialize } from '../save';

/**
 * Очередь стройки (СТ-1, docs/ui_v2.md, «Решения СТ-1»): строится первое, остальные ждут оплаченными; порядок — кнопками
 * «выше / ниже», первое место меняется, пока строящееся не начато; отмена начатого — половина цены, ждущего — вся; старая
 * партия открывается той же очередью, текущая стройка — первой.
 */

/** Посёлок с запасом на несколько улучшений: склад на девять десятых, чтобы возврат не упирался в вместимость. */
function town(): GameState {
  const s = createInitialState();
  for (const r of RESOURCE_IDS) s.resources[r] = Math.floor(storageCap(s) * 0.9);
  return s;
}

const TYPES: BuildingTypeId[] = ['houses', 'barracks', 'market', 'storage', 'smithy', 'watch'];
const bld = (s: GameState, t: BuildingTypeId) => buildingOfType(s, t)!;
const ids = (s: GameState): number[] => buildQueue(s).map((b) => b.id);
/** Сдвинуть время партии на `sec` игровых секунд шагами по секунде — так идёт живая партия. */
const run = (s: GameState, sec: number): void => {
  for (let i = 0; i < sec; i++) tick(s, 1);
};

describe('очередь стройки: строится первое, остальные ждут', () => {
  it('работа ложится только на первое; достроилось — начинает следующее по порядку', () => {
    const s = town();
    for (const t of TYPES.slice(0, 3)) expect(startUpgrade(s, bld(s, t).id), t).toBeNull();
    expect(ids(s)).toEqual(TYPES.slice(0, 3).map((t) => bld(s, t).id));
    expect(TYPES.slice(0, 3).map((t) => queuePlace(s, bld(s, t)))).toEqual([1, 2, 3]);
    run(s, 30);
    const [a, b, c] = TYPES.slice(0, 3).map((t) => bld(s, t));
    expect(a.work, 'точка внутри правила: стройка идёт').toBeGreaterThan(0);
    expect(b.work).toBe(0);
    expect(c.work).toBe(0);
    // Первое на пороге: следующий шаг достроит его, и работа пойдёт на второе.
    a.work = a.workRequired - 1e-6;
    run(s, 2);
    expect(a.level).toBe(2);
    expect(isSite(a)).toBe(false);
    expect(currentSite(s)?.id).toBe(b.id);
    expect(b.work).toBeGreaterThan(0);
    expect(c.work).toBe(0);
    expect(ids(s)).toEqual([b.id, c.id]);
  });

  it('длина очереди — не больше BUILD_QUEUE_MAX: шестое улучшение гаснет с причиной и не списывает цену', () => {
    const s = town();
    for (const r of RESOURCE_IDS) s.resources[r] = storageCap(s);
    for (const t of TYPES.slice(0, BUILD_QUEUE_MAX)) expect(startUpgrade(s, bld(s, t).id), t).toBeNull();
    const extra = bld(s, TYPES[BUILD_QUEUE_MAX]);
    const before = { ...s.resources };
    expect(upgradeInfo(s, extra).affordable, 'точка внутри правила: шестое по карману').toBe(true);
    expect(startUpgrade(s, extra.id)).toMatch(/Очередь стройки полна/);
    expect(s.resources).toEqual(before);
    expect(buildQueue(s)).toHaveLength(BUILD_QUEUE_MAX);
  });
});

describe('смена мест: «выше» и «ниже»', () => {
  it('ждущие меняются местами; первое — пока строящееся не начато', () => {
    const s = town();
    for (const t of TYPES.slice(0, 3)) startUpgrade(s, bld(s, t).id);
    const [a, b, c] = TYPES.slice(0, 3).map((t) => bld(s, t));
    expect(moveUpgrade(s, c.id, -1)).toBeNull();
    expect(ids(s)).toEqual([a.id, c.id, b.id]);
    expect(moveBlock(s, b.id, 1)).toBe('Уже последнее.');
    expect(moveBlock(s, a.id, -1)).toBe('Уже первое.');
    // Не начато — второе встаёт первым.
    expect(a.work).toBe(0);
    expect(moveUpgrade(s, c.id, -1)).toBeNull();
    expect(ids(s)).toEqual([c.id, a.id, b.id]);
    // Началось — первое место не меняется ни сверху, ни снизу; ждущие за ним — по-прежнему.
    run(s, 5);
    expect(c.work, 'точка внутри правила: строящееся начато').toBeGreaterThan(0);
    expect(moveUpgrade(s, a.id, -1)).toBe('Строящееся уже начато.');
    expect(moveUpgrade(s, c.id, 1)).toBe('Строящееся уже начато.');
    expect(moveUpgrade(s, b.id, -1)).toBeNull();
    expect(ids(s)).toEqual([c.id, b.id, a.id]);
  });
});

describe('отмена: начатое — половина цены, ждущее — вся', () => {
  it('возврат — ровно `labour.cancelRefund`, а цена списана при постановке', () => {
    const s = town();
    const a = bld(s, 'houses');
    const b = bld(s, 'barracks');
    const start = { ...s.resources };
    startUpgrade(s, a.id);
    startUpgrade(s, b.id);
    const costB = upgradeCost(BUILDING_BY_ID.barracks, 2);
    for (const r of RESOURCE_IDS) expect(s.resources[r], r).toBe(start[r] - (upgradeCost(BUILDING_BY_ID.houses, 2)[r] ?? 0) - (costB[r] ?? 0));
    run(s, 5);
    expect(a.work, 'точка внутри правила: первое начато').toBeGreaterThan(0);
    expect(b.work, 'точка внутри правила: второе ждёт').toBe(0);

    const r0 = { ...s.resources };
    expect(cancelUpgrade(s, b.id)).toBeNull();
    const full = cancelRefund(BUILDING_BY_ID.barracks, 2, false);
    for (const r of RESOURCE_IDS) expect(s.resources[r] - r0[r], `ждущее: ${r}`).toBeCloseTo(full[r] ?? 0, 6);
    expect(full).toEqual(costB);

    const r1 = { ...s.resources };
    expect(cancelUpgrade(s, a.id)).toBeNull();
    const half = cancelRefund(BUILDING_BY_ID.houses, 2, true);
    for (const r of RESOURCE_IDS) expect(s.resources[r] - r1[r], `начатое: ${r}`).toBeCloseTo(half[r] ?? 0, 6);
    for (const [r, v] of Object.entries(upgradeCost(BUILDING_BY_ID.houses, 2))) expect(half[r as keyof typeof half] ?? 0, r).toBe(Math.floor(v * 0.5));
    expect(buildQueue(s)).toEqual([]);
  });

  it('возврат отмены не разовое дело описи: его объясняет очередь, сервер сверяет его сам', () => {
    const s = town();
    const a = bld(s, 'houses');
    startUpgrade(s, a.id);
    const windfalls = s.stats.windfalls ?? 0;
    cancelUpgrade(s, a.id);
    expect(s.stats.windfalls ?? 0).toBe(windfalls);
  });
});

describe('ускорение — только строящееся', () => {
  it('ждущее не ускоряется даже даром', () => {
    const s = town();
    const a = bld(s, 'houses');
    const b = bld(s, 'barracks');
    startUpgrade(s, a.id);
    startUpgrade(s, b.id);
    // Ждущее на пороге — даровые минуты были бы, но оно не строится.
    b.workRequired = 1;
    expect(rushQueued(s, b)).toMatch(/только строящееся/);
    expect(rushFree(s, b.id)).toMatch(/только строящееся/);
    expect(b.level).toBe(1);
    expect(rushQueued(s, a)).toBeNull();
  });
});

describe('старое сохранение открывается', () => {
  it('без поля очереди: стройки — порядком построек, начатая — первой', () => {
    const s = town();
    const a = bld(s, 'houses');
    const b = bld(s, 'barracks');
    // Как вела бы старая партия: две стройки, работа — на той, что ниже в списке построек (её заложили первой).
    a.workRequired = upgradeCost(BUILDING_BY_ID.houses, 2).wood ?? 100;
    b.workRequired = 500;
    b.work = 120;
    expect(s.buildings.indexOf(a), 'точка внутри правила: начатая не первая в списке').toBeLessThan(s.buildings.indexOf(b));
    const json = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete json.buildQueue;
    const back = deserialize(JSON.stringify(json))!;
    expect(back).not.toBeNull();
    expect(back.buildQueue).toEqual([]);
    expect(currentSite(back)?.type).toBe('barracks');
    expect(buildQueue(back).map((x) => x.type)).toEqual(['barracks', 'houses']);
    // Ход идёт дальше той же стройкой, а постановка пишет порядок.
    expect(startUpgrade(back, buildingOfType(back, 'market')!.id)).toBeNull();
    expect(back.buildQueue.map((id) => back.buildings.find((x) => x.id === id)!.type)).toEqual(['barracks', 'houses', 'market']);
  });

  it('с полем очереди — порядок как записан', () => {
    const s = town();
    for (const t of TYPES.slice(0, 3)) startUpgrade(s, bld(s, t).id);
    moveUpgrade(s, bld(s, 'market').id, -1);
    moveUpgrade(s, bld(s, 'market').id, -1);
    const back = deserialize(serialize(s))!;
    expect(buildQueue(back).map((x) => x.type)).toEqual(['market', 'houses', 'barracks']);
  });
});
