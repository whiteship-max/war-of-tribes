// Входы к набегу ведут в донесение о набеге, и окно ответа читается на них одинаково.
//
// Экрана расстановки обороны больше нет (поставка 2 боя, docs/battle_eu4.md, 14.27): у частокола строй раскладывает
// правило, а решение о набеге — донесение в почте, где оба ответа, перехват на карте и полководец с раскладкой в Статуе.
// Входов к нему два — строка набега в тревогах и раздел «Оборона» у стены, — и открывают они его одной дверью
// (`realm/open.openRaid`). Окно ответа — до прихода (решение владельца 06.10.2026, docs/NOTIFY.md, 12.11) — читают трое
// (оба входа и само донесение), и все через одну дверь слов (`useRaidWords` → `raidWords(raidWindow(…))`). Две проверки:
// по исходнику — прежней двери к расстановке нет нигде, а своих расчётов и слов об окне ни у кого (и слов о сборе дома —
// «сбор ещё», «не успеет» — тоже); по ответу — слова на границе окна говорят ровно то, что решил мир.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { raidWindow } from '@/world/store';
import { realLeft } from './wait';
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

/**
 * Входы к донесению о набеге. Тревога у обоих видов интерфейса одна — `alertItems` (строки и значки рисуют по ней); с П-7
 * набег стоит значком войны справа снизу — `warSigns` (docs/polish.md), окно читает той же дверью.
 */
const ENTRIES = ['alertItems.ts', 'parts/Walls.tsx', 'warSigns.ts'];
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
    // Донесение ведёт к действию, которое игрок может сделать: гарнизон и отряд полководца — в окне «Дружина» (передача там
    // с UI-4; прежде кнопка вела в Статую — docs/ui_v2.md, 5.3 и 5.6).
    const mail = code(path.join(UI, 'realm/Mail.tsx'));
    expect(mail, 'кнопка «Дружина» ведёт в окно дружины').toMatch(/goTo\(WINDOW\.army\)/);
    expect(mail, 'кнопка «Дружина» ведёт в окно дружины').toMatch(/<b>Дружина<\/b>/);
  });

  /**
   * Окно ответа — до прихода, и слова называют ровно этот срок. Прежде здесь держалась граница «полный сбор ещё успевает»
   * (`MarchView.musterBy`, строки «сбор ещё …» и «полный сбор не успеет»): сбора дома больше нет. Граница области —
   * приход: точки за минуту, за секунду, ровно в минуту прихода и после неё (окно закрыто — срок ноль).
   */
  it('на границе окна слова говорят то же, что решил мир: срок — до прихода, о сборе ни слова', () => {
    const NOW = 1_700_000_000_000;
    const march = (arriveAt: number): MarchView =>
      ({ id: 'm', hostile: true, own: false, phase: 'out', arriveAt, fromName: 'Логово' }) as MarchView;
    let open = 0;
    let shut = 0;
    for (const left of [60_000, 1_000, 0, -1_000]) {
      const win = raidWindow(march(NOW + left), NOW);
      const words = raidWords(win);
      expect(words.win, `${left} мс: ответ двери приехал как есть`).toBe(win);
      expect(win.seconds, `${left} мс: окно — до прихода`).toBe(Math.max(0, left / 1000));
      expect(words.left, `${left} мс: строка называет срок до прихода`).toBe(realLeft(win.seconds));
      expect(`${words.left} ${words.long}`, `${left} мс: о сборе ни слова`).not.toMatch(/сбор|не успеет/i);
      if (left > 0) open++;
      else shut++;
    }
    // Граница области — внутри выборки: есть точки по обе её стороны.
    expect(open, 'точки до прихода').toBeGreaterThan(0);
    expect(shut, 'точки в минуту прихода и после').toBeGreaterThan(0);
  });
});
