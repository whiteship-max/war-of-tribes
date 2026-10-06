import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveRecord } from '../../netlify/lib/contract';

/**
 * Правило встречи двух копий. Проверяется отдельно от всего остального, потому
 * что это единственное место, где прогресс может пропасть: три ветки из четырёх
 * что-нибудь перезаписывают, и любая, поставленная не туда, стирает вечер игры
 * молча.
 *
 * Само правило теперь такое: **сервер — единственная правда, местная копия —
 * его продолжение.** Вопроса игроку нет ни в одной ветке, и это осознанный
 * размен: первая минута игры не должна начинаться с разбирательства. Держится
 * он на двух вещах, и обе проверяются ниже прогоном, а не на слово, — что
 * обычная игра без сети расхождением не считается вовсе, и что проигравшая
 * копия остаётся достижимой.
 */
describe('какую партию оставить при запуске', () => {
  it('на сервере пусто — кладём свою', async () => {
    const { decide } = await import('./sync');
    expect(decide({ hasLocal: true, remoteEtag: null, knownEtag: null })).toBe('first');
    expect(decide({ hasLocal: false, remoteEtag: null, knownEtag: 'e1' })).toBe('first');
  });

  /**
   * Ради этого сервер и заведён: игрок почистил данные браузера или зашёл с
   * нового телефона. Спорить не с чем — берём серверную.
   */
  it('своей нет — берём серверную', async () => {
    const { decide } = await import('./sync');
    expect(decide({ hasLocal: false, remoteEtag: 'e1', knownEtag: null })).toBe('adopt');
    expect(decide({ hasLocal: false, remoteEtag: 'e1', knownEtag: 'e0' })).toBe('adopt');
  });

  it('серверная — наша же предыдущая: играем дальше и кладём поверх', async () => {
    const { decide } = await import('./sync');
    expect(decide({ hasLocal: true, remoteEtag: 'e7', knownEtag: 'e7' })).toBe('continue');
  });

  /**
   * Все три случая, когда серверная запись не наша, — это расхождение: играли
   * на двух устройствах; на этом устройстве ещё ни разу не синхронизировались;
   * копию, которой мы наследовали, кто-то перезаписал. Решаются они одинаково —
   * в пользу серверной, а своя откладывается.
   */
  it('серверная не продолжает нашу — уступаем ей', async () => {
    const { decide } = await import('./sync');
    expect(decide({ hasLocal: true, remoteEtag: 'e9', knownEtag: 'e7' })).toBe('yield');
    expect(decide({ hasLocal: true, remoteEtag: 'e9', knownEtag: null })).toBe('yield');
  });

  /**
   * Отдельно: пустая отметка не считается совпадением. Соблазн прочесть «не
   * знаю, чему наследую» как «наследую тому, что лежит» велик — и стоил бы
   * дорого: устройство, ни разу не синхронизировавшееся, молча затирало бы
   * чужую партию своей.
   */
  it('«не знаю, чему наследую» — это не «наследую этому»', async () => {
    const { decide } = await import('./sync');
    expect(decide({ hasLocal: true, remoteEtag: 'e1', knownEtag: null })).not.toBe('continue');
  });

  it('веток по-прежнему четыре, и они различимы', async () => {
    const { decide } = await import('./sync');
    const all = [
      decide({ hasLocal: true, remoteEtag: null, knownEtag: null }),
      decide({ hasLocal: false, remoteEtag: 'e1', knownEtag: null }),
      decide({ hasLocal: true, remoteEtag: 'e7', knownEtag: 'e7' }),
      decide({ hasLocal: true, remoteEtag: 'e9', knownEtag: 'e7' }),
    ];
    expect(new Set(all)).toEqual(new Set(['first', 'adopt', 'continue', 'yield']));
  });
});

/*
 * Ниже — не таблица решений, а сам запуск: `syncBoot` целиком, с хранилищем,
 * ведением партии между вкладками и разговором с сервером. Проверять правило
 * одной чистой функцией мало: «ничего не теряется» — это про то, что уехало на
 * сервер и что легло на диск, а не про то, какое слово вернул `decide`.
 *
 * Наружу от игры замокано ровно четыре двери: сохранение племени, сохранение
 * мира, подпись Telegram и сеть. Всё остальное — настоящее, включая договор
 * вкладок о ведении партии: он ходит в то же хранилище, что и синхронизация, и
 * подменять его значило бы проверять не тот код.
 */
const H = vi.hoisted(() => ({
  adoptSave: vi.fn((_json: string) => true),
  worldWrite: vi.fn(),
  worldClear: vi.fn(),
  apiGet: vi.fn(),
  apiPut: vi.fn(),
  /** Что лежит на этом устройстве прямо сейчас, глазами слепка. */
  local: { game: '', world: null as string | null, day: 0 },
  reload: vi.fn(),
}));

vi.mock('@/game/save', () => ({ adoptSave: H.adoptSave }));
vi.mock('@/world/local/state', () => ({
  browserStorage: { read: () => H.local.world, write: H.worldWrite, clear: H.worldClear },
}));
vi.mock('@/telegram/webapp', () => ({ tgInitData: () => 'подпись' }));
vi.mock('./api', () => ({ apiGet: H.apiGet, apiPut: H.apiPut }));
vi.mock('./snapshot', () => ({
  snapshotOf: () => record(H.local.game, H.local.day, H.local.world),
}));

const shelf = new Map<string, string>();

/** Запись, какой её видит сервер. Опись — то немногое, по чему её узнают. */
function record(game: string, day: number, world: string | null = null, device = 'd-наше'): SaveRecord {
  return {
    v: 1,
    rev: day,
    updatedAt: day,
    device,
    game,
    world,
    card: { name: 'Вождь', day, pop: 30 + day, power: day * 10, army: day },
  };
}

const ok = <T,>(data: T) => ({ ok: true as const, data });

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  shelf.clear();
  H.adoptSave.mockClear().mockReturnValue(true);
  H.worldWrite.mockClear();
  H.worldClear.mockClear();
  H.apiGet.mockReset();
  H.apiPut.mockReset();
  H.reload.mockClear();
  H.local = { game: '', world: null, day: 0 };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => shelf.get(k) ?? null,
      setItem: (k: string, v: string) => void shelf.set(k, v),
      removeItem: (k: string) => void shelf.delete(k),
    },
  });
  // Запуск синхронизации заводит часы вкладки и подписывается на её закрытие;
  // перезагрузку страницы после смены партии считаем вызовом, а не делаем.
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { addEventListener: () => {}, removeEventListener: () => {} },
  });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { reload: H.reload } });
});

afterEach(() => {
  vi.useRealTimers();
});

const META = 'tribe.sync.v1';
const SPARE = 'tribe.sync.spare.v1';

/**
 * Свежий запуск игры: новый экземпляр модуля синхронизации, которому показали,
 * где взять партию. Стор игры сюда не тянем — синхронизация про игру не знает
 * ничего, ей отдают строку (за строку отвечает мок `snapshotOf`).
 */
async function tab(): Promise<typeof import('./sync')> {
  const mod = await import('./sync');
  mod.provideGame(() => ({}) as never);
  return mod;
}

/**
 * Вкладку закрывают — она отпускает ведение партии, как это делает браузер по
 * `beforeunload`. Без этого шага следующий запуск в том же хранилище счёл бы
 * предыдущую вкладку живой и промолчал бы, а перезапуск игры после смены партии
 * — это обычный случай, а не край.
 */
const unload = async (): Promise<void> => (await import('./session')).dropLease();

describe('чистый старт (docs/test_world.md)', () => {
  it('отметка и отложенная партия прошлой эпохи не читаются: вернуть стёртую партию нечем', async () => {
    shelf.set(META, JSON.stringify({ etag: 'e7', rev: 7 }));
    shelf.set(SPARE, JSON.stringify({ card: record('старый день 90', 90).card, at: 1, game: 'старый день 90', world: null }));
    shelf.set('tribe.era', '1');
    H.local = { game: 'новый день 1', world: null, day: 1 };
    H.apiGet.mockResolvedValue(ok({ now: 1, etag: null, record: null }));
    H.apiPut.mockResolvedValue(ok({ now: 1, etag: 'e1', rev: 1 }));
    const sync = await tab();
    await sync.syncBoot(true);
    expect(sync.useSync.getState().spare).toBeNull();
    // Граница области: в той же эпохе отложенная видна (её не стёрли — её не читают).
    await unload();
    vi.resetModules();
    shelf.set('tribe.era', '0');
    const again = await tab();
    await again.syncBoot(true);
    expect(again.useSync.getState().spare?.card.day).toBe(90);
  });
});

describe('прогресс при запуске', () => {
  /**
   * Главный обычный случай, ради которого правило и написано так: играли без
   * сети — на устройстве партия ушла далеко вперёд серверной, но выросла она из
   * той же записи. Это не расхождение, а продолжение, и вопросов тут быть не
   * может: местная копия просто уезжает наверх.
   */
  it('игра без сети поверх серверной записи уезжает на сервер и ничего не теряет', async () => {
    shelf.set(META, JSON.stringify({ etag: 'e7', rev: 7 }));
    H.local = { game: 'день 41', world: 'карта 41', day: 41 };
    H.apiGet.mockResolvedValue(ok({ now: 1, etag: 'e7', record: record('день 7', 7) }));
    H.apiPut.mockResolvedValue(ok({ now: 1, etag: 'e8', rev: 8 }));

    await (await tab()).syncBoot(true);

    // Уехало наверх ровно то, что лежит на устройстве, и поверх той записи,
    // которой оно наследует.
    expect(H.apiPut).toHaveBeenCalledTimes(1);
    const [, body] = H.apiPut.mock.calls[0] as [string, { baseEtag: string | null; record: SaveRecord }];
    expect(body.baseEtag).toBe('e7');
    expect(body.record.game).toBe('день 41');
    expect(body.record.world).toBe('карта 41');
    // Ни серверная партия не подставлена вместо нашей, ни игра не перезапущена,
    // ни отвергнутой копии не завелось: терять здесь нечего.
    expect(H.adoptSave).not.toHaveBeenCalled();
    expect(H.reload).not.toHaveBeenCalled();
    expect(shelf.get(SPARE)).toBeUndefined();
    // Отметка наследования подновилась: следующий запуск — снова продолжение.
    expect(JSON.parse(shelf.get(META) as string)).toEqual({ etag: 'e8', rev: 8, era: 0 });
  });

  /**
   * Настоящее расхождение: обе копии выросли из одной базы врозь. Сервер —
   * правда, вопроса игроку нет; но и молча в никуда своя копия не девается.
   */
  it('расхождение двух устройств берёт серверную, а свою кладёт в отвергнутые', async () => {
    shelf.set(META, JSON.stringify({ etag: 'e7', rev: 7 }));
    H.local = { game: 'наш день 41', world: 'наша карта', day: 41 };
    H.apiGet.mockResolvedValue(
      ok({ now: 1, etag: 'e9', record: record('чужой день 60', 60, 'чужая карта', 'd-второе') }),
    );

    await (await tab()).syncBoot(true);

    // Взяли серверную целиком — и племя, и карту.
    expect(H.adoptSave).toHaveBeenCalledWith('чужой день 60');
    expect(H.worldWrite).toHaveBeenCalledWith('чужая карта');
    expect(H.reload).toHaveBeenCalled();
    // Свою не затёрли: она лежит рядом со своей описью.
    const spare = JSON.parse(shelf.get(SPARE) as string) as { game: string; world: string; card: { day: number } };
    expect(spare.game).toBe('наш день 41');
    expect(spare.world).toBe('наша карта');
    expect(spare.card.day).toBe(41);
    // Своей копией сервер при этом не перезаписан: он и есть правда.
    expect(H.apiPut).not.toHaveBeenCalled();
  });

  /**
   * Обратная сторона того же правила: серверную партию нельзя брать, если
   * прочесть её нечем. Тогда на устройстве всё остаётся как было — и
   * «отклонённой партии» не заводится, иначе игрок нашёл бы в служебном разделе
   * ту самую игру, в которую играет сейчас.
   */
  it('нечитаемую серверную партию не берут и своей копии не откладывают', async () => {
    shelf.set(META, JSON.stringify({ etag: 'e7', rev: 7 }));
    H.local = { game: 'наш день 41', world: 'наша карта', day: 41 };
    H.adoptSave.mockReturnValue(false);
    H.apiGet.mockResolvedValue(ok({ now: 1, etag: 'e9', record: record('из будущего', 60, null, 'd-второе') }));

    await (await tab()).syncBoot(true);

    expect(H.worldWrite).not.toHaveBeenCalled();
    expect(H.reload).not.toHaveBeenCalled();
    expect(shelf.get(SPARE)).toBeUndefined();
  });

  it('своей копии нет — серверная берётся, откладывать нечего', async () => {
    H.local = { game: 'пусто', world: null, day: 0 };
    H.apiGet.mockResolvedValue(ok({ now: 1, etag: 'e9', record: record('серверная', 60) }));

    await (await tab()).syncBoot(false);

    expect(H.adoptSave).toHaveBeenCalledWith('серверная');
    expect(shelf.get(SPARE)).toBeUndefined();
  });
});

describe('отвергнутая партия достаётся из служебного', () => {
  /**
   * Ради этой кнопки расхождение и разбирается без вопросов. Проверяется весь
   * путь целиком: разошлись — уступили серверу — вернули своё — и оно уехало
   * наверх. Оборвись он на любом шаге, «молча» стало бы «навсегда».
   */
  it('вернуть отвергнутую — и она станет той партией, что лежит на сервере', async () => {
    // Шаг первый: расхождение, серверная взята, наша отложена.
    shelf.set(META, JSON.stringify({ etag: 'e7', rev: 7 }));
    H.local = { game: 'наш день 41', world: 'наша карта', day: 41 };
    H.apiGet.mockResolvedValue(ok({ now: 1, etag: 'e9', record: record('чужой день 60', 60, 'чужая карта', 'd-второе') }));
    await (await tab()).syncBoot(true);
    expect(shelf.get(SPARE)).toBeDefined();

    // Шаг второй: игра перезапустилась с серверной партией. Уходя, вкладка
    // отпускает ведение партии (`beforeunload` → `dropLease`) — без этого
    // следующая сочла бы её живой и не стала бы ни писать, ни сверяться.
    await unload();
    vi.resetModules();
    H.local = { game: 'чужой день 60', world: 'чужая карта', day: 60 };
    H.apiGet.mockResolvedValue(ok({ now: 1, etag: 'e9', record: record('чужой день 60', 60, 'чужая карта', 'd-второе') }));
    H.apiPut.mockResolvedValue(ok({ now: 1, etag: 'e10', rev: 10 }));
    const second = await tab();
    await second.syncBoot(true);

    // Отвергнутая видна игроку — это и есть «Задания» → «Служебное».
    const spare = second.useSync.getState().spare;
    expect(spare?.card.day).toBe(41);

    // Шаг третий: игрок вернул её.
    H.adoptSave.mockClear();
    H.worldWrite.mockClear();
    second.useSync.getState().restoreSpare();
    expect(H.adoptSave).toHaveBeenCalledWith('наш день 41');
    expect(H.worldWrite).toHaveBeenCalledWith('наша карта');
    expect(H.reload).toHaveBeenCalled();
    // Возвращать больше нечего, а вот отметка наследования осталась — иначе
    // правило «сервер главнее» тут же отправило бы возвращённую копию обратно в
    // отвергнутые, и кнопка не делала бы ничего.
    expect(shelf.get(SPARE)).toBeUndefined();
    expect(JSON.parse(shelf.get(META) as string).etag).toBe('e10');

    // Шаг четвёртый: следующий запуск с возвращённой партией. Она продолжает
    // серверную запись, значит уезжает наверх, а не уступает ей.
    await unload();
    vi.resetModules();
    H.local = { game: 'наш день 41', world: 'наша карта', day: 41 };
    H.adoptSave.mockClear();
    H.apiPut.mockClear();
    H.apiGet.mockResolvedValue(ok({ now: 1, etag: 'e10', record: record('чужой день 60', 60, 'чужая карта', 'd-второе') }));
    H.apiPut.mockResolvedValue(ok({ now: 1, etag: 'e11', rev: 11 }));
    await (await tab()).syncBoot(true);
    expect(H.adoptSave).not.toHaveBeenCalled();
    const [, body] = H.apiPut.mock.calls[0] as [string, { record: SaveRecord }];
    expect(body.record.game).toBe('наш день 41');
  });
});

describe('окна выбора нет ни в каком виде', () => {
  /**
   * Проверка по исходнику, и это тот же приём, что у замка алмазов: вернуть
   * вопрос игроку можно правкой одной строки, а заметить это в тестах поведения
   * нельзя — окно просто снова появится на первой минуте у тестировщика.
   */
  it('состояния «расхождение» и разрешения игроком в слое синхронизации не осталось', async () => {
    const { readFileSync } = await import('node:fs');
    const strip = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const sync = strip(readFileSync(new URL('./sync.ts', import.meta.url), 'utf8'));
    const modal = strip(readFileSync(new URL('../ui/SyncModal.tsx', import.meta.url), 'utf8'));
    expect(sync).not.toMatch(/'conflict'\s*[|;]/);
    expect(sync).not.toMatch(/resolve/);
    expect(sync).not.toMatch(/Divergence/);
    // А вот отвергнутая копия и её возврат обязаны остаться: на них держится
    // обещание «прогресс не пропадает».
    expect(sync).toMatch(/keepSpare\(/);
    expect(sync).toMatch(/restoreSpare:/);
    expect(modal).not.toMatch(/Conflict/);
  });
});

/**
 * Раскладка в слепке обороны (docs/retinue.md): полководец вышел в поход на игрока или вернулся — запись партии уходит
 * раньше минуты, иначе слепок, лёгший до выхода, держал бы его отряд дома, пока игрок не зайдёт.
 */
describe('когда партия уходит на сервер', () => {
  it('по сроку — всегда; раскладка сменилась — раньше срока, но не чаще HURRY_MS', async () => {
    const { pushDue, PUSH_MS, HURRY_MS } = await import('./sync');
    expect(HURRY_MS).toBeLessThan(PUSH_MS);
    expect(pushDue(PUSH_MS, 'a', 'a')).toBe(true);
    expect(pushDue(PUSH_MS - 1, 'a', 'a')).toBe(false);
    expect(pushDue(HURRY_MS, 'b', 'a')).toBe(true);
    expect(pushDue(HURRY_MS - 1, 'b', 'a')).toBe(false);
    // Ни одна запись ещё не ушла или слепка нет — сравнивать не с чем, ждём срока.
    expect(pushDue(HURRY_MS, 'b', null)).toBe(false);
    expect(pushDue(HURRY_MS, null, 'a')).toBe(false);
  });
});
