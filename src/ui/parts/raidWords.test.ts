// Входы к набегу ведут в донесение о набеге, и окно ответа читается на них одинаково.
//
// Экрана расстановки обороны больше нет (поставка 2 боя, docs/battle_eu4.md, 14.27): у частокола строй раскладывает
// правило, а решение о набеге — донесение в почте, где оба ответа, перехват на карте и сбор дружины в Статуе. Входов к
// нему два — строка набега в тревогах и раздел «Оборона» у стены, — и открывают они его одной дверью (`realm/open.openRaid`).
// Окно ответа — сколько ещё успевает полный сбор — читают трое (оба входа и само донесение), и все через одну дверь слов
// (`useRaidWords` → `raidWords(raidWindow(…))`). Две проверки: по исходнику — прежней двери к расстановке нет нигде, а
// своих расчётов и слов об окне ни у кого; по ответу — слова на границе окна говорят ровно то, что решил мир.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { raidWindow } from '@/world/store';
import { formatLeft } from '@/world/geo';
import type { MarchView } from '@/world/types';
import { raidWords } from './raidWords';

const SRC = path.join(process.cwd(), 'src');
const UI = path.join(SRC, 'ui');

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

const rel = (base: string, abs: string): string => path.relative(base, abs).split(path.sep).join('/');

/** Входы к донесению о набеге. Тревога у обоих видов интерфейса одна — `alertItems` (строки и значки рисуют по ней). */
const ENTRIES = ['alertItems.ts', 'parts/Walls.tsx'];
/** Кто показывает окно ответа: оба входа и само донесение. */
const READERS = [...ENTRIES, 'realm/Mail.tsx'];

describe('набег — одно донесение и одно окно на все входы', () => {
  it('двери к расстановке нет нигде, входы открывают донесение `openRaid`, окно читают через `useRaidWords`', () => {
    const all = sources(SRC);
    // Прежняя дверь — вид шторки `defense` и `openDefense` — не вернулась ни в одном файле игры.
    const stale = all.filter((f) => /\bopenDefense\b|kind: 'defense' \}|BattlePanel/.test(code(f))).map((f) => rel(SRC, f));
    expect(stale, 'кто ещё ведёт к расстановке обороны').toEqual([]);

    const ui = sources(UI);
    const doors = ui.filter((f) => /(?<!function )\bopenRaid\(/.test(code(f))).map((f) => rel(UI, f)).sort();
    expect(doors, 'кто открывает донесение о набеге').toEqual([...ENTRIES].sort());
    for (const f of READERS) {
      const src = code(path.join(UI, f));
      expect(src, `${f}: окно из общей двери`).toMatch(/\buseRaidWords\(\)/);
      expect(src, `${f}: свой расчёт окна`).not.toMatch(/\braidWindow\(|musterBy|musterWait|HANDOVER_|DEFENSE_FREEZE/);
      expect(src, `${f}: свои слова об окне`).not.toMatch(/не успеет|сбор ещё|заперт/i);
    }
    // Дверь мира в интерфейсе зовёт один модуль — слов.
    const callers = ui.filter((f) => /\braidWindow\(/.test(code(f))).map((f) => rel(UI, f));
    expect(callers, 'кто зовёт raidWindow в интерфейсе').toEqual(['parts/raidWords.ts']);
    // Донесение ведёт к действию, которое игрок может сделать: сбор дружины — в Статуе.
    const mail = code(path.join(UI, 'realm/Mail.tsx'));
    expect(mail, 'кнопка «Дружина» ведёт в Статую').toMatch(/buildingOfType\(s, 'statue'\)/);
    expect(mail, 'кнопка «Дружина» ведёт в Статую').toMatch(/<span>Дружина<\/span>/);
  });

  it('на границе окна слова говорят то же, что решил мир', () => {
    const NOW = 1_700_000_000_000;
    const MUSTER = 3 * 3_600_000;
    const march = (arriveAt: number, musterBy?: number): MarchView =>
      ({ id: 'm', hostile: true, own: false, phase: 'out', arriveAt, fromName: 'Логово', ...(musterBy === undefined ? {} : { musterBy }) }) as MarchView;
    // Точки по обе стороны минуты, до которой полный сбор успевает, и на ней самой: за минуту до, за секунду до, ровно,
    // секунду после, и отряд, до прихода которого сбор не успевал уже с минуты обнаружения.
    const lefts = [60_000, 1_000, 0, -1_000, -MUSTER + 1_000];
    let late = 0;
    let open = 0;
    for (const left of lefts) {
      const musterBy = NOW + left;
      const win = raidWindow(march(musterBy + MUSTER, musterBy), NOW);
      // Точка внутри области правила: отряд идёт на деревню, и приход ещё впереди.
      expect(win.muster, `${left} мс: у отряда на деревню есть срок сбора`).not.toBeNull();
      expect(win.seconds, `${left} мс: приход впереди`).toBeGreaterThan(0);
      const words = raidWords(win);
      expect(words.win, `${left} мс: ответ двери приехал как есть`).toBe(win);
      expect(win.late, `${left} мс: слова и мир о том, успевает ли сбор`).toBe(left <= 0);
      if (win.late) {
        late++;
        expect(win.muster, `${left} мс: у опоздавшего срока сбора нет`).toBe(0);
        expect(words.short, `${left} мс: строка опоздания`).toBe('полный сбор не успеет');
      } else {
        open++;
        expect(win.seconds - win.muster!, `${left} мс: до прихода — срок сбора и потолок сбора`).toBeCloseTo(MUSTER / 1000, 6);
        expect(words.short, `${left} мс: строка называет срок сбора`).toBe(`сбор ещё\u00a0${formatLeft(win.muster!)}`);
        expect(words.long, `${left} мс: полная строка называет тот же срок`).toContain(formatLeft(win.muster!));
      }
    }
    // Граница области — внутри выборки: есть точки по обе её стороны.
    expect(late, 'точки после минуты сбора').toBeGreaterThan(0);
    expect(open, 'точки до минуты сбора').toBeGreaterThan(0);
    // Отряд не на деревню сбора не ждёт: срока нет, и о сборе слов нет.
    const elsewhere = raidWords(raidWindow(march(NOW + MUSTER), NOW));
    expect(elsewhere.win.muster, 'отряд не на деревню').toBeNull();
    expect(elsewhere.short, 'отряд не на деревню').toBeNull();
  });
});
