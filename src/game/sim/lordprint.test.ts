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
import { describe, expect, it } from 'vitest';
import type { GameState } from '../types';
import { createInitialState } from '../state';
import { deserialize } from '../save';
import { DAY_LENGTH } from '../constants';
import { seasonOf } from '../derived';
import { absence, liveStep } from './tick';

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
  deserted: number;
  risen: boolean;
}

/** Партия лорда с войском больше, чем тянет казна, на скудном амбаре, с ранеными в лазарете и при полководце. */
function lordParty(): GameState {
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
function liveYear(s: GameState): Seen {
  const seen: Seen = { seasons: new Set(), debt: false, hungry: false, deserted: 0, risen: false };
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
    if (s.wounded.every((g) => g.until === null)) seen.risen = true;
    const t = troops();
    if (t < lastTroops) seen.deserted += lastTroops - t;
    lastTroops = t;
    // Хлеб кончается и приходит снова — голод не стоит всю партию.
    if (round % 8 === 7) s.resources.food += 400;
  }
  return seen;
}

/**
 * Отпечатки, снятые на `master` 9a9ccde до ПН-1 этим же файлом: прожитая партия и она же после записи и чтения. Сдвиг —
 * ошибка ПН-1, а не повод переписать число: партия лорда обязана жить как жила.
 */
const MASTER = { lived: '93e8cf56', read: 'bafd2307' };

describe('партия лорда живёт как до ПН-1', () => {
  it('год живых шагов и отлучек даёт ту же запись, что на master', () => {
    const s = lordParty();
    const seen = liveYear(s);
    // Граница области: двери ПН-1 правда спрашивались.
    expect([...seen.seasons].sort(), 'прошли все четыре сезона').toEqual(['autumn', 'spring', 'summer', 'winter']);
    expect(seen.debt, 'казна уходила в долг').toBe(true);
    expect(seen.hungry, 'амбар пустел').toBe(true);
    expect(seen.deserted, 'войско теряло людей').toBeGreaterThan(0);
    expect(seen.risen, 'раненые лазарета встали').toBe(true);
    expect(Object.keys(s), 'у партии лорда нет ни фазы, ни отряда бродяги').not.toEqual(expect.arrayContaining(['phase']));
    expect(Object.keys(s)).not.toEqual(expect.arrayContaining(['roam']));
    expect(print(s), `отпечаток партии: master ${MASTER.lived}`).toBe(MASTER.lived);
    // Запись и чтение не добавляют полей: чтение сохранения лорда ведёт к той же записи.
    const back = deserialize(JSON.stringify(s));
    expect(back).not.toBeNull();
    expect(print(back as GameState), `отпечаток прочитанной: master ${MASTER.read}`).toBe(MASTER.read);
  });
});
