// Клиентский мир: пульсы по одному и ответы прежнего мира (OPS-4, docs/audit/WORKPLAN.md).
//  · Пульс, начатый, пока идёт другой, не запускает второй `sync` разом с первым: он идёт следом (действие игрока, ждущее
//    пульса, увидит свой итог), а лишние пульсы по таймеру сливаются в один.
//  · Мир заменён (`swapWorld`: «Начать заново», постройка при входе), а ответ прежнего ещё в пути — он не ложится ни в
//    партию, ни в стор.
import { afterEach, describe, expect, it } from 'vitest';
import { swapWorld, useWorld } from './store';
import { useGame } from '@/game/store';
import type { WorldApi } from './api';
import type { WorldPulse } from './types';

interface Gate {
  resolve: (p: WorldPulse) => void;
}

/** Мир, у которого `sync` отвечает, когда тест скажет; остальное — пусто. */
function fakeWorld(tag: string, log: string[], gates: Gate[]): WorldApi {
  const empty: WorldPulse = {
    now: 1_700_000_000_000,
    marches: [],
    figures: [],
    reports: [],
    effects: [],
    siege: null,
    faith: { id: 'catholic', pressure: 0 },
    unread: 0,
  } as unknown as WorldPulse;
  return new Proxy({} as WorldApi, {
    get: (_t, prop) => {
      if (prop === 'sync')
        return () => {
          log.push(`${tag}:start`);
          return new Promise<WorldPulse>((resolve) =>
            gates.push({
              resolve: (p) => {
                log.push(`${tag}:end`);
                resolve({ ...empty, ...p });
              },
            }),
          );
        };
      if (prop === 'then') return undefined;
      return async () => (prop === 'rivals' ? { proposals: [], marching: [] } : []);
    },
  });
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterEach(() => swapWorld(null));

describe('пульс клиентского мира (OPS-4)', () => {
  it('второй пульс ждёт первого, а не идёт разом; лишние сливаются в один', async () => {
    const log: string[] = [];
    const gates: Gate[] = [];
    swapWorld(fakeWorld('A', log, gates));
    const first = useWorld.getState().pulse();
    const second = useWorld.getState().pulse();
    const third = useWorld.getState().pulse();
    await flush();
    expect(log).toEqual(['A:start']);
    gates[0].resolve({} as WorldPulse);
    await flush();
    await flush();
    expect(log).toEqual(['A:start', 'A:end', 'A:start']);
    gates[1].resolve({} as WorldPulse);
    await Promise.all([first, second, third]);
    expect(log).toEqual(['A:start', 'A:end', 'A:start', 'A:end']);
  });

  it('ответ прежнего мира после замены не ложится ни в партию, ни в стор', async () => {
    const log: string[] = [];
    const gates: Gate[] = [];
    swapWorld(fakeWorld('A', log, gates));
    const pending = useWorld.getState().pulse();
    await flush();
    const before = useGame.getState().s.resources.wood;
    swapWorld(fakeWorld('B', log, gates));
    gates[0].resolve({
      effects: [{ id: 'old', lost: {}, resources: { wood: 7 }, prestige: 0, morale: 0, battle: null, text: 'старый мир', good: true }],
      marches: [{ id: 'm-old' }],
    } as unknown as WorldPulse);
    await pending;
    expect(useGame.getState().s.resources.wood).toBe(before);
    expect(useWorld.getState().marches.some((m) => m.id === 'm-old')).toBe(false);
  });
});
