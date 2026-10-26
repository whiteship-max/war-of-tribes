// Склад не выше вместимости (ECO-1 аудита; решение владельца — docs/audit/OWNER-DECISIONS.md, п. 1).
//
// Область правила — любой запас любого вида при любой вместимости: прибавка не кладёт сверх вместимости, убавка — ниже
// нуля, и то, что оказалось сверх вместимости (склад потерял уровень, старое сохранение), сгорает строкой летописи, а не
// молча. Клиент и книга запасов сервера считают склад одним правилом (`stockrules.fitStock`).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { deserialize, enter, serialize } from '../save';
import { RESOURCE_IDS, RESOURCE_META } from '../constants';
import { buildingOfType, storageCap } from '../derived';
import type { GameState, ResourceId } from '../types';
import { QUESTS } from '../data/quests';
import { addRes } from '../data/eventKit';
import { addStock } from './stock';
import { overflowOf, overflowOfAct, overflowLine } from './stockview';
import { layStock } from './admin';
import { refund } from './pay';
import { callGate, settleGate } from './gate';
import { applyExpedition, type ExpeditionOutcome } from './expedition';
import { startUpgrade, cancelUpgrade } from './actions';
import { tick } from './tick';
import { gameSeconds } from '../pace';
import { watchOf } from '@/net/snapshot';
import { goodsStep } from '../../../netlify/lib/goods';
import { flagsOf } from '../../../netlify/lib/watch';
import type { HomeEffect } from '@/world/types';

/** Посёлок со складом уровня `level`. */
function town(level = 3, seed = 7): GameState {
  const s = createInitialState(seed);
  buildingOfType(s, 'storage')!.level = level;
  return s;
}

const lines = (s: GameState): string[] => s.log.map((e) => e.text);

/** Последствие похода без боя и потерь — только то, что задано. */
const outcome = (o: Partial<ExpeditionOutcome>): ExpeditionOutcome => ({ warriorsLost: 0, scoutsLost: 0, morale: 0, resources: {}, ...o }) as ExpeditionOutcome;

/** Склад теряет уровень падением города — той дверью, что и в игре (`applyExpedition` → `fallBuildings`). */
function dropStorage(s: GameState): void {
  const b = buildingOfType(s, 'storage')!;
  applyExpedition(s, outcome({ fallen: [{ id: 'storage', from: b.level, to: b.level - 1 }] }));
}

/** Двери прибавки, которыми добро ложится на склад: каждая получает «положить `n` вида `r`». */
const DOORS: Record<string, (s: GameState, r: ResourceId, n: number) => void> = {
  'вести (eventKit.addRes)': (s, r, n) => void addRes(s, r, n),
  'указ и лавка (admin.layStock)': (s, r, n) => void layStock(s, r, n),
  'возврат цены (pay.refund)': (s, r, n) => refund(s, { [r]: n }, 1),
  'трофеи у ворот (gate.settleGate)': (s, r, n) => {
    const c = callGate(s, 'wolves', 1, { [r]: n });
    settleGate(s, { gate: c.id, battle: 'won' } as HomeEffect);
  },
  'последствие похода (expedition)': (s, r, n) => applyExpedition(s, outcome({ resources: { [r]: n } })),
};

describe('склад не выше вместимости: прибавка, убавка и лишнее', () => {
  it('прибавка любой дверью ложится до вместимости и возвращает, сколько легло; убавка — до нуля', () => {
    const s = town();
    const cap = storageCap(s);
    s.resources.wood = cap - 50;
    expect(addStock(s, 'wood', 200), 'легло — сколько влезло').toBe(50);
    expect(s.resources.wood).toBe(cap);
    // Убавка (отопление, цена вести) уменьшает запас как обычно, и до нуля, не ниже.
    expect(addStock(s, 'wood', -30)).toBe(-30);
    expect(s.resources.wood).toBe(cap - 30);
    s.resources.stone = 5;
    expect(addStock(s, 'stone', -40)).toBe(-5);
    expect(s.resources.stone).toBe(0);
    for (const [name, put] of Object.entries(DOORS)) {
      const t = town();
      t.resources.food = cap - 50;
      put(t, 'food', 200);
      expect(t.resources.food, name).toBe(cap);
    }
  });

  it('лишнее над вместимостью не держится ни одной дверью: сгорает строкой «Склад повреждён» и разовой тратой', () => {
    for (const [name, put] of Object.entries(DOORS)) {
      const s = town();
      const cap = storageCap(s);
      // Точка внутри правила: на складе лежит больше вместимости — так бывает, когда склад только что потерял уровень.
      s.resources.wood = cap + 300;
      const outlays = s.stats.outlays ?? 0;
      put(s, 'wood', 10);
      expect(s.resources.wood, `${name}: не выше вместимости`).toBeLessThanOrEqual(cap);
      expect(lines(s).some((t) => t.startsWith('Склад повреждён: пропало — древесина 300')), `${name}: строка летописи`).toBe(true);
      expect(s.stats.outlays ?? 0, `${name}: сгоревшее — трата для книги запасов`).toBe(outlays + 1);
    }
  });

  it('склад потерял уровень: на следующем шаге излишек сгорает строкой летописи, тихо — никогда', () => {
    const s = town(4);
    const before = storageCap(s);
    for (const r of RESOURCE_IDS) s.resources[r] = before;
    dropStorage(s);
    const after = storageCap(s);
    expect(after, 'точка внутри правила: вместимость упала').toBeLessThan(before);
    tick(s, gameSeconds(1));
    for (const r of RESOURCE_IDS) expect(s.resources[r], r).toBeLessThanOrEqual(after);
    expect(lines(s).filter((t) => t.startsWith('Склад повреждён: пропало')), 'одна строка на всё сгоревшее').toHaveLength(1);
    expect(lines(s).find((t) => t.startsWith('Склад повреждён'))).toContain(`древесина ${before - after}`);
  });

  it('старое сохранение со складом выше вместимости приводится при загрузке, и игрок узнаёт об этом', () => {
    const s = town(2);
    const cap = storageCap(s);
    s.resources.iron = cap + 777;
    const got = deserialize(serialize(s))!;
    expect(got.resources.iron).toBe(cap);
    enter(got, got.lastSaved);
    expect(lines(got).some((t) => t.startsWith('Склад приведён к вместимости') && t.includes('железо 777'))).toBe(true);
    // Партия в порядке строки не получает.
    const ok = deserialize(serialize(town(2)))!;
    enter(ok, ok.lastSaved);
    expect(lines(ok).some((t) => t.startsWith('Склад приведён'))).toBe(false);
  });

  it('награда задания сверх вместимости: что не поместилось, сказано в строке задания', () => {
    const s = town();
    const cap = storageCap(s);
    const q = QUESTS[0];
    const [r, n] = Object.entries(q.reward)[0] as [ResourceId, number];
    s.resources[r] = cap - 10;
    s.completedQuests = QUESTS.filter((x) => x.id !== q.id).map((x) => x.id);
    const check = q.check;
    (q as { check: (s: GameState) => boolean }).check = () => true;
    try {
      tick(s, gameSeconds(1));
    } finally {
      (q as { check: typeof check }).check = check;
    }
    expect(s.resources[r]).toBe(cap);
    const line = lines(s).find((t) => t.startsWith(`Задание выполнено: ${q.title}.`));
    expect(line).toContain(`не поместилось ${RESOURCE_META[r].name.toLowerCase()} ${n - 10}`);
  });
});

describe('предпросмотр: окно «Склад заполнен» встаёт, только когда что-то не влезает', () => {
  it('overflowOf: влезает всё — пусто; не всё — сколько обещано и сколько поместится', () => {
    const s = town();
    const cap = storageCap(s);
    s.resources.wood = cap - 120;
    s.resources.stone = 0;
    expect(overflowOf(s, { wood: 120, stone: 500 })).toEqual([]);
    expect(overflowOf(s, { wood: 500, stone: 500 })).toEqual([{ resource: 'wood', wanted: 500, fits: 120 }]);
    expect(overflowLine({ resource: 'wood', wanted: 500, fits: 120 })).toBe('из 500 единиц древесины поместится только 120');
    expect(overflowLine({ resource: 'stone', wanted: 21, fits: 0 })).toBe('из 21 единицы камня поместится только 0');
    // Дробь на складе, которую игрок не видит, окна не зовёт: на глаз легло всё.
    s.resources.wood = cap - 0.5;
    expect(overflowOf(s, { wood: 1 })).toEqual([]);
  });

  it('overflowOfAct: отмена стройки сухим прогоном — те же числа, что лягут на деле, и партия не тронута', () => {
    const s = town();
    for (const r of RESOURCE_IDS) s.resources[r] = 1e6;
    s.resources = Object.fromEntries(RESOURCE_IDS.map((r) => [r, storageCap(s)])) as GameState['resources'];
    const b = s.buildings.find((x) => startUpgrade(s, x.id) === null)!;
    expect(b, 'стройка заложена').toBeDefined();
    // Склад снова полон: возврат не влезет ни единицей.
    for (const r of RESOURCE_IDS) s.resources[r] = storageCap(s) - 5;
    const shot = JSON.stringify(s);
    const over = overflowOfAct(s, (x) => cancelUpgrade(x, b.id));
    expect(JSON.stringify(s), 'партия не тронута').toBe(shot);
    expect(over.length, 'возврат не влезает').toBeGreaterThan(0);
    const was = { ...s.resources };
    cancelUpgrade(s, b.id);
    for (const o of over) {
      expect(o.fits, o.resource).toBe(Math.floor(s.resources[o.resource]) - Math.floor(was[o.resource]));
      expect(o.wanted).toBeGreaterThan(o.fits);
    }
  });
});

/** Кость теста: сеяный генератор, чтобы сценарии повторялись. */
function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  };
}

describe('клиент и книга запасов сервера считают склад одним правилом', () => {
  it('сто случайных сценариев: прибавки, убавки, указы, потеря уровня склада — опись не выше вместимости, книга равна описи', () => {
    let asked = 0;
    for (let k = 0; k < 100; k++) {
      const rand = rng(1000 + k);
      const s = town(2 + Math.floor(rand() * 5), k + 1);
      for (const r of RESOURCE_IDS) s.resources[r] = Math.floor(rand() * storageCap(s));
      for (let step = 0; step < 12; step++) {
        const r = RESOURCE_IDS[Math.floor(rand() * RESOURCE_IDS.length)];
        const n = Math.round((rand() * 2 - 1) * storageCap(s));
        const roll = rand();
        if (roll < 0.15 && buildingOfType(s, 'storage')!.level > 1) dropStorage(s);
        else if (roll < 0.3) layStock(s, r, n);
        else if (roll < 0.4) tick(s, gameSeconds(30));
        else if (roll < 0.55) addRes(s, r, n);
        else addStock(s, r, n);
      }
      const card = watchOf(s);
      const cap = storageCap(s);
      const book = goodsStep(null, undefined, 0, card, 60_000, { levels: card.buildings, pop: card.pop, soldiers: 0 }).book;
      for (const r of RESOURCE_IDS) {
        expect(s.resources[r], `сценарий ${k}: ${r} не выше вместимости`).toBeLessThanOrEqual(cap);
        expect(book.have[r] ?? 0, `сценарий ${k}: ${r} — книга сервера равна описи`).toBe(card.stock[r] ?? 0);
        if ((card.stock[r] ?? 0) >= cap - 1) asked++;
      }
      expect(flagsOf(card, card.clock).map((f) => f.kind), `сценарий ${k}: «сверх склада» нет`).not.toContain('cap');
    }
    // Точки внутри правила: склад у края вместимости, где срез и решает.
    expect(asked, 'склад у вместимости в сценариях').toBeGreaterThanOrEqual(50);
  });
});

// ------------------------------------------------ SETUP-2 ---
//
// Склад не срезают мимо двери (SETUP-2 аудита): своей арифметики «не выше вместимости» нет нигде в игре, кроме правила
// (`stockrules.fitStock`) и двери (`sim/stock`). Восемь копий среза уже расходились — две из них держали лишнее, остальные
// резали его молча. Тест читает исходники `src/game` как текст.

const GAME = join(__dirname, '..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
const rel = (p: string): string => relative(GAME, p).split(sep).join('/');

/** Где правило склада живёт по праву: само правило, дверь и предпросмотр окна. */
const DOOR = new Set(['stockrules.ts', 'sim/stock.ts', 'sim/stockview.ts']);

/**
 * Срез склада мимо двери, по строкам: запись в склад со срезом (`Math.min`, вместимость, правило) справа, прибавка
 * `+=` к складу, `Math.min` с вместимостью склада — по имени `storageCap(` или по переменной, в которую файл её положил.
 */
function clamps(code: string): string[] {
  const out: string[] = [];
  const capVars = [...code.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*storageCap\(/g)].map((m) => m[1]);
  const capMin = capVars.length > 0 ? new RegExp(`Math\\.min\\(\\s*(?:${capVars.join('|')})\\b|Math\\.min\\([^;]*,\\s*(?:${capVars.join('|')})\\s*\\)`) : null;
  for (const line of code.split('\n')) {
    const t = line.trim();
    if (/\.resources(?:\[[^\]]+\]|\.[a-z]+)\s*=(?!=)[^;]*(?:Math\.min\(|storageCap\(|fitStock\()/.test(t)) out.push(`запись в склад со срезом: ${t}`);
    else if (/\.resources(?:\[[^\]]+\]|\.[a-z]+)\s*\+=/.test(t)) out.push(`прибавка к складу мимо двери: ${t}`);
    else if (/Math\.min\([^;]*storageCap\(/.test(t) || (capMin && capMin.test(t))) out.push(`срез вместимостью склада: ${t}`);
  }
  return out;
}

describe('SETUP-2: склад срезает одна дверь', () => {
  it('образцы ловят срез, прибавку и вместимость в переменной, а убавку и чужой потолок — нет', () => {
    const bad = [
      's.resources[r] = Math.min(cap, before + n);',
      's.resources.food = Math.max(0, Math.min(storageCap(s), s.resources.food + n));',
      's.resources[r] += put;',
      'const cap = storageCap(s);\nconst room = Math.min(cap, have + n);',
      'const cap = storageCap(s);\nfood = Math.min(food + net, cap);',
    ];
    for (const b of bad) expect(clamps(b), b).not.toEqual([]);
    const good = [
      's.resources[r] -= n;',
      's.resources.food = 0;',
      'const whole = Math.min(cap, Math.floor(due));',
      'addStock(s, r, n);',
      'const room = Math.max(0, Math.floor(storageCap(s) - s.resources[r]));',
      // Потолок награды — доля вместимости, а не срез склада (`sim/daily.DAILY_CAP_SHARE`).
      'const cap = Math.floor(storageCap(s) * 0.15);\nout[r] = Math.max(1, Math.min(Math.round(base * k), cap));',
    ];
    for (const g of good) expect(clamps(g), g).toEqual([]);
  });

  it('в `src/game` мимо двери склад не срезает и не прибавляет никто', () => {
    const files = sources(GAME).filter((p) => !DOOR.has(rel(p)));
    // Точка внутри правила: файлы, которые пишут в склад, в выборке есть — иначе тест зелёный даром.
    const writers = files.filter((p) => /\.resources(?:\[[^\]]+\]|\.[a-z]+)\s*(?:=|-=)/.test(strip(readFileSync(p, 'utf8'))));
    expect(writers.length, 'файлы, пишущие в склад').toBeGreaterThanOrEqual(5);
    const found = files.flatMap((p) => clamps(strip(readFileSync(p, 'utf8'))).map((c) => `${rel(p)}: ${c}`));
    expect(found).toEqual([]);
  });
});
