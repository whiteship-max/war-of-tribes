// Графика устройства (`render/gfx.ts`): запись выбора, адрес стенда, память сторожа.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GFX_AUTO_KEEP_MS,
  GFX_AUTO_KEY,
  GFX_DEFAULT,
  GFX_KEY,
  autoCap,
  autoCapOf,
  capQuality,
  gfx,
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
  it('по умолчанию — прежний вид и уровень по устройству', () => {
    expect(gfx()).toEqual({ look: 'now', quality: 'auto' });
    expect(GFX_DEFAULT.look).toBe('now');
  });

  it('битая и чужая запись — умолчание, поле за полем', () => {
    expect(gfxOf('{')).toEqual(GFX_DEFAULT);
    expect(gfxOf('"next"')).toEqual(GFX_DEFAULT);
    expect(gfxOf(JSON.stringify({ look: 'next', quality: 'ultra' }))).toEqual({ look: 'next', quality: 'auto' });
    expect(gfxOf(JSON.stringify({ look: 'wow', quality: 'low' }))).toEqual({ look: 'now', quality: 'low' });
  });

  it('запись будит подписчиков, чтение отдаёт тот же объект, пока запись та же', () => {
    let calls = 0;
    const off = subscribeGfx(() => calls++);
    const a = gfx();
    expect(gfx()).toBe(a);
    setGfx({ look: 'next' });
    expect(calls).toBe(1);
    expect(gfx()).toEqual({ look: 'next', quality: 'auto' });
    setGfx({ quality: 'low' });
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
    expect(mem.size).toBe(0);
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
