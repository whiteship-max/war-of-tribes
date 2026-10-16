// UI-8 (docs/ui_v2.md, 5.7): оставшиеся дубли — одна копия, остальное ссылка. Д1 — подсказка новичку ведёт туда же, куда
// кнопка, у которой стоит; Д5 — ускорение одной кнопкой в окне постройки; Д6 — промысел двора строкой-дверью в «Промыслы»;
// Д7 — полководец в Статуе одной карточкой; Д8 — у казарм оборона и свободные руки по разу; Д10 — служители храма — в ряду
// рабочих; Д11 — ход разведки одной таблицей; Д13 — налог, пир и обряд в «Морали» по разу, строки складываются в цель.
// Окна построек — «Что даёт городу» таблицей: вклад с разбором и дверью к окну числа (`gives.ts`).
//
// Окна рисуются в строку (`renderToStaticMarkup`) с партией теста: стор игры подменён видом, как в `people.test.ts`.
// Области (правило 11) названы в каждом блоке и проверяются утверждениями.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { BUILDINGS } from '@/game/data/buildings';
import { HINTS } from '@/game/data/hints';
import { buildingOfType, moraleBreakdown, pietyBreakdown } from '@/game/derived';
import { MAX_BUILDING_LEVEL } from '@/game/constants';
import { surveyInfo } from '@/game/sim/survey';
import { SURVEY_STEPS } from '@/game/data/survey';
import { WINDOW } from '@/ui/kit/sources';
import type { TipGo } from './hudTips';
import { buildingGives } from './gives';
import { moraleRows } from './morale';

const { stores, fake } = vi.hoisted(() => ({
  stores: { game: {} as Record<string, unknown> },
  fake: <T extends object>(real: T, view: () => Record<string, unknown>): T => Object.assign((sel: (g: unknown) => unknown) => sel(view()), real),
}));
vi.mock('@/game/store', async (orig) => {
  const real = await orig<{ useGame: object }>();
  return { ...real, useGame: fake(real.useGame, () => stores.game) };
});

import { AgentPlaces } from '@/ui/parts/AgentPlaces';
import { Barracks } from '@/ui/parts/Barracks';
import { Temple, pietyRows } from '@/ui/parts/Temple';
import { Watch, surveyRows } from '@/ui/parts/Watch';
import { MoralePanel } from '@/ui/panels/MoralePanel';

const SRC = join(__dirname, '..', '..');
const NOGO: TipGo = { tab: () => undefined, building: () => undefined, realm: () => undefined, to: () => undefined };

/** Исходник без комментариев: замки читают код, а не слова о нём. */
const code = (rel: string): string =>
  readFileSync(join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}

const setStore = (s: GameState): void => {
  stores.game = { s, act: () => undefined, openBuilding: () => undefined, openMap: () => undefined, sheet: null };
};

// ---------- Партии ----------

/** Начало партии. */
const fresh = (): GameState => createInitialState(7);

/** Налог, пир, обряд и две вести с моралью разом (усилители — `s.boons`). */
function lifted(): GameState {
  const s = createInitialState(7);
  s.tax = 'high';
  s.feastUntil = s.time + 10_000;
  s.faith = { ...s.faith, riteUntil: s.time + 10_000 };
  s.boons = [
    { id: 'harvest_joy', until: s.time + 10_000 },
    { id: 'cold', until: s.time + 10_000 },
  ];
  return s;
}

/** Город на потолке уровней: сумма слагаемых морали выше шкалы — срез строкой. */
function maxed(): GameState {
  const s = lifted();
  for (const b of s.buildings) b.level = Math.min(MAX_BUILDING_LEVEL, BUILDINGS.find((d) => d.id === b.type)!.maxLevel ?? MAX_BUILDING_LEVEL);
  s.prestige = 500;
  return s;
}

// ---------- Д1 ----------

describe('Д1: подсказка новичку ведёт туда же, куда кнопка, у которой стоит', () => {
  it('у кнопки низа ссылка подсказки — дверь этой кнопки; в казармы подсказка «Дружины» больше не ведёт', () => {
    // Двери кнопок низа (`next/Nav`): «Ратуша» — ратуша, «Дружина» — раздел, «Карта» — карта.
    const NAV: Record<string, string> = { 'nav-townhall': 'townhall', 'nav-army': 'army', 'nav-map': 'map' };
    const onNav = HINTS.filter((x) => /data-tut="nav-/.test(x.anchor));
    // Область: подсказки у кнопок низа есть, «Дружина» — среди них.
    expect(onNav.map((x) => x.id), 'точка внутри области').toContain('army');
    for (const x of onNav) {
      const tut = /data-tut="([^"]+)"/.exec(x.anchor)![1];
      expect(x.link.go, `${x.id}: ссылка — туда же, куда ${tut}`).toBe(NAV[tut]);
    }
    expect(code('ui/next/Hints.tsx'), 'дверь «Дружины» — окно дружины').toMatch(/case 'army':\s*return \(\) => goToSource\(WINDOW\.army\)/);
    expect(code('ui/next/Hints.tsx')).not.toContain("'barracks'");
  });
});

// ---------- Д5, Д6 ----------

describe('Д5, Д6: ускорение и промысел — одной копией, остальное ссылкой', () => {
  it('кнопка ускорения стоит только в окне постройки; ярлык у лесов — дверь в окно', () => {
    const users = walk(join(SRC, 'ui')).filter((f) => /<RushButton\b/.test(code(relative(SRC, f))));
    expect(users.map((f) => relative(SRC, f).replace(/\\/g, '/'))).toEqual(['ui/next/BuildingNew.tsx']);
    const rush = code('ui/next/Rush.tsx');
    expect(rush, 'ярлык — дверь в окно постройки').toMatch(/function SiteTag[\s\S]*onClick=\{\(\) => openBuilding\(b\.id\)\}/);
    expect(rush).toMatch(/createPortal\(<SiteTag b=\{b\} \/>/);
  });

  it('промысел двора — строкой-дверью в «Промыслы»; строка игры с кнопкой — только в окне «Промыслы»', () => {
    const users = walk(join(SRC, 'ui')).filter((f) => /<TradeLine\b/.test(code(relative(SRC, f))));
    expect(users.map((f) => relative(SRC, f).replace(/\\/g, '/'))).toEqual(['ui/next/Trades.tsx']);
    expect(code('ui/next/BuildingNew.tsx')).toMatch(/function TradeLink[\s\S]*go=\{\(\) => goTo\(WINDOW\.energy\)\}/);
    expect(WINDOW.energy).toEqual({ kind: 'trades' });
  });
});

// ---------- Д7 ----------

describe('Д7: полководец в Статуе — одной карточкой', () => {
  it('на месте — строки «Люди» нет (карточка целиком в Статуе); место пустует — строка с наймом есть', () => {
    const s = fresh();
    setStore(s);
    // Область: полководец на месте в новой партии.
    expect(s.agents.general.vacant, 'точка внутри области: на месте').not.toBe(true);
    expect(renderToStaticMarkup(h(AgentPlaces, { ids: ['general'], vacantOnly: true }))).toBe('');
    // Без `vacantOnly` (Дозор, храм) строка места есть и у занятого.
    expect(renderToStaticMarkup(h(AgentPlaces, { ids: ['general'] }))).toContain('на месте');
    s.agents.general.vacant = true;
    expect(renderToStaticMarkup(h(AgentPlaces, { ids: ['general'], vacantOnly: true }))).toContain('<h3>Люди</h3>');
    expect(code('ui/panels/BuildingPanel.tsx')).toMatch(/<Statue \/>\s*<AgentPlaces ids=\{\['general'\]\} vacantOnly \/>/);
  });
});

// ---------- Окна построек: «Что даёт городу» ----------

describe('«Что даёт городу» — вклад строкой, итог города — в разборе и за дверью', () => {
  it('у каждой постройки: вклад в показатель с дверью к окну числа; итогов города и чужих чисел нет (Д8, Д11, Л3)', () => {
    for (const s of [fresh(), maxed()]) {
      let seen = 0;
      for (const b of s.buildings) {
        const rows = buildingGives(s, b, NOGO);
        for (const r of rows) {
          expect(r.label, `${b.type}: итог обороны второй строкой (Д8)`).not.toBe('Оборона города');
          expect(r.label, `${b.type}: мощь дружины (Л3)`).not.toBe('Мощь дружины');
          expect(r.label, `${b.type}: ход разведки (Д11)`).not.toMatch(/Округа разведана/);
          expect(r.label, `${b.type}: жители второй раз`).not.toBe('Жители');
          // Подсказка есть у каждой цифры (docs/ui_v2.md, 2.2).
          expect(r.tip().title, `${b.type}: ${r.label} — подсказка`).toBeTruthy();
        }
        const door = (key: string) => rows.find((r) => r.key === key)?.to;
        if (rows.some((r) => r.key === 'defense')) {
          expect(door('defense'), b.type).toEqual(WINDOW.defense);
          seen++;
        }
        if (rows.some((r) => r.key === 'morale')) expect(door('morale'), b.type).toEqual(WINDOW.morale);
        if (rows.some((r) => r.key === 'housing')) expect(door('housing'), b.type).toEqual(WINDOW.pop);
      }
      // Область: вклад в оборону есть хоть у одной постройки (стены, башня, казармы).
      expect(seen, 'точка внутри области: постройки с обороной есть').toBeGreaterThan(0);
    }
  });

  it('казармы: оборона — одной строкой вклада с разбором, свободных рук и второй обороны нет; дружина и стены — дверями', () => {
    const s = fresh();
    setStore(s);
    const barracks = buildingOfType(s, 'barracks')!;
    const def = buildingGives(s, barracks, NOGO).filter((r) => r.key === 'defense');
    // Область: казармы дают оборону.
    expect(def.length, 'точка внутри области: у казарм есть вклад в оборону').toBe(1);
    const html = renderToStaticMarkup(h(Barracks));
    expect(html).not.toContain('Свободные руки');
    expect(html).not.toMatch(/>Оборона</);
    expect(html).toContain('aria-label="Дружина"');
    expect(html).toContain('aria-label="Стены"');
    // Терпение — дверью в Статую: его число делает она.
    expect(html).toContain('aria-label="Терпение: Статуя Героя"');
  });
});

// ---------- Д10 ----------

describe('Д10: служители храма — в ряду рабочих; набожность — таблицей с итогом', () => {
  it('раздела «Служители» под окном нет; строки набожности складываются в итог', () => {
    for (const make of [fresh, lifted, maxed]) {
      const s = make();
      s.faith = { ...s.faith, id: 'orthodox' };
      const b = pietyBreakdown(s);
      // Область: вера названа — иначе храм говорит «вера ещё не ясна», и разбора нет.
      expect(b.lines.length, 'точка внутри области: вера названа').toBeGreaterThan(0);
      const rows = pietyRows(b);
      const sum = [b.base, ...b.lines.map((l) => l.value), b.value - b.raw].reduce((n, x) => n + x, 0);
      expect(sum, 'строки — итог').toBeCloseTo(b.value, 9);
      expect(rows.length).toBe(1 + b.lines.length + (Math.abs(b.value - b.raw) > 0.001 ? 1 : 0));
      setStore(s);
      const html = renderToStaticMarkup(h(Temple));
      expect(html).toContain('aria-label="Набожность"');
      expect(html, 'второго счёта служителей нет').not.toContain('Их ставят в ряд рабочих');
      expect(html).not.toContain('Что добавляет');
    }
  });
});

// ---------- Д11 ----------

describe('Д11: ход разведки — одной таблицей', () => {
  it('строка на уровень: пройдено, идёт, заперто — словами; в «Что даёт городу» и в заголовке хода нет', () => {
    const s = fresh();
    s.survey = { done: 1, startedAt: s.time, until: s.time + 600 };
    buildingOfType(s, 'watch')!.level = 3;
    const info = surveyInfo(s);
    // Область: пройденный, идущий и запертый уровни есть.
    expect(info.done, 'точка внутри области: пройдено').toBe(1);
    expect(info.running?.n, 'точка внутри области: идёт второй').toBe(2);
    expect(info.level, 'точка внутри области: выше третьего заперто').toBe(3);
    const rows = surveyRows(info, SURVEY_STEPS);
    expect(rows.length).toBe(SURVEY_STEPS.length);
    expect(String(rows[0].cells.state)).toMatch(/пройдено/);
    expect(String(rows[1].cells.state)).toMatch(/идёт/);
    expect(String(rows[3].cells.state)).toMatch(/Дозор ур\. 4/);
    expect(rows[3].dim).toBe(true);
    setStore(s);
    const html = renderToStaticMarkup(h(Watch));
    expect(html).toContain('aria-label="Уровни разведки"');
    expect(html).not.toContain('card as-row');
    expect(html).not.toMatch(/ур\. \d+ из \d+/);
  });
});

// ---------- Д13 ----------

describe('Д13: «Мораль» — каждое слагаемое одной строкой, строки складываются в цель', () => {
  it('налог, пир, обряд и вести — по разу; сумма строк — цель, без остатка', () => {
    for (const [name, make] of [['начало', fresh], ['налог, пир, обряд, вести', lifted], ['потолок уровней', maxed]] as const) {
      const s = make();
      const { rows, target } = moraleRows(s);
      const sum = rows.reduce((n, r) => n + r.value, 0);
      expect(sum, `${name}: строки — цель`).toBeCloseTo(target, 9);
      expect(target, name).toBeCloseTo(moraleBreakdown(s).target, 9);
    }
    // Область: в «lifted» налог, пир, обряд и две вести не ноль; в «maxed» шкала срезает сумму.
    const l = moraleRows(lifted()).rows.map((r) => r.id);
    for (const id of ['tax', 'feast', 'rite', 'boon-harvest_joy', 'boon-cold']) expect(l, `точка внутри области: ${id}`).toContain(id);
    expect(moraleRows(maxed()).rows.map((r) => r.id), 'точка внутри области: срез шкалы').toContain('cut');

    const s = lifted();
    setStore(s);
    const html = renderToStaticMarkup(h(MoralePanel));
    for (const word of ['Пир в трактире', 'Обряд в приходе', 'Праздник урожая']) {
      expect(html.split(word).length - 1, `${word} — одной строкой`).toBe(1);
    }
    expect(html.split('Налог:').length - 1, 'налог — одной строкой').toBe(1);
    expect(html).not.toContain('Как складывается цель');
    expect(html).toContain('aria-label="Цель морали"');
  });
});
