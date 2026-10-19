// Р-3: найм — значки видов сеткой, карточка выбранного, число и «Нанять» в потоке окна (docs/ui_v2.md, «Решения Р-3»).
// Область правила — каждый вид каждого места найма (`hereOf`: казармы и конюшня); тест берёт их все и проверяет, что
// список не пуст.
import { describe, expect, it, vi } from 'vitest';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInitialState } from '@/game/state';
import { TROOP_BY_ID } from '@/game/data/troops';
import type { GameState, TroopId } from '@/game/types';
import { troopBlock } from '@/game/sim/tech';
import { HireBody, hereOf, type HireProps } from './RecruitNew';

const PLACES = ['barracks', 'stable'] as const;

type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;

/** Все элементы дерева, которое вернуло тело найма, — без отрисовки вложенных компонентов. */
function elements(node: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach((c) => elements(c, out));
  else if (isValidElement(node)) {
    const el = node as El;
    out.push(el);
    elements(el.props.children, out);
  }
  return out;
}

function props(s: GameState, at: HireProps['at'], pick: TroopId, over: Partial<HireProps> = {}): HireProps {
  return { s, at, pick, n: 1, onPick: () => {}, onCount: () => {}, act: () => true, openBuilding: () => {}, show: () => {}, ...over };
}

/** Партия, где всё изучено и хватает всего: «Нанять» открыто у любого вида. */
function rich(): GameState {
  const s = createInitialState();
  s.tutorialDone = true;
  s.realm.tech.war = 99;
  for (const k of Object.keys(s.resources) as (keyof GameState['resources'])[]) s.resources[k] += 5000;
  for (const k of Object.keys(s.equipment) as (keyof GameState['equipment'])[]) s.equipment[k] += 100;
  return s;
}

describe('найм: выбор вида (Р-3)', () => {
  for (const at of PLACES) {
    it(`${at}: любой вид выбирается значком, закрытый тоже, и карточка показывает выбранный`, () => {
      const s = createInitialState();
      const here = hereOf(at);
      expect(here.length, 'у места найма есть виды').toBeGreaterThan(0);
      const from = here[0];
      for (const id of here) {
        const onPick = vi.fn();
        const tree = elements(HireBody(props(s, at, from, { onPick })));
        const tile = tree.find((e) => e.props['data-troop'] === id);
        expect(tile, `значок ${id}`).toBeDefined();
        expect(tile!.props.disabled, `значок ${id} не гаснет`).toBeFalsy();
        (tile!.props.onClick as () => void)();
        expect(onPick, `нажатый ${id} выбран`).toHaveBeenCalledWith(id);

        const html = renderToStaticMarkup(createElement(HireBody, props(s, at, id)));
        const checked = [...html.matchAll(/aria-checked="true"[^>]*data-troop="(\w+)"/g)].map((m) => m[1]);
        expect(checked, `подсвечен ровно ${id}`).toEqual([id]);
        expect(html, 'карточка — выбранного').toContain(`<b>${TROOP_BY_ID[id].name}</b>`);
        const why = troopBlock(s, id);
        if (why) expect(html, `закрытый ${id} — с причиной`).toContain(why);
      }
    });
  }
  it('у новой партии есть и закрытые виды: точки закрытого внутри области', () => {
    const s = createInitialState();
    expect(PLACES.flatMap(hereOf).some((id) => troopBlock(s, id) !== null)).toBe(true);
  });
});

describe('найм: нанимается выбранный вид (Р-3)', () => {
  for (const at of PLACES) {
    it(`${at}: «Нанять» ставит в очередь именно выбранный вид и число`, () => {
      for (const id of hereOf(at)) {
        const s = rich();
        const act = vi.fn((fn: (st: GameState) => string | null) => fn(s) === null);
        const tree = elements(HireBody(props(s, at, id, { n: 2, act })));
        const go = tree.find((e) => e.props['data-tut'] === `recruit-${id}`);
        expect(go, `кнопка найма ${id}`).toBeDefined();
        expect(go!.props.disabled, `найм ${id} открыт`).toBe(false);
        (go!.props.onClick as () => void)();
        expect(act).toHaveReturnedWith(true);
        const order = s.recruits[s.recruits.length - 1];
        expect(order?.troop, `в очереди ${id}`).toBe(id);
        expect(order?.count).toBe(2);
      }
    });
  }
});
