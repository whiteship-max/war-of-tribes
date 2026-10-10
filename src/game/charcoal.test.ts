// Уголь вместо костей (решение владельца 10.10.2026, docs/economy.md, «Уголь вместо костей»).
//
// Пятый припас переименован везде: склад, двор, кузница, лавка, рынок, указ админа и опись. Тесты держат три обещания:
// уголь начисляется и тратится прежними дверями (выработка двора, кузница), лавка и сервер знают его под новым именем,
// а старая партия и старый мир читаются, и кости в них становятся углём один к одному.
import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, createInitialState } from './state';
import { deserialize, enter, serialize } from './save';
import { bonesToCharcoal } from './charcoal';
import { RESOURCE_IDS, RESOURCE_META } from './constants';
import { YARDS } from './data/yards';
import { EQUIPMENT_BY_ID } from './data/equipment';
import { GOODS } from './data/market';
import { SHOP_GOODS, shopPrice, GOOD_OF } from './gemrules';
import { buildingOfType, productionPerDay, selfCost } from './derived';
import { startForge } from './sim/smithy';
import { WORLD_SAVE_VERSION, parseWorldSave, createWorldSave } from '@/world/local/state';
import { GEM_GOODS, STOCK_KEYS } from '../../netlify/lib/contract';
import { parseGive, statsCsv } from '../../netlify/lib/commands';

const noBones = (json: string): void => expect(json, 'имени bones в записи нет').not.toMatch(/bones/);

describe('уголь — пятый припас', () => {
  it('припас называется углём, а костей нет нигде в словарях', () => {
    expect(RESOURCE_IDS).toContain('charcoal');
    expect(RESOURCE_IDS as readonly string[]).not.toContain('bones');
    expect(RESOURCE_META.charcoal.name).toBe('Уголь');
    expect(GOOD_OF.charcoal).toBe('угля');
  });

  it('уголь жгут лесорубы рядом с лесом, лесопилка не теряет дерева; охотник угля не даёт', () => {
    const saw = YARDS.find((y) => y.building === 'sawmill')!;
    const hunt = YARDS.find((y) => y.building === 'hunter_hut')!;
    expect(saw.yield).toEqual({ wood: 9, charcoal: 2 });
    expect(hunt.yield.charcoal ?? 0).toBe(0);
    // Двор — единственный источник угля в хозяйстве.
    expect(YARDS.filter((y) => (y.yield.charcoal ?? 0) > 0).map((y) => y.building)).toEqual(['sawmill']);
  });

  it('выработка: лесорубы кладут уголь, без них угля не прибывает', () => {
    const s = createInitialState(5);
    const saw = buildingOfType(s, 'sawmill')!;
    s.workers = {};
    s.freeJobs = {};
    expect(productionPerDay(s).charcoal, 'нет лесорубов — нет угля').toBe(0);
    s.workers[saw.id] = 6;
    s.pop += 6;
    const day = productionPerDay(s);
    expect(day.charcoal).toBeGreaterThan(0);
    // Пропорция двора: уголь к дереву — 2 к 9, какой бы ни была мораль и сезон (одна дверь `yardYield`).
    expect(day.charcoal / day.wood).toBeCloseTo(2 / 9, 9);
  });

  it('кузница тратит уголь прежней дверью: лук — дерево и уголь, списано сразу', () => {
    expect(EQUIPMENT_BY_ID.bow.cost).toEqual({ wood: 6, charcoal: 3 });
    const s = createInitialState(6);
    s.realm.tech.war = 3; // лук открыт: гейт спрашивается раньше запасов
    s.resources.charcoal = 3;
    s.resources.wood = 600;
    expect(startForge(s, 'bow', 2), 'на два лука угля не хватает').toMatch(/Не хватает/);
    expect(startForge(s, 'bow', 1)).toBeNull();
    expect(s.resources.charcoal).toBe(0);
  });

  it('лавка и рынок: уголь в продаже, цена выведена той же формулой — прежний поток, прежние цены', () => {
    expect(SHOP_GOODS).toContain('charcoal');
    // Двор первого уровня с дюжиной лесорубов даёт угля столько же, сколько охотники давали костей, — цена та же.
    expect(shopPrice('charcoal')).toBe(shopPrice('copper'));
    const good = GOODS.find((g) => g.id === 'charcoal')!;
    expect(good.name).toBe('Уголь');
    expect(good.price).toBeGreaterThan(selfCost(good));
  });

  it('сервер знает уголь: склад описи, лавка алмазов, указ /give и выгрузка /stats', () => {
    expect(STOCK_KEYS as readonly string[]).toContain('charcoal');
    expect(GEM_GOODS as readonly string[]).toContain('charcoal');
    for (const word of ['уголь', 'угля', 'угли', 'charcoal']) {
      expect(parseGive(['7001', word, '50']), word).toEqual({ who: '7001', stock: { charcoal: 50 }, troops: {} });
    }
    expect(parseGive(['7001', 'кости', '50'])).toMatch(/Не знаю/);
    const head = statsCsv([], { v: 1, keys: {} }).split('\r\n')[0];
    expect(head).toContain('уголь');
    expect(head).not.toContain('кости');
  });
});

describe('старые сохранения: кости становятся углём', () => {
  it('ступень обходит всё: ключи складывает, строки-имена меняет, остальное не трогает', () => {
    const v = bonesToCharcoal({ a: { bones: 3, charcoal: 2, wood: 1 }, list: ['bones', 'wood', { bones: 1 }], text: 'кости' });
    expect(v).toEqual({ a: { charcoal: 5, wood: 1 }, list: ['charcoal', 'wood', { charcoal: 1 }], text: 'кости' });
  });

  it('партия 22-й версии читается: склад, рынок, караван и трофей у ворот — в угле, и игроку сказано', () => {
    const s = createInitialState(9);
    const old = JSON.parse(serialize(s)) as Record<string, unknown> & { resources: Record<string, number> };
    // Граница области: ступень спрашивается только у партии младше 23-й, и в ней правда лежат кости.
    expect(SAVE_VERSION).toBe(23);
    old.version = 22;
    const { charcoal: _, ...rest } = old.resources;
    old.resources = { ...rest, bones: 77 };
    old.market = { day: 3, bought: { bones: 12, wood: 5 }, sold: {} };
    old.caravans = [{ id: 900, good: 'bones', count: 40, gold: 160, departAt: 0, arriveAt: 999 }];
    old.gate = [{ id: 'g1', foe: 'wolves', power: 10, seed: 1, spoils: { hides: 4, bones: 4 } }];
    expect(JSON.stringify(old)).toMatch(/bones/);

    const got = deserialize(JSON.stringify(old))!;
    expect(got, 'партия читается').not.toBeNull();
    expect(got.resources.charcoal, 'кости один к одному, а не стартовый уголь').toBe(77);
    expect(got.market.bought).toEqual({ charcoal: 12, wood: 5 });
    expect(got.caravans[0].good).toBe('charcoal');
    expect(got.gate[0].spoils).toEqual({ hides: 4, charcoal: 4 });
    noBones(serialize(got));

    enter(got, got.lastSaved);
    expect(got.log.some((e) => /Кости на складе пошли в уголь/.test(e.text)), 'строка в летописи').toBe(true);
  });

  it('партия текущей версии ступени не проходит и строки не получает', () => {
    const s = createInitialState(10);
    s.resources.charcoal = 33;
    const got = deserialize(serialize(s))!;
    expect(got.resources.charcoal).toBe(33);
    enter(got, got.lastSaved);
    expect(got.log.some((e) => /пошли в уголь/.test(e.text))).toBe(false);
  });

  it('мир 9-й версии читается: добыча и склады в угле, версия поднята', () => {
    const fresh = createWorldSave(7, { x: 10, y: 10 }, null, 0);
    expect(WORLD_SAVE_VERSION).toBe(10);
    const old = { ...JSON.parse(JSON.stringify(fresh)), v: 9, effects: [{ id: 'e', lost: {}, resources: { bones: 9 }, prestige: 0, morale: 0, battle: null, text: '', good: true }] };
    const got = parseWorldSave(JSON.stringify(old))!;
    expect(got).not.toBeNull();
    expect(got.v).toBe(10);
    expect(got.effects[0].resources).toEqual({ charcoal: 9 });
    noBones(JSON.stringify(got));
  });
});
