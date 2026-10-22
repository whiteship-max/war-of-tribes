// Дверь перехода ЗД-1 (`game/yardmerge.ts`) — своей докачкой: первая загрузка не растёт ради тех, у кого старой партии нет
// (docs/city_v3.md, «Решения ЗД-1»). Партия младше 24-й без двери не читается и не затирается; вход (`loadGame`) и взятие
// серверной партии (`readyToRead` → `adoptSave`) подгружают дверь сами.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disk = new Map<string, string>();
beforeEach(() => {
  disk.clear();
  vi.resetModules();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => disk.get(k) ?? null,
      setItem: (k: string, v: string) => void disk.set(k, v),
      removeItem: (k: string) => void disk.delete(k),
    },
  });
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

/** Партия 23-й версии: Загон ещё стоит, рабочие — по номеру постройки. */
async function oldRecord(): Promise<string> {
  const { createInitialState } = await import('./state');
  const { serialize } = await import('./save');
  const raw = JSON.parse(serialize(createInitialState(3))) as Record<string, unknown> & { buildings: { id: number; type: string; level: number }[] };
  const farm = raw.buildings.find((b) => b.type === 'farm')!;
  raw.buildings.push({ ...farm, id: 900, type: 'pen', level: 3 });
  raw.workers = { [String(farm.id)]: 4, '900': 6 };
  raw.version = 23;
  return JSON.stringify(raw);
}

describe('дверь перехода ЗД-1 — своей докачкой', () => {
  it('без двери партия младше 24-й не читается и не затирается; с дверью — читается', async () => {
    const json = await oldRecord();
    const save = await import('./save');
    // Область: запись правда младше — у неё Загон и рабочие по номерам.
    expect(json).toContain('"type":"pen"');
    expect(save.deserialize(json), 'без двери — не читается').toBeNull();
    expect(save.adoptSave(json), 'и на диск не ложится').toBe(false);
    expect(disk.size).toBe(0);
    await save.readyToRead(json);
    const s = save.deserialize(json)!;
    expect(s.version).toBe(24);
    expect(s.buildings.find((b) => b.type === 'farm')!.level, 'двор — больший из двух').toBe(3);
    expect(s.workers).toMatchObject({ farmer: 4, herder: 6 });
  });

  it('вход подгружает дверь сам: старая партия на диске открывается приведённой, а не новой', async () => {
    const json = await oldRecord();
    const save = await import('./save');
    const { createInitialState } = await import('./state');
    // Ключ сейва знает один save.ts: кладём партию его дверью и подменяем строку старой записью.
    save.saveGame(createInitialState(5));
    const [key] = [...disk.keys()];
    disk.set(key, json);
    const r = await save.loadGame();
    expect(r.legacy).toBe(false);
    expect(r.fresh).toBe(false);
    expect(r.state.version).toBe(24);
    expect(r.state.workers.herder).toBe(6);
  });

  it('новая партия дверь не грузит, и в первом куске её нет: save.ts берёт её только докачкой', async () => {
    const save = await import('./save');
    const { createInitialState } = await import('./state');
    const fresh = save.serialize(createInitialState(4));
    await save.readyToRead(fresh);
    expect(save.deserialize(fresh), 'своя версия читается без двери').not.toBeNull();
    const src = readFileSync(join(__dirname, 'save.ts'), 'utf8');
    expect(src, 'статического ввоза двери нет').not.toMatch(/^import (?!type)[^;]*from '\.\/(yardmerge|yardstep)'/m);
    expect(src).toMatch(/await import\('\.\/yardstep'\)/);
    // Сервер и мир читают прежний тип постройки малой таблицей, а не дверью.
    for (const f of ['derived.ts', 'sim/expedition.ts']) expect(readFileSync(join(__dirname, f), 'utf8'), f).not.toMatch(/from '\.{1,2}\/yardmerge'/);
  });
});
