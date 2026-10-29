// Партия лорда после ПН-1 живёт байт в байт как до неё (docs/gdd/path_of_sword.md, «Решения ПН-1»).
//
// ПН-1 правит двери, которые шагают партию лорда каждую секунду: шаг племени (`sim/tick` — диспетчер по фазе), содержание
// войска (`sim/upkeep` — вход «отряд»), раненых (`sim/infirmary`), склад (`sim/stock` — ключ обоза) и таблицу сезонов
// (фураж — поле сезона из `SEASON_MODIFIERS`). Обещание задания — «lord-партии работают байт в байт как сейчас». Держит его отпечаток: одна
// партия лорда, прожитая живыми шагами и отлучками через год сезонов с долгом, голодом, уходом, ранеными и вестями, даёт ту же
// запись, что на `master` до ПН-1 (9a9ccde). Отпечаток снят на нетронутом коде и вписан числом; сдвинется хоть одно поле —
// тест упадёт и назовёт оба отпечатка.
//
// Граница области — утверждениями в самом тесте: партия правда прошла четыре сезона, правда была в долгу и голоде, правда
// теряла людей уходом и правда поднимала раненых. Иначе отпечаток мерил бы шаг, в котором двери ПН-1 не спрашиваются.
import { describe, expect, it, vi } from 'vitest';
import type { GameState } from '../types';
import * as stateMod from '../state';
import * as saveMod from '../save';
import * as tickMod from './tick';
import { DAY_LENGTH } from '../constants';
import { seasonOf } from '../derived';

/** Двери, которыми живёт партия: их берут то настоящими, то после подмены выключателя пути (`vi.doMock`). */
interface Doors {
  createInitialState: typeof stateMod.createInitialState;
  deserialize: typeof saveMod.deserialize;
  liveStep: typeof tickMod.liveStep;
  absence: typeof tickMod.absence;
}

/** FNV-1a над строкой — отпечаток записи партии. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** Запись партии без отметки сохранения: её ставит часы устройства, а не шаг. */
const print = (s: GameState): string => fnv(JSON.stringify({ ...s, lastSaved: 0 }));

/** Настоящее время начала: 12:00 UTC 01.10.2026. */
const T0 = Date.UTC(2026, 9, 1, 12);

interface Seen {
  seasons: Set<string>;
  debt: boolean;
  hungry: boolean;
  /** Долг и пустой амбар разом, после терпения: уходят и голодом, и неуплатой в одном шаге. */
  both: boolean;
  deserted: number;
  risen: boolean;
}

/** Партия лорда с войском больше, чем тянет казна, на скудном амбаре, с ранеными в лазарете и при полководце. */
function lordParty({ createInitialState }: Doors): GameState {
  const s = createInitialState(20261029);
  s.army.spearman = 60;
  s.army.clubman = 30;
  s.army.rider = 8;
  s.army.archer = 12;
  s.gold = 40;
  s.resources.food = 120;
  s.wounded.push({ troops: { spearman: 4, archer: 1 }, until: DAY_LENGTH * 2 }, { troops: { clubman: 3 }, until: null });
  return s;
}

/** Год сезонов: живые шаги по секунде, между ними отлучки по полчаса и по шесть часов. */
function liveYear({ liveStep, absence }: Doors, s: GameState): Seen {
  const seen: Seen = { seasons: new Set(), debt: false, hungry: false, both: false, deserted: 0, risen: false };
  const troops = (): number => Object.values(s.army).reduce((n, v) => n + Math.max(0, v ?? 0), 0);
  let now = T0;
  let lastTroops = troops();
  for (let round = 0; round < 40; round++) {
    for (let i = 0; i < 90; i++) {
      now += 1000;
      liveStep(s, 1, now);
    }
    const gap = round % 4 === 3 ? 6 * 3600 * 1000 : 30 * 60 * 1000;
    absence(s, now, now + gap);
    now += gap;
    seen.seasons.add(seasonOf(s.time));
    if (s.pay.debt > 0) seen.debt = true;
    if (s.resources.food <= 0.5) seen.hungry = true;
    if (s.pay.debt > 0 && s.resources.food <= 0.5 && s.pay.late >= 2 * DAY_LENGTH) seen.both = true;
    if (s.wounded.every((g) => g.until === null)) seen.risen = true;
    const t = troops();
    if (t < lastTroops) seen.deserted += lastTroops - t;
    lastTroops = t;
    // Хлеб кончается и приходит снова — голод не стоит всю партию. С 16-го по 23-й круг амбар пуст и казна в долгу разом: уходят
    // обоими поводами в одном шаге.
    if (round === 16) {
      s.resources.food = 0;
      s.gold = 0;
    }
    if (round % 8 === 7 && (round < 16 || round > 23)) s.resources.food += 400;
  }
  return seen;
}

/**
 * Отпечатки, снятые на `master` 9a9ccde до ПН-1 этим же файлом: прожитая партия и она же после записи и чтения. Сдвиг —
 * ошибка ПН-1, а не повод переписать число: партия лорда обязана жить как жила.
 */
const MASTER = { lived: '553385a3', read: '490c1c8e' };

/** Год партии лорда этими дверями: отпечатки прожитой и прочитанной, и где она побывала. */
function run(d: Doors): { lived: string; read: string; seen: Seen; keys: string[] } {
  const s = lordParty(d);
  const seen = liveYear(d, s);
  const back = d.deserialize(JSON.stringify(s));
  expect(back).not.toBeNull();
  return { lived: print(s), read: print(back as GameState), seen, keys: [...Object.keys(s), ...Object.keys(back as GameState)] };
}

function check(r: ReturnType<typeof run>): void {
  // Граница области: двери ПН-1 правда спрашивались.
  expect([...r.seen.seasons].sort(), 'прошли все четыре сезона').toEqual(['autumn', 'spring', 'summer', 'winter']);
  expect(r.seen.debt, 'казна уходила в долг').toBe(true);
  expect(r.seen.hungry, 'амбар пустел').toBe(true);
  expect(r.seen.both, 'долг и голод разом, после терпения').toBe(true);
  expect(r.seen.deserted, 'войско теряло людей').toBeGreaterThan(0);
  expect(r.seen.risen, 'раненые лазарета встали').toBe(true);
  expect(r.keys, 'у партии лорда нет ни фазы, ни отряда бродяги').not.toContain('phase');
  expect(r.keys).not.toContain('roam');
  expect(r.lived, `отпечаток партии: master ${MASTER.lived}`).toBe(MASTER.lived);
  // Запись и чтение не добавляют полей: чтение сохранения лорда ведёт к той же записи.
  expect(r.read, `отпечаток прочитанной: master ${MASTER.read}`).toBe(MASTER.read);
}

describe('партия лорда живёт как до ПН-1', () => {
  it('год живых шагов и отлучек даёт ту же запись, что на master', () => {
    check(run({ ...stateMod, ...saveMod, ...tickMod }));
  });

  it('и при включённом пути — диспетчер партии лорда не касается', async () => {
    vi.resetModules();
    vi.doMock('../roamflag', () => ({ ROAM_ON: true }));
    try {
      const flag = await import('../roamflag');
      expect(flag.ROAM_ON, 'граница области: путь включён').toBe(true);
      const d = { ...(await import('../state')), ...(await import('../save')), ...(await import('./tick')) };
      check(run(d));
    } finally {
      vi.doUnmock('../roamflag');
      vi.resetModules();
    }
  });
});
