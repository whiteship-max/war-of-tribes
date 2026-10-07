// Графика устройства (`render/gfx.ts`): запись выбора, адрес стенда, память сторожа; вид у игры один — город.
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
  levelNow,
  noteSceneLevel,
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
afterEach(() => {
  setGfxStorage({ read: () => null, write: () => undefined });
  noteSceneLevel(null);
});

const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (rel: string): string => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('вид один — город', () => {
  it('по умолчанию и всегда — город: вида нет ни в выборе, ни в адресе, ни в настройках, а игра собирает только его', () => {
    // Ничего не выбрано — уровень по устройству (телефон сам выше среднего не встаёт — `quality.test.ts`).
    expect(mem.size, 'область: записи нет').toBe(0);
    expect(gfx()).toEqual({ quality: 'auto' });
    expect(GFX_DEFAULT).toEqual({ quality: 'auto' });
    // Адрес вида прошлых сборок ничего не меняет: сцена та же — город.
    for (const search of ['', '?look=now', '?look=next', '?look=city']) {
      expect(sceneGfx(gfx(), search), search || 'без адреса').toEqual({ quality: null, asked: false });
    }
    // Настройки выбирают только уровень: строки прежнего вида нет, строка уровня — всегда (её место для слабых
    // устройств — «Низкая»).
    // Вид графики — поле выбора (`setGfx({ look: … })`, `gfx().look`) и его значок; двери вида карты и ролика боя
    // (`ui/map/look`, `ui/battle/look`, docs/ui_audit.md, 12.8) — не графика, их строки здесь законны.
    const settings = strip(read('ui/parts/Settings.tsx'));
    expect(settings, 'строки прежнего вида нет').not.toMatch(/Простой вид|Новый вид|\blook\s*:|\.look\b|ui-look/);
    expect(settings, 'строка уровня есть').toMatch(/<div className="set-row pick">/);
    expect(settings, 'и она без условия').not.toMatch(/&& \(\s*<div className="set-row pick">/);
    // Игра собирает сцену города и только её: кусок едет до игры без условий, холст берёт его класс.
    const main = strip(read('main.tsx'));
    expect(main, 'кусок города — до игры, всегда').toMatch(/void import\('\.\/render\/city\/scene'\)\.then\(start, start\);/);
    // Без выбора сцены по виду: адрес `?look=` не читается, кусок не выбирается по виду графики. Адрес вида карты и
    // ролика (`bootMapLook`, `bootBattleLook`) сцены не выбирает.
    expect(main, 'без выбора по виду').not.toMatch(/['"]look['"]|\blook\s*[=!]==|\.look\b|sceneGfx/);
    const canvas = strip(read('ui/GameCanvas.tsx'));
    expect(canvas, 'класс сцены — город').toMatch(/const City = SCENES\.game;/);
    expect(canvas, 'и только он').toMatch(/new City\(canvas, null, sceneGfx\(gfx\(\), window\.location\.search\)\)/);
    expect(canvas, 'ни вида, ни другой сцены').not.toMatch(/\.look\b|new TribeScene|SCENES\[/);
  });
});

describe('старый сохранённый выбор вида', () => {
  it('ничего не ломает: прежний вид — город на «Авто», уровень нового вида — выбор игрока, и он остаётся', () => {
    // Записи прошлых сборок. «Простой вид» (до 01.10.2026 — выключенный «Новый вид») писал `look: 'now'` и уровень,
    // который при нём был спрятан, — решение владельца: такому игроку город на «Авто».
    for (const quality of ['auto', 'low', 'medium', 'high']) {
      mem.set(GFX_KEY, JSON.stringify({ look: 'now', quality }));
      expect(gfx(), `прежний вид, уровень ${quality}`).toEqual({ quality: 'auto' });
      expect(sceneGfx(gfx(), '')).toEqual({ quality: null, asked: false });
    }
    mem.set(GFX_KEY, JSON.stringify({ look: 'now' }));
    expect(gfx(), 'прежний вид без уровня').toEqual({ quality: 'auto' });
    // Новый вид с уровнем — уровень выбирал игрок, и городу он тот же.
    for (const quality of ['low', 'medium', 'high'] as const) {
      mem.set(GFX_KEY, JSON.stringify({ look: 'next', quality }));
      expect(gfx(), `новый вид, уровень ${quality}`).toEqual({ quality });
      expect(sceneGfx(gfx(), '')).toEqual({ quality, asked: true });
    }
    mem.set(GFX_KEY, JSON.stringify({ look: 'next', quality: 'auto' }));
    expect(gfx()).toEqual({ quality: 'auto' });
    // Первая запись после обновления — без поля вида, и выбор прежнего вида из неё не воскресает.
    mem.set(GFX_KEY, JSON.stringify({ look: 'now', quality: 'low' }));
    setGfx({ quality: 'medium' });
    expect(JSON.parse(mem.get(GFX_KEY)!)).toEqual({ quality: 'medium' });
    expect(gfx()).toEqual({ quality: 'medium' });
  });

  it('битая и чужая запись — умолчание, поле за полем', () => {
    expect(gfxOf('{')).toEqual(GFX_DEFAULT);
    expect(gfxOf('"next"')).toEqual(GFX_DEFAULT);
    expect(gfxOf('null')).toEqual(GFX_DEFAULT);
    expect(gfxOf(JSON.stringify({ look: 'next', quality: 'ultra' }))).toEqual({ quality: 'auto' });
    // Вид, которого не было, и запись без вида — уровень из записи.
    expect(gfxOf(JSON.stringify({ look: 'wow', quality: 'low' }))).toEqual({ quality: 'low' });
    expect(gfxOf(JSON.stringify({ quality: 'high' }))).toEqual({ quality: 'high' });
  });

  it('запись будит подписчиков, чтение отдаёт тот же объект, пока запись та же', () => {
    let calls = 0;
    const off = subscribeGfx(() => calls++);
    const a = gfx();
    expect(gfx()).toBe(a);
    setGfx({ quality: 'high' });
    expect(calls).toBe(1);
    expect(gfx()).toEqual({ quality: 'high' });
    setGfx({ quality: 'low' });
    expect(calls).toBe(2);
    expect(gfx()).toEqual({ quality: 'low' });
    expect(JSON.parse(mem.get(GFX_KEY)!)).toEqual({ quality: 'low' });
    off();
  });
});

describe('что рисовать', () => {
  it('адрес сильнее записи и в запись не пишется', () => {
    const g = { quality: 'medium' } as const;
    expect(sceneGfx(g, '')).toEqual({ quality: 'medium', asked: true });
    expect(sceneGfx(g, '?quality=low')).toEqual({ quality: 'low', asked: true });
    expect(sceneGfx(g, '?quality=auto')).toEqual({ quality: null, asked: false });
    // Чужое слово — не уровень: остаётся выбор игрока.
    expect(sceneGfx(g, '?quality=ultra')).toEqual({ quality: 'medium', asked: true });
    expect(mem.size).toBe(0);
  });
});

describe('когда пересобирать сцену', () => {
  it('ключ — уровень: сменился выбор или адрес — новый ключ', () => {
    expect(gfxKey({ quality: 'auto' }, '')).toBe('auto');
    expect(gfxKey({ quality: 'low' }, '')).toBe('low');
    expect(gfxKey({ quality: 'high' }, '?quality=medium')).toBe('medium');
    // Адрес вида прошлых сборок ключа не меняет.
    expect(gfxKey({ quality: 'low' }, '?look=now')).toBe('low');
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

describe('уровень один на всю игру (docs/perf.md)', () => {
  const at = 1_000_000_000_000;

  it('«Авто» сцен поверх города — уровень города, в том числе опущенный сторожем', () => {
    noteSceneLevel('medium');
    expect(levelNow('', at)).toBe('medium');
    // Сторож опустил город — карта, ролик и промысел следом.
    noteSceneLevel('low');
    expect(levelNow('', at)).toBe('low');
  });

  it('выбор игрока и адрес сильнее уровня города', () => {
    noteSceneLevel('low');
    setGfx({ quality: 'high' });
    expect(levelNow('', at)).toBe('high');
    expect(levelNow('?quality=medium', at)).toBe('medium');
    setGfx({ quality: 'auto' });
    expect(levelNow('?quality=auto', at)).toBe('low');
  });

  it('города ещё нет — устройство без видеокарты, не выше памяти сторожа за неделю', () => {
    // Под тестом окна нет: устройство — настольное без видеокарты, «высокий» (`quality.autoQuality`).
    expect(levelNow('', at)).toBe('high');
    rememberAutoCap('low', at - 1000);
    expect(levelNow('', at)).toBe('low');
    expect(levelNow('', at + GFX_AUTO_KEEP_MS)).toBe('high');
  });

  it('уровень по устройству выбирают только дверь графики и сцена города — карта, ролик и промысел спрашивают `levelNow`', () => {
    const ROOT = path.resolve(__dirname, '..');
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const abs = path.join(dir, n);
        return statSync(abs).isDirectory() ? files(abs) : /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [abs] : [];
      });
    const all = files(ROOT).map((f) => [path.relative(ROOT, f).split(path.sep).join('/'), strip(readFileSync(f, 'utf8'))] as const);
    // Область: исходники найдены, и дверь в них есть.
    expect(all.length).toBeGreaterThan(100);
    const pickers = all.filter(([, src]) => /\bautoQuality\(/.test(src)).map(([f]) => f);
    expect(pickers.sort()).toEqual(['render/Scene.ts', 'render/gfx.ts', 'render/quality.ts']);
    for (const f of ['ui/map/tw/quality.ts', 'ui/map/WorldMap.tsx', 'ui/battle/TwReplay.tsx', 'minigames/stage.ts']) {
      expect(read(f), f).toMatch(/\blevelNow\(/);
    }
  });
});
