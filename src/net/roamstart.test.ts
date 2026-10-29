// Путь меча у админа на клиенте (30.10.2026): слово сервера «админ» открывает путь тем же правилом, что у сервера, и устройство его
// помнит; новая партия входит в путь Воином; указ админа ложится в отряд; обнуление партии стирает её на устройстве один раз.
//
// Граница области — утверждениями: путь правда не выпущен (`ROAM_ON`), до слова сервера игрок правда не админ, на устройстве правда
// лежит партия, которую стирает обнуление.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Память устройства — своя на каждый тест. */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('localStorage', memoryStorage());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const note = (extra: Record<string, unknown> = {}) => ({ frozen: false, grants: [], ...extra });

describe('слово сервера об админе', () => {
  it('админ — путь открыт и устройство помнит; записка без слова — закрыт и память стёрта', async () => {
    const flag = await import('@/game/roamflag');
    const admin = await import('./admin');
    expect(flag.ROAM_ON, 'граница: путь не выпущен').toBe(false);
    expect(flag.roamOn(), 'граница: до слова сервера — не админ').toBe(false);
    admin.takeNote(note({ admin: true }));
    expect(flag.roamOn()).toBe(true);
    expect(admin.useAdmin.getState().roam).toBe(true);
    expect(localStorage.getItem('tribe.admin.v1')).toBe('1');
    // Следующий запуск — путь открыт раньше первого ответа: партия бродяги читается бродягой.
    vi.resetModules();
    const flag2 = await import('@/game/roamflag');
    await import('./admin');
    expect(flag2.roamOn()).toBe(true);
    const admin2 = await import('./admin');
    admin2.takeNote(note());
    expect(flag2.roamOn()).toBe(false);
    expect(localStorage.getItem('tribe.admin.v1')).toBeNull();
  });

  it('нет записки (сервер не ответил) — память не трогается', async () => {
    localStorage.setItem('tribe.admin.v1', '1');
    const flag = await import('@/game/roamflag');
    const admin = await import('./admin');
    admin.takeNote(undefined);
    expect(flag.roamOn()).toBe(true);
  });
});

describe('новая партия бродягой со стартового экрана', () => {
  it('игроку — отказ, партия прежняя; админу — Воин: отряд, кошель, провиант на 4 игр. дн.', async () => {
    const { useGame } = await import('@/game/store');
    const flag = await import('@/game/roamflag');
    const { warriorStart, WARRIOR } = await import('@/game/roamorigin');
    expect(useGame.getState().fresh, 'граница: на устройстве нет партии').toBe(true);
    expect(useGame.getState().beginRoamParty()).toBe('Путь меча ещё не открыт.');
    expect(useGame.getState().s.phase).toBeUndefined();
    useGame.setState({ s: { ...useGame.getState().s, gemSeen: 9, adminSeen: 4 } });
    flag.setRoamOpen(true);
    expect(useGame.getState().beginRoamParty()).toBeNull();
    const s = useGame.getState().s;
    expect(s.phase).toBe('roam');
    expect(s.roam?.origin).toBe('warrior');
    expect(s.roam?.band).toEqual(WARRIOR.band);
    expect(s.roam?.purse).toBe(WARRIOR.gold);
    expect(s.roam?.hero.war).toBe(WARRIOR.war);
    expect(s.roam?.cargo.food).toBeCloseTo(warriorStart(s, 'x').food, 9);
    expect(s.roam?.cargo.food ?? 0, 'провиант есть').toBeGreaterThan(0);
    expect([s.gemSeen, s.adminSeen], 'номера дел и указов — за игроком').toEqual([9, 4]);
  });

  it('партия на устройстве уже есть — вход в путь не отнимает её', async () => {
    const { useGame } = await import('@/game/store');
    const flag = await import('@/game/roamflag');
    flag.setRoamOpen(true);
    useGame.setState({ fresh: false });
    expect(useGame.getState().beginRoamParty()).toBe('Путь меча начинают с новой партии.');
    expect(useGame.getState().s.phase).toBeUndefined();
  });
});

describe('указ админа на Пути меча', () => {
  it('золото — в кошель, хлеб — в обоз, бойцы — в отряд; склад и казна посёлка не тронуты', async () => {
    const flag = await import('@/game/roamflag');
    const { createInitialState } = await import('@/game/state');
    const { beginRoam } = await import('@/game/sim/roam');
    const { applyGrants } = await import('@/game/sim/admin');
    flag.setRoamOpen(true);
    const s = createInitialState(3);
    expect(beginRoam(s, { origin: 'warrior', hero: { name: 'Ратко', war: 2 }, band: { spearman: 4, clubman: 2 }, purse: 120, food: 5 })).toBeNull();
    const town = JSON.stringify({ r: s.resources, g: s.gold, a: s.army });
    expect(applyGrants(s, [{ n: 1, at: 0, stock: { gold: 300, food: 20 }, troops: { spearman: 2 } }])).toBe(1);
    expect(s.roam?.purse).toBe(420);
    expect(s.roam?.cargo.food).toBe(25);
    expect(s.roam?.band.spearman).toBe(6);
    expect(JSON.stringify({ r: s.resources, g: s.gold, a: s.army })).toBe(town);
    expect(s.log[0].text).toMatch(/^Указ админа №1 отряду: еда в обоз \+20, кошель \+300, копейщики \+2\.$/i);
    // Убавка — не ниже нуля.
    applyGrants(s, [{ n: 2, at: 0, stock: { gold: -1000 }, troops: { clubman: -5 } }]);
    expect(s.roam?.purse).toBe(0);
    expect(s.roam?.band.clubman).toBeUndefined();
  });
});

describe('обнуление партии на устройстве', () => {
  const party = async (): Promise<void> => {
    localStorage.setItem('tribe.save.v1', '{"old":true}');
    localStorage.setItem('tribe.sync.v1', '{"etag":"e1","rev":3}');
    localStorage.setItem('tribe.sync.spare.v1', '{"spare":true}');
    localStorage.setItem('tribe.world.v1', '{"world":true}');
    localStorage.setItem('tribe.prologue.v1', '{"glade":1}');
  };

  it('метка новее — партия, отметка, отложенная копия и мир стёрты, номера наследуются, перезапуск; второй раз — ничего', async () => {
    await party();
    const sync = await import('./sync');
    const { createInitialState } = await import('@/game/state');
    const was = createInitialState(5);
    was.gemSeen = 11;
    was.adminSeen = 6;
    sync.provideGame(() => was);
    const restart = vi.fn();
    sync.setResetRestart(restart);
    expect(sync.mayWrite(), 'граница: вкладка пишет').toBe(true);
    expect(sync.takeReset(note({ reset: 1000 }), true)).toBe(true);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(sync.mayWrite(), 'уходя, вкладка не пишет старую партию обратно').toBe(false);
    for (const k of ['tribe.save.v1', 'tribe.sync.v1', 'tribe.sync.spare.v1', 'tribe.world.v1']) expect(localStorage.getItem(k), k).toBeNull();
    expect(localStorage.getItem('tribe.prologue.v1'), 'чужое партии не тронуто').not.toBeNull();
    expect(sync.resetCarry()).toEqual({ gemSeen: 11, adminSeen: 6 });
    vi.resetModules();
    const again = await import('./sync');
    again.setResetRestart(restart);
    localStorage.setItem('tribe.save.v1', '{"new":true}');
    expect(again.takeReset(note({ reset: 1000 }), true), 'та же метка — новая партия не стирается').toBe(false);
    expect(again.takeReset(note(), true)).toBe(false);
    expect(localStorage.getItem('tribe.save.v1')).toBe('{"new":true}');
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('партии на устройстве нет — метка запомнена, стирать и перезапускать нечего', async () => {
    const sync = await import('./sync');
    const restart = vi.fn();
    sync.setResetRestart(restart);
    expect(sync.takeReset(note({ reset: 2000 }), false)).toBe(false);
    expect(restart).not.toHaveBeenCalled();
    expect(sync.mayWrite()).toBe(true);
    expect(sync.takeReset(note({ reset: 2000 }), true)).toBe(false);
  });
});
