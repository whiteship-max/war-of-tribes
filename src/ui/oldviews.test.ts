// Прежние интерфейс, карта и ролик боя удалены (docs/ui_audit.md, 16): вид у игры один. Старый адрес (`?ui=old`,
// `?map=old`, `?battle=old`) и выбор, записанный на устройстве прежней игрой (`tribe.ui`, `tribe.map`, `tribe.battle`),
// ничего не ломают и ничего не меняют — их просто не читает никто.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const OLD_KEYS = ['tribe.ui', 'tribe.map', 'tribe.battle'];
const OLD_SEARCH = '?ui=old&map=old&battle=old';

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...sources(abs));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(abs);
  }
  return out;
}

const strip = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('старые адреса и выбор на устройстве игнорируются', () => {
  const g = globalThis as unknown as { location?: unknown; localStorage?: unknown };
  const saved = { location: g.location, localStorage: g.localStorage };
  const reads: string[] = [];

  beforeAll(() => {
    // Устройство, где прежняя игра записала «прежнее» у всех трёх, и адрес, который его просит.
    const store = new Map(OLD_KEYS.map((k) => [k, 'old']));
    g.localStorage = {
      getItem: (k: string) => {
        reads.push(k);
        return store.get(k) ?? null;
      },
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    g.location = { search: OLD_SEARCH, href: `https://example.test/${OLD_SEARCH}` };
  });
  afterAll(() => {
    g.location = saved.location;
    g.localStorage = saved.localStorage;
  });

  it('карта — по регионам, ролик — TW: при записанном «old» и адресе с old', async () => {
    // Точки внутри области: «прежнее» правда записано и правда просится адресом.
    expect((g.localStorage as Storage).getItem('tribe.map')).toBe('old');
    expect(new URLSearchParams((g.location as Location).search).get('map')).toBe('old');
    reads.length = 0;

    await import('./map/tw/hook');
    const { twSlot } = await import('./map/twslot');
    expect(twSlot(), 'кадр, палец и рамка — у карты по регионам').not.toBe(null);

    const { BattleReplay } = await import('./battle/BattleReplay');
    const { TwReplay } = await import('./battle/TwReplay');
    const el = BattleReplay({ rec: {} as never, onDone: () => {} });
    expect(el.type, 'ролик — TW').toBe(TwReplay);

    expect(reads.filter((k) => OLD_KEYS.includes(k)), 'выбор прежней игры не читался').toEqual([]);
  });

  it('ни ключей выбора, ни параметров адреса прежних видов в коде нет', () => {
    const hits: string[] = [];
    for (const f of sources(ROOT)) {
      const code = strip(readFileSync(f, 'utf8'));
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      for (const k of OLD_KEYS) if (code.includes(`'${k}'`) || code.includes(`"${k}"`)) hits.push(`${rel}: ${k}`);
      // Параметр адреса прежнего вида: `get('ui')`, `has('map')`, `ui=old`, `battle=tw` — в любом виде.
      if (/\b(?:get|has)\(\s*['"](?:ui|map|battle)['"]\s*\)/.test(code)) hits.push(`${rel}: параметр адреса`);
      if (/[?&](?:ui|map|battle)=(?:old|new|tw)\b/.test(code)) hits.push(`${rel}: адрес вида`);
    }
    expect(hits).toEqual([]);
  });

  it('в настройках нет строк выбора вида', () => {
    const settings = strip(readFileSync(path.join(ROOT, 'ui/parts/Settings.tsx'), 'utf8'));
    for (const row of ['Интерфейс', 'Карта мира', 'Ролик боя']) expect(settings, row).not.toContain(row);
  });
});
