// Консольные команды (docs/handbook/console.md): разбор доводов и сторон, разброс доли, стена и место — и справочник,
// который называет каждую команду консоли из package.json. Бой и мир здесь не гоняются: их держат тесты ядра и мира.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { kindsOf } from '@/game/battle/price';
import { menOfPower, raidingParty } from '@/world/garrison';
import { GROUND_CROSSING, GROUND_LAND } from '@/world/place';
import { ROOT, assaultOf, has, menOf, num, parseArgs, parseSide, placeOf, rejectUnknown, text, wilson } from './lib';

/** `fail` выходит из процесса — в тесте выход становится ошибкой с той же строкой. */
function failing(fn: () => unknown): string {
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('exit');
  }) as never);
  const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    fn();
  } catch {
    // выход
  }
  const said = err.mock.calls.map((c) => String(c[0])).join('\n');
  exit.mockRestore();
  err.mockRestore();
  return said;
}

afterEach(() => vi.restoreAllMocks());

describe('доводы', () => {
  it('ключ со значением, через «=», флаг и свободные доводы; «--» npm пропускается', () => {
    const a = parseArgs(['--', 'wolves', '--level', '5', '--runs=40', '--log', '--watch', '--a', 'spearman:10']);
    expect(a.free).toEqual(['wolves']);
    expect(text(a, 'level')).toBe('5');
    expect(text(a, 'runs')).toBe('40');
    expect(has(a, 'log')).toBe(true);
    expect(has(a, 'watch')).toBe(true);
    expect(text(a, 'a')).toBe('spearman:10');
  });

  it('флаг не съедает следующий свободный довод', () => {
    const a = parseArgs(['--live', 'x']);
    expect(has(a, 'live')).toBe(true);
    expect(a.free).toEqual(['x']);
  });

  it('число: запятая — десятичная, вне границ и не число — ошибка словами', () => {
    expect(num('t', parseArgs(['--rest-a', '0,7']), 'rest-a', 1)).toBe(0.7);
    expect(failing(() => num('t', parseArgs(['--runs', 'много']), 'runs', 1))).toContain('--runs ждёт число');
    expect(failing(() => num('t', parseArgs(['--level', '12']), 'level', 1, { max: 10 }))).toContain('не больше 10');
    expect(failing(() => num('t', parseArgs(['--runs', '1.5']), 'runs', 1, { int: true }))).toContain('целое');
  });

  it('опечатка в имени ключа — ошибка до счёта, а не молча другой бой', () => {
    const a = parseArgs(['--levle', '5']);
    num('t', a, 'level', 5);
    expect(failing(() => rejectUnknown('t', a))).toContain('--levle');
  });
});

describe('стороны', () => {
  it('виды племени латиницей и по-русски — те же головы, строй — дверью цены (price.kindsOf)', () => {
    const a = parseSide('t', 'spearman:100,archer:40', 1, 'a');
    const b = parseSide('t', 'Копейщики:100, лучники:40', 1, 'b');
    expect(a.troops).toEqual({ spearman: 100, archer: 40 });
    expect(b.troops).toEqual(a.troops);
    expect(a.kinds).toEqual(kindsOf({ spearman: 100, archer: 40 }));
  });

  it('рода ядра — бойцами строя: с префиксом kind: и без него, кроме лучников (они — вид племени)', () => {
    const s = parseSide('t', 'kind:spear:30,infantry:20,kind:archer:10', 1, 'a');
    expect(s.troops).toEqual({});
    expect([s.kinds.spear, s.kinds.infantry, s.kinds.archer]).toEqual([30, 20, 10]);
  });

  it('волки — лёгкая конница по числу, звери; разбойники и логово — уклад по сиду, людей — мерой мира', () => {
    const w = parseSide('t', 'волки:300', 1, 'a');
    expect(w.beasts).toBe(true);
    expect(w.kinds.cavalry).toBe(300);
    expect(menOf(w.kinds)).toBe(300);
    const r = parseSide('t', 'raiders:900', 7, 'a');
    expect(r.kinds).toEqual(raidingParty(7, 'console', 900).kinds);
    expect(menOf(r.kinds)).toBe(menOfPower(900));
  });

  it('неизвестное имя и пустая сторона — ошибка словами', () => {
    expect(failing(() => parseSide('t', 'spearmen:5', 1, 'нападающий'))).toContain('«spearmen»');
    expect(failing(() => parseSide('t', 'spearman', 1, 'нападающий'))).toContain('имя:число');
    expect(failing(() => parseSide('t', 'spearman:0', 1, 'оборона'))).toContain('пустая сторона');
  });
});

describe('стена, место, разброс', () => {
  it('способ штурма: поле — без стены; лестницы, таран, башня, проломы — через «+»', () => {
    expect(assaultOf('t', 'none')).toBeNull();
    expect(assaultOf('t', 'scaling')).toEqual({});
    expect(assaultOf('t', 'ladders+ram')).toEqual({ ladders: true, ram: true });
    expect(assaultOf('t', 'breach:2+tower')).toEqual({ breaches: 2, tower: true });
    expect(failing(() => assaultOf('t', 'breach:9'))).toContain('проломов не больше');
  });

  it('место: земля и переправа — те же грани, что у world/place', () => {
    expect(placeOf('t', undefined, false)).toBeUndefined();
    expect(placeOf('t', 'лес', true)).toEqual({ land: GROUND_LAND.forest, crossing: GROUND_CROSSING });
    expect(placeOf('t', 'mountains', false)).toEqual({ land: GROUND_LAND.mountains });
  });

  it('граница Уилсона: внутри [0, 1], содержит долю и сужается с числом боёв', () => {
    for (const [k, n] of [[0, 10], [10, 10], [3, 40], [20, 40]] as const) {
      const [lo, hi] = wilson(k, n);
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(1);
      expect(lo).toBeLessThanOrEqual(k / n);
      expect(hi).toBeGreaterThanOrEqual(k / n);
    }
    const narrow = wilson(200, 400);
    const wide = wilson(20, 40);
    expect(narrow[1] - narrow[0]).toBeLessThan(wide[1] - wide[0]);
  });
});

describe('справочник консоли', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  const commands = Object.entries(pkg.scripts).filter(([, cmd]) => cmd.includes('scripts/console/'));
  const doc = readFileSync(path.join(ROOT, 'docs', 'handbook', 'console.md'), 'utf8');

  it('каждая команда консоли из package.json описана в docs/handbook/console.md рецептом', () => {
    expect(commands.length).toBeGreaterThanOrEqual(10);
    for (const [name] of commands) expect(doc, `npm run ${name}`).toContain(`npm run ${name}`);
  });

  it('каждый вход консоли лежит на диске и знает --help', () => {
    for (const [name, cmd] of commands) {
      const file = /scripts\/console\/[\w-]+\.ts/.exec(cmd)?.[0];
      expect(file, name).toBeTruthy();
      const src = readFileSync(path.join(ROOT, file as string), 'utf8');
      expect(src, name).toMatch(/--help|helpIf/);
    }
  });
});
