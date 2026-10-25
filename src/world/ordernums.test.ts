// SETUP-4 (docs/audit/WORKPLAN.md): число из приказа — чужое число. `Math.max(0, Math.floor(NaN))` — NaN, и все
// сравнения с ним ложны: отряд из NaN разведчиков проходил «дома ли столько» и «пустой ли отряд» и уходил в поход.
// Область правила — приказ, который мир принимает: свой город готов (`sync`), цель в регионе, путь открыт.
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import { distance } from './geo';
import { shieldVillagers } from './lairs';
import type { PlayerProfile, SettlementView } from './types';

const START = 1_700_000_000_000;

const profile = (): PlayerProfile => ({
  name: 'Тест',
  pop: shieldVillagers(0.1),
  defense: 30,
  units: { warrior: 10, scout: 4 },
  stock: { food: 120, wood: 80 },
  stash: 0,
});

async function ready(): Promise<{ world: LocalWorld; target: SettlementView }> {
  const world = new LocalWorld({ seed: 31, now: () => START, storage: null });
  await world.sync(profile());
  const info = await world.info();
  const chunk = await world.region({ x: info.home.x - 24, y: info.home.y - 24, w: 48, h: 48 });
  const target = chunk.settlements.filter((s) => !s.mine).sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];
  return { world, target };
}

describe('числа приказа похода', () => {
  it('точка внутри области: честная разведка уходит', async () => {
    const { world, target } = await ready();
    const res = await world.send({ target: target.id, mission: 'scout', units: { scout: 3 } });
    expect(res.error).toBeNull();
    expect(res.march?.units).toEqual({ scout: 3 });
  });

  it('NaN, бесконечность и минус — не люди: отряд пустой, похода нет', async () => {
    for (const n of [NaN, Infinity, -Infinity, -3]) {
      const { world, target } = await ready();
      const res = await world.send({ target: target.id, mission: 'scout', units: { scout: n } });
      expect(res.march, String(n)).toBeNull();
      expect(res.error, String(n)).toBe('Отряд пустой.');
    }
  });

  it('ключ прототипа в отряде — не вид: в поход уходят только разведчики', async () => {
    const { world, target } = await ready();
    const units = JSON.parse('{"scout": 3, "constructor": 2}') as PlayerProfile['units'];
    const res = await world.send({ target: target.id, mission: 'scout', units });
    expect(res.error).toBeNull();
    expect(res.march?.units).toEqual({ scout: 3 });
  });
});
