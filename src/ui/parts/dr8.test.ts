// ДР-8 (docs/ui_v2.md, «Решения ДР-8»): «Дружина» — состав плитками видов, касание плитки — карточка вида поверх меню (дома и в
// походе, жалованье вида, роспуск), роспуск только через карточку и ровно на выбранное число, погашенное — с причиной, убранные
// надписи записаны в docs/ui_v2.md, «Дружина — отложенные надписи».
//
// Тела без своего состояния (`RosterTiles`, `KindCardBody`) жмутся без браузера: дерево элементов обходится, касание —
// вызовом `onClick`, как у найма (`next/hire.test.ts`). Окно целиком рисуется в строку с подменёнными сторами (`dr1.test.ts`).
// Числа сверяются с функциями игры (правило 18), а не со своей арифметикой. Области (правило 11) названы у каждого блока и
// проверены утверждениями.
import { createElement as h, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '@/game/state';
import type { GameState, TroopId } from '@/game/types';
import { TROOP_BY_ID, TROOPS } from '@/game/data/troops';
import { armyWagesPerDay, homeTroops } from '@/game/derived';
import { TROOPS_OF_KIND } from '@/game/battle/kinds';
import { UNIT_KINDS } from '@/battle';
import { dismissCheck, dismissReturns, dismissSoldiers } from '@/game/sim/upkeep';
import { num } from '@/game/num';
import type { FigureView, Regroup } from '@/world/types';
import { Btn } from '@/ui/kit';
import { fmtInt } from '@/ui/next/hudTips';

const { stores, fake } = vi.hoisted(() => ({
  stores: { game: {} as Record<string, unknown>, world: {} as Record<string, unknown> },
  fake: <T extends object>(real: T, view: () => Record<string, unknown>): T => Object.assign((sel: (g: unknown) => unknown) => sel(view()), real),
}));
vi.mock('@/game/store', async (orig) => {
  const real = await orig<{ useGame: object }>();
  return { ...real, useGame: fake(real.useGame, () => stores.game) };
});
vi.mock('@/world/store', async (orig) => {
  const real = await orig<{ useWorld: object }>();
  return { ...real, useWorld: fake(real.useWorld, () => stores.world), worldNow: () => NOW };
});

import { ArmyPanel, type ArmyTab } from '@/ui/panels/ArmyPanel';
import { RosterTiles, rosterTiles } from './ArmyDesk';
import { KindCardBody, QUICK, dismissPick, type KindCardProps } from './KindCard';

const NOW = 1_700_000_000_000;
const FREE: Regroup = { block: null, grow: null, instant: true };
const general = { id: 'general', name: 'Полководец', icon: '', phase: 'home', place: 'map', departAt: NOW, arriveAt: NOW, troops: {}, readyAt: 0, regroup: FREE, gone: null } as unknown as FigureView;

/** Партия теста: войско, раненые и ушедшие (`s.away` — тем же полем, что сводит мост мира) поверх новой партии. */
function party(army: Partial<Record<TroopId, number>>, over: (s: GameState) => void = () => undefined): GameState {
  const s = createInitialState(7);
  for (const t of TROOPS) s.army[t.id] = 0;
  Object.assign(s.army, army);
  s.gold = 1e6;
  over(s);
  stores.game = { s, showToast: () => undefined, openBuilding: () => undefined, act: () => true };
  stores.world = { marches: [], figures: [general] };
  return s;
}

type El = ReactElement<Record<string, unknown> & { children?: ReactNode; className?: string }>;

/** Все элементы дерева, которое вернуло тело, — без отрисовки вложенных компонентов. */
function elements(node: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach((c) => elements(c, out));
  else if (isValidElement(node)) {
    const el = node as El;
    out.push(el);
    elements(el.props.children, out);
  }
  return out;
}

/** Текст элемента — строки и числа его детей (без вложенных компонентов). */
const text = (node: ReactNode): string =>
  Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node as El).props.children) : node === null || node === undefined || node === false ? '' : String(node);

const cls = (e: El, c: string): boolean => typeof e.props.className === 'string' && e.props.className.split(' ').includes(c);

/** Раненые вида — своим счётом из групп лазарета (лежащие и несомые), а не дверью окна. */
const hurtOf = (s: GameState, id: TroopId): number => (s.wounded ?? []).reduce((n, g) => n + (g.troops[id] ?? 0), 0);

function props(s: GameState, troop: TroopId, over: Partial<KindCardProps> = {}): KindCardProps {
  return { s, troop, n: 1, onCount: () => {}, onDismiss: () => {}, onMore: () => {}, onClose: () => {}, ...over };
}

/** Карточка вида: дерево и кнопка «Распустить» (`Btn` с подтверждением). */
function card(p: KindCardProps): { tree: El[]; go: El; html: string } {
  const tree = elements(KindCardBody(p));
  const go = tree.find((e) => e.type === Btn && e.props.kind === 'main');
  expect(go, 'кнопка «Распустить»').toBeDefined();
  return { tree, go: go!, html: renderToStaticMarkup(h(KindCardBody, p)) };
}

/** Число ячейки карточки по её подписи (`<small>Дома</small><b>…</b>`). */
const cell = (html: string, label: string): string | null => {
  const m = new RegExp(`<small>${label}</small><b>(?:<svg[\\s\\S]*?</svg> ?)?([^<]+)</b>`).exec(html);
  return m ? m[1].trim() : null;
};

const ARMIES: Partial<Record<TroopId, number>>[] = [
  { spearman: 30, archer: 12, rider: 5, legionary: 4 },
  Object.fromEntries(TROOPS.map((t, i) => [t.id, 3 + i * 7])),
  { clubman: 1 },
];

describe('ДР-8: состав плитками — по составу партии', () => {
  it('плитка — у каждого вида с бойцами или ранеными, и только у них; число — `s.army`, раненые — отметкой', () => {
    // Область: войска разного состава, с ранеными (лежащие и несомые) и вид, у которого остались одни раненые.
    for (const army of ARMIES) {
      for (const wounded of [[], [{ troops: { spearman: 7, archer: 2 }, until: 1e12 }, { troops: { knight: 3 }, until: null }]] as GameState['wounded'][]) {
        const s = party(army, (st) => {
          st.wounded = wounded;
        });
        const want = UNIT_KINDS.flatMap((k) => TROOPS_OF_KIND[k]).filter((id) => (s.army[id] ?? 0) > 0 || hurtOf(s, id) > 0);
        expect(want.length, 'точка внутри области: состав не пуст').toBeGreaterThan(0);
        const tiles = elements(RosterTiles({ s, onPick: () => {} })).filter((e) => cls(e, 'dr-tile'));
        expect(tiles.map((e) => e.props['data-troop']), 'плитки — виды с бойцами или ранеными, порядком родов').toEqual(want);
        for (const t of tiles) {
          const id = t.props['data-troop'] as TroopId;
          const inner = elements(t.props.children);
          const n = inner.find((e) => cls(e, 'dr-tile-n'));
          expect(text(n?.props.children), `${id}: число бойцов`).toBe(fmtInt(s.army[id] ?? 0));
          const hurt = inner.find((e) => cls(e, 'dr-tile-hurt'));
          if (hurtOf(s, id) > 0) expect(text(hurt?.props.children), `${id}: раненые`).toBe(fmtInt(hurtOf(s, id)));
          else expect(hurt, `${id}: раненых нет — отметки нет`).toBeUndefined();
          expect(text(inner.find((e) => cls(e, 'dr-tile-name'))?.props.children)).toBe(TROOP_BY_ID[id].name);
        }
        if (wounded.length > 0) expect(want, 'вид с одними ранеными — тоже плиткой').toContain('knight');
      }
    }
  });

  it('пустая дружина — строка «Бойцов нет», плиток нет', () => {
    const s = party({});
    expect(rosterTiles(s)).toEqual([]);
    expect(renderToStaticMarkup(h(RosterTiles, { s, onPick: () => {} }))).toContain('Бойцов нет.');
  });

  it('окно открывается на «Составе»: плитки, а не полки по родам; роспуска в окне нет', () => {
    const s = party(ARMIES[0]);
    const html = renderToStaticMarkup(h(ArmyPanel));
    expect(html.split('class="dr-tile"').length - 1).toBe(rosterTiles(s).length);
    expect(html).toMatch(/role="tab" aria-selected="true"[^>]*><svg[\s\S]*?<span class="one-line">Состав<\/span>/);
    for (const gone of ['dr-regiment', 'dr-dismiss', '<h3>Роспуск</h3>', '>Распустить']) expect(html, `нет «${gone}»`).not.toContain(gone);
  });

  it('у каждого вида — ровно одна дверь в карточку: плитка или значок под наймом, вид с одними ранеными — плиткой', () => {
    const s = party(ARMIES[0], (st) => {
      st.wounded = [{ troops: { knight: 3 }, until: 1e12 }];
    });
    expect(s.army.knight, 'точка внутри области: у вида одни раненые').toBe(0);
    const html = renderToStaticMarkup(h(ArmyPanel));
    for (const t of TROOPS) expect(html.split(`aria-label="${t.name}: карточка вида"`).length - 1, t.id).toBe(1);
    expect(html).toContain('data-troop="knight"');
  });
});

describe('ДР-8: касание плитки — карточка вида поверх меню', () => {
  it('плитка зовёт выбор своего вида, окно ставит его карточкой поверх меню, а не уходит в полную карточку', () => {
    const s = party(ARMIES[1]);
    const tiles = elements(RosterTiles({ s, onPick: () => {} })).filter((e) => cls(e, 'dr-tile'));
    expect(tiles.length, 'точка внутри области: все девять видов').toBe(TROOPS.length);
    for (const t of tiles) {
      const onPick = vi.fn();
      const mine = elements(RosterTiles({ s, onPick })).find((e) => e.props['data-troop'] === t.props['data-troop']);
      (mine!.props.onClick as () => void)();
      expect(onPick, `плитка ${String(t.props['data-troop'])}`).toHaveBeenCalledWith(t.props['data-troop']);
    }
    const src = readFileSync(join(__dirname, '../panels/ArmyPanel.tsx'), 'utf8');
    expect(src, 'плитка — выбор вида').toContain('<Roster onPick={setPick} />');
    expect(src, 'карточка — выбранного вида').toMatch(/<KindCard\s+troop=\{pick\}/);
    const layer = readFileSync(join(__dirname, 'KindCard.tsx'), 'utf8');
    expect(layer, 'поверх меню — порталом над шторкой').toMatch(/createPortal\([\s\S]*document\.body/);
  });

  it('карточка: имя, дома и в походе, раненые, жалованье вида — функциями игры', () => {
    // Область: часть вида в походе, часть ранена — все ячейки на месте.
    const s = party(ARMIES[0], (st) => {
      st.away = { spearman: 20 };
      st.wounded = [{ troops: { spearman: 5 }, until: 1e12 }];
    });
    const home = homeTroops(s).spearman ?? 0;
    expect(home, 'точка внутри области: дома меньше, чем всего').toBe(10);
    const { html } = card(props(s, 'spearman'));
    expect(html).toContain(TROOP_BY_ID.spearman.name);
    expect(cell(html, 'Дома')).toBe(fmtInt(home));
    expect(cell(html, 'В походе')).toBe(fmtInt(30 - home));
    expect(cell(html, 'Раненые')).toBe('5');
    const without = armyWagesPerDay({ ...s, army: { ...s.army, spearman: 0 } });
    expect(cell(html, 'Жалованье'), 'жалованье вида — ведомость без него').toBe(fmtInt(Math.round(armyWagesPerDay(s) - without)));
    const quiet = card(props(party(ARMIES[0]), 'archer')).html;
    expect(cell(quiet, 'Раненые'), 'раненых нет — ячейки нет').toBeNull();
  });

  it('«Всё о виде» ведёт в полную карточку, крестик закрывает', () => {
    const s = party(ARMIES[0]);
    const onMore = vi.fn();
    const onClose = vi.fn();
    const { tree } = card(props(s, 'archer', { onMore, onClose }));
    (tree.find((e) => e.type === Btn && e.props.kind === 'link')!.props.onClick as () => void)();
    expect(onMore).toHaveBeenCalledOnce();
    (tree.find((e) => cls(e, 'kit-close'))!.props.onClick as () => void)();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('ДР-8: роспуск через карточку — ровно выбранное число', () => {
  it('выбрал k — «Распустить k»: ушло ровно k, вернулось то, что карточка показала, жалованье — как показано', () => {
    // Область: 1 ≤ k ≤ дома; дома 30 копейщиков из 30.
    for (const k of [1, 3, 10, 30]) {
      const s = party(ARMIES[0]);
      const home = homeTroops(s).spearman ?? 0;
      expect(k >= 1 && k <= home, `точка ${k} внутри области`).toBe(true);
      const onDismiss = vi.fn((m: number) => dismissSoldiers(s, 'spearman', m));
      const { go, html } = card(props(s, 'spearman', { n: k, onDismiss }));
      expect(text(go.props.children), 'подпись кнопки').toBe(`Распустить ${fmtInt(k)}`);
      expect(go.props.confirm, 'двумя касаниями').toBe(true);
      const back = dismissReturns('spearman', k);
      expect(html, 'вернутся жители').toContain(`+${fmtInt(back.people)}`);
      for (const g of Object.values(back.gear)) expect(html, 'вернётся снаряжение').toContain(`+${fmtInt(g ?? 0)}`);
      const shown = /→ <b>([^<]+)<\/b>/.exec(html)?.[1];
      const pop = s.pop;
      const gear = { ...s.equipment };
      (go.props.onClick as () => void)();
      expect(onDismiss).toHaveBeenCalledWith(k);
      expect(onDismiss).toHaveReturnedWith(null);
      expect(s.army.spearman, 'ушло ровно k').toBe(30 - k);
      expect(s.pop - pop).toBe(back.people);
      for (const [id, g] of Object.entries(back.gear)) expect(s.equipment[id as keyof typeof s.equipment] - gear[id as keyof typeof gear], id).toBe(g);
      expect(shown, 'жалованье после — ведомость после роспуска').toBe(num(armyWagesPerDay(s), 1));
    }
  });

  it('быстрые числа и шаг ставят ровно своё; «Все дома» — сколько дома, а не всего', () => {
    const s = party({ spearman: 150 }, (st) => {
      st.away = { spearman: 30 };
    });
    const home = homeTroops(s).spearman ?? 0;
    expect(home, 'точка внутри области: дома больше ста, часть в походе').toBe(120);
    const onCount = vi.fn();
    const { tree } = card(props(s, 'spearman', { n: 10, onCount }));
    const chips = tree.filter((e) => cls(e, 'dr-chip'));
    expect(chips.map((e) => text(e.props.children))).toEqual([...QUICK.map(String), 'Все дома']);
    for (const c of chips) (c.props.onClick as () => void)();
    expect(onCount.mock.calls.map((c) => c[0])).toEqual([...QUICK, home]);
    onCount.mockClear();
    const steps = tree.filter((e) => e.type === 'button' && (e.props['aria-label'] === 'Меньше' || e.props['aria-label'] === 'Больше'));
    for (const b of steps) (b.props.onClick as () => void)();
    expect(onCount.mock.calls.map((c) => c[0]), 'шаг — на один от выбранного').toEqual([9, 11]);
  });

  it('выбор больше, чем дома (ушли после выбора), — распускает дома, а не выбор', () => {
    const s = party({ spearman: 30 }, (st) => {
      st.away = { spearman: 25 };
    });
    expect(dismissPick(100, 5)).toBe(5);
    const onDismiss = vi.fn((m: number) => dismissSoldiers(s, 'spearman', m));
    const { go } = card(props(s, 'spearman', { n: 100, onDismiss }));
    (go.props.onClick as () => void)();
    expect(onDismiss).toHaveBeenCalledWith(5);
    expect(s.army.spearman).toBe(25);
  });
});

describe('ДР-8: погашенное объясняет причину', () => {
  it('все в походе — «Распустить» погашено словами `dismissCheck`, шаг и быстрые числа погашены, «Вернётся» нет', () => {
    const s = party({ spearman: 30 }, (st) => {
      st.away = { spearman: 30 };
    });
    expect(homeTroops(s).spearman ?? 0, 'точка внутри области: дома никого').toBe(0);
    const why = dismissCheck(s, 'spearman', 1).blocked;
    expect(why).toBe('Дома таких нет, все в походе.');
    const { tree, go, html } = card(props(s, 'spearman'));
    expect(go.props.why).toBe(why);
    expect(html, 'причина — строкой под кнопкой').toContain(`<small class="kit-why">${why}</small>`);
    for (const b of tree.filter((e) => e.type === 'button' && (cls(e, 'dr-chip') || /Меньше|Больше/.test(String(e.props['aria-label'] ?? ''))))) {
      expect(b.props.disabled, `«${text(b.props.children)}» погашено`).toBe(true);
    }
    expect(html).not.toContain('Вернётся');
  });

  it('одни раненые — погашено «Таких бойцов нет.»; дома меньше быстрого числа — это число погашено', () => {
    const hurt = party({}, (st) => {
      st.wounded = [{ troops: { archer: 4 }, until: 1e12 }];
    });
    expect(card(props(hurt, 'archer')).go.props.why).toBe('Таких бойцов нет.');
    const few = party({ archer: 12 });
    const chips = card(props(few, 'archer')).tree.filter((e) => cls(e, 'dr-chip'));
    expect(chips.map((e) => Boolean(e.props.disabled)), '1 и 10 открыты, 100 погашено, «Все дома» открыто').toEqual([false, false, true, false]);
  });
});

describe('ДР-8: убранные надписи записаны', () => {
  // Что ДР-8 убрал из «Дружины» — дословно, как стояло в коде до ДР-8 (`{…}` — подстановка числа или имени).
  const REMOVED = [
    '{N} бойцов · мощь {M}',
    'Мораль и дисциплина',
    '{N} бойцов',
    '· в строю {M}',
    'Всего {N} бойцов, в строю {M}, в лазарете {K}.',
    'Роспуск',
    'Распущенные станут жителями, снаряжение вернётся на склад. Плата за найм и учения пропадает. Распускают только тех, кто дома.',
    'дома {N} из {M}',
    'все в походе',
    'жителей +{N}, на склад: {снаряжение} {K}; жалованье −{W} в день',
  ];
  const doc = readFileSync(join(__dirname, '../../../docs/ui_v2.md'), 'utf8');
  const from = doc.indexOf('#### Дружина — отложенные надписи');
  const section = doc.slice(from, doc.indexOf('\n#### ', from + 1));
  const recorded = [...section.matchAll(/^\| `([^`]+)` \| ([^|]+) \|/gm)].map((m) => ({ text: m[1], where: m[2].trim() }));

  it('каждая убранная надпись — в docs/ui_v2.md дословно и с местом', () => {
    expect(from, 'раздел есть').toBeGreaterThan(0);
    for (const t of REMOVED) {
      const row = recorded.find((r) => r.text === t);
      expect(row, `«${t}» записана`).toBeDefined();
      expect(row!.where.length, `у «${t}» названо место`).toBeGreaterThan(3);
    }
  });

  it('записанного в окне больше нет — ни во вкладках, ни в карточке', () => {
    const s = party(ARMIES[0], (st) => {
      st.wounded = [{ troops: { spearman: 7 }, until: 1e12 }];
    });
    const tabs: ArmyTab[] = ['roster', 'spirit', 'wage'];
    const html = [
      ...tabs.map((t) => renderToStaticMarkup(h(ArmyPanel, { start: t }))),
      ...rosterTiles(s).map((t) => renderToStaticMarkup(h(KindCardBody, props(s, t.id)))),
    ].join('\n');
    const re = (t: string): RegExp => new RegExp(t.split(/\{[^}]+\}/).map((p) => p.replace(/[.*+?^$()|[\]\\]/g, '\\$&')).join('[^<>]{0,40}?'));
    expect(recorded.length, 'точка внутри области: записи есть').toBeGreaterThanOrEqual(REMOVED.length);
    // Заголовки «Мораль и дисциплина» и «Роспуск» — по тегу: имя шкал и слово в строке жалованья законно живут дальше.
    for (const r of recorded) {
      const head = r.where.includes('заголовок раздела');
      expect(html, `«${r.text}» убрана`).not.toMatch(head ? new RegExp(`<h3>${r.text}</h3>`) : re(r.text));
    }
  });
});
