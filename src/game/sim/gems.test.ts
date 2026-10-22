import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import {
  buildRate,
  buildingOfType,
  crafterBuildRate,
  crafterBuildShare,
  isSite,
  seasonMods,
  storageCap,
  townHallBuildMult,
  buildBoost,
} from '../derived';
import { BUILDER_RATE, RESOURCE_IDS } from '../constants';
import { startUpgrade } from './actions';
import {
  GEM_REF_RATE,
  RUSH_FREE_SECONDS,
  SHOP_LOT,
  applyGemDeeds,
  gemSeen,
  rushBlocked,
  rushFree,
  rushLeft,
  rushPrice,
  rushWork,
  shopBlocked,
  shopPrice,
} from './gems';
import { gemsForWait, rushPriceOfWork } from '../gemrules';
import { gameSeconds, realSeconds, setTimeScale, timeScale } from '../pace';
import type { GemEntry } from '../../../netlify/lib/contract';
import { DAILY_GAMES } from '../data/daily';
import { SOCIAL_LINKS } from '../data/social';
import { dailyReward } from './daily';
import { tick } from './tick';
import { deserialize, enter, serialize, loadFold } from '../save';
import { SAVE_VERSION } from '../state';

// Партии младше 24-й читаются дверью перехода ЗД-1 — своей докачкой, как её подгружает вход (`save.loadFold`).
beforeAll(() => loadFold());

/**
 * Алмазы в партии (docs/gems.md). Баланс и журнал — на сервере (`netlify/lib/gems.test.ts` держит начисление, повтор
 * ключа, лимит лавки и гонки). Здесь — то, что партия делает сама: цена ускорения, которую показывает кнопка, и дела с
 * сервера, которые ложатся ровно один раз и не переполняют склад; и замок: клиент не умеет начислять алмазы вовсе.
 */

/** Начатая стройка Жилищ с остатком на столько настоящих секунд нормативного ожидания. */
function siteLeft(seconds: number) {
  const s = createInitialState();
  const hut = buildingOfType(s, 'houses')!;
  expect(startUpgrade(s, hut.id)).toBeNull();
  hut.workRequired = Math.max(hut.workRequired, gameSeconds(seconds) * GEM_REF_RATE + 1);
  hut.work = hut.workRequired - gameSeconds(seconds) * GEM_REF_RATE;
  return { s, hut };
}

const deed = (n: number, over: Partial<GemEntry>): GemEntry => ({ n, at: 0, delta: -10, kind: 'buy', ...over });

describe('ускорение: цена от оставшегося времени', () => {
  it('чем меньше осталось, тем дешевле, — и падает шаг за шагом по ходу стройки', () => {
    const s = createInitialState();
    for (const r of RESOURCE_IDS) s.resources[r] = 1e6;
    const market = buildingOfType(s, 'market')!;
    expect(startUpgrade(s, market.id)).toBeNull();
    const prices: number[] = [rushPrice(market)];
    for (let i = 0; i < 4; i++) {
      market.work = Math.min(market.workRequired - 1, market.work + market.workRequired * 0.2);
      prices.push(rushPrice(market));
    }
    expect(prices[0], 'точка внутри области: целая стройка дороже даровых минут').toBeGreaterThan(0);
    for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeLessThanOrEqual(prices[i - 1]);
    expect(prices[prices.length - 1]).toBeLessThan(prices[0]);
  });

  /** Граница области — ровно пять минут. Точка у границы с каждой стороны проверена утверждением. */
  it('последние пять минут — даром, и даром ускоряется без связи', () => {
    const at = siteLeft(RUSH_FREE_SECONDS);
    expect(rushLeft(at.hut), 'ровно пять минут').toBeCloseTo(RUSH_FREE_SECONDS, 6);
    expect(rushPrice(at.hut)).toBe(0);
    expect(rushBlocked(at.hut, null, 'нет связи'), 'даром — без связи и без баланса').toBeNull();
    const level = at.hut.level;
    expect(rushFree(at.s, at.hut.id)).toBeNull();
    expect(at.hut.level).toBe(level + 1);
    expect(isSite(at.hut)).toBe(false);

    const over = siteLeft(RUSH_FREE_SECONDS + 60);
    expect(rushLeft(over.hut)).toBeGreaterThan(RUSH_FREE_SECONDS);
    expect(rushPrice(over.hut), 'минута сверх даровых — алмаз').toBe(1);
    expect(rushFree(over.s, over.hut.id)).toBe('Даром ускоряются только последние пять минут.');
  });

  it('за алмазы — только по связи и при балансе; нетронутое здание не ускоряется', () => {
    const { hut } = siteLeft(3 * 3600);
    const price = rushPrice(hut);
    expect(price).toBeGreaterThan(1);
    expect(rushBlocked(hut, price, null)).toBeNull();
    expect(rushBlocked(hut, price - 1, null)).toBe('Не хватает алмазов.');
    expect(rushBlocked(hut, 10_000, 'Нет связи.')).toBe('Нет связи.');
    expect(rushBlocked(hut, null, null)).toMatch(/^Нет связи/);
    const fresh = buildingOfType(createInitialState(), 'market')!;
    expect(rushWork(fresh)).toBe(0);
    expect(rushBlocked(fresh, 10_000, null)).toBe('Здесь ничего не строится.');
  });

  it('кнопка показывает ту же цену, что спишет сервер: одна функция от остатка работы', () => {
    const { hut } = siteLeft(2 * 3600);
    expect(rushPrice(hut)).toBe(rushPriceOfWork(rushWork(hut)));
    expect(rushPrice(hut)).toBe(gemsForWait(rushLeft(hut) - RUSH_FREE_SECONDS));
  });
});

// Алмаз покупает время игрока, а время игрока — настоящее (решение владельца, docs/time.md, раздел 16): цена — функция
// настоящего ожидания, а не игровых секунд. При шкале 1 игровые и настоящие совпадают, и тест был бы зелёным даром
// (правило 11): свойство снято при шкалах, отличных от единицы.
describe('цена ускорения — от настоящего ожидания, а не от игровых секунд', () => {
  afterEach(() => setTimeScale());

  it('то же настоящее ожидание стоит одинаково при любой шкале', () => {
    const prices: number[] = [];
    for (const k of [2, 30]) {
      setTimeScale(k);
      expect(timeScale(), 'точка внутри области: шкала отлична от единицы').toBe(k);
      const { hut } = siteLeft(6 * 3600);
      expect(rushLeft(hut)).toBeCloseTo(6 * 3600, 3);
      prices.push(rushPrice(hut));
    }
    expect(prices[0], 'точка внутри области: цена выше пола').toBeGreaterThan(20);
    expect(prices[1]).toBe(prices[0]);
  });

  it('тот же труд при ×30 ждёт в тридцать раз дольше — и стоит по кривой этого ожидания', () => {
    const work = 5000;
    setTimeScale(1);
    const fast = realSeconds(work / GEM_REF_RATE);
    setTimeScale(30);
    expect(realSeconds(work / GEM_REF_RATE)).toBeCloseTo(fast * 30, 6);
    expect(rushPriceOfWork(work)).toBe(gemsForWait(fast * 30 - RUSH_FREE_SECONDS));
  });
});

describe('дела с сервера ложатся ровно один раз', () => {
  it('лавка: тот же номер дважды — припас один раз; старший номер — ещё раз', () => {
    const s = createInitialState();
    s.resources.stone = 0;
    const d1 = deed(3, { res: 'stone', amount: SHOP_LOT });
    expect(applyGemDeeds(s, [d1])).toBe(1);
    expect(applyGemDeeds(s, [d1])).toBe(0);
    expect(s.resources.stone).toBe(SHOP_LOT);
    expect(gemSeen(s)).toBe(3);
    // Младший номер, приехавший позже (другое устройство, старый ответ), — не ложится.
    expect(applyGemDeeds(s, [deed(2, { res: 'stone', amount: SHOP_LOT })])).toBe(0);
    expect(applyGemDeeds(s, [deed(5, { res: 'stone', amount: SHOP_LOT }), d1])).toBe(1);
    expect(s.resources.stone).toBe(2 * SHOP_LOT);
  });

  it('склад не переполняется: сверх вместимости лавка не кладёт', () => {
    const s = createInitialState();
    const cap = storageCap(s);
    s.resources.wood = cap - 30;
    expect(applyGemDeeds(s, [deed(1, { res: 'wood', amount: SHOP_LOT })])).toBe(1);
    expect(s.resources.wood).toBe(cap);
    expect(s.log.some((l) => l.text.includes('остальное склад не вместил'))).toBe(true);
    // Лежащее сверх вместимости (склад потерял уровень) прибавка не отнимает.
    s.resources.wood = cap + 50;
    applyGemDeeds(s, [deed(2, { res: 'wood', amount: SHOP_LOT })]);
    expect(s.resources.wood).toBe(cap + 50);
  });

  it('ускорение достраивает идущую стройку этого уровня — и только её', () => {
    const { s, hut } = siteLeft(3600);
    const level = hut.level;
    applyGemDeeds(s, [deed(1, { kind: 'rush', building: 'houses', level: level + 1, delta: -20 })]);
    expect(hut.level).toBe(level + 1);
    expect(isSite(hut)).toBe(false);
    // Тот же номер второй раз и стройка, которой уже нет, — ничего не трогают.
    applyGemDeeds(s, [deed(1, { kind: 'rush', building: 'houses', level: level + 1 })]);
    applyGemDeeds(s, [deed(2, { kind: 'rush', building: 'houses', level: level + 2 })]);
    expect(hut.level).toBe(level + 1);
    expect(gemSeen(s)).toBe(2);
  });

  it('дело не трогает ни золота, ни войска, ни ресурсов сверх названного', () => {
    const s = createInitialState();
    const before = JSON.stringify({ gold: s.gold, army: s.army, r: RESOURCE_IDS.filter((r) => r !== 'iron').map((r) => s.resources[r]) });
    applyGemDeeds(s, [deed(1, { res: 'iron', amount: SHOP_LOT }), deed(2, { kind: 'start', delta: 120 }), deed(3, { kind: 'purchase', delta: 550 })]);
    expect(JSON.stringify({ gold: s.gold, army: s.army, r: RESOURCE_IDS.filter((r) => r !== 'iron').map((r) => s.resources[r]) })).toBe(before);
    expect(Object.keys(s)).not.toContain('gems');
  });
});

describe('лавка: что покупать нельзя', () => {
  it('полный склад, осада, нет связи, кончился лимит, мало алмазов — отказ словами', () => {
    const s = createInitialState();
    const price = shopPrice('stone');
    s.resources.stone = 0;
    expect(shopBlocked(s, 'stone', price, price, 1, null)).toBeNull();
    s.resources.stone = storageCap(s) - SHOP_LOT + 1;
    expect(shopBlocked(s, 'stone', price, price, 1, null)).toMatch(/^Склад полон/);
    s.resources.stone = 0;
    expect(shopBlocked(s, 'stone', price, null, 1, null)).toMatch(/^Нет связи/);
    expect(shopBlocked(s, 'stone', price, price, 0, null)).toBe('На сегодня покупки кончились.');
    expect(shopBlocked(s, 'stone', price, price - 1, 1, null)).toBe('Не хватает алмазов.');
  });
});

describe('клиент не умеет начислять алмазы', () => {
  /**
   * Договор, ради которого алмазы когда-то завели отдельным модулем, теперь держится устройством: в партии алмазов нет,
   * баланс — последнее слово сервера (`net/gems.takeGems`), начисление одно — на сервере (`netlify/lib/gems.creditGems`).
   * Замок читает исходники всего `src` и валится на любом из естественных написаний, которыми алмаз завели бы обратно:
   * поле в партии, число баланса мимо записки сервера, начисление, запись сейва мимо `save.ts`. Сам список образцов
   * проверяется тестом ниже: правило, которое ничего не ловит, хуже отсутствующего.
   */
  const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

  /** Любой оператор присваивания: `=`, `+=`, `*=`, `??=`, `||=`, `**=`, `>>>=`. */
  const ASSIGN = String.raw`(?:\*\*|\?\?|\|\||&&|<<|>>>?|[+\-*/%&|^])?=(?!=)`;
  const WRITE = String.raw`(?:\+\+|--|${ASSIGN})`;

  const GEM_WRITES: [RegExp, string][] = [
    [/creditGems/, 'зовёт creditGems'],
    [new RegExp(String.raw`\.gems\s*${WRITE}`), 'правит s.gems'],
    [/(?:\+\+|--)[\w$()[\]{}'".\s]*\.gems\b/, 'правит s.gems префиксом'],
    [new RegExp(String.raw`\[\s*(['"])gems\1\s*\]\s*${WRITE}`), "правит s['gems']"],
    [new RegExp(String.raw`(?:^|[^\w$.])s\s*\[[^\]]+\]\s*${WRITE}`), 'пишет в состояние по вычисленному ключу'],
    // Баланс — только из записки сервера: ключ `balance:` в объекте и запись в `.balance` мимо `net/gems.takeGems`.
    // Тип поля (`balance: number`) и своя переменная (`const balance = useGems(…)`) — не запись.
    [/\bbalance\s*:(?!\s*number\b)/, 'кладёт баланс алмазов'],
    [new RegExp(String.raw`\.balance\s*${WRITE}`), 'правит баланс алмазов'],
  ];
  /** Ключ `gems:` в объектном литерале — пересборка спредом, `Object.assign`, новая партия с полем алмазов. */
  const GEM_KEY: [RegExp, string] = [/(^|[^\w$.])gems\s*:/, 'кладёт gems: в объект'];
  const SAVE_KEY: [RegExp, string] = [/tribe\.save\.v1/, 'пишет сейв мимо save.ts'];

  it('образцы замка ловят то, ради чего заведены, и не ловят честный код', () => {
    const all = [...GEM_WRITES, GEM_KEY, SAVE_KEY];
    const caught = (line: string): boolean => all.some(([re]) => re.test(strip(line)));
    for (const line of [
      'creditGems(s, { source: "server", amount: 1000, ref: "x" });',
      'set({ s: { ...s, gems: 500 } });',
      'Object.assign(useGame.getState().s, { gems: 9999 });',
      'const k = "gems" as const; s[k] = 9999;',
      '++(s as any).gems;',
      's.gems = 10;',
      'useGems.setState({ balance: 9999 });',
      'useGems.getState().balance += 10;',
      'localStorage.setItem("tribe.save.v1", JSON.stringify({ ...s }));',
    ]) {
      expect([line, caught(line)]).toEqual([line, true]);
    }
    for (const line of [
      'const balance = useGems((g) => g.balance);',
      'disabled={(balance ?? 0) < price}',
      "if (balance < price) return 'Не хватает алмазов.';",
      "onClick={() => setTab('gems')}",
      's.resources[r] = Math.min(cap, s.resources[r] + n);',
    ]) {
      expect([line, caught(line)]).toEqual([line, false]);
    }
  });

  it('ни партия, ни интерфейс, ни сцена не держат и не начисляют алмазов', () => {
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
    walk(root);
    // Записку сервера читает одна дверь — она и кладёт баланс. Этот тест называет образцы.
    // Её тест кладёт записки руками — на то он и тест двери; тесты в сборку не едут.
    const door = new Set([join(root, 'net', 'gems.ts'), join(root, 'net', 'gems.test.ts'), join(root, 'game', 'sim', 'gems.test.ts')]);
    // Ключ сейва знает save.ts — и два теста: этот и подъём партии из облака Telegram (`telegram/cloud.test.ts`).
    const saveKnows = new Set([join(root, 'game', 'save.ts'), join(root, 'game', 'sim', 'gems.test.ts'), join(root, 'telegram', 'cloud.test.ts')]);
    // Ключ `gems:` — только в образцах этого теста и в старой партии, которую читает тест профиля (ступень 21 → 22 его снимает).
    const keyKnows = new Set([join(root, 'game', 'sim', 'gems.test.ts'), join(root, 'profile', 'profile.test.ts')]);
    // У викторины ежедневки своё слово `balance` — доля расхождения ответов (`daily/quiz.ts`), к алмазам не относится.
    const quiz = join(root, 'game', 'daily', 'quiz.ts');
    const guilty: string[] = [];
    for (const f of files) {
      const src = strip(readFileSync(f, 'utf8'));
      const rules: [RegExp, string][] = [];
      if (!door.has(f)) rules.push(...GEM_WRITES.filter(([, why]) => f !== quiz || why !== 'кладёт баланс алмазов'));
      if (!keyKnows.has(f)) rules.push(GEM_KEY);
      if (!saveKnows.has(f)) rules.push(SAVE_KEY);
      for (const [re, why] of rules) if (re.test(src)) guilty.push(`${f}: ${why}`);
    }
    expect(guilty).toEqual([]);
    // Поля алмазов в новой партии нет.
    expect(Object.keys(createInitialState())).not.toContain('gems');
  });

  it('в net/gems баланс кладёт только записка сервера', () => {
    const src = strip(readFileSync(join(__dirname, '..', '..', 'net', 'gems.ts'), 'utf8'));
    const writes = [...src.matchAll(/\bbalance\s*:(?!\s*number\b)\s*([^,}\n]+)/g)].map((m) => m[1].trim());
    expect(writes.sort()).toEqual(['note.balance', 'null']);
  });

  it('награда ежедневного задания состоит только из ресурсов', () => {
    for (const g of DAILY_GAMES) {
      for (const key of Object.keys(g.reward)) expect(RESOURCE_IDS).toContain(key);
    }
    const s = createInitialState();
    for (const g of DAILY_GAMES) {
      for (const key of Object.keys(dailyReward(s, g.id))) expect(RESOURCE_IDS).toContain(key);
    }
  });

  it('за подписку и за приглашение ничего не начисляется', () => {
    const src = readFileSync(join(__dirname, '..', 'data', 'social.ts'), 'utf8');
    for (const link of SOCIAL_LINKS) expect(Object.keys(link)).not.toContain('reward');
    expect(/reward\s*[:=]/.test(src)).toBe(false);
    expect(/(gems|gold|resources)\s*(=[^=]|\+=)/.test(src)).toBe(false);
  });
});

describe('ступень сохранения 21 → 22: алмазы ушли из партии', () => {
  it('число с устройства не переносится, поле снято, игроку сказано строкой', () => {
    const raw = JSON.parse(serialize(createInitialState())) as Record<string, unknown>;
    raw.version = 21;
    raw['ge' + 'ms'] = 500;
    const s = deserialize(JSON.stringify(raw));
    expect(s).not.toBeNull();
    expect(SAVE_VERSION, 'точка внутри области: ступень есть в цепочке').toBeGreaterThanOrEqual(22);
    expect(Object.keys(s!)).not.toContain('gems');
    enter(s!, s!.lastSaved);
    expect(s!.log.some((e) => e.text.includes('Сокровищниц'))).toBe(true);
    expect(Object.keys(JSON.parse(serialize(s!)))).not.toContain('gems');
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
    s.workers.crafter = 10;
    // Точка внутри области: множитель ратуши не единица, ремесленники есть.
    expect(townHallBuildMult(s)).toBeGreaterThan(1);
    expect(crafterBuildRate(s)).toBeGreaterThan(0);
    const full = buildRate(s);
    const share = crafterBuildShare(s);
    s.workers.crafter = 0;
    // Сняли ремесленников — они стали свободными руками: их простой труд вычитается отдельно.
    // Рука стройки сверх ратуши (Староста, цехи в силе — РТ-2: Мастерская третьего уровня поднимает цехи) — тем же множителем.
    const withoutShop = buildRate(s) - 10 * BUILDER_RATE * seasonMods(s).build * townHallBuildMult(s) * buildBoost(s);
    expect(full - withoutShop).toBeCloseTo(share, 6);
    expect(share).toBeGreaterThan(crafterBuildRate({ ...s, workers: { ...s.workers, [shop.id]: 10 } }));
    // Панель мастерской пишет именно эту долю, а не голую выработку ремесленников. С UI-8 строки «Что даёт городу»
    // собирает `ui/next/gives.ts` (docs/ui_v2.md, 5.7); окно постройки их только рисует.
    const panel = readFileSync(join(__dirname, '..', '..', 'ui', 'panels', 'BuildingPanel.tsx'), 'utf8');
    const gives = readFileSync(join(__dirname, '..', '..', 'ui', 'next', 'gives.ts'), 'utf8');
    expect(panel, 'BuildingPanel.tsx: голый crafterBuildRate').not.toMatch(/\bcrafterBuildRate\b/);
    expect(gives, 'gives.ts: голый crafterBuildRate').not.toMatch(/\bcrafterBuildRate\b/);
    expect(gives).toMatch(/\bcrafterBuildShare\(/);
    expect(panel, 'окно рисует строки «Что даёт городу» одной дверью').toMatch(/\bbuildingGives\(/);
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
