import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UI_KEY, UI_MODES, askedUiMode, bootUiMode, setUiMode, setUiStorage, subscribeUi, uiMode, uiModeOf, type UiStorage } from './uimode';

/** Хранилище в памяти: что записано и сколько раз. */
function memory(seed: Record<string, string> = {}): UiStorage & { data: Record<string, string>; writes: number } {
  const box = { data: { ...seed }, writes: 0 };
  return Object.assign(box, {
    read: (k: string) => box.data[k] ?? null,
    write: (k: string, v: string) => {
      box.data[k] = v;
      box.writes++;
    },
  });
}

afterEach(() => setUiStorage(memory()));

describe('переключатель интерфейса', () => {
  it('по умолчанию — новый (решение владельца 03.10.2026): пустая, битая и чужая запись — новый, прежний — только словом old', () => {
    for (const raw of [null, '', 'NEW', 'OLD', 'tw', '{"ui":"old"}', 'old ']) expect(uiModeOf(raw), String(raw)).toBe('new');
    expect(uiModeOf('old')).toBe('old');
    // Область правила «по умолчанию» — устройство без записи: точка внутри неё, запись пуста.
    const box = memory();
    setUiStorage(box);
    expect(box.data[UI_KEY]).toBeUndefined();
    expect(uiMode()).toBe('new');
  });

  it('две кнопки: «Новый» первой — умолчание, «Прежний» второй', () => {
    expect(UI_MODES).toEqual([
      ['new', 'Новый'],
      ['old', 'Прежний'],
    ]);
  });

  it('адрес ?ui=old пишет выбор, ?ui=new возвращает новый, чужой адрес запись не трогает', () => {
    const box = memory();
    setUiStorage(box);
    expect(bootUiMode('?ui=old')).toBe('old');
    expect(box.data[UI_KEY]).toBe('old');
    // Следующий запуск без адреса помнит выбор.
    setUiStorage(box);
    expect(bootUiMode('?probe=1')).toBe('old');
    expect(bootUiMode('?ui=whatever')).toBe('old');
    expect(bootUiMode('?ui=new')).toBe('new');
    expect(box.data[UI_KEY]).toBe('new');
    expect(askedUiMode('?map=tw&ui=old')).toBe('old');
    expect(askedUiMode('')).toBeNull();
  });

  it('выбор в настройках будит подписчиков сразу и только при смене', () => {
    const box = memory();
    setUiStorage(box);
    let calls = 0;
    const off = subscribeUi(() => calls++);
    setUiMode('old');
    expect(uiMode()).toBe('old');
    expect(calls).toBe(1);
    setUiMode('old');
    expect(calls).toBe(1);
    expect(box.writes).toBe(1);
    setUiMode('new');
    expect(calls).toBe(2);
    off();
  });

  it('приватное окно: запись падает молча, заход видит свой выбор', () => {
    setUiStorage({
      read: () => null,
      write: () => {
        // браузер не дал записать — `browserStorage` глотает ошибку так же
      },
    });
    setUiMode('old');
    expect(uiMode()).toBe('old');
  });
});

describe('рычаг один', () => {
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

  it('выбор пишут только пункт «Интерфейс» и адрес на запуске; ключ записи — только у двери', () => {
    const all = sources(ROOT).map((f) => [path.relative(ROOT, f).split(path.sep).join('/'), readFileSync(f, 'utf8')] as const);
    expect(all.length).toBeGreaterThan(100);
    expect(all.some(([f]) => f === 'ui/uimode.ts')).toBe(true);
    const writers = all.filter(([, src]) => /\bsetUiMode\(/.test(src)).map(([f]) => f).sort();
    expect(writers).toEqual(['ui/parts/Settings.tsx', 'ui/uimode.ts']);
    const booters = all.filter(([, src]) => /\bbootUiMode\(/.test(src)).map(([f]) => f).sort();
    expect(booters).toEqual(['main.tsx', 'ui/uimode.ts']);
    const keyed = all.filter(([, src]) => src.includes("'tribe.ui'")).map(([f]) => f);
    expect(keyed).toEqual(['ui/uimode.ts']);
  });
});
