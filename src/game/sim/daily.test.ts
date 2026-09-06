import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { MAX_BUILDING_LEVEL, RESOURCE_IDS } from '../constants';
import { population, storageCap } from '../derived';
import { deserialize, serialize } from '../save';
import { DAILY_GAMES, dailyGameOf, dailySeed, dayIndex, untilNextDay } from '../data/daily';
import { DAILY_CAP_SHARE, dailyReward, dailyStatus, finishDaily, startDaily } from './daily';

/** Сегодняшний номер дня — тот же счёт, что и в интерфейсе. */
const TODAY = dayIndex(Date.UTC(2026, 8, 5, 12, 0, 0));

describe('ежедневное задание: календарь', () => {
  it('день считается по UTC, а не по местной дате: у полуночи одна граница на всех', () => {
    const noonUtc = Date.UTC(2026, 8, 5, 12);
    // Тот же момент времени в любом поясе — тот же номер дня.
    expect(dayIndex(noonUtc)).toBe(dayIndex(noonUtc));
    // Сутки — ровно сутки: 23:59:59 и 00:00:00 следующих суток различаются на единицу.
    expect(dayIndex(Date.UTC(2026, 8, 5, 23, 59, 59))).toBe(dayIndex(Date.UTC(2026, 8, 5, 0, 0, 0)));
    expect(dayIndex(Date.UTC(2026, 8, 6))).toBe(dayIndex(Date.UTC(2026, 8, 5)) + 1);
  });

  it('до следующего задания остаётся то, что осталось от суток', () => {
    expect(untilNextDay(Date.UTC(2026, 8, 5, 23, 0))).toBe(3600_000);
    expect(untilNextDay(Date.UTC(2026, 8, 5, 0, 0))).toBe(86_400_000);
  });

  it('задание одинаково у двух разных партий в один день и разное в разные дни', () => {
    const a = createInitialState();
    const b = createInitialState();
    b.pop = 500;
    b.time = 9999;
    expect(dailyStatus(a, TODAY).game).toBe(dailyStatus(b, TODAY).game);
    expect(dailyStatus(a, TODAY).seed).toBe(dailyStatus(b, TODAY).seed);
    // Соседние дни не должны давать похожий сид — иначе уровни повторялись бы.
    expect(dailySeed(TODAY)).not.toBe(dailySeed(TODAY + 1));
  });

  it('три игры чередуются: за каждую тройку дней каждая выпадает ровно раз', () => {
    for (let block = 0; block < 400; block++) {
      const games = [0, 1, 2].map((i) => dailyGameOf(block * 3 + i));
      expect(new Set(games).size).toBe(3);
    }
  });

  it('порядок внутри тройки перемешан, а не один и тот же', () => {
    const orders = new Set<string>();
    for (let block = 0; block < 200; block++) {
      orders.add([0, 1, 2].map((i) => dailyGameOf(block * 3 + i)).join(','));
    }
    // Шесть перестановок; довольно, чтобы порядок не был предсказуем циклом.
    expect(orders.size).toBeGreaterThan(3);
  });

  it('за год каждая из трёх игр выпадает примерно поровну', () => {
    const count = new Map<string, number>();
    for (let d = 0; d < 366; d++) {
      const g = dailyGameOf(TODAY + d);
      count.set(g, (count.get(g) ?? 0) + 1);
    }
    expect(count.size).toBe(DAILY_GAMES.length);
    for (const n of count.values()) expect(Math.abs(n - 122)).toBeLessThan(4);
  });
});

describe('ежедневное задание: попытка', () => {
  it('в новой партии попытка есть, начатая — тратится', () => {
    const s = createInitialState();
    expect(dailyStatus(s, TODAY).played).toBe(false);
    expect(startDaily(s, TODAY)).toBeNull();
    expect(dailyStatus(s, TODAY).played).toBe(true);
    expect(dailyStatus(s, TODAY).won).toBe(false);
  });

  it('уйти с экрана и зайти заново — не вторая попытка: заход уже записан проигранным', () => {
    const s = createInitialState();
    startDaily(s, TODAY);
    // Игрок закрыл шторку, ничего не доиграв. Состояние про это уже знает.
    expect(dailyStatus(s, TODAY).played).toBe(true);
    expect(startDaily(s, TODAY)).not.toBeNull();
  });

  it('проиграл — награды нет и повтора сегодня нет', () => {
    const s = createInitialState();
    const before = { ...s.resources };
    startDaily(s, TODAY);
    expect(finishDaily(s, TODAY, false)).toBeNull();
    for (const r of RESOURCE_IDS) expect(s.resources[r]).toBeCloseTo(before[r], 5);
    expect(s.stats.dailyWins).toBe(0);
    // Ни повторного старта, ни попытки объявить себя победителем задним числом.
    expect(startDaily(s, TODAY)).not.toBeNull();
    expect(finishDaily(s, TODAY, true)).toBeNull();
    expect(s.stats.dailyWins).toBe(1);
  });

  it('выиграл — награда легла на склад, и второй раз за день выиграть нельзя', () => {
    const s = createInitialState();
    const before = { ...s.resources };
    const game = dailyStatus(s, TODAY).game;
    const reward = dailyReward(s, game);
    startDaily(s, TODAY);
    expect(finishDaily(s, TODAY, true)).toBeNull();

    for (const r of RESOURCE_IDS) {
      expect(s.resources[r]).toBeCloseTo(Math.min(storageCap(s), before[r] + (reward[r] ?? 0)), 5);
    }
    expect(s.stats.dailyWins).toBe(1);
    expect(finishDaily(s, TODAY, true)).not.toBeNull();
    expect(s.stats.dailyWins).toBe(1);
  });

  it('итог без начатой попытки не принимается: кнопке не верят', () => {
    const s = createInitialState();
    expect(finishDaily(s, TODAY, true)).not.toBeNull();
    expect(s.stats.dailyWins).toBe(0);
    // И чужой день тоже не годится.
    startDaily(s, TODAY);
    expect(finishDaily(s, TODAY + 1, true)).not.toBeNull();
    expect(s.stats.dailyWins).toBe(0);
  });

  it('перевод часов назад не открывает вторую попытку', () => {
    const s = createInitialState();
    startDaily(s, TODAY);
    finishDaily(s, TODAY, false);
    // Игрок ушёл в настройки телефона и поставил вчерашнюю дату.
    expect(dailyStatus(s, TODAY - 1).played).toBe(true);
    expect(startDaily(s, TODAY - 1)).not.toBeNull();
    expect(s.stats.dailyWins).toBe(0);
    // И награду задним числом тоже не выписать.
    expect(finishDaily(s, TODAY - 1, true)).not.toBeNull();
    expect(s.stats.dailyWins).toBe(0);
  });

  it('после победы откат часов тоже закрыт: второй награды не будет', () => {
    const s = createInitialState();
    startDaily(s, TODAY);
    finishDaily(s, TODAY, true);
    const food = s.resources.food;
    // Вчерашний день показан сыгранным, а не свободным.
    expect(dailyStatus(s, TODAY - 1).played).toBe(true);
    expect(startDaily(s, TODAY - 1)).not.toBeNull();
    expect(finishDaily(s, TODAY - 1, true)).not.toBeNull();
    expect(s.stats.dailyWins).toBe(1);
    expect(s.resources.food).toBe(food);
  });

  /**
   * Обратная сторона храповика, и она достаётся не жулику, а человеку со сбитой
   * датой: телефон с датой на год вперёд (заводская, севшая батарейка, ручная
   * правка ради чужого приложения), одна сыгранная попытка — и ежедневка
   * закрыта, пока календарь не догонит запись. Открыть её нельзя: этим же ходом
   * попытку и множат. Но состояние обязано отличать «сегодня не вышло» от
   * «часы отстают от записи» — иначе панель год обещает «приходи завтра».
   */
  it('часы, ушедшие вперёд, запирают задание — и это видно отдельно от проигрыша', () => {
    const s = createInitialState();
    const ahead = TODAY + 400;
    expect(startDaily(s, ahead)).toBeNull();
    expect(finishDaily(s, ahead, true)).toBeNull();

    const now = dailyStatus(s, TODAY);
    expect(now.played).toBe(true);
    expect(now.clockBehind).toBe(true);
    // Победа принадлежит записанному дню: сегодня её не было, и обещать
    // награду за сегодня нельзя.
    expect(now.won).toBe(false);
    expect(startDaily(s, TODAY)).not.toBeNull();
    // И через год тоже, пока дата не догонит запись.
    expect(dailyStatus(s, TODAY + 399).clockBehind).toBe(true);
    // День записи и всё, что после, — уже не «часы отстают».
    expect(dailyStatus(s, ahead).clockBehind).toBe(false);
    expect(dailyStatus(s, ahead).won).toBe(true);
    expect(dailyStatus(s, ahead + 1).clockBehind).toBe(false);
    expect(dailyStatus(s, ahead + 1).played).toBe(false);
  });

  it('в обычной партии часы не «отстают»: признак не загорается на ровном месте', () => {
    const s = createInitialState();
    expect(dailyStatus(s, TODAY).clockBehind).toBe(false);
    startDaily(s, TODAY);
    expect(dailyStatus(s, TODAY).clockBehind).toBe(false);
    finishDaily(s, TODAY, false);
    expect(dailyStatus(s, TODAY).clockBehind).toBe(false);
    expect(dailyStatus(s, TODAY + 1).clockBehind).toBe(false);
    // Перевод на вчера — это уже «часы отстают», и попытка по-прежнему закрыта.
    expect(dailyStatus(s, TODAY - 1).clockBehind).toBe(true);
    expect(dailyStatus(s, TODAY - 1).played).toBe(true);
  });

  it('назавтра попытка открывается снова', () => {
    const s = createInitialState();
    startDaily(s, TODAY);
    finishDaily(s, TODAY, false);
    expect(dailyStatus(s, TODAY + 1).played).toBe(false);
    expect(startDaily(s, TODAY + 1)).toBeNull();
  });

  it('исход переживает сохранение и загрузку', () => {
    const s = createInitialState();
    startDaily(s, TODAY);
    finishDaily(s, TODAY, true);
    const loaded = deserialize(serialize(s));
    expect(loaded).not.toBeNull();
    expect(dailyStatus(loaded!, TODAY).won).toBe(true);
    expect(startDaily(loaded!, TODAY)).not.toBeNull();
  });

  it('сохранение без ежедневки читается как «сегодня ещё не играли», а не как undefined', () => {
    const s = createInitialState();
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete raw.daily;
    const loaded = deserialize(JSON.stringify(raw));
    expect(loaded).not.toBeNull();
    expect(loaded!.daily).toEqual({ day: 0, result: 'none' });
    expect(dailyStatus(loaded!, TODAY).played).toBe(false);
  });
});

describe('ежедневное задание: награда', () => {
  it('награда — только ресурсы: ни золота, ни алмазов не прибавляется', () => {
    const s = createInitialState();
    const gold = s.gold;
    const gems = s.gems;
    startDaily(s, TODAY);
    finishDaily(s, TODAY, true);
    expect(s.gold).toBe(gold);
    expect(s.gems).toBe(gems);
  });

  it('награда растёт вместе с посёлком, а не тонет в дневной выработке', () => {
    const small = createInitialState();
    const big = createInitialState();
    big.pop = 750;
    // Склад поднят вместе с посёлком: иначе сработает потолок доли склада, и
    // проверялась бы уже не пропорция, а он.
    big.buildings.find((b) => b.type === 'storage')!.level = MAX_BUILDING_LEVEL;
    const game = dailyStatus(small, TODAY).game;
    const a = dailyReward(small, game);
    const b = dailyReward(big, game);
    const sum = (x: Partial<Record<(typeof RESOURCE_IDS)[number], number>>): number =>
      RESOURCE_IDS.reduce((n, r) => n + (x[r] ?? 0), 0);
    expect(sum(b)).toBeGreaterThan(sum(a) * 5);
    // Ровно во столько раз, во сколько племя больше стартовых тридцати.
    expect(sum(b) / sum(a)).toBeCloseTo(population(big) / population(small), 0);
  });

  it('одна награда не больше доли склада: посёлок без амбара не получает больше, чем в него влезет', () => {
    const s = createInitialState();
    s.pop = 5000; // заведомо больше, чем выдержит потолок
    const cap = Math.floor(storageCap(s) * DAILY_CAP_SHARE);
    for (const g of DAILY_GAMES) {
      const reward = dailyReward(s, g.id);
      for (const r of RESOURCE_IDS) expect(reward[r] ?? 0).toBeLessThanOrEqual(cap);
    }
  });

  it('победа и поражение пишутся в летопись', () => {
    const s = createInitialState();
    startDaily(s, TODAY);
    finishDaily(s, TODAY, true);
    expect(s.log[0].kind).toBe('good');
    expect(s.log[0].text).toContain('задание дня выполнено');

    const l = createInitialState();
    startDaily(l, TODAY);
    finishDaily(l, TODAY, false);
    expect(l.log[0].text).toContain('не вышло');
  });
});
