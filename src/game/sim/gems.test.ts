import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import {
  buildRate,
  buildingOfType,
  crafterBuildRate,
  crafterBuildShare,
  isSite,
  seasonMods,
  townHallBuildMult,
  upgradeInfo,
} from '../derived';
import { BUILDER_RATE, RESOURCE_IDS, TEST_GEMS } from '../constants';
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
   *
   * Прежний набор образцов ловил ровно четыре написания: `s.gems =`, `s.gems +=`,
   * `s['gems'] =` и `Object.assign(` с ключом в тех же скобках. Мимо него
   * проходило всё остальное — придирчивая проверка провела через замок девять
   * штук подряд, и ни одна не была экзотикой:
   *
   *   set({ s: { ...s, gems: s.gems + 500 } })      — пересборка спредом
   *   Object.assign(useGame.getState().s, { gems }) — вложенные скобки рвали [^)]*
   *   s.gems *= 10;  s.gems ||= 999;                — операторов было четыре из десяти
   *   ++(s as any).gems                             — префиксный инкремент
   *   [s.gems] = [9999]                             — деструктуризация
   *   const k = 'gems'; s[k] = 9999                 — вычисляемый ключ
   *   localStorage.setItem('tribe.save.v1', ...)    — запись мимо save.ts
   *
   * Чего замок не может и не сможет: имя поля, собранное из кусков
   * (`s['ge' + 'ms']`), и состояние под другим именем. Он стоит не от
   * злоумышленника — исходники у того и так в руках, — а от следующей правки,
   * которую напишут не задумываясь. Поэтому закрыты все естественные написания,
   * а сам список образцов проверяется тестом ниже: правило, которое ничего не
   * ловит, хуже отсутствующего.
   */
  const strip = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

  /** Любой оператор присваивания: `=`, `+=`, `*=`, `??=`, `||=`, `**=`, `>>>=`. */
  const ASSIGN = String.raw`(?:\*\*|\?\?|\|\||&&|<<|>>>?|[+\-*/%&|^])?=(?!=)`;
  /** Присваивание или инкремент — всё, чем поле можно изменить. */
  const WRITE = String.raw`(?:\+\+|--|${ASSIGN})`;

  const GEM_WRITES: [RegExp, string][] = [
    [/creditGems/, 'зовёт creditGems'],
    [new RegExp(String.raw`\.gems\s*${WRITE}`), 'правит s.gems'],
    // Префиксный инкремент, в том числе через приведение: `++(s as any).gems`.
    [/(?:\+\+|--)[\w$()[\]{}'".\s]*\.gems\b/, 'правит s.gems префиксом'],
    [new RegExp(String.raw`\[\s*(['"])gems\1\s*\]\s*${WRITE}`), "правит s['gems']"],
    // Деструктуризация: `[s.gems] = [...]`, `({ x: s.gems } = ...)`.
    [new RegExp(String.raw`[[{][^[\]{}]*\.gems[^[\]{}]*[\]}]\s*${ASSIGN}`), 'правит s.gems деструктуризацией'],
    // Вычисляемый ключ: `const k = 'gems'; s[k] = 9999`. Имени поля в такой
    // строке нет вовсе, поэтому ловится не оно, а сама форма — запись в корень
    // состояния по вычисленному ключу. Законной такой записи нет ни одной:
    // словари состояния правятся через своё поле (`s.resources[r] =`), а не
    // через корень.
    [new RegExp(String.raw`(?:^|[^\w$.])s\s*\[[^\]]+\]\s*${WRITE}`), 'пишет в состояние по вычисленному ключу'],
  ];

  /**
   * Ключ `gems:` в объектном литерале. Ловит и пересборку спредом, и
   * `Object.assign` на любой глубине скобок: и то, и другое обязано назвать поле.
   * Разрешён он ровно там, где алмазы объявлены и заданы: тип состояния, новая
   * партия и витрина наборов — ни один из этих файлов не интерфейс и не сцена.
   */
  const GEM_KEY: [RegExp, string] = [/(^|[^\w$.])gems\s*:/, 'кладёт gems: в объект'];

  /**
   * Ключ сохранения знает только `save.ts` (там же и `saveGame` для выхода
   * из игры). Второй слой, пишущий сейв своими руками, обходит и формат, и любой
   * договор о том, чего в сохранении быть не должно.
   */
  const SAVE_KEY: [RegExp, string] = [/tribe\.save\.v1/, 'пишет сейв мимо save.ts'];

  it('образцы замка ловят то, ради чего заведены, и не ловят честный код', () => {
    const all = [...GEM_WRITES, GEM_KEY, SAVE_KEY];
    const caught = (line: string): boolean => all.some(([re]) => re.test(strip(line)));

    // Девять написаний, прошедших прежний замок насквозь.
    for (const line of [
      'creditGems(s, { source: "server", amount: 1000, ref: "x" });',
      'set({ s: { ...s, gems: s.gems + 500 } });',
      'Object.assign(useGame.getState().s, { gems: 9999 });',
      'const k = "gems" as const; s[k] = 9999;',
      '++(s as any).gems;',
      's.gems *= 10;',
      's.gems ||= 999;',
      '[s.gems] = [9999];',
      'localStorage.setItem("tribe.save.v1", JSON.stringify({ ...s, gems: 9999 }));',
    ]) {
      expect([line, caught(line)]).toEqual([line, true]);
    }

    // Честное чтение через единственную дверь замок не трогает.
    for (const line of [
      'const gems = gemsOf(s);',
      'disabled={gemsOf(s) < price}',
      '<span className="count">{p.gems}</span>',
      "if (gemsOf(s) < price) return 'Не хватает алмазов.';",
      "onClick={() => setTab('gems')}",
      's.resources[r] = Math.min(cap, s.resources[r] + n);',
    ]) {
      expect([line, caught(line)]).toEqual([line, false]);
    }
  });

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
    const door = new Set([join(root, 'game', 'sim', 'gems.ts'), join(root, 'game', 'sim', 'gems.test.ts')]);
    // Где поле алмазов объявлено и задано. Присваивать в них всё равно нельзя —
    // разрешён только ключ в литерале: тип состояния, новая партия и витрина.
    const declares = new Set([
      ...door,
      join(root, 'game', 'types.ts'),
      join(root, 'game', 'state.ts'),
      join(root, 'game', 'data', 'gems.ts'),
    ]);
    // Ключ сейва знает save.ts — и два теста: этот, где ключ назван образцом
    // правила, и `telegram/cloud.test.ts`, который проверяет подъём партии из
    // облака Telegram, то есть по устройству своему обязан класть и читать
    // сохранение мимо игры. Замок от этого не слабеет: он стоит от кода,
    // который поедет игроку, а тесты не едут никуда.
    const saveKnows = new Set([
      join(root, 'game', 'save.ts'),
      join(root, 'game', 'sim', 'gems.test.ts'),
      join(root, 'telegram', 'cloud.test.ts'),
    ]);

    const guilty: string[] = [];
    for (const f of files) {
      const src = strip(readFileSync(f, 'utf8'));
      const rules: [RegExp, string][] = [];
      if (!door.has(f)) rules.push(...GEM_WRITES);
      if (!declares.has(f)) rules.push(GEM_KEY);
      if (!saveKnows.has(f)) rules.push(SAVE_KEY);
      for (const [re, why] of rules) if (re.test(src)) guilty.push(`${f}: ${why}`);
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

  it('вклад мастерской, который пишет её панель, — ровно та доля, которую она добавляет к стройке', () => {
    const s = createInitialState();
    buildingOfType(s, 'town_hall')!.level = 10;
    const shop = buildingOfType(s, 'workshop')!;
    shop.level = 3;
    s.pop = 200;
    s.workers[shop.id] = 10;
    // Точка внутри области: множитель ратуши не единица, ремесленники есть.
    expect(townHallBuildMult(s)).toBeGreaterThan(1);
    expect(crafterBuildRate(s)).toBeGreaterThan(0);
    const full = buildRate(s);
    const share = crafterBuildShare(s);
    s.workers[shop.id] = 0;
    // Сняли ремесленников — они стали свободными руками: их простой труд вычитается отдельно.
    const withoutShop = buildRate(s) - 10 * BUILDER_RATE * seasonMods(s).build * townHallBuildMult(s);
    expect(full - withoutShop).toBeCloseTo(share, 6);
    expect(share).toBeGreaterThan(crafterBuildRate({ ...s, workers: { ...s.workers, [shop.id]: 10 } }));
    // Панель мастерской пишет именно эту долю, а не голую выработку ремесленников.
    const panel = readFileSync(join(__dirname, '..', '..', 'ui', 'panels', 'BuildingPanel.tsx'), 'utf8');
    expect(panel, 'BuildingPanel.tsx: голый crafterBuildRate').not.toMatch(/\bcrafterBuildRate\b/);
    expect(panel).toMatch(/\bcrafterBuildShare\(/);
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
