import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readClaim, type CastleClaim, type RosterFile } from './contract.js';
import {
  ROSTER_FORGET_MS,
  ROSTER_MAX,
  castleIdOf,
  emptyRoster,
  prune,
  readRoster,
  rosterEpoch,
  upsert,
  viewOf,
  worthWriting,
} from './roster.js';
import { SETTLE_GAP } from '../../src/world/data/tuning.js';
import { fitToSettle } from '../../src/world/settle.js';

const NOW = 1_700_000_000_000;

const claim = (over: Partial<CastleClaim> = {}): CastleClaim => ({
  name: 'Вождь',
  power: 4200,
  pop: 310,
  ...over,
});

/** Реестр из `n` игроков, посаженных подряд, — ровно так это делает функция. */
function roster(n: number, at = NOW): RosterFile {
  let file = emptyRoster();
  for (let i = 0; i < n; i++) file = upsert(file, `tg-${100 + i}`, claim({ name: `Вождь ${i}` }), at);
  return file;
}

describe('игрок пишет только свою строку', () => {
  /**
   * Ради чего замок и стоит. Достаточно одной строки вида `rows[body.id] = …` —
   * и любой сможет переставить чужой замок; по коду такая правка выглядит
   * невинно, поэтому её ловит правило, а не внимательность.
   */
  it('чужие строки не меняются ни в одном поле', () => {
    const before = roster(5);
    const copy = JSON.parse(JSON.stringify(before)) as RosterFile;
    const after = upsert(before, 'tg-102', claim({ name: 'Новое имя', power: 1 }), NOW + 60_000);
    for (const key of Object.keys(copy.rows)) {
      if (key === 'tg-102') continue;
      expect([key, after.rows[key]]).toEqual([key, copy.rows[key]]);
    }
    expect(after.rows['tg-102'].name).toBe('Новое имя');
    // Прежний реестр не тронут: сравнивать «до» и «после» можно только так.
    expect(before).toEqual(copy);
  });

  it('новая строка не двигает ни одного стоящего замка', () => {
    const before = roster(6);
    const spots = Object.fromEntries(Object.entries(before.rows).map(([k, r]) => [k, { x: r.x, y: r.y }]));
    const after = upsert(before, 'tg-999', claim(), NOW);
    for (const [key, at] of Object.entries(spots)) {
      expect([key, { x: after.rows[key].x, y: after.rows[key].y }]).toEqual([key, at]);
    }
  });

  /**
   * Клетка стоящего замка не меняется никогда. Это не «сервер не двигает» — это
   * «двигать нечем»: в `claim` нет полей координат, а `upsert` берёт их у уже
   * стоящей строки.
   */
  it('клетка стоящего замка не двигается, что бы игрок ни присылал', () => {
    const first = upsert(emptyRoster(), 'tg-7', claim(), NOW);
    const at = { x: first.rows['tg-7'].x, y: first.rows['tg-7'].y };
    let file = first;
    for (let i = 0; i < 5; i++) {
      file = upsert(file, 'tg-7', claim({ name: `имя ${i}`, power: i }), NOW + i * 60_000);
      expect({ x: file.rows['tg-7'].x, y: file.rows['tg-7'].y }).toEqual(at);
    }
  });
});

describe('тело запроса не назначает места', () => {
  it('координаты не проезжают в реестр ни под каким именем', () => {
    const c = readClaim({ name: 'Вождь', power: 10, pop: 20, x: 1, y: 2, seenAt: 5, id: 'чужой' });
    expect(Object.keys(c!).sort()).toEqual(['name', 'pop', 'power']);
  });

  it('числа приводятся, строкой в них не подставить ничего', () => {
    expect(readClaim({ name: 5, power: '99', pop: -3 })).toEqual({ name: '', power: 0, pop: 0 });
    expect(readClaim({ name: 'и'.repeat(200), power: 1e30, pop: 1e30 })!.name).toBe('');
  });

  it('без тела строки нет', () => {
    for (const bad of [null, 'строка', 42]) expect(readClaim(bad)).toBeNull();
  });

  /**
   * Замок ставится на землю, годную под двор, — тем же правилом, каким мир
   * ставит его игроку без сети. Проверяется по-настоящему, а не по типу: у
   * функции нет второго способа выбрать клетку.
   */
  it('поставленный замок стоит на пригодной земле и не под боком у соседа', () => {
    const file = roster(12);
    const rows = Object.values(file.rows);
    for (const r of rows) expect([r.x, r.y, fitToSettle(r)]).toEqual([r.x, r.y, true]);
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        expect(Math.hypot(rows[i].x - rows[j].x, rows[i].y - rows[j].y)).toBeGreaterThanOrEqual(SETTLE_GAP);
      }
    }
  });
});

describe('реестр знает свою землю', () => {
  /**
   * Координаты без отметки земли — та же беда, ради которой у сохранения мира
   * нижняя граница версии равна верхней: замок, стоявший на 541|822, оказался бы
   * посреди залива. Пересобрали атлас — реестр начинается заново.
   */
  it('реестр чужой земли читается как пустой, а не приводится', () => {
    const file = roster(3);
    const foreign = { ...file, epoch: file.epoch + 1 };
    expect(readRoster(foreign).rows).toEqual({});
    expect(readRoster(file).rows).toEqual(file.rows);
  });

  it('испорченное значение читается как пустой реестр, а не роняет функцию', () => {
    for (const bad of [null, 'строка', 42, {}, { v: 2, epoch: rosterEpoch(), rows: {} }]) {
      expect(readRoster(bad).rows).toEqual({});
    }
    // Строка без клетки — не строка: такую в реестр не принимают.
    expect(readRoster({ v: 1, epoch: rosterEpoch(), rows: { a: { name: 'x' } } }).rows).toEqual({});
  });
});

describe('реестр не растёт без предела', () => {
  it('замок того, кто не заходил три месяца, сходит с карты', () => {
    const old = roster(4, NOW - ROSTER_FORGET_MS - 60_000);
    const kept = prune(old, NOW, 'нет-такого');
    expect(Object.keys(kept.rows)).toEqual([]);
  });

  it('своя строка от прополки защищена, как бы ни разошлись часы', () => {
    const old = roster(4, NOW - ROSTER_FORGET_MS - 60_000);
    const kept = prune(old, NOW, 'tg-101');
    expect(Object.keys(kept.rows)).toEqual(['tg-101']);
  });

  it('свежие строки прополка не трогает вовсе — и объект тот же', () => {
    const fresh = roster(4);
    expect(prune(fresh, NOW, 'tg-100')).toBe(fresh);
  });

  it('потолок держится, и уходят самые давние', () => {
    const rows: RosterFile = { v: 1, epoch: rosterEpoch(), rows: {} };
    for (let i = 0; i < ROSTER_MAX + 5; i++) {
      rows.rows[`tg-${i}`] = { x: 500, y: 800, name: '', power: 0, pop: 0, seenAt: NOW - i };
    }
    const kept = prune(rows, NOW, 'tg-0');
    expect(Object.keys(kept.rows).length).toBe(ROSTER_MAX);
    // Ушли те, у кого «был в игре» дальше всех.
    expect(kept.rows[`tg-${ROSTER_MAX + 4}`]).toBeUndefined();
    expect(kept.rows['tg-0']).toBeDefined();
  });
});

describe('лишних записей не делается', () => {
  it('ничего не изменилось и тишина недолгая — писать не за чем', () => {
    const file = roster(2);
    expect(worthWriting(file, 'tg-100', claim({ name: 'Вождь 0' }), NOW + 1000, 60_000)).toBe(false);
  });

  it('сменилось имя или мощь — пишем сразу', () => {
    const file = roster(2);
    expect(worthWriting(file, 'tg-100', claim({ name: 'Другой' }), NOW + 1000, 60_000)).toBe(true);
    expect(worthWriting(file, 'tg-100', claim({ name: 'Вождь 0', power: 9 }), NOW + 1000, 60_000)).toBe(true);
  });

  it('долгая тишина — пишем ради одной отметки «был в игре»', () => {
    const file = roster(2);
    expect(worthWriting(file, 'tg-100', claim({ name: 'Вождь 0' }), NOW + 120_000, 60_000)).toBe(true);
  });

  it('строки нет — писать надо всегда: это регистрация', () => {
    expect(worthWriting(emptyRoster(), 'tg-1', claim(), NOW, 60_000)).toBe(true);
  });
});

describe('соседям не раздаётся телеграмный номер', () => {
  it('наружу уходит выведенный признак, а не ключ', () => {
    const file = upsert(emptyRoster(), 'tg-123456789', claim(), NOW);
    const seen = viewOf(file);
    expect(seen).toHaveLength(1);
    expect(seen[0].id).not.toContain('123456789');
    expect(seen[0].id).toBe(castleIdOf('tg-123456789'));
  });

  it('признак постоянен и у разных ключей разный', () => {
    expect(castleIdOf('tg-1')).toBe(castleIdOf('tg-1'));
    const all = new Set<string>();
    for (let i = 0; i < 5000; i++) all.add(castleIdOf(`tg-${i}`));
    expect(all.size).toBe(5000);
  });
});

describe('замки серверной части реестра', () => {
  const src = readFileSync(join(__dirname, '..', 'functions', 'castles.mts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('запрос проверяется подписью до всего остального', () => {
    expect(code).toMatch(/readInitData\(/);
    expect(code).toMatch(/if \(!auth\.ok\) return deny\(401/);
  });

  /**
   * То же, что и у сохранения, только строка вместо значения: ключ строки
   * собирается ровно один раз и ровно из проверенной личности. Достаточно
   * `const key = body.id` — и любой перепишет чужой замок.
   */
  it('ключ строки собирается один раз и только из проверенного', () => {
    const assigns = [...code.matchAll(/\bkey\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(assigns).toEqual(['saveKeyOf(auth.user)']);
  });

  it('в реестр ходят только по этому ключу', () => {
    const calls = [...code.matchAll(/\b(?:upsert|prune|worthWriting|answer)\([^)]*?,\s*([A-Za-z_$][\w$]*)/g)].map(
      (m) => m[1],
    );
    expect(calls.length).toBeGreaterThan(2);
    expect([...new Set(calls)]).toEqual(['key']);
  });

  /**
   * Машинная запись правила «место выбирает сервер». Поля координат в теле нет,
   * значит его неоткуда и прочитать; проверяется это прямо, потому что добавить
   * такое чтение — правка в одну строку.
   */
  it('координат из тела запроса функция не читает вовсе', () => {
    for (const bad of [/sent\s*\.\s*[xy]\b/, /claim\s*\.\s*[xy]\b/, /body\s*\.\s*[xy]\b/]) {
      expect([String(bad), bad.test(code)]).toEqual([String(bad), false]);
    }
  });

  /**
   * Место ищется внутри цикла перезаписи, а не до него. Иначе двое, зашедших в
   * одну секунду, посчитали бы клетку каждый по своему списку — и сервер сам
   * поставил бы два замка вплотную.
   */
  it('реестр читается заново на каждой попытке записи', () => {
    const loop = code.slice(code.indexOf('for (let tries'));
    expect(loop).toMatch(/getWithMetadata\(KEY/);
    expect(loop).toMatch(/upsert\(file, key/);
    expect(loop).toMatch(/onlyIfMatch|onlyIfNew/);
  });
});
