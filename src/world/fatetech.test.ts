// Участь «увести людей» — верх военной ветви (docs/dynasty.md, раздел 11.2), и мир спрашивает
// её замок, не зная ни ветвей, ни уровней: замок приходит слепком готовой строкой гейта
// (`PlayerProfile.fateLocks` ← `sim/tech.fateLocks`), и проверяет его одна проверка участи
// (`spoils.fateBlock`) — на приказе «Ударить» и «Осадить», в строках выбора и на падении.
//
// Область, где правило спрашивается, названа в самом тесте: полководец с дружиной стоит у
// чужого логова, и любую участь, кроме запертой, мир здесь принимает, — иначе отказ приказа
// и отказ по замку были бы неразличимы.
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import { distance } from './geo';
import { shieldVillagers } from './lairs';
import { fateLocks } from '@/game/sim/tech';
import { createInitialState } from '@/game/state';
import type { TroopStack } from '@/game/battle/kinds';
import type { FigureView, PlayerProfile } from './types';

const START = 1_700_000_000_000;

function memory(data: string | null = null) {
  return {
    read: (): string | null => data,
    write: (json: string): void => {
      data = json;
    },
  };
}

const HOST: TroopStack = { legionary: 30, spearman: 24, archer: 16 };

const profile = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Тест',
  pop: shieldVillagers(0.1),
  defense: 900,
  militia: 1000,
  units: { warrior: 10, scout: 4 },
  army: { ...HOST },
  stock: { food: 600, wood: 400 },
  stash: 0,
  food: 6000,
  foodPerHour: 6000,
  soldierFoodPerHour: 60,
  ...over,
});

describe('замок участи: мир спрашивает его строкой гейта', () => {
  it('приказ, строки выбора и участь лагеря — одна проверка, одна строка', async () => {
    // Замок той партии, какой он бывает у игрока: новая партия, дверь гейта.
    const locks = fateLocks(createInitialState(7));
    const lock = locks.captives;
    expect(lock, 'точка внутри области: у новой партии участь заперта').toBeTruthy();
    const locked = profile({ fateLocks: locks });
    const open = profile();

    let now = START;
    const world = new LocalWorld({ seed: 7, now: () => now, storage: memory() });
    const general = async (): Promise<FigureView> => (await world.figures()).find((f) => f.id === 'general') as FigureView;
    await world.sync(locked);
    expect(await world.setGarrison({ ...HOST })).toBeNull();
    now = Math.max(now, (await general()).readyAt);
    await world.sync(locked);
    const info = await world.info();
    const near = (await world.region({ x: info.home.x - 24, y: info.home.y - 24, w: 48, h: 48 })).settlements
      .filter((s) => !s.mine)
      .sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];
    expect(await world.moveFigure('general', { x: near.x, y: near.y })).toBeNull();
    now = Math.max(now, (await general()).arriveAt);
    await world.sync(locked);

    // Строки выбора: запертая участь погашена той же строкой, соседние открыты.
    const card = await world.settlement(near.id);
    const row = (id: string) => card?.fates.find((f) => f.id === id);
    expect(row('plunder')?.can, 'точка внутри области: «ограбить» у этого логова можно').toBe(true);
    expect(row('captives')?.can, 'строка выбора: заперто').toBe(false);
    expect(row('captives')?.reason, 'строка выбора: причина — строка гейта').toBe(lock);

    // Приказ: «Ударить» и «Осадить» отказывают той же строкой и ничего не начинают.
    expect((await world.attack({ fate: 'captives' })).error, 'удар отказывает строкой гейта').toBe(lock);
    expect(await world.besiege('captives'), 'осада отказывает строкой гейта').toBe(lock);
    expect(await world.camp(), 'лагеря нет: приказ не прошёл').toBeNull();

    // Ступень куплена: замков нет — поля нет, — и тот же приказ проходит.
    await world.sync(open);
    expect((await world.settlement(near.id))?.fates.find((f) => f.id === 'captives')?.can, 'купил — открыто').toBe(true);
    expect(await world.besiege('captives')).toBeNull();
    expect((await world.camp())?.fate, 'лагерь объявил увести людей').toBe('captives');

    // Замок вернулся (слепок заперт), а приказ отдан раньше: падение его не исполняет —
    // исполняет умолчание. Участь лагеря и участь в карточке города — та же проверка,
    // которой делит взятый город падение (`fateFor`).
    await world.sync(locked);
    expect((await world.camp())?.fate, 'окно лагеря: объявленное заперто — умолчание').toBe('plunder');
    expect((await world.settlement(near.id))?.siege?.fate, 'карточка города: то же').toBe('plunder');
  }, 120_000);
});
