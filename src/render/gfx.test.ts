// Графика устройства (`render/gfx.ts`): запись выбора, адрес стенда, память сторожа.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GFX_AUTO_KEEP_MS,
  GFX_AUTO_KEY,
  GFX_DEFAULT,
  GFX_KEY,
  GFX_QUALITIES,
  autoCap,
  autoCapOf,
  capQuality,
  gfx,
  gfxKey,
  gfxOf,
  rememberAutoCap,
  sceneGfx,
  setGfx,
  setGfxStorage,
  subscribeGfx,
} from './gfx';

let mem = new Map<string, string>();
beforeEach(() => {
  mem = new Map();
  setGfxStorage({ read: (k) => mem.get(k) ?? null, write: (k, v) => void mem.set(k, v) });
});
afterEach(() => setGfxStorage({ read: () => null, write: () => undefined }));

describe('выбор игрока', () => {
  it('по умолчанию — новый вид, прежний доступен в настройках', () => {
    // Ничего не выбрано — новый вид и уровень по устройству (телефон сам выше среднего не встаёт — `quality.test.ts`).
    expect(mem.size, 'область: записи нет').toBe(0);
    expect(gfx()).toEqual({ look: 'next', quality: 'auto' });
    expect(GFX_DEFAULT).toEqual({ look: 'next', quality: 'auto' });
    // Прежний вид — строка «Простой вид» в настройках: включённая пишет `now`, выключенная возвращает `next`;
    // строка уровня при простом виде спрятана — у прежнего вида уровень ничего не меняет.
    const src = readFileSync(path.resolve(__dirname, '../ui/parts/Settings.tsx'), 'utf8');
    expect(src, 'строка прежнего вида в настройках').toMatch(/<span className="name">\s*Простой вид\s*<em/);
    expect(src, 'простой вид — это прежний').toContain("const simple = look.look === 'now';");
    expect(src, 'выключатель пишет прежний вид и снимает его').toContain(
      "onClick={() => setGfx({ look: simple ? 'next' : 'now' })} aria-pressed={simple}",
    );
    expect(src, 'уровень — только у нового вида').toMatch(/\{!simple && \(\s*<div className="set-row pick">/);
    setGfx({ look: 'now' });
    expect(gfx()).toEqual({ look: 'now', quality: 'auto' });
    setGfx({ look: 'next' });
    expect(gfx()).toEqual({ look: 'next', quality: 'auto' });
  });

  it('прежний вид, выбранный раньше, остаётся: смена умолчания выбора не отнимает', () => {
    // Запись прошлой сборки: игрок выключил «Новый вид» — выключатель писал `look: 'now'` и уровень как был.
    mem.set(GFX_KEY, JSON.stringify({ look: 'now', quality: 'auto' }));
    expect(gfx()).toEqual({ look: 'now', quality: 'auto' });
    mem.set(GFX_KEY, JSON.stringify({ look: 'now', quality: 'low' }));
    expect(gfx()).toEqual({ look: 'now', quality: 'low' });
    expect(sceneGfx(gfx(), '').look).toBe('now');
    // Выбравший новый вид — на нём же.
    mem.set(GFX_KEY, JSON.stringify({ look: 'next', quality: 'medium' }));
    expect(gfx()).toEqual({ look: 'next', quality: 'medium' });
  });

  it('битая и чужая запись — умолчание, поле за полем', () => {
    expect(gfxOf('{')).toEqual(GFX_DEFAULT);
    expect(gfxOf('"next"')).toEqual(GFX_DEFAULT);
    expect(gfxOf(JSON.stringify({ look: 'next', quality: 'ultra' }))).toEqual({ look: 'next', quality: 'auto' });
    // Вид, которого нет, и запись без вида — не выбор прежнего: умолчание.
    expect(gfxOf(JSON.stringify({ look: 'wow', quality: 'low' }))).toEqual({ look: 'next', quality: 'low' });
    expect(gfxOf(JSON.stringify({ quality: 'high' }))).toEqual({ look: 'next', quality: 'high' });
  });

  it('запись будит подписчиков, чтение отдаёт тот же объект, пока запись та же', () => {
    let calls = 0;
    const off = subscribeGfx(() => calls++);
    const a = gfx();
    expect(gfx()).toBe(a);
    setGfx({ look: 'now' });
    expect(calls).toBe(1);
    expect(gfx()).toEqual({ look: 'now', quality: 'auto' });
    setGfx({ look: 'next' });
    setGfx({ quality: 'low' });
    expect(calls).toBe(3);
    expect(gfx()).toEqual({ look: 'next', quality: 'low' });
    expect(JSON.parse(mem.get(GFX_KEY)!)).toEqual({ look: 'next', quality: 'low' });
    off();
  });
});

describe('что рисовать', () => {
  it('адрес сильнее записи и в запись не пишется', () => {
    const g = { look: 'now', quality: 'medium' } as const;
    expect(sceneGfx(g, '')).toEqual({ look: 'now', quality: 'medium', asked: true });
    expect(sceneGfx(g, '?look=next&quality=low')).toEqual({ look: 'next', quality: 'low', asked: true });
    expect(sceneGfx(g, '?quality=auto')).toEqual({ look: 'now', quality: null, asked: false });
    // Ступени предыстории (`?look=lite`) — не вид посёлка.
    expect(sceneGfx(g, '?look=lite').look).toBe('now');
    // Простой вид адресом — при новом виде в записи.
    expect(sceneGfx({ look: 'next', quality: 'auto' }, '?look=now')).toEqual({ look: 'now', quality: null, asked: false });
    expect(mem.size).toBe(0);
  });
});

describe('когда пересобирать сцену', () => {
  it('ключ меняется со сменой вида и уровня нового вида, а уровень прежнего вида — не повод', () => {
    expect(gfxKey({ look: 'now', quality: 'auto' }, '')).toBe('now');
    expect(gfxKey({ look: 'now', quality: 'high' }, '')).toBe('now');
    expect(gfxKey({ look: 'next', quality: 'auto' }, '')).toBe('next:auto');
    expect(gfxKey({ look: 'next', quality: 'low' }, '')).toBe('next:low');
    // Адрес сильнее записи: при ?look=next запись вида ключа не меняет.
    expect(gfxKey({ look: 'now', quality: 'auto' }, '?look=next')).toBe('next:auto');
  });

  it('кнопки уровня — все уровни и «авто», по разу', () => {
    expect(GFX_QUALITIES.map(([q]) => q)).toEqual(['auto', 'low', 'medium', 'high']);
  });
});

describe('память сторожа', () => {
  it('помнит неделю, потом забывает; запись из будущего — не запись', () => {
    const at = 1_000_000_000_000;
    rememberAutoCap('low', at);
    expect(JSON.parse(mem.get(GFX_AUTO_KEY)!)).toEqual({ quality: 'low', at });
    expect(autoCap(at + 1000)).toBe('low');
    expect(autoCap(at + GFX_AUTO_KEEP_MS - 1)).toBe('low');
    expect(autoCap(at + GFX_AUTO_KEEP_MS + 1)).toBeNull();
    expect(autoCap(at - 1)).toBeNull();
    expect(autoCapOf('мусор', at)).toBeNull();
  });

  it('уровень устройства не поднимается выше памяти сторожа, а ниже — остаётся', () => {
    expect(capQuality('high', 'medium')).toBe('medium');
    expect(capQuality('medium', 'low')).toBe('low');
    expect(capQuality('low', 'medium')).toBe('low');
    expect(capQuality('medium', null)).toBe('medium');
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

  it('выбор игрока пишет только пункт «Графика»; память сторожа — только сцена', () => {
    const all = sources(ROOT).map((f) => [path.relative(ROOT, f).split(path.sep).join('/'), readFileSync(f, 'utf8')] as const);
    // Область: исходники найдены, и сама дверь в них есть.
    expect(all.length).toBeGreaterThan(100);
    expect(all.some(([f]) => f === 'render/gfx.ts')).toBe(true);
    const writers = all.filter(([, src]) => /\bsetGfx\(/.test(src)).map(([f]) => f);
    for (const f of writers) expect(['render/gfx.ts', 'ui/parts/Settings.tsx'], f).toContain(f);
    const cappers = all.filter(([, src]) => /\brememberAutoCap\(/.test(src)).map(([f]) => f);
    expect(cappers.sort()).toEqual(['render/Scene.ts', 'render/gfx.ts']);
  });
});
