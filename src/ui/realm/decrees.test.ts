// «Указы» одной копией (UI-7, docs/ui_v2.md, 5.6; находки Д3 и Ч14): указ, паёк и налог правят только в державе, ратуша и
// окна, что прежде вели в её вкладку «Указы», ведут туда одной дверью; у каждого варианта видно, что он даст, — полями
// записи и `taxQuote`; казна — три числа с разбором, строки складываются в итог без «Прочее».
//
// Области (правило 11) названы в каждом блоке и проверяются утверждениями: город с верой, что приносит золото, и с
// жалованьем дружине и мастерам вне отсрочки; отсрочка новой партии; набор вариантов, где хоть один без перемены и хоть
// один с убытком.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { FaithId, GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { DAY_LENGTH } from '@/game/constants';
import { DECREES, RATIONS, TAXES } from '@/game/data/policy';
import { faithGoldPerDay, taxIncomePerDay, taxQuote, upkeepInfo, wagesDue } from '@/game/derived';
import { REST_LABEL } from '@/ui/kit/breakdown';
import { WINDOW } from '@/ui/kit/sources';
import { perDay } from '@/ui/next/hudTips';
import { decreeCells, growthCell, incomeTip, pctCell, perDayCell, rationCells, taxCells, wagesTip } from './decrees';
import { hallGives } from '@/ui/next/HallGives';

const { stores, fake } = vi.hoisted(() => ({
  stores: { game: {} as Record<string, unknown> },
  fake: <T extends object>(real: T, view: () => Record<string, unknown>): T => Object.assign((sel: (g: unknown) => unknown) => sel(view()), real),
}));
vi.mock('@/game/store', async (orig) => {
  const real = await orig<{ useGame: object }>();
  return { ...real, useGame: fake(real.useGame, () => stores.game) };
});

import { DecreesNew } from './RealmTabs';

const SRC = join(__dirname, '..', '..');
/** Исходник без комментариев: правило читает код, а не слова о нём. */
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

/** Город на 200 жителей с храмом десятого уровня, дружиной и тремя мастерами, вне отсрочки жалованья. */
function town(faith: FaithId | null): GameState {
  const s = createInitialState(7);
  s.pop = 200;
  for (const b of s.buildings) if (b.type === 'church') b.level = 10;
  s.faith.id = faith;
  s.army.clubman = 20;
  s.army.archer = 6;
  s.masters = 3;
  s.pay = { ...(s.pay ?? {}), from: 0 } as GameState['pay'];
  return s;
}
const FAITHS: (FaithId | null)[] = ['catholic', 'orthodox', 'islam', 'pagan', null];
const labels = (rows: { label: string }[] | undefined): string[] => (rows ?? []).map((r) => r.label);

describe('указы — одна копия: правят только в державе', () => {
  it('указ, паёк и налог пишет из интерфейса один файл — вкладка державы', () => {
    // Область: весь интерфейс, кроме тестов.
    const writers = walk(join(SRC, 'ui'))
      .filter((f) => /\b(setDecree|setRation|setTax)\(/.test(code(relative(SRC, f))))
      .map((f) => relative(SRC, f).replace(/\\/g, '/'));
    expect(writers).toEqual(['ui/realm/RealmTabs.tsx']);
  });

  it('вкладки «Указы» у ратуши нет; ратуша, «Мораль» и «Изменить паёк» ведут в окно золота — «Указы» державы', () => {
    expect(WINDOW.gold).toEqual({ kind: 'realm', view: 'government' });
    const hall = code('ui/parts/TownHall.tsx');
    expect(hall).not.toMatch(/Manage|DECREES|TAXES|'manage'/);
    for (const f of ['ui/next/HallGives.tsx', 'ui/panels/MoralePanel.tsx', 'ui/parts/Provisions.tsx']) {
      expect(code(f), f).toContain('goTo(WINDOW.gold)');
    }
    for (const f of walk(join(SRC, 'ui'))) expect(code(relative(SRC, f)), relative(SRC, f)).not.toContain("openTownHall('manage')");
    // Вопрос 6.22 (решение владельца 16.10.2026): мёртвой вкладки нет и в типе ядра. С РТ-1 у ратуши — совет и сословия, с АГ-1 —
    // и агенты.
    expect(code('game/store.ts'), 'game/store.ts: TownTab').toMatch(/export type TownTab = 'council' \| 'agents' \| 'estates';/);
  });

  it('ратуша говорит, что даёт городу: скорость стройки, мораль, жильё — «с ур. N», пока его нет', () => {
    const s = createInitialState(7);
    const hall = s.buildings.find((b) => b.type === 'town_hall')!;
    expect(hall.level, 'область: ратуша первого уровня — жилья ещё нет').toBe(1);
    const rows = hallGives(hall, 1);
    expect(rows.map((r) => r.key)).toEqual(['build', 'morale', 'housing', 'council']);
    expect(rows[0].v).toBe('×1,00');
    expect(rows[2].v).toMatch(/^с ур\. \d+$/);
    hall.level = 10;
    expect(hallGives(hall, 1.5).find((r) => r.key === 'housing')!.v).toMatch(/^\d+$/);
  });
});

describe('варианты — что каждый даст, полями записи и `taxQuote` (Ч14)', () => {
  it('указ и паёк: проценты и мораль — из записи; без перемены — «—»', () => {
    // Указы короны — эта таблица; указы сословий (РТ-2) — своей (`estateDecreeCells`).
    expect(decreeCells().map((r) => r.id)).toEqual(DECREES.filter((d) => !d.estate).map((d) => d.id));
    expect(rationCells().map((r) => r.id)).toEqual(RATIONS.map((r) => r.id));
    // Область: хоть один вариант без перемены и хоть один с переменой в каждом столбце.
    expect(DECREES.some((d) => d.output === 1) && DECREES.some((d) => d.output !== 1)).toBe(true);
    expect(RATIONS.some((r) => r.growth === 0)).toBe(true);
    for (const r of decreeCells()) {
      const d = DECREES.find((x) => x.id === r.id)!;
      expect(r.cells.output).toBe(pctCell(d.output));
      expect(r.cells.morale).toBe(perDayCell(d.moralePerDay));
      if (d.output === 1) expect(r.cells.output).toBe('—');
    }
    for (const r of rationCells()) {
      const d = RATIONS.find((x) => x.id === r.id)!;
      expect(r.cells.food).toBe(pctCell(d.food));
      expect(r.cells.growth).toBe(growthCell(d.growth));
    }
    expect(pctCell(1.1)).toBe('+10 %');
    expect(pctCell(0.7)).toBe('−30 %');
    expect(growthCell(0)).toBe('нет');
  });

  it('налог: сбор, цель морали и выработка — `taxQuote` при этом налоге; убыток виден знаком', () => {
    let negative = 0;
    for (const faith of FAITHS) {
      const s = town(faith);
      const rows = taxCells(s);
      expect(rows.map((r) => r.id)).toEqual(TAXES.map((t) => t.id));
      for (const r of rows) {
        const q = taxQuote(s, r.id);
        expect(r.gold).toBe(q.gold);
        expect(r.cells.gold).toBe(perDay(q.gold).replace(/ в день$/, ''));
        expect(r.cells.morale).toBe(String(Math.round(q.morale)));
        if (q.gold < -0.05) negative++;
      }
    }
    // Область: закят без налога уводит сбор в минус — точка с убытком в наборе есть.
    expect(negative).toBeGreaterThan(0);
  });
});

describe('казна — три числа с разбором, строки складываются в итог', () => {
  it('сбор: налог и вера; итог — `taxIncomePerDay`, «Прочее» нет', () => {
    let faithShown = 0;
    for (const faith of FAITHS) {
      const s = town(faith);
      const t = incomeTip(s);
      expect(t.sum?.value).toBe(perDay(taxIncomePerDay(s)).replace(/ в день$/, ''));
      expect(labels(t.rows)).not.toContain(REST_LABEL);
      if (Math.abs(faithGoldPerDay(s)) > 0.05) faithShown++;
    }
    // Область: хоть одна вера приносит или уносит золото — её строка в разборе есть.
    expect(faithShown).toBeGreaterThan(0);
  });

  it('жалованье: дружине и мастерам; итог — `wagesDue` со знаком, «Прочее» нет', () => {
    const s = town('orthodox');
    const up = upkeepInfo(s);
    expect(wagesDue(s), 'область: вне отсрочки').toBeGreaterThan(0);
    expect(up.armyWages > 0 && up.mastersWages > 0, 'область: платят и дружине, и мастерам').toBe(true);
    const t = wagesTip(s);
    expect(labels(t.rows)).toEqual(['Дружине', 'Наёмным мастерам']);
    expect(t.sum?.value).toBe(perDay(-wagesDue(s)).replace(/ в день$/, ''));
  });

  it('в отсрочку приведённой партии платить нечего: строк нет, сказано когда начнём', () => {
    const s = createInitialState(7);
    s.army.clubman = 10;
    s.pay = { ...(s.pay ?? {}), from: s.time + 2 * DAY_LENGTH } as GameState['pay'];
    expect(upkeepInfo(s).amnestyDays, 'область: отсрочка идёт').toBeGreaterThan(0);
    const t = wagesTip(s);
    expect(t.rows ?? []).toEqual([]);
    expect(t.body).toContain('через');
  });
});

describe('окно «Указов»: три таблицы выбора, выбранное отмечено', () => {
  it('девять строк-кнопок; нажата ровно одна в каждой таблице — та, что стоит в партии', () => {
    const s = town('catholic');
    s.decree = DECREES[1].id;
    s.tax = TAXES[0].id;
    stores.game = { s, act: () => {} };
    const html = renderToStaticMarkup(h(DecreesNew));
    const picks = [...html.matchAll(/<button type="button" class="kit-cells pick"[^>]*aria-pressed="(true|false)"/g)].map((m) => m[1]);
    expect(picks).toHaveLength(DECREES.length + RATIONS.length + TAXES.length);
    expect(picks.filter((p) => p === 'true')).toHaveLength(3);
    // Порядок строк — порядок записей: нажатый указ — второй, налог — первый.
    expect(picks[1]).toBe('true');
    expect(picks[DECREES.length + RATIONS.length]).toBe('true');
    // Прежнего ряда трёх ячеек у указов нет.
    expect(html).not.toContain('nx-opts');
  });
});
