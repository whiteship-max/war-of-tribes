// Новое — по умолчанию (решение владельца 03.10.2026, docs/ui_audit.md, 12.8): интерфейс, карта мира и ролик боя
// начинают с нового вида, прежний — запасной, строкой настроек или адресом со словом `old`. Механика у трёх одна
// (`ui/device.ts`), двери свои — и каждая проверяется своими словами: ключом записи, именем в адресе, писателями.
// Интерфейс подробно — в `uimode.test.ts`; здесь — то, что обязано совпасть у всех трёх, и карта с роликом.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceStorage } from './device';
import { UI_KEY, UI_MODES, askedUiMode, bootUiMode, setUiStorage, uiMode, uiModeOf } from './uimode';
import { MAP_KEY, MAP_LOOKS, askedMapLook, bootMapLook, mapLook, mapLookOf, setMapStorage, subscribeMap, setMapLook } from './map/look';
import { BATTLE_LOOKS, BATTLE_LOOK_KEY, askedBattleLook, battleLook, battleLookOf, bootBattleLook, setBattleStorage } from './battle/look';

/** Хранилище в памяти: что записано и сколько раз. */
function memory(seed: Record<string, string> = {}): DeviceStorage & { data: Record<string, string>; writes: number } {
  const box = { data: { ...seed }, writes: 0 };
  return Object.assign(box, {
    read: (k: string) => box.data[k] ?? null,
    write: (k: string, v: string) => {
      box.data[k] = v;
      box.writes++;
    },
  });
}

/** Дверь вида: всё, чем тест её спрашивает. Слова — строками: у трёх дверей они разные. */
interface Door {
  name: string;
  key: string;
  param: string;
  /** Новое слово двери — оно же умолчание. */
  fresh: string;
  /** Слово чужой двери: в этой записи оно — мусор. */
  foreign: string;
  file: string;
  setter: string;
  booter: string;
  buttons: readonly (readonly [string, string])[];
  of: (raw: string | null) => string;
  asked: (search: string) => string | null;
  get: () => string;
  boot: (search: string) => string;
  setStorage: (s: DeviceStorage) => void;
}

const DOORS: Door[] = [
  {
    name: 'интерфейс',
    key: UI_KEY,
    param: 'ui',
    fresh: 'new',
    foreign: 'tw',
    file: 'ui/uimode.ts',
    setter: 'setUiMode',
    booter: 'bootUiMode',
    buttons: UI_MODES,
    of: uiModeOf,
    asked: askedUiMode,
    get: uiMode,
    boot: bootUiMode,
    setStorage: setUiStorage,
  },
  {
    name: 'карта мира',
    key: MAP_KEY,
    param: 'map',
    fresh: 'tw',
    foreign: 'new',
    file: 'ui/map/look.ts',
    setter: 'setMapLook',
    booter: 'bootMapLook',
    buttons: MAP_LOOKS,
    of: mapLookOf,
    asked: askedMapLook,
    get: mapLook,
    boot: bootMapLook,
    setStorage: setMapStorage,
  },
  {
    name: 'ролик боя',
    key: BATTLE_LOOK_KEY,
    param: 'battle',
    fresh: 'tw',
    foreign: 'new',
    file: 'ui/battle/look.ts',
    setter: 'setBattleLook',
    booter: 'bootBattleLook',
    buttons: BATTLE_LOOKS,
    of: battleLookOf,
    asked: askedBattleLook,
    get: battleLook,
    boot: bootBattleLook,
    setStorage: setBattleStorage,
  },
];

afterEach(() => {
  for (const d of DOORS) d.setStorage(memory());
});

describe('новое — по умолчанию у всех трёх', () => {
  it('ключи записи и имена в адресе — свои у каждой двери', () => {
    expect(DOORS.map((d) => [d.key, d.param])).toEqual([
      ['tribe.ui', 'ui'],
      ['tribe.map', 'map'],
      ['tribe.battle', 'battle'],
    ]);
  });

  for (const d of DOORS) {
    describe(d.name, () => {
      it(`устройство без записи начинает с нового (${d.fresh})`, () => {
        // Область правила «по умолчанию» — устройство без записи: точка внутри неё, запись пуста.
        const box = memory();
        d.setStorage(box);
        expect(box.data[d.key]).toBeUndefined();
        expect(d.get()).toBe(d.fresh);
        // Чтение умолчания ничего не пишет: другой телефон и переустановка начинают с того же умолчания.
        expect(box.writes).toBe(0);
      });

      it('пустая, битая и чужая запись — новое; прежнее — только словом old', () => {
        for (const raw of [null, '', 'OLD', 'Old', 'old ', '{"look":"old"}', d.foreign, d.fresh]) {
          expect(d.of(raw), `${d.name}: ${String(raw)}`).toBe(d.fresh);
        }
        expect(d.of('old')).toBe('old');
        d.setStorage(memory({ [d.key]: 'old' }));
        expect(d.get()).toBe('old');
      });

      it('две кнопки в настройках: новое первым — умолчание, прежнее вторым', () => {
        expect(d.buttons.map(([w]) => w)).toEqual([d.fresh, 'old']);
      });

      it(`адрес ?${d.param}=old пишет выбор и переживает перезапуск, ?${d.param}=${d.fresh} возвращает новое`, () => {
        const box = memory();
        d.setStorage(box);
        expect(d.boot(`?${d.param}=old`)).toBe('old');
        expect(box.data[d.key]).toBe('old');
        // Следующий запуск без адреса помнит выбор; чужой адрес и чужое слово запись не трогают.
        d.setStorage(box);
        expect(d.boot('?probe=1')).toBe('old');
        expect(d.boot(`?${d.param}=${d.foreign}`)).toBe('old');
        expect(d.boot(`?${d.param}=${d.fresh}`)).toBe(d.fresh);
        expect(box.data[d.key]).toBe(d.fresh);
        expect(d.asked(`?probe=1&${d.param}=old`)).toBe('old');
        expect(d.asked('')).toBeNull();
      });
    });
  }

  it('выбор карты в настройках будит подписчиков сразу и только при смене — по нему едет кусок нового вида', () => {
    const box = memory();
    setMapStorage(box);
    let calls = 0;
    const off = subscribeMap(() => calls++);
    setMapLook('old');
    expect(calls).toBe(1);
    setMapLook('old');
    expect(calls).toBe(1);
    setMapLook('tw');
    expect(calls).toBe(2);
    expect(box.writes).toBe(2);
    off();
  });
});

describe('рычаг один: карта и ролик', () => {
  const ROOT = path.resolve(__dirname, '..');
  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) out.push(...sources(abs));
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(abs);
    }
    return out;
  }
  const all = sources(ROOT).map((f) => [path.relative(ROOT, f).split(path.sep).join('/'), readFileSync(f, 'utf8')] as const);

  // Интерфейс держит свой тест (`uimode.test.ts`); здесь — две двери, заведённые вместе с умолчанием.
  for (const d of DOORS.filter((x) => x.param !== 'ui')) {
    it(`${d.name}: выбор пишут только строка настроек и адрес на запуске; ключ записи — только у двери`, () => {
      expect(all.length).toBeGreaterThan(100);
      expect(all.some(([f]) => f === d.file)).toBe(true);
      const writers = all.filter(([, src]) => new RegExp(`\\b${d.setter}\\(`).test(src)).map(([f]) => f).sort();
      expect(writers).toEqual(['ui/parts/Settings.tsx', d.file].sort());
      const booters = all.filter(([, src]) => new RegExp(`\\b${d.booter}\\(`).test(src)).map(([f]) => f).sort();
      expect(booters).toEqual(['main.tsx', d.file].sort());
      const keyed = all.filter(([, src]) => src.includes(`'${d.key}'`)).map(([f]) => f);
      expect(keyed).toEqual([d.file]);
    });
  }
});
