// Прибор `roam:report` (ПН-0ч, docs/gdd/path_of_sword.md, раздел 11): разделы те, что называет ГДД; статус раздела выводится
// из его входов, и раздел на заглушках не может назвать себя выведенным; вход читается только объявленным; реестр ориентиров
// покрывает ГДД; путь и отчёт повторяются по сиду.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TroopStack } from '../../src/game/battle/kinds';
import { MIX, stackOf } from '../autopilot';
import { INPUTS, type InputId, type InputValue } from './inputs';
import { ORIENTS, orientSections } from './orients';
import { STYLES, runPath } from './path';
import { Undeclared, render, statusLines, statusOf, type Section, type Size } from './run';
import { PILOT, SECTIONS, knobsOf } from './sections';
import { detectShare, landAround } from './sight';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const GDD = path.join(ROOT, 'docs/gdd/path_of_sword.md');

/** Размер для тестов: та же машина, что у малого и полного, только мельче. */
const TINY: Size = { name: 'малый', seeds: 1, steps: 2, even: 4, pool: 1, nft: 1, sight: 200 };

const stubsOf = (uses: readonly InputId[]): InputId[] => uses.filter((k) => INPUTS[k].kind === 'stub');
const use = <K extends InputId>(k: K): InputValue<K> => INPUTS[k].value as InputValue<K>;

async function lines(sections: readonly Section[], only?: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  await render(sections, TINY, (l) => out.push(l), only ? new Set(only) : undefined);
  return out;
}

describe('разделы — те, что называют ГДД 6.5 и пачка ПН-0', () => {
  it('сразу на дверях кода и на автопилоте, по порядку', () => {
    // ГДД 7.1, ПН-0: содержание эталонов тира, цены повышения, сроки пути, плата договоров, ценность города для паритета;
    // 6.5: темп престижа, медиана до замка, паритет, сила НПС, курс припаса, пул, доля обнаружений по видам лагеря.
    // ПН-1 добавил раздел дверей отряда (`band`) — содержание, терпение, обоз и фураж бродяги.
    expect(SECTIONS.map((s) => s.id)).toEqual(['pay', 'band', 'rate', 'upgrade', 'road', 'contract', 'foes', 'prestige', 'castle', 'parity', 'pool', 'sight']);
  });

  it('у каждого раздела — раздел ГДД и двери кода или входы', () => {
    for (const s of SECTIONS) {
      expect(s.gdd, s.id).toMatch(/^\d/);
      expect(s.doors.length + s.uses.length, s.id).toBeGreaterThan(0);
    }
  });
});

describe('заглушка не выдаётся за выведенное', () => {
  it('статус — из родов входов: хоть одна заглушка — «НЕ ИЗМЕРЕНО», и шапка называет каждую с пачкой', () => {
    for (const s of SECTIONS) {
      const stubs = stubsOf(s.uses);
      const head = statusLines(s);
      if (stubs.length > 0) {
        expect(statusOf(s.uses), `раздел «${s.title}» на заглушках ${stubs.join(', ')} печатает статус НЕ ИЗМЕРЕНО`).toBe('НЕ ИЗМЕРЕНО');
        for (const k of stubs) expect(head.join('\n'), `шапка «${s.title}» называет заглушку ${k}`).toContain(k);
        for (const k of stubs) expect(head.join('\n'), `шапка «${s.title}» называет пачку ${INPUTS[k].batch}`).toContain(INPUTS[k].batch);
      } else {
        expect(statusOf(s.uses), s.title).not.toBe('НЕ ИЗМЕРЕНО');
      }
    }
  });

  it('у разделов автопилота, ценности, пула и видимости заглушки есть; у пути и у отряда — нет ни одного входа', () => {
    // Граница: что из разделов стоит на заглушках сейчас, до пачек ПН-1…ПН-17. Пачка, заменившая вход дверью, правит эту строку
    // тем же коммитом — и раздел честно переходит в «выведено».
    for (const id of ['contract', 'foes', 'prestige', 'castle', 'parity', 'pool', 'sight']) {
      expect(statusOf((SECTIONS.find((s) => s.id === id) as Section).uses), id).toBe('НЕ ИЗМЕРЕНО');
    }
    expect(statusOf((SECTIONS.find((s) => s.id === 'road') as Section).uses)).toBe('выведено');
    // ПН-1: содержание, терпение, обоз и фураж отряда — двери, и раздел выведен сам.
    expect(statusOf((SECTIONS.find((s) => s.id === 'band') as Section).uses)).toBe('выведено');
  });

  it('напечатанный статус каждого раздела — тот, что выводится из входов, и слова «выведено» у раздела на заглушках нет', async () => {
    const out = await lines(SECTIONS, ['pay', 'band', 'rate', 'upgrade', 'road', 'contract', 'foes', 'prestige', 'castle', 'pool', 'sight']);
    const heads = out.filter((l) => l.startsWith('━━ ') && !l.startsWith('━━ Итог'));
    const statuses = out.filter((l) => l.startsWith('статус: '));
    expect(statuses.length).toBe(heads.length);
    const ran = SECTIONS.filter((s) => s.id !== 'parity');
    ran.forEach((s, i) => {
      expect(heads[i], s.id).toContain(s.title);
      expect(statuses[i], `«${s.title}»: статус из входов`).toBe(`статус: ${statusOf(s.uses)}`);
    });
    expect(out[out.length - 2]).toMatch(/^━━ Итог: выведено \d+, по формуле ГДД \d+, не измерено \d+ из 11 ━━$/);
  });

  it('вход, не объявленный разделом, — исключение', async () => {
    const sly: Section = { id: 'sly', title: 'Хитрый', gdd: '0', doors: ['x'], uses: [], run: (ctx) => void ctx.use('stages') };
    await expect(render([sly], TINY, () => {})).rejects.toThrow(Undeclared);
  });

  it('выведенное на заглушках не берётся разделом, не объявившим их', async () => {
    const giver: Section = { id: 'a', title: 'Даёт', gdd: '0', doors: [], uses: ['stages'], run: (ctx) => ctx.share('row', ctx.use('stages')) };
    const taker: Section = { id: 'b', title: 'Берёт', gdd: '0', doors: ['x'], uses: [], run: (ctx) => void ctx.take('row') };
    await expect(render([giver, taker], TINY, () => {})).rejects.toThrow(/не объявив его входы: stages/);
    const honest: Section = { ...taker, uses: ['stages'] };
    await expect(render([giver, honest], TINY, () => {})).resolves.toBeDefined();
  });

  it('разделы автопилота объявляют все входы автопилота', () => {
    for (const id of ['foes', 'prestige', 'castle', 'parity', 'pool']) {
      const s = SECTIONS.find((x) => x.id === id) as Section;
      for (const k of PILOT) expect(s.uses, `«${s.title}» объявляет ${k}`).toContain(k);
    }
  });
});

describe('входы — только через исполнителя, и в код игры они не идут', () => {
  it('значения модуля входов читают только исполнитель и тесты; разделы и модель — одни типы', () => {
    const files = [...readdirSync(HERE).map((f) => path.join(HERE, f)), path.join(ROOT, 'scripts/roam-report.ts')].filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !['inputs.ts', 'run.ts'].includes(path.basename(f)),
    );
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/^import\s+([^;]*?)\s+from\s+'([^']+)'/gms)) {
        if (!/(^|\/)inputs$/.test(m[2])) continue;
        expect(m[1].startsWith('type '), `${path.relative(ROOT, f)} берёт из входов значение: import ${m[1]}`).toBe(true);
      }
    }
  });

  it('код игры не читает прибор', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    for (const base of ['src', 'netlify']) {
      for (const f of walk(path.join(ROOT, base)).filter((x) => /\.(ts|tsx|mts)$/.test(x))) {
        expect(readFileSync(f, 'utf8'), path.relative(ROOT, f)).not.toMatch(/scripts\/roam|roam-report/);
      }
    }
  });
});

describe('двери ПН-1 вместо входов', () => {
  it('у прибора нет входа пачки ПН-1: терпение, фураж сезона и содержание отряда — двери', () => {
    // Граница: пачка ПН-1 закрыта — её входы (терпение, фураж сезона) ушли, а вид лагеря остался ориентиром ПН-3.
    expect(Object.entries(INPUTS).filter(([, i]) => i.batch === 'ПН-1').map(([k]) => k)).toEqual([]);
    expect(INPUTS.forage.batch).toBe('ПН-3');
    const src = readFileSync(path.join(HERE, 'path.ts'), 'utf8');
    for (const door of ['bandUpkeep(', 'forageShare(', 'bandRationPerDay(', 'cargoCap(']) expect(src, `автопилот зовёт ${door}`).toContain(door);
    expect(src, 'своего ухода у модели нет').not.toMatch(/DESERT_SHARE/);
  });
});

describe('реестр ориентиров', () => {
  it('покрывает каждый раздел ГДД 0–9 с пометкой [ориентир] — и ничего лишнего', () => {
    const marked = orientSections(readFileSync(GDD, 'utf8'));
    const listed = new Set(ORIENTS.map((o) => o.gdd));
    expect([...marked].filter((g) => !listed.has(g)), 'разделы ГДД с ориентиром без строки реестра').toEqual([]);
    expect([...listed].filter((g) => !marked.has(g)), 'строки реестра без ориентира в ГДД').toEqual([]);
  });

  it('у каждой строки — раздел прибора или причина, почему не здесь', () => {
    for (const o of ORIENTS) expect((o.in?.length ?? 0) > 0 || (o.not ?? '') !== '', o.gdd).toBe(true);
  });

  it('заглушка, названная ориентиром, стоит в разделе ГДД с пометкой', () => {
    const listed = new Set(ORIENTS.map((o) => o.gdd));
    for (const [k, i] of Object.entries(INPUTS)) {
      if (i.kind === 'stub' && (i as { orient?: boolean }).orient !== false) expect(listed.has(i.gdd), `${k}: ориентир ГДД ${i.gdd}`).toBe(true);
    }
  });

  it('раздел ГДД берётся по последнему заголовку с номером; передачи 10+ не в счёт', () => {
    const doc = ['# Шапка [ориентир]', '## 3. Раздел', '#### 3.5.4. Скрытность', 'лес 0.5 **[ориентир]**', '## 10. Передача', '[ориентир]'].join('\n');
    expect([...orientSections(doc)]).toEqual(['3.5.4']);
  });
});

describe('детерминизм по сиду', () => {
  const k = knobsOf({ use });
  const table = [12, 19, 35, 68, 241];
  const even = [0.92, 0.99, 1.1, 1.01, 1.07];
  const origins = use('origins');

  it('та же партия — тот же путь бит в бит', () => {
    for (const st of STYLES) {
      const a = runPath(3, st, origins[0], table, even, k);
      const b = runPath(3, st, origins[0], table, even, k);
      expect(b, st.id).toEqual(a);
    }
  });

  it('разные сиды — разные пути', () => {
    const runs = [1, 2, 3, 4, 5, 6].map((seed) => runPath(seed, STYLES[0], origins[3], table, even, k));
    const keys = new Set(runs.map((r) => `${r.deeds}/${Math.round(r.prestige)}/${r.recruited}/${r.castleAt}`));
    expect(keys.size, 'шесть сидов дали один и тот же путь').toBeGreaterThan(1);
  });

  it('доля обнаружений — функция сида', () => {
    const land = landAround(3);
    const s = { ...use('sight'), camps: use('camps'), passing: use('passing') };
    expect(detectShare(s, land, { camp: 'open' }, 30, 8, 500, 7)).toBe(detectShare(s, land, { camp: 'open' }, 30, 8, 500, 7));
  });

  it('малый прогон разделов повторяется строка в строку', async () => {
    const only = ['pay', 'band', 'rate', 'upgrade', 'road', 'contract', 'foes', 'prestige', 'castle', 'pool', 'sight'];
    expect(await lines(SECTIONS, only)).toEqual(await lines(SECTIONS, only));
  });
});

describe('правила ГДД на числах кода', () => {
  it('эталон тира III — 70 человек составом автопилота', () => {
    expect(use('etalons').tiers[2]).toEqual(stackOf(70, MIX) as TroopStack);
  });
});
