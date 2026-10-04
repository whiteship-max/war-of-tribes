import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHEATS, CHEATS_ON, CHEAT_MARK, CHEAT_NO, cheatOf, cheatsOf, codesOf, matchCheat } from './cheats';
import { createInitialState } from './game/state';
import { storageCap } from './game/derived';
import { RESOURCE_IDS } from './game/constants';
import { EQUIPMENT_IDS } from './game/data/equipment';
import { TROOP_IDS } from './game/data/troops';
import { gemsOf } from './game/sim/gems';
import { CHEAT_GEAR, CHEAT_GOLD, CHEAT_TROOPS, applyCheat } from './game/sim/cheat';
import { beginMinigame, canPlay, energyAt } from './game/sim/minigames';
import { ENERGY_MAX, MINIGAME_COST } from './game/data/minigames';
import { applyCheat as applyGlade } from './prologue/cheat';
import { HOUSE_LOGS } from './prologue/craft';
import { HEARTH_CAP, fuelAt } from './prologue/fire';
import { guestHere, love } from './prologue/kin';
import { QUIVER_MAX } from './prologue/craft';
import { freshPrologue, loadPrologue, savePrologue } from './prologue/save';

describe('коды: список и разбор', () => {
  it('кодов четыре, у каждого свой режим, и все они строчной латиницей', () => {
    expect(CHEATS).toHaveLength(4);
    expect(new Set(CHEATS.map((c) => c.code)).size).toBe(CHEATS.length);
    for (const c of CHEATS) {
      expect(c.code, c.code).toMatch(/^[a-z]{3,12}$/);
      expect(c.what.length, c.code).toBeGreaterThan(20);
    }
    expect(CHEATS.filter((c) => c.where === 'village').map((c) => c.code)).toEqual(['tribe', 'energy']);
    expect(CHEATS.filter((c) => c.where === 'prologue').map((c) => c.code)).toEqual(['glade', 'home']);
  });

  it('пробелы и регистр не в счёт, чужой режим не в счёт, лишнее — не код', () => {
    expect(matchCheat('  TrIbE ', 'village', false)?.id).toBe('tribe');
    expect(matchCheat('tribe', 'prologue')).toBeNull();
    expect(matchCheat('home', 'village')).toBeNull();
    expect(matchCheat('', 'village')).toBeNull();
    expect(matchCheat('tribes', 'village')).toBeNull();
  });

  /**
   * Одно действие, которым коды снимают, — `CHEATS_ON`. Проверяется чтением
   * исходника: выключатель обязан стоять **в обеих** дверях наружу, иначе
   * выключенные коды остались бы кнопкой без списка или списком без кнопки.
   */
  it('выключатель один, и его спрашивают обе двери наружу', () => {
    const src = readFileSync(join(__dirname, 'cheats.ts'), 'utf8');
    const where = src.indexOf('export function cheatOf');
    const list = src.indexOf('export const cheatsOf');
    expect(src.slice(where, where + 300)).toContain('CHEATS_ON');
    expect(src.slice(list, list + 200)).toContain('CHEATS_ON');
  });

  /**
   * Коды опущены для игроков: кнопку видели все, а правило (docs/handbook/cheats.md) требует снять их
   * до посторонних. Проверяется не значением выключателя, а тем, что видно снаружи: обе
   * двери молчат на каждый настоящий код. Поднимут выключатель для проверки дальнего
   * куска — этот тест упадёт, и в коммит такое не уйдёт незамеченным.
   */
  it('для игроков коды выключены: ни списка, ни узнанного кода', () => {
    expect(cheatsOf('village')).toEqual([]);
    expect(cheatsOf('prologue')).toEqual([]);
    for (const c of CHEATS) {
      expect(matchCheat(c.code, c.where, false), c.code).not.toBeNull();
      expect(cheatOf(c.code, c.where, false), c.code).toBeNull();
    }
    expect(CHEATS_ON).toBe(false);
  });

  /**
   * Решение владельца 04.10.2026: код энергии промыслов — только вне Telegram, где прогресс не уходит на сервер. В
   * Telegram его нет ни в разборе, ни в списке, даже с поднятым выключателем; прочие коды Telegram не касается.
   * Признак «в Telegram» приносит зовущий; не принёс — считается «в Telegram».
   */
  it('код энергии — только вне Telegram: в Telegram его не узнать и не увидеть', () => {
    expect(matchCheat('energy', 'village', false)?.id).toBe('energy');
    expect(codesOf('village', false).map((c) => c.code)).toContain('energy');
    expect(matchCheat('energy', 'village', true), 'в Telegram').toBeNull();
    expect(codesOf('village', true).map((c) => c.code), 'в Telegram').not.toContain('energy');
    // Забытый довод закрывает, а не открывает.
    expect(matchCheat('energy', 'village'), 'довод забыт').toBeNull();
    expect(codesOf('village').map((c) => c.code), 'довод забыт').not.toContain('energy');
    // Точка внутри области: прочие коды деревни в Telegram на месте — запрет касается одного кода.
    expect(matchCheat('tribe', 'village', true)?.id).toBe('tribe');
    expect(CHEATS.filter((c) => c.offTelegram).map((c) => c.id)).toEqual(['energy']);
  });

  it('признак Telegram обе двери наружу берут из подписи: та же проверка, что у сохранения на сервер', () => {
    const store = readFileSync(join(__dirname, 'game', 'store.ts'), 'utf8');
    const panel = readFileSync(join(__dirname, 'ui', 'CheatPanel.tsx'), 'utf8');
    expect(store).toMatch(/cheatOf\(code, 'village', tgInitData\(\) !== null\)/);
    expect(panel).toMatch(/cheatsOf\(where, tgInitData\(\) !== null\)/);
  });
});

describe('код деревни', () => {
  it('наполняет склад, казну, снаряжение и дружину — и ничего не строит', () => {
    const s = createInitialState();
    const levels = s.buildings.map((b) => b.level);
    const said = applyCheat(s, 'tribe');
    const cap = storageCap(s);
    for (const r of RESOURCE_IDS) expect(s.resources[r], r).toBe(cap);
    expect(s.gold).toBe(CHEAT_GOLD);
    for (const e of EQUIPMENT_IDS) expect(s.equipment[e], e).toBe(CHEAT_GEAR);
    for (const t of TROOP_IDS) expect(s.army[t], t).toBe(CHEAT_TROOPS);
    // Уровни — вся прогрессия посёлка, и код их не трогает.
    expect(s.buildings.map((b) => b.level)).toEqual(levels);
    expect(said).toContain('Код:');
  });

  /**
   * Алмазов код не даёт. Замок на это стоит не здесь, а по всему `src`
   * (`game/sim/gems.test.ts`): он читает исходники и валится на начислении, на
   * правке поля, на ключе в литерале и на записи мимо сохранения. Все три файла
   * кодов лежат под ним без единого исключения — исключения в замке названы
   * поимённо, и ни одного из них там нет. Здесь — проверка с другой стороны:
   * применённый код счёта не двигает.
   */
  it('алмазов не прибавляет', () => {
    const s = createInitialState();
    const before = gemsOf(s);
    applyCheat(s, 'tribe');
    expect(gemsOf(s)).toBe(before);
  });

  it('метит партию навсегда, а строку метки пишет один раз', () => {
    const s = createInitialState();
    expect(s.cheated).toBe(false);
    applyCheat(s, 'tribe');
    expect(s.cheated).toBe(true);
    applyCheat(s, 'tribe');
    applyCheat(s, 'tribe');
    expect(s.log.filter((e) => e.text === CHEAT_MARK)).toHaveLength(1);
    expect(s.cheated).toBe(true);
  });

  it('код энергии наполняет запас промыслов и метит партию', () => {
    const s = createInitialState();
    for (let i = 0; i < ENERGY_MAX / MINIGAME_COST; i++) expect(typeof beginMinigame(s, 'berries', 1_700_000_000_000)).toBe('object');
    expect(canPlay(s, 1_700_000_000_000), 'точка внутри области: запас пуст').toBe(false);
    const gems = gemsOf(s);
    const said = applyCheat(s, 'energy');
    expect(energyAt(s, 1_700_000_000_000)).toBe(ENERGY_MAX);
    expect(s.cheated).toBe(true);
    expect(s.log.some((e) => e.text === CHEAT_MARK)).toBe(true);
    expect(gemsOf(s)).toBe(gems);
    expect(said).toContain('Код:');
  });

  it('чужого кода деревня не знает', () => {
    expect(cheatOf('glade', 'village')).toBeNull();
    expect(CHEAT_NO).not.toBe('');
  });
});

describe('коды поляны', () => {
  const now = 1_700_000_000_000;

  it('«glade» даёт полный очаг, руки и колчан — и метит поляну', () => {
    const s = freshPrologue(now);
    const { save, said } = applyGlade(s, 'glade', now);
    expect(fuelAt(save.hearth, now)).toBe(HEARTH_CAP);
    expect(save.axe).toBe(true);
    expect(save.kit).toBe(true);
    expect(save.quiver).toBe(QUIVER_MAX);
    expect(save.logs).toBeGreaterThan(0);
    expect(save.meat.cooked).toBeGreaterThan(0);
    expect(save.hides).toBeGreaterThan(0);
    expect(save.cheated).toBe(true);
    expect(said).toContain('Код:');
    // Правит он копию, а не переданное: то же правило, что у `fire.feed`.
    expect(s.cheated).toBe(false);
    expect(s.axe).toBe(false);
  });

  it('«home» ставит дом, зовёт гостью и наполняет любовь — но жены не назначает', () => {
    const s = freshPrologue(now);
    const { save } = applyGlade(s, 'home', now);
    expect(save.house).toBe(HOUSE_LOGS);
    expect(guestHere(save, now)).toBe(true);
    expect(love(save.bond)).toBe(100);
    // Принять её и назвать сына — два решения игрока, и код их не делает.
    expect(save.wife).toBeNull();
    expect(save.heir).toBeNull();
    expect(save.cheated).toBe(true);
  });

  it('дом кодом не строится в деревне, а склад кодом не наполняется на поляне', () => {
    const s = freshPrologue(now);
    expect(applyGlade(s, 'tribe', now).save).toBe(s);
    const g = createInitialState();
    const wood = g.resources.wood;
    applyCheat(g, 'glade');
    expect(g.resources.wood).toBe(wood);
    expect(g.cheated).toBe(false);
  });

  describe('метка переживает запись', () => {
    const store = new Map<string, string>();
    const host = globalThis as unknown as { localStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> };
    beforeEach(() => {
      store.clear();
      host.localStorage = {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => void store.set(k, String(v)),
        removeItem: (k) => void store.delete(k),
      };
    });
    afterEach(() => {
      delete host.localStorage;
    });

    it('помеченная поляна читается помеченной, а старая запись — чистой', () => {
      const { save } = applyGlade(freshPrologue(now), 'glade', now);
      savePrologue(save, now);
      expect(loadPrologue(now).cheated).toBe(true);
      store.set('tribe.prologue.v1', JSON.stringify({ v: 1, hearth: { fuel: 3, at: now - 5 } }));
      expect(loadPrologue(now).cheated).toBe(false);
    });
  });
});
