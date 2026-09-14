import { describe, expect, it } from 'vitest';
import { LocalWorld, HOME_ID } from './local/LocalWorld';
import type { WorldSave } from './local/state';
import type { PlayerProfile } from './types';

const START = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const profile = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Тест',
  // Выше AI_MIN_POP: без этого набегов на деревню нет вовсе, и тест проверял бы пустоту.
  pop: 120,
  defense: 30,
  warriorPower: 3,
  units: { warrior: 10, scout: 4 },
  command: 60,
  stock: { food: 120, wood: 80 },
  stash: 0,
  ...over,
});

/** Мир с ручными часами и сохранением в памяти: сохранение читается глазами теста. */
function makeWorld(seed: number) {
  let now = START;
  let saved: string | null = null;
  const world = new LocalWorld({
    seed,
    now: () => now,
    storage: {
      read: () => saved,
      write: (json) => {
        saved = json;
      },
    },
  });
  return {
    world,
    at: (t: number): void => {
      now = t;
    },
    now: (): number => now,
    save: (): WorldSave => JSON.parse(saved ?? 'null') as WorldSave,
  };
}

/** Чужие отряды, идущие на деревню. */
const onHome = (save: WorldSave) => save.marches.filter((m) => !m.own && m.targetId === HOME_ID);

describe('инвариант уведомлений: набег на деревню рождается только на пульсе', () => {
  /**
   * **От этого теста зависят уведомления (docs/NOTIFY.md, разделы 1 и 8).**
   *
   * Список того, о чём сервер скажет игроку, пока его нет, составляет клиент в
   * минуту ухода — из сохранения мира. Полон этот список ровно потому, что набег на
   * деревню рождается только на пульсе, в минуту пульса (`scheduleAi` с
   * `departAt: now`), и чужой отряд на деревню в мире один. Значит в минуту ухода в
   * сохранении уже лежит каждый набег, который дойдёт до ворот до следующего
   * открытия.
   *
   * Если мир начнёт жить без игрока — набеги станут рождаться в догоне задним
   * числом, «в ту минуту, на которую были назначены», — клиент перестанет знать о
   * них в минуту ухода, и **уведомления станут неполными молча**: сервер честно
   * пришлёт всё, что ему дали, а о набеге, рождённом в офлайне, не узнает никто,
   * кроме игрока, потерявшего город. Хочешь, чтобы мир жил без игрока, — сначала
   * реши, откуда тогда брать уведомления, и перепиши этот тест вместе с ними.
   *
   * Граница области: догон берётся большим шагом (три часа — дальше любой паузы
   * между набегами), и каждая точка обязана быть внутри правила — к минуте догона
   * набег **должен был** созреть (`nextAiAt` в прошлом): только тогда «задним
   * числом» ему было откуда взяться. Это проверяется утверждением, а не расчётом в
   * голове, и хоть один набег обязан родиться на догоне.
   */
  it('мир, догоняемый большим шагом, не рождает отряда на деревню задним числом', async () => {
    const STEP = 3 * HOUR;
    let born = 0;
    for (const seed of [202, 404, 606, 808]) {
      const w = makeWorld(seed);
      await w.world.sync(profile());
      for (let step = 0; step < 6; step++) {
        const before = w.save();
        const had = new Set(onHome(before).map((m) => m.id));
        const catchUp = w.now() + STEP;
        w.at(catchUp);
        await w.world.sync(profile());
        const after = w.save();
        const fresh = onHome(after).filter((m) => !had.has(m.id));

        // Отряд на деревню в мире один — в любую минуту.
        expect(onHome(after).filter((m) => m.phase === 'out').length, `сид ${seed}: отрядов на деревню`).toBeLessThanOrEqual(1);

        for (const m of fresh) {
          // Граница области: набег созрел раньше минуты догона, то есть «задним
          // числом» ему было откуда взяться.
          expect(before.nextAiAt, `сид ${seed}, шаг ${step}: набег созрел до догона`).toBeLessThan(catchUp);
          expect(
            m.departAt,
            `сид ${seed}, шаг ${step}: отряд ${m.id} на деревню вышел задним числом, за ${
              Math.round((catchUp - m.departAt) / 1000)
            } с до догона — уведомления больше не полны`,
          ).toBeGreaterThanOrEqual(catchUp);
          born++;
        }
      }
    }
    // Точки внутри области есть: хоть один набег родился на догоне.
    expect(born, 'догон родил хоть один набег на деревню').toBeGreaterThan(3);
  }, 60_000);
});
