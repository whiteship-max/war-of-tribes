// Каждая дверь, которая убавляет склад или казну, — поимённо, и у каждой своя причина (docs/security.md, ЗЩ-2).
//
// Книга запасов сервера (`netlify/lib/goods.ts`) держит склад «не меньше», пока между двумя описями не было ни разового
// дела, ни разовой траты: тогда склад убывает только расходом. Дверь, которая убавила бы склад мимо счётчика трат
// (`sim/pay.outlay`) и мимо разовых дел, сделала бы честного игрока подделкой — сервер держал бы за ним добро, которого
// нет, и при падении города унёс бы больше честного. Поэтому новый файл в этот список попадает только правкой теста.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

type Why = 'outlay' | 'drain' | 'deed';

/**
 * Где склад или казна убывают, и чем это объяснено для книги запасов: `outlay` — дверь зовёт `outlay`; `drain` — расход
 * (хлеб, дрова, жалованье, закят), его потолок считает сервер (`goods.drainCeil`); `deed` — разовое дело описи (событие,
 * бой у ворот, указ, коды проверки).
 */
// Хлеб осады (Р-5) — больше не дверь убыли: с ОС-1 склад под осадой убывает только прокормом шага (`sim/tick`), мост его не
// урезает (docs/siege_v2.md, 23.1).
const DOORS: Record<string, { why: Why[]; what: string }> = {
  'sim/pay.ts': { why: ['outlay'], what: 'плата за заказ: стройка, ковка, найм, разведка округи, обряд' },
  'sim/actions.ts': { why: ['outlay'], what: 'пир' },
  'sim/market.ts': { why: ['outlay', 'deed'], what: 'покупка на рынке; продажа торговцам — выручка разовым делом (`stats.windfalls`, РН-1)' },
  'sim/caravan.ts': { why: ['drain'], what: 'закят налогом ниже нуля (шаг рынка, РН-1)' },
  'sim/faith.ts': { why: ['outlay'], what: 'обряд и крещение' },
  'sim/mutiny.ts': { why: ['outlay'], what: 'мятеж невольников уносит добро' },
  'sim/expedition.ts': { why: ['outlay', 'deed'], what: 'последствие мира: с боем — дело, без боя — трата' },
  'sim/tick.ts': { why: ['drain'], what: 'паёк и очаги' },
  'sim/upkeep.ts': { why: ['drain'], what: 'жалованье войска и мастеров' },
  'sim/gate.ts': { why: ['deed'], what: 'бой у ворот по вести' },
  'sim/admin.ts': { why: ['deed'], what: 'указ админа (номер указа — в описи)' },
  'sim/bandgrant.ts': { why: ['deed'], what: 'указ админа отряду бродяги — обоз (`cargo`), склад города не трогает (ПН-5, хвост а: половина двери указа)' },
  'data/events.ts': { why: ['deed'], what: 'цена ответа на весть' },
  'data/eventKit.ts': { why: ['deed'], what: 'весть отнимает добро' },
  'sim/crown.ts': { why: ['deed'], what: 'ответ на весть державы отнимает золото (СБ-2)' },
  'sim/candidates.ts': { why: ['outlay'], what: 'плата за найм советника за сезон вперёд (РТ-1)' },
  'sim/recruits.ts': { why: ['outlay'], what: 'найм агента в Ратуше: плата по ртам и жалованье вперёд (АГ-1)' },
  'sim/commanders.ts': { why: ['outlay'], what: 'найм командира фланга: плата по ртам и жалованье вперёд (ДР-3)' },
  'sim/contracts.ts': { why: ['drain'], what: 'договор бродяги «Доставить груз» — груз заказчику с обоза (`cargo`) при сдаче, склад города не трогает (ПН-7)' },
  'sim/estates.ts': { why: ['outlay'], what: 'дар сословию золотом (РТ-2)' },
  'sim/roam.ts': { why: ['drain'], what: 'паёк отряда бродяги — из обоза (`cargo`), склад города не трогает (ПН-1)' },
  'sim/roamtown.ts': { why: ['drain'], what: 'найм бродяги у города и села — припас из обоза (`cargo`), склад города не трогает (ПН-6)' },
  'sim/stock.ts': { why: ['outlay', 'drain', 'deed'], what: 'дверь склада (ECO-1): убавку объясняет тот, кто зовёт; излишек сверх вместимости сгорает тратой' },
};

/**
 * Кто кладёт на склад дверью склада (`sim/stock.addStock`) только прибавкой: убавить склад они не могут, и объяснять
 * нечего. Дверь, способная убавить, стоит в `DOORS`. Новый файл, зовущий `addStock`, попадает в один из списков только
 * правкой теста.
 */
const GAINS: Record<string, string> = {
  'sim/daily.ts': 'награда ежедневки — разовое дело (`stats.dailyWins`)',
  'sim/minigames.ts': 'добыча промысла — разовое дело (`stats.games`)',
  'sim/roamcastle.ts': 'добыча и дань вольного замка — в обоз отряда бродяги (`cargo`), склад города не трогает (ПН-10)',
};

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
const rel = (p: string): string => relative(ROOT, p).split(sep).join('/');

/** Запись, которая может убавить склад или казну: вычитание или присваивание через `Math.max(0, …)` (с минусом внутри). */
const DECREASE = /\.(?:resources(?:\[[^\]]+\]|\.[a-z]+)|gold)\s*(?:-=|=\s*Math\.max\(\s*0\s*,)/;

/** Дверь склада: прибавка или убавка со знаком (`sim/stock.addStock`). */
const STOCK_DOOR = /\baddStock\(/;

describe('убыль склада и казны — только поимённые двери', () => {
  it('образцы ловят вычитание и «не ниже нуля», а прибавку — нет', () => {
    for (const bad of ['s.gold -= cost;', 's.resources[r] -= n;', 's.resources.food -= eat;', 's.resources[r] = Math.max(0, s.resources[r] - n);', 's.gold = Math.max(0, s.gold + o.gold);']) {
      expect(DECREASE.test(bad), bad).toBe(true);
    }
    for (const good of ['s.gold += gold;', 's.resources[r] = Math.min(cap, s.resources[r] + n);', 'const gold = s.gold - 1;']) {
      expect(DECREASE.test(good), good).toBe(false);
    }
  });

  it('каждая дверь в списке, и та, что объяснена тратой, зовёт `outlay`', () => {
    const found = sources(ROOT)
      .filter((p) => {
        const code = strip(readFileSync(p, 'utf8'));
        return DECREASE.test(code) || STOCK_DOOR.test(code);
      })
      .map(rel)
      .sort();
    expect(found).toEqual([...Object.keys(DOORS), ...Object.keys(GAINS)].sort());
    for (const [path, door] of Object.entries(DOORS)) {
      const code = strip(readFileSync(join(ROOT, path), 'utf8'));
      if (door.why.includes('outlay') && path !== 'sim/pay.ts') expect(code, path).toMatch(/\boutlay\(s\)/);
    }
  });
});
