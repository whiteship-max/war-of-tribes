// Заморозка обороны читается одинаково на всех входах к расстановке.
//
// Входов четыре — строка набега в тревогах, письмо о набеге, карточка своего замка и
// раздел «Оборона» у стены, — и пятый читатель — сам экран расстановки. Все пятеро
// берут замок из одной двери (`useLockWords` → `lockWords(defenseLock(…))`) и слова из неё
// же. Две проверки: по исходнику — никто не зовёт `defenseLock` сам и не пишет своих слов
// о замке; по ответу — слова на границе замка говорят ровно то, что решила дверь мира.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defenseLock } from '@/world/store';
import { DEFENSE_FREEZE } from '@/world/data/tuning';
import { formatLeft } from '@/world/geo';
import type { MarchView } from '@/world/types';
import { lockWords } from './defenseLock';

const UI = path.join(process.cwd(), 'src/ui');

/** Исходник без комментариев. */
const code = (abs: string): string =>
  readFileSync(abs, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...sources(abs));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(abs);
  }
  return out;
}

const rel = (abs: string): string => path.relative(UI, abs).split(path.sep).join('/');

/** Четыре входа к расстановке и сам экран. */
const ENTRIES = ['AlertBar.tsx', 'realm/Mail.tsx', 'panels/WorldPanel.tsx', 'parts/Walls.tsx'];
const READERS = [...ENTRIES, 'panels/BattlePanel.tsx'];

describe('замок обороны — одна дверь на все входы', () => {
  it('входы к расстановке — ровно эти четыре, и каждый читает замок через `useLockWords`', () => {
    const all = sources(UI);
    const doors = all.filter((f) => /\bopenDefense\(\)|onClick=\{openDefense\}/.test(code(f))).map(rel).sort();
    expect(doors, 'кто открывает расстановку').toEqual([...ENTRIES].sort());
    for (const f of READERS) {
      const src = code(path.join(UI, f));
      expect(src, `${f}: замок из общей двери`).toMatch(/\buseLockWords\(\)/);
      expect(src, `${f}: свой расчёт замка`).not.toMatch(/\bdefenseLock\(|DEFENSE_FREEZE/);
      expect(src, `${f}: свои слова о замке`).not.toMatch(/заперт|минус 5|пяти минут/i);
    }
    // Дверь мира в интерфейсе зовёт один модуль — слов.
    const callers = all.filter((f) => /\bdefenseLock\(/.test(code(f))).map(rel);
    expect(callers, 'кто зовёт defenseLock в интерфейсе').toEqual(['parts/defenseLock.ts']);
  });

  it('на границе замка слова говорят то же, что решила дверь мира', () => {
    const NOW = 1_700_000_000_000;
    const march = (arriveAt: number): MarchView => ({ id: 'm', hostile: true, own: false, phase: 'out', arriveAt, fromName: 'Логово' }) as MarchView;
    // Точки по обе стороны отметки и на ней самой: за минуту до, за секунду до, ровно, после.
    const lefts = [DEFENSE_FREEZE + 60_000, DEFENSE_FREEZE + 1_000, DEFENSE_FREEZE, DEFENSE_FREEZE - 1_000, 1_000];
    let frozen = 0;
    let open = 0;
    for (const left of lefts) {
      const lock = defenseLock([march(NOW + left)], NOW);
      // Точка внутри области правила: отряд идёт, и приход ещё впереди.
      expect(lock.march, `${left} мс: отряд в пути`).not.toBeNull();
      expect(lock.seconds, `${left} мс: приход впереди`).toBeGreaterThan(0);
      const words = lockWords(lock);
      expect(words.frozen, `${left} мс: слова и дверь мира о замке`).toBe(left <= DEFENSE_FREEZE);
      expect(words.lock, `${left} мс: ответ двери приехал как есть`).toBe(lock);
      if (words.frozen) {
        frozen++;
        expect(words.short, `${left} мс: запертая строка`).toBe('оборона заперта');
        expect(lock.freezeIn, `${left} мс: у запертой срока до замка нет`).toBe(0);
      } else {
        open++;
        expect(lock.seconds - lock.freezeIn, `${left} мс: срок до замка — приход минус отметка`).toBeCloseTo(DEFENSE_FREEZE / 1000, 6);
        expect(words.short, `${left} мс: открытая строка называет срок до замка`).toBe(`менять ещё\u00a0${formatLeft(lock.freezeIn)}`);
        expect(words.long, `${left} мс: полная строка называет тот же срок`).toContain(formatLeft(lock.freezeIn));
      }
    }
    expect(frozen, 'на границе побывали запертыми').toBeGreaterThan(0);
    expect(open, 'на границе побывали открытыми').toBeGreaterThan(0);
    // Без отряда замка нет и сказать у входа нечего.
    const none = lockWords(defenseLock([], NOW));
    expect(none.frozen).toBe(false);
    expect(none.short).toBeNull();
  });
});
