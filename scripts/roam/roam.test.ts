// Прибор `roam:report` (ПН-0ч, docs/gdd/path_of_sword.md, раздел 11): разделы те, что называет ГДД; статус раздела выводится
// из его входов, и раздел на заглушках не может назвать себя выведенным; вход читается только объявленным; реестр ориентиров
// покрывает ГДД; путь и отчёт повторяются по сиду.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TroopStack } from '../../src/game/battle/kinds';
import { MIX, stackOf } from '../autopilot';
import { ROAM_STUBS, roamStubIds } from '../../src/game/roamstubs';
import { campForage } from '../../src/game/roamrules';
import { INPUTS, type InputId, type InputValue } from './inputs';
import { ORIENTS, orientSections } from './orients';
import { RUN_STYLES, STYLES, runPath, type PathFlow } from './path';
import { rowDrops } from './foes';
import { mapBand, mapDrops, mapGarrison, type MapPoint } from './castle';
import { FREE_TIERS } from '../../src/world/freecastle';
import { troopTotal } from '../../src/game/battle/kinds';
import { Undeclared, onlyOf, render, statusLines, statusOf, type Section, type Size } from './run';
import { PILOT, SECTIONS, knobsOf } from './sections';
import { GOAL_ROWS, SIGHT_GOALS, deriveSight, goalCheck, writtenSight } from './sight';
import { SICILY } from '../../src/world/spawn';
import { WILD_MEAN } from '../../src/world/data/campsite';
import { DEAL_K, DEAL_KINDS, DEAL_R, ETALONS } from '../../src/game/data/contracts';
import { KEEP_MARGIN, busyDays, dealSample, deriveDealKR } from './deals';
import { placeForage, wildMeanOf } from '../../src/world/campsite';
import { campSample, deriveWildMean } from './camp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const GDD = path.join(ROOT, 'docs/gdd/path_of_sword.md');

/** Размер для тестов: та же машина, что у малого и полного, только мельче. */
const TINY: Size = { name: 'малый', seeds: 1, steps: 2, even: 4, pool: 1, nft: 1, sight: 1, map: { seeds: 1, fine: 0.25, man: false, tail: 1 }, odds: { truth: 1, tiers: [1] } };

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
    // ПН-1 добавил раздел дверей отряда (`band`) — содержание, терпение, обоз и фураж бродяги; ПН-3 — лагерь и руины (`camp`).
    // ПН-5 — точки мира и встречи с НПС (`meet`): густота точек, сила НПС по ступеням, шанс засады — двери мира бродяги.
    // ПН-7 — вывод K и R видов договоров (`deals`) рядом с платой договоров.
    // ПН-Э1 (ГДД 2.0, 4.8): окупаемость путей, торговля между городами, воровство, разбой, форт, наёмники, гонка; вывод гарнизона
    // под коридор 4–6 сут (`castleFix`) снят вместе с целью. ПН-Э2а — карта осады вольного замка по числу нападающих (`castlemap`).
    expect(SECTIONS.map((s) => s.id)).toEqual(['pay', 'band', 'camp', 'place', 'placeSpirit', 'rate', 'upgrade', 'road', 'contract', 'deals', 'foes', 'prestige', 'paths', 'trade', 'theft', 'raid', 'fort', 'castle', 'castlemap', 'merc', 'race', 'parity', 'pool', 'meet', 'sight', 'people']);
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

  it('у разделов автопилота, ценности и пула заглушки есть; у пути, у отряда и у видимости — нет ни одного входа', () => {
    // Граница: что из разделов стоит на заглушках сейчас, до пачек ПН-1…ПН-17. Пачка, заменившая вход дверью, правит эту строку
    // тем же коммитом — и раздел честно переходит в «выведено».
    for (const id of ['camp', 'placeSpirit', 'contract', 'deals', 'foes', 'prestige', 'paths', 'trade', 'theft', 'raid', 'fort', 'castle', 'castlemap', 'merc', 'race', 'parity', 'pool', 'meet']) {
      expect(statusOf((SECTIONS.find((s) => s.id === id) as Section).uses), id).toBe('НЕ ИЗМЕРЕНО');
    }
    expect(statusOf((SECTIONS.find((s) => s.id === 'road') as Section).uses)).toBe('выведено');
    // ПН-1: содержание, терпение, обоз и фураж отряда — двери, и раздел выведен сам.
    expect(statusOf((SECTIONS.find((s) => s.id === 'band') as Section).uses)).toBe('выведено');
    // ПН-4у: видимость — дверь `world/sight` и цели ГДД 3.5.4, заглушек нет; входов пачки ПН-4у у прибора не осталось.
    expect(statusOf((SECTIONS.find((s) => s.id === 'sight') as Section).uses)).toBe('выведено');
    // ПН-12л: польза места — двери `world/campsite` и делитель фуража из выборки, заглушек нет; дух и отдых — на числах лагеря ПН-3.
    expect(statusOf((SECTIONS.find((s) => s.id === 'place') as Section).uses)).toBe('выведено');
    expect(Object.entries(INPUTS).filter(([, i]) => i.batch === 'ПН-4у').map(([k]) => k)).toEqual([]);
  });

  it('напечатанный статус каждого раздела — тот, что выводится из входов, и слова «выведено» у раздела на заглушках нет', async () => {
    const out = await lines(SECTIONS, ['pay', 'band', 'camp', 'place', 'placeSpirit', 'rate', 'upgrade', 'road', 'contract', 'deals', 'foes', 'prestige', 'paths', 'trade', 'theft', 'raid', 'fort', 'castle', 'castlemap', 'merc', 'race', 'pool', 'meet', 'sight', 'people']);
    const heads = out.filter((l) => l.startsWith('━━ ') && !l.startsWith('━━ Итог'));
    const statuses = out.filter((l) => l.startsWith('статус: '));
    expect(statuses.length).toBe(heads.length);
    // «Паритет» (НФТ-старт живёт автопилотом посёлка) в выборку теста не входит — дорого.
    const ran = SECTIONS.filter((s) => s.id !== 'parity');
    ran.forEach((s, i) => {
      expect(heads[i], s.id).toContain(s.title);
      expect(statuses[i], `«${s.title}»: статус из входов`).toBe(`статус: ${statusOf(s.uses)}`);
    });
    expect(out[out.length - 2]).toMatch(/^━━ Итог: выведено \d+, по формуле ГДД \d+, не измерено \d+ из 25 ━━$/);
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
    for (const id of ['foes', 'prestige', 'paths', 'trade', 'castle', 'parity', 'pool']) {
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
    const src = readFileSync(path.join(HERE, 'path.ts'), 'utf8');
    for (const door of ['bandUpkeep(', 'forageShare(', 'bandRationPerDay(', 'cargoCap(']) expect(src, `автопилот зовёт ${door}`).toContain(door);
    expect(src, 'своего ухода у модели нет').not.toMatch(/DESERT_SHARE/);
  });
});

describe('двери ПН-6 вместо входов', () => {
  it('у прибора нет входа пачки ПН-6: повышение, найм, хлеб села и просящиеся — двери игры', () => {
    // Граница: пачка ПН-6 закрыта — повышение (`promoterules`), найм (`townrules.hireBase`), хлеб села (`townrules.villageFoodPrice`) и
    // просящиеся (`askrules` на сетке почты) ушли в двери; чего вывести нечем, лежит заглушкой игры тем же числом.
    expect(Object.entries(INPUTS).filter(([, i]) => i.batch === 'ПН-6').map(([k]) => k)).toEqual([]);
    expect(Object.keys(INPUTS)).not.toContain('village');
    const src = readFileSync(path.join(HERE, 'path.ts'), 'utf8');
    for (const door of ['askCount(', 'askFeedable(', 'awayArrival(']) expect(src, `автопилот зовёт ${door}`).toContain(door);
  });
});

describe('двери ПН-3 вместо входов', () => {
  it('у прибора нет входа пачки ПН-3: ход, лагерь и место выхода — двери, а их числа без вывода — заглушки игры', () => {
    // Граница: пачка ПН-3 закрыта — дорога до замка, фураж вида лагеря и место выхода ушли в двери (`world/roam`, `roamrules`);
    // чего вывести нечем, лежит заглушкой игры (`game/roamstubs`) и входит в прибор тем же числом, а не вторым.
    expect(Object.entries(INPUTS).filter(([, i]) => i.batch === 'ПН-3').map(([k]) => k)).toEqual([]);
    // С ПН-7 дорога до дела — от города заказчика к цели доски договоров (`world/dealboard.boardsAt`: цели — точки мира на суше), а не
    // брошенное расстояние с проверкой клетки (`roamCellBlock`).
    const src = readFileSync(path.join(HERE, 'path.ts'), 'utf8') + readFileSync(path.join(HERE, 'pool.ts'), 'utf8');
    for (const door of ['placeBand(', 'roamWalkMs(', 'boardsAt(']) expect(src, `автопилот зовёт ${door}`).toContain(door);
  });

  it('каждая заглушка игры — вход-заглушка прибора с тем же числом, разделом ГДД и пачкой', () => {
    const inputs: Record<string, { kind: string; value: unknown; gdd: string; batch: string; orient?: boolean }> = INPUTS;
    expect(roamStubIds().length).toBeGreaterThan(0);
    for (const id of roamStubIds()) {
      const i = inputs[id];
      expect(i, `заглушка игры ${id} — вход прибора`).toBeDefined();
      expect(i.kind, id).toBe('stub');
      expect([i.value, i.gdd, i.batch, i.orient], id).toEqual([ROAM_STUBS[id].value, ROAM_STUBS[id].gdd, ROAM_STUBS[id].batch, ROAM_STUBS[id].orient]);
    }
  });

  it('раздел, прочитавший заглушку игры дверью без объявления, — исключение; объявивший — проходит', async () => {
    const sly: Section = { id: 'sly', title: 'Хитрый', gdd: '0', doors: ['roamrules.campForage'], uses: [], run: () => void campForage('hidden') };
    await expect(render([sly], TINY, () => {})).rejects.toThrow(/заглушку игры forageHidden/);
    await expect(render([{ ...sly, uses: ['forageHidden'] }], TINY, () => {})).resolves.toBeDefined();
    // Сторож снят после раздела: чтение вне прибора никого не роняет.
    expect(campForage('hidden')).toBe(ROAM_STUBS.forageHidden.value);
  });
});

describe('дверь ПН-2 вместо входа', () => {
  it('у прибора нет входа пачки ПН-2: престиж и его ступень — дверь, пороги — ориентир до вывода', () => {
    // Граница: пачка ПН-2 закрыта — ступень считает дверь, а пороги остались заглушкой первого читателя в игре (ПН-5).
    expect(Object.entries(INPUTS).filter(([, i]) => i.batch === 'ПН-2').map(([k]) => k)).toEqual([]);
    expect(INPUTS.stages.kind).toBe('stub');
    const src = readFileSync(path.join(HERE, 'path.ts'), 'utf8');
    for (const door of ['prestigeAfter(', 'prestigeStage(']) expect(src, `автопилот зовёт ${door}`).toContain(door);
    expect(src, 'своей арифметики престижа у модели нет').not.toMatch(/prestige\s*\+\s*p\b/);
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

  it('малый прогон разделов повторяется строка в строку', async () => {
    const only = ['pay', 'band', 'camp', 'rate', 'upgrade', 'road', 'contract', 'foes', 'prestige', 'castle', 'pool', 'sight'];
    expect(await lines(SECTIONS, only)).toEqual(await lines(SECTIONS, only));
  });
});

describe('договоры (ПН-7): K и R видов — записано = выведено', () => {
  const sessions = { per: [3, 5] as const, wake: [8, 23] as const };
  const sample = dealSample();
  const got = deriveDealKR(sample, sessions);

  it('у прибора нет входов платы договоров: K, R, срок, тир по ступени, доска — двери и заглушки игры', () => {
    // Граница: пачка ПН-7 закрыта — плата считается `contractrules.contractTerms`, K и R — данные игры, выведенные этим прибором.
    for (const k of ['contractK', 'contractR', 'contractTerm', 'stageTier', 'board', 'contracts', 'contractRule', 'etalons', 'foodGold', 'reach']) {
      expect(Object.keys(INPUTS), k).not.toContain(k);
    }
    expect(PILOT).toEqual(expect.arrayContaining(['boardSize', 'dealReach', 'dealRoads', 'dealDays', 'dealStand', 'dealCargo']));
  });

  it('выборка — внутри области правила: у каждого вида есть предложения, у каждого боевого — бои', () => {
    for (const k of DEAL_KINDS) expect(sample.offers.filter((o) => o.kind === k).length, k).toBeGreaterThan(10);
    for (const r of got.rows) if (r.kind === 'lair' || r.kind === 'vataga' || r.kind === 'head' || r.kind === 'defend') expect(r.fights, r.kind).toBeGreaterThan(0);
  });

  it('K и R игры (`data/contracts`) — ровно вывод по целям Д1 и Д2', () => {
    expect(got.K).toEqual(DEAL_K);
    expect(got.R).toEqual(DEAL_R);
  });

  it('Д1 держится на записанном: содержание за срок × K покрывает цикл с запасом', () => {
    for (const r of got.rows) expect(r.K * r.term, r.kind).toBeGreaterThanOrEqual((1 + KEEP_MARGIN) * r.cycle - 0.01 * r.term);
  });

  it('вывод не глух к целям: занятость отряда двигает K, а цикл не короче занятости', () => {
    for (const r of got.rows) expect(r.cycle, r.kind).toBeGreaterThanOrEqual(r.busy - 1e-9);
    const one = sample.offers.find((o) => o.kind === 'lair') as (typeof sample.offers)[number];
    expect(busyDays({ ...one, roadMs: one.roadMs * 2 })).toBeGreaterThan(busyDays(one));
  });
});

describe('видимость (ПН-4у): записано = выведено', () => {
  const world = { lords: SICILY.length };

  it('таблица игры — неподвижная точка вывода из целей: проход от записанного ничего не меняет', () => {
    const d = deriveSight(SIGHT_GOALS, writtenSight(), 1, world);
    expect(d.why).toEqual([]);
    expect(d.converged).toBe(true);
    expect(d.passes, 'записанное сходится первым же проходом').toBe(1);
    expect(d.numbers).toEqual(writtenSight());
  });

  it('каждая цель держится на записанных числах дверью игры', () => {
    for (const g of goalCheck(SIGHT_GOALS, writtenSight(), 1, world)) {
      if (g.id === 'ruinsNear') expect(g.got, g.what).toBeGreaterThanOrEqual(g.goal);
      else if (g.id === 'ruinsFull') expect(g.got, g.what).toBeLessThanOrEqual(g.goal);
      else expect(Math.abs(g.got - g.goal), `${g.what}: цель ${g.goal}, вышло ${g.got}`).toBeLessThanOrEqual(0.5);
    }
  });

  it('сдвинутая цель — записанное больше не неподвижная точка (мерка не глуха к целям)', () => {
    for (const id of ['hiddenForest', 'nightField', 'winterForest', 'hundredOpen', 'ruinsFull'] as const) {
      const d = deriveSight({ ...SIGHT_GOALS, [id]: SIGHT_GOALS[id] + 3 }, writtenSight(), 1, world);
      expect(d.numbers, id).not.toEqual(writtenSight());
    }
  });

  it('цели ГДД 3.5.4 («Цели обнаружения», Ц1–Ц16) — те же числа, что у прибора', () => {
    const doc = readFileSync(GDD, 'utf8');
    GOAL_ROWS.forEach((row, i) => {
      const line = doc.split('\n').find((l) => l.startsWith(`| Ц${i + 1} |`));
      expect(line, `строка Ц${i + 1} (${row.what}) в ГДД`).toBeDefined();
      const cell = (line as string).split('|')[3];
      const n = Number((/(\d+(?:[.,]\d+)?)/.exec(cell) ?? ['', 'NaN'])[1].replace(',', '.'));
      const want = row.id === 'ruinsNear' ? SIGHT_GOALS.ruinsNear * 100 : SIGHT_GOALS[row.id];
      expect(n, `Ц${i + 1}: ${row.what}`).toBe(want);
    });
  });
});

describe('место лагеря (ПН-12л): записано = выведено', () => {
  const sample = campSample();

  it('делитель фуража места — средний вольный корм выборки: записано = выведено', () => {
    expect(sample.length, 'выборка — клетки острова, где отряд может встать').toBeGreaterThan(300);
    expect(WILD_MEAN).toBe(deriveWildMean(sample));
  });

  it('Л1–Л3: в среднем — как прежде; лес и берег больше, голое поле меньше; пустыня не кормит', () => {
    const mean = sample.reduce((n, x) => n + placeForage(x), 0) / sample.length;
    expect(Math.abs(mean - 1), `средний множитель места ${mean}`).toBeLessThanOrEqual(0.01);
    expect(placeForage({ terrain: 'forest', shore: false })).toBeGreaterThan(1);
    expect(placeForage({ terrain: 'plain', shore: true })).toBeGreaterThan(1);
    expect(placeForage({ terrain: 'plain', shore: false })).toBeLessThan(1);
    expect(placeForage({ terrain: 'desert', shore: false })).toBe(0);
  });

  it('вывод не глух к выборке: другая земля — другой делитель', () => {
    const one = campSample([SICILY[0]], 3);
    expect(one.length).toBeGreaterThan(0);
    expect(Math.round(wildMeanOf(one) * 10) / 10).not.toBe(WILD_MEAN);
  });
});

describe('правила ГДД на числах кода', () => {
  it('эталон тира III — 70 человек составом автопилота (правило 4.3 — данные игры `data/contracts.ETALONS`)', () => {
    expect(ETALONS[2]).toEqual(stackOf(70, MIX) as TroopStack);
  });
});

describe('политика автопилота пути (ПН-Э1): не таять неуплатой, не расти сверх дохода', () => {
  const k = knobsOf({ use });
  const table = [...ROAM_STUBS.foeTable.value];
  const even = table.map(() => 1);
  const origins = use('origins');
  const peace = STYLES.find((s) => s.id === 'peace')!;
  const runs = origins.map((o) => runPath(1, peace, o, table, even, k));
  const sum = (f: (r: (typeof runs)[number]) => number): number => runs.reduce((n, r) => n + f(r), 0);

  it('на замок — по окну замка одной дверью (`freecastle.freeNeeds`), без сухой разведки', () => {
    const src = readFileSync(path.join(HERE, 'path.ts'), 'utf8');
    expect(src).toMatch(/freeNeeds\(\{/);
    expect(src, 'сухой разведки у автопилота нет — у игрока её нет').not.toMatch(/dry\(/);
  });

  it('четыре стиля пути ГДД 3.7.0; вор и разбойник не гоняются, пока дел нет в коде', () => {
    expect(STYLES.map((s) => s.id)).toEqual(['peace', 'thief', 'robber', 'castle']);
    expect(STYLES.filter((s) => s.missing).map((s) => s.id)).toEqual(['thief', 'robber']);
  });

  it('уход неуплатой — не больше 5 % пришедших; рост мирного пути не сверх дохода — роспуск не больше трети пришедших', () => {
    // Граница: окно 42 сут, отряд растёт — пришедших сотни, иначе доли меряли бы пустоту.
    expect(k.limitDays).toBe(42);
    expect(sum((r) => r.recruited)).toBeGreaterThan(100);
    // Рост — пока содержание × запас стиля ≤ дохода: за всё окно доход дел покрывает содержание с запасом.
    const income = sum((r) => r.byScale.reduce((n, b) => n + b.income, 0));
    const upkeep = sum((r) => r.byScale.reduce((n, b) => n + b.upkeep, 0));
    expect(income / upkeep, 'доход к содержанию за окно').toBeGreaterThanOrEqual(1.1);
    expect(sum((r) => r.deserted), 'ушло неуплатой').toBeLessThanOrEqual(0.05 * sum((r) => r.recruited));
    expect(sum((r) => r.dismissed), 'распущено политикой').toBeLessThanOrEqual(sum((r) => r.recruited) / 3);
    // Счёт по масштабам — те же часы, что прожила партия.
    for (const r of runs) expect(r.byScale.reduce((n, b) => n + b.hours, 0)).toBeGreaterThan(41 * 24);
  });
});

describe('сила НПС — вывод неподвижной точкой (ПН-Э2а, ГДД 23.8)', () => {
  const k = knobsOf({ use });
  const origins = use('origins');

  it('договоры автопилота бьются со строкой шага, а не с таблицей игры: доска зовётся с `table`', () => {
    // Сила целей доски — главный канал, которым строка силы входит в свою выборку (правило 16); засада — второй. С таблицей игры у
    // договоров ступени «садились», не двигаясь (ПН-Э1: выведено 59 и 46 — при 79 и 79 у ударов). Вывод K и R (`deals.ts`) берёт
    // таблицу игры нарочно: K и R выводятся на той, что в игре.
    const src = readFileSync(path.join(HERE, 'path.ts'), 'utf8');
    const calls = [...src.matchAll(/boardsAt\(([^)]*)\)/g)].map((m) => m[1].split(',').map((x) => x.trim()));
    expect(calls.length, 'граница: автопилот зовёт доску').toBeGreaterThan(0);
    for (const a of calls) expect(a[5], `boardsAt(${a.join(', ')})`).toBe('table');
  });

  it('книга людей сходится с отрядом: от входа в ступень до входа в следующую — пришедшие и нанятые минус ушедшие', () => {
    // Строка «эталоны и люди между входами» раздела «Сила НПС» называет, что обрезало эталон ступени; правда она, только если книга
    // (`PathRun.flowAt`) ловит каждого пришедшего и ушедшего.
    const table = [...ROAM_STUBS.foeTable.value];
    const even = table.map(() => 1);
    let pairs = 0;
    let moved = 0;
    let peaks = 0;
    for (const st of RUN_STYLES) {
      for (const o of origins) {
        for (const seed of [1, 2]) {
          // Пик стиля «к замку» — найм до «сколько нужно» окна замка (ПН-Э2б): при ценах прибора кошель его не тянет ни в одной из
          // этих партий (людей окно велит втрое больше гарнизона, а их содержание на дорогу к замку — дороже найма). Граница «пики есть»
          // держится одной партией «к замку» с наймом в пятьдесят раз дешевле и замком у доски — книга должна поймать и такого пришедшего.
          const castle = st.id === 'castle';
          if (castle && (o !== origins[0] || seed !== 1)) continue;
          const roads = Object.fromEntries(Object.entries(k.castleRoads).map(([g, r]) => [g, r.map(() => 0)])) as unknown as typeof k.castleRoads;
          const r = runPath(seed, st, o, table, even, castle ? { ...k, hire: (id) => k.hire(id) / 50, castleRoads: roads } : k);
          peaks += r.peaks;
          // Минуты книги: входы в ступени и конец окна (последний отряд и счётчики партии).
          const marks = k.stages
            .map((_, s) => (r.flowAt[s] && r.bandAt[s] ? { at: `ступень ${s}`, flow: r.flowAt[s] as PathFlow, band: r.bandAt[s] as TroopStack } : null))
            .filter((m) => m !== null);
          marks.push({
            at: 'конец окна',
            flow: { asked: r.recruited, hired: r.hired, dismissed: r.dismissed, deserted: r.deserted, fallen: r.fallen[0] + r.fallen[1] + r.fallen[2], ambushLost: r.ambushLost, castleLost: r.castleLost },
            band: r.band,
          });
          for (let i = 1; i < marks.length; i++) {
            const a = marks[i - 1].flow;
            const b = marks[i].flow;
            pairs++;
            const came = b.asked - a.asked + b.hired - a.hired;
            const left = b.dismissed - a.dismissed + b.deserted - a.deserted + b.fallen - a.fallen + b.ambushLost - a.ambushLost + b.castleLost - a.castleLost;
            if (came + left > 0) moved++;
            expect(troopTotal(marks[i].band) - troopTotal(marks[i - 1].band), `${st.id}/${o.id}/${seed}: ${marks[i - 1].at} → ${marks[i].at}`).toBeCloseTo(came - left, 6);
          }
        }
      }
    }
    // Граница: пары минут есть, между ними люди правда приходят и уходят, и пики на осаду в выборке есть — иначе равенство держалось
    // бы нулями, а найм пика мимо книги не ловился бы.
    expect(pairs).toBeGreaterThan(20);
    expect(moved).toBeGreaterThan(pairs / 2);
    expect(peaks, 'граница: у стиля «к замку» в выборке есть пик на осаду').toBeGreaterThan(0);
  });

  it('строка, где выше ступень — слабее противник, называется: `rowDrops`', () => {
    expect(rowDrops([12, 59, 47, 143, 433])).toEqual([2]);
    expect(rowDrops([12, 79, 79, 243, 682]), 'равные соседние — не падение').toEqual([]);
    expect(rowDrops([30, 20, 10])).toEqual([1, 2]);
  });
});

describe('карта осады вольного замка по числу нападающих (ПН-Э2а)', () => {
  it('отряд карты: копейщики — как есть; состав гарнизона — доли гарнизона ступени наибольшими остатками, людей ровно столько', () => {
    for (const t of FREE_TIERS) {
      const g = mapGarrison(t);
      const all = troopTotal(g);
      for (const men of [1, 7, 100, all, 999]) {
        const b = mapBand('mirror', t, men);
        expect(troopTotal(b), `ступень ${t}, ${men} чел.`).toBe(men);
        for (const [id, n] of Object.entries(g) as [keyof TroopStack, number][]) expect(Math.abs((b[id] ?? 0) - (n * men) / all), `${t}/${men}/${id}`).toBeLessThan(1);
      }
      expect(mapBand('mirror', t, all)).toEqual(g);
      expect(mapBand('spear', t, 42)).toEqual({ spearman: 42 });
    }
  });

  it('падение — «взят → не взят» с ростом людей на одном сиде; монотонная карта — без падений', () => {
    const p = (men: number, ...won: boolean[]): MapPoint => ({ men, power: men, won });
    expect(mapDrops([p(1, false, false), p(2, true, false), p(3, true, true)])).toEqual([]);
    expect(mapDrops([p(1, false, true), p(2, true, false), p(3, true, true)])).toEqual([{ seed: 2, won: 1, lost: 2 }]);
    expect(mapDrops([p(1, true), p(2, false), p(3, true), p(4, false)])).toEqual([
      { seed: 1, won: 1, lost: 2 },
      { seed: 1, won: 3, lost: 4 },
    ]);
    expect(mapDrops([])).toEqual([]);
  });

  it('ROAM_ONLY: только названные разделы, неизвестный номер — ошибка, а не тихий пропуск', () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(onlyOf(undefined, ids)).toBeUndefined();
    expect(onlyOf('  ', ids)).toBeUndefined();
    expect([...(onlyOf('foes, castlemap', ids) as Set<string>)]).toEqual(['foes', 'castlemap']);
    expect(() => onlyOf('foes,castlefix', ids)).toThrow(/castlefix/);
  });
});
