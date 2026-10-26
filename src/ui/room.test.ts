// Окно «Склад заполнен» (решение владельца, docs/audit/OWNER-DECISIONS.md, п. 1): встаёт, только если что-то не влезает;
// «Отмена» — действия нет, партия та же; «Да» — действие сделано, и лишнее пропало. Вопрос один на экран.
import { afterEach, describe, expect, it } from 'vitest';
import { useGame } from '@/game/store';
import { createInitialState } from '@/game/state';
import { RESOURCE_IDS } from '@/game/constants';
import { storageCap } from '@/game/derived';
import { cancelUpgrade, startUpgrade } from '@/game/sim/actions';
import { roomText } from '@/game/sim/stockview';
import { actRoom, askRoom, useRoom } from './room';

/** Партия со стройкой, чья отмена вернёт цену на склад, полный до `left` единиц под вместимостью. */
function withSite(left: number): number {
  const s = createInitialState(3);
  for (const r of RESOURCE_IDS) s.resources[r] = storageCap(s);
  const b = s.buildings.find((x) => startUpgrade(s, x.id) === null)!;
  for (const r of RESOURCE_IDS) s.resources[r] = Math.max(0, storageCap(s) - left);
  useGame.setState({ s });
  // Точка внутри правила: стройка стоит в очереди, отмене есть что вернуть.
  expect(s.buildQueue.includes(b.id), 'стройка в очереди').toBe(true);
  return b.id;
}

const siteOf = (id: number): boolean => useGame.getState().s.buildQueue.includes(id);

afterEach(() => useRoom.getState().ask?.answer(false));

describe('окно «Склад заполнен»', () => {
  it('влезает всё — окна нет, дело сделано сразу', () => {
    const id = withSite(1e9);
    actRoom((s) => cancelUpgrade(s, id));
    expect(useRoom.getState().ask).toBeNull();
    expect(siteOf(id)).toBe(false);
  });

  it('не влезает: окно с числами двери склада; «Отмена» — партия не тронута', () => {
    const id = withSite(3);
    const shot = JSON.stringify(useGame.getState().s);
    actRoom((s) => cancelUpgrade(s, id));
    const ask = useRoom.getState().ask;
    expect(ask, 'окно встало').not.toBeNull();
    expect(ask!.over.every((o) => o.fits === 3 && o.wanted > 3)).toBe(true);
    expect(roomText(ask!.over)).toMatch(/^из \d+ единиц[ы]? [а-я]+ поместится только 3(, из .+)?, остальное пропадёт\. Продолжить\?$/);
    ask!.answer(false);
    expect(useRoom.getState().ask).toBeNull();
    expect(JSON.stringify(useGame.getState().s), 'партия та же').toBe(shot);
  });

  it('«Да» — дело сделано, на складе ровно вместимость', async () => {
    const id = withSite(3);
    actRoom((s) => cancelUpgrade(s, id));
    useRoom.getState().ask!.answer(true);
    await Promise.resolve();
    const s = useGame.getState().s;
    expect(siteOf(id), 'стройка отменена').toBe(false);
    const ask = useRoom.getState().ask;
    expect(ask).toBeNull();
    expect(RESOURCE_IDS.some((r) => s.resources[r] === storageCap(s))).toBe(true);
  });

  it('новый вопрос закрывает прежний отказом', async () => {
    const first = askRoom([{ resource: 'wood', wanted: 10, fits: 1 }]);
    const second = askRoom([{ resource: 'stone', wanted: 10, fits: 2 }]);
    expect(await first).toBe(false);
    expect(useRoom.getState().ask!.over[0].resource).toBe('stone');
    useRoom.getState().ask!.answer(true);
    expect(await second).toBe(true);
    // Пусто — спрашивать не о чем.
    expect(await askRoom([])).toBe(true);
    expect(useRoom.getState().ask).toBeNull();
  });
});
