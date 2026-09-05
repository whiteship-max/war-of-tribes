import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { buildRate, buildingOfType, isSite, townHallBuildMult, upgradeInfo } from '../derived';
import { RESOURCE_IDS, TEST_GEMS } from '../constants';
import { startUpgrade } from './actions';
import { creditGems, gemsOf, rushPrice, rushUpgrade } from './gems';
import { DAILY_GAMES } from '../data/daily';
import { SOCIAL_LINKS } from '../data/social';
import { dailyReward } from './daily';
import { tick } from './tick';

describe('алмазы', () => {
  it('новая партия начинается с тестового запаса, и он небольшой', () => {
    const s = createInitialState();
    expect(gemsOf(s)).toBe(TEST_GEMS);
    expect(TEST_GEMS).toBeLessThan(100);
  });

  it('цена достройки падает по мере приближения к концу стройки', () => {
    const s = createInitialState();
    const hut = buildingOfType(s, 'houses')!;
    expect(startUpgrade(s, hut.id)).toBeNull();

    const prices: number[] = [rushPrice(hut)];
    for (let i = 0; i < 4; i++) {
      // Крутим стройку, не доводя до конца: цена обязана падать шаг за шагом.
      hut.work = Math.min(hut.workRequired - 1, hut.work + hut.workRequired * 0.2);
      prices.push(rushPrice(hut));
    }
    for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeLessThanOrEqual(prices[i - 1]);
    expect(prices[prices.length - 1]).toBeLessThan(prices[0]);

    // На последних процентах достройка стоит один алмаз, а не ноль.
    hut.work = hut.workRequired - 1;
    expect(rushPrice(hut)).toBe(1);
  });

  it('цена дорогого улучшения выше, чем дешёвого: платят за время, а не за уровень', () => {
    const s = createInitialState();
    const hut = buildingOfType(s, 'houses')!;
    const market = buildingOfType(s, 'market')!;
    expect(rushPrice(market)).toBeGreaterThan(rushPrice(hut));
  });

  it('достройка списывает и алмазы, и ресурсы — время покупается, ресурсы нет', () => {
    const s = createInitialState();
    const hut = buildingOfType(s, 'houses')!;
    const cost = upgradeInfo(s, hut).cost;
    const wood = s.resources.wood;
    const stone = s.resources.stone;
    const price = rushPrice(hut);

    expect(rushUpgrade(s, hut.id)).toBeNull();

    expect(hut.level).toBe(2);
    expect(isSite(hut)).toBe(false);
    expect(gemsOf(s)).toBe(TEST_GEMS - price);
    expect(s.resources.wood).toBeCloseTo(wood - (cost.wood ?? 0), 5);
    expect(s.resources.stone).toBeCloseTo(stone - (cost.stone ?? 0), 5);
  });

  it('начатую стройку достройка вторым разом не оплачивает', () => {
    const s = createInitialState();
    const hut = buildingOfType(s, 'houses')!;
    expect(startUpgrade(s, hut.id)).toBeNull();
    const wood = s.resources.wood;

    expect(rushUpgrade(s, hut.id)).toBeNull();
    expect(hut.level).toBe(2);
    expect(s.resources.wood).toBeCloseTo(wood, 5);
  });

  it('достройка не ломает очередь: следующая стройка становится первой сама', () => {
    const s = createInitialState();
    const hut = buildingOfType(s, 'houses')!;
    const storage = buildingOfType(s, 'storage')!;
    expect(startUpgrade(s, hut.id)).toBeNull();
    expect(startUpgrade(s, storage.id)).toBeNull();
    expect(s.buildings.filter(isSite)).toHaveLength(2);

    expect(rushUpgrade(s, hut.id)).toBeNull();
    const queue = s.buildings.filter(isSite);
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(storage.id);

    // Очередь идёт дальше обычным ходом: работа копится на оставшемся заказе.
    const before = storage.work;
    tick(s, 5);
    expect(storage.work).toBeGreaterThan(before);
  });

  it('без алмазов достройки нет, и состояние не трогается', () => {
    const s = createInitialState();
    s.gems = 0;
    const hut = buildingOfType(s, 'houses')!;
    const wood = s.resources.wood;
    expect(rushUpgrade(s, hut.id)).toBe('Не хватает алмазов.');
    expect(hut.level).toBe(1);
    expect(s.resources.wood).toBe(wood);
  });

  it('нельзя достроить то, что и улучшить нельзя', () => {
    const s = createInitialState();
    const fire = buildingOfType(s, 'campfire')!;
    expect(rushUpgrade(s, fire.id)).toBe('Это здание не улучшается.');
    expect(gemsOf(s)).toBe(TEST_GEMS);
  });

  it('начисляет алмазы только расписка сервера', () => {
    const s = createInitialState();
    expect(creditGems(s, { source: 'server', amount: 60, ref: 'stars:1' })).toBeNull();
    expect(gemsOf(s)).toBe(TEST_GEMS + 60);
    // @ts-expect-error — клиентского источника не существует, и подставить его нельзя.
    expect(creditGems(s, { source: 'client', amount: 1000, ref: 'x' })).toBe('Алмазы начисляет только сервер.');
    expect(creditGems(s, { source: 'server', amount: 0, ref: 'stars:2' })).toBe('Пустое начисление.');
    expect(gemsOf(s)).toBe(TEST_GEMS + 60);
  });

  /**
   * Договор, ради которого алмазы вообще заведены отдельным модулем: начисление —
   * одно на всю игру, и заменить его на серверное должно быть делом одной функции.
   * Поэтому интерфейс и сцена не имеют права ни звать `creditGems`, ни трогать
   * поле напрямую. Проверяется чтением исходников — иначе договор держится
   * на честном слове.
   */
  it('ни интерфейс, ни сцена, ни ежедневка не умеют начислять алмазы', () => {
    const root = join(__dirname, '..', '..');
    const files: string[] = [];
    const walk = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name)) files.push(p);
      }
    };
    // Раньше обходились три дерева — ui, render, world. Этого мало: ежедневные
    // задания, социальные подписки и рефералка легли в `game/`, куда тест не
    // смотрел вовсе, а соблазн выдать алмаз «за подписку» сильнее всего именно
    // там — проверить её без сервера нечем, а выдать награду клиенту это одна
    // строка. Поэтому обходится весь `src`, кроме самого модуля алмазов: он и
    // есть единственная законная дверь.
    walk(root);
    const allowed = new Set([join(root, 'game', 'sim', 'gems.ts'), join(root, 'game', 'sim', 'gems.test.ts')]);

    /**
     * Комментарии выбрасываются: договор нарушает код, а не рассказ о нём.
     * Назвать единственную дверь начисления по имени в пояснении можно и нужно —
     * иначе следующий читатель не найдёт, где она.
     */
    const code = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

    const guilty: string[] = [];
    for (const f of files) {
      if (allowed.has(f)) continue;
      const src = code(readFileSync(f, 'utf8'));
      if (/creditGems/.test(src)) guilty.push(`${f}: creditGems`);
      // Присваивание полю — другой способ прибавить себе алмазов. Закрыты и
      // обходные написания: через строковый ключ и через Object.assign.
      if (/\.gems\s*(=[^=]|\+=|-=|\+\+|--)/.test(src)) guilty.push(`${f}: правит s.gems`);
      if (/\[\s*['"]gems['"]\s*\]\s*(=[^=]|\+=|-=)/.test(src)) guilty.push(`${f}: правит s['gems']`);
      if (/Object\.assign\([^)]*gems\s*:/.test(src)) guilty.push(`${f}: Object.assign с gems`);
    }
    expect(guilty).toEqual([]);
  });

  /**
   * Награда ежедневного задания — ресурсами, и это держится не обещанием, а
   * типом: `ResourceId` алмазов не содержит, поэтому `{ wood: 40, gems: 2 }` —
   * ошибка компиляции, а не решение баланса. Тест закрывает обход через `as`.
   */
  it('награда ежедневного задания состоит только из ресурсов', () => {
    for (const g of DAILY_GAMES) {
      for (const key of Object.keys(g.reward)) {
        expect(RESOURCE_IDS).toContain(key);
      }
    }
    const s = createInitialState();
    for (const g of DAILY_GAMES) {
      for (const key of Object.keys(dailyReward(s, g.id))) expect(RESOURCE_IDS).toContain(key);
    }
  });

  /**
   * У ссылки на подписку нет поля награды, и завести его нельзя: проверить
   * подписку без сервера нечем, а обещание задним числом стало бы долгом игры
   * перед игроком. Проверяется чтением исходника — иначе договор держится на
   * честном слове ровно до следующей правки.
   */
  it('за подписку и за приглашение ничего не начисляется', () => {
    const src = readFileSync(join(__dirname, '..', 'data', 'social.ts'), 'utf8');
    for (const link of SOCIAL_LINKS) {
      expect(Object.keys(link)).not.toContain('reward');
    }
    // Ни поля, ни начисления: в модуле не должно быть ни одного присваивания
    // ресурсов, алмазов или золота.
    expect(/reward\s*[:=]/.test(src)).toBe(false);
    expect(/(gems|gold|resources)\s*(=[^=]|\+=)/.test(src)).toBe(false);
  });
});

describe('ратуша ускоряет стройку', () => {
  it('уровень ратуши — множитель ко всей скорости стройки', () => {
    const s = createInitialState();
    const hall = buildingOfType(s, 'town_hall')!;
    expect(townHallBuildMult(s)).toBe(1);
    const base = buildRate(s);
    expect(base).toBeGreaterThan(0);

    hall.level = 10;
    const top = townHallBuildMult(s);
    expect(top).toBeGreaterThan(1.5);
    expect(buildRate(s)).toBeCloseTo(base * top, 5);
  });

  it('с высокой ратушей то же улучшение строится заметно быстрее', () => {
    const run = (hallLevel: number): number => {
      const s = createInitialState();
      buildingOfType(s, 'town_hall')!.level = hallLevel;
      const hut = buildingOfType(s, 'houses')!;
      expect(startUpgrade(s, hut.id)).toBeNull();
      let sec = 0;
      while (isSite(hut) && sec < 10000) {
        tick(s, 1);
        sec++;
      }
      return sec;
    };
    expect(run(10)).toBeLessThan(run(1));
  });
});
