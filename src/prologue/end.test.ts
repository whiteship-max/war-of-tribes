import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BEAT,
  BOARDS,
  FOE_HIT,
  FOE_HIT_GAP,
  FOE_REACH,
  FOE_TURN_MS,
  FOE_WALK,
  OVER_NOTE,
  OVER_SAYS,
  PASSED,
  RAIDERS,
  RAIDERS_MELEE,
  RAID_AWAY,
  RAID_FROM,
  RAID_MID,
  RAID_SAYS,
  RAID_STAND,
  SON_SAYS,
  SON_THANKS,
  WIFE_SAYS,
  WIFE_THANKS,
  beatFrom,
  beatOf,
  endBegins,
  endOn,
  familyDone,
  familyHere,
  finaleMs,
  frameDone,
  newEnd,
  type Beat,
  type EndState,
} from './end';
import { death, endTask, feedSon, offer, reach, share } from './act';
import {
  AXE_STUMP,
  BODY_R,
  FIRE,
  GLADE_R,
  GUEST_FROM,
  HOUSE,
  MATE_R,
  MATE_SPOT,
  REACH,
  SON_HOUSE,
  SON_SPOT,
  START,
  TENT,
  TREES,
  TREE_R,
  VIEW_H_MIN,
  nearest,
} from './glade';
import { WOLF_BITES } from './body';
import { HOUSE_LOGS } from './craft';
import { freshPrologue, loadPrologue, savePrologue, type PrologueSave } from './save';

const NOW = 1_700_000_000_000;

/** Поляна с достроенным домом, женой и сыном — то, с чего начинается финал. */
const kin = (over: Partial<PrologueSave> = {}): PrologueSave => ({
  ...freshPrologue(NOW),
  axe: true,
  kit: true,
  house: HOUSE_LOGS,
  wife: { name: 'Ведана', at: NOW - 1000 },
  heir: { name: 'Ратибор', at: NOW - 100 },
  ...over,
});

/** Ступень со сделанным. Имя короткое нарочно: её здесь строят десятки раз. */
const st = (stage: EndState['stage'], over: Partial<EndState> = {}): EndState => ({ ...newEnd(), stage, ...over });

describe('финал начинается там, где кончился род', () => {
  it('нужны и жена, и имя сына: одного мало', () => {
    const wife = { name: 'Ведана', at: 1 };
    const heir = { name: 'Ратибор', at: 2 };
    expect(endBegins(null, null)).toBe(false);
    expect(endBegins(wife, null)).toBe(false);
    expect(endBegins(null, heir)).toBe(false);
    expect(endBegins(wife, heir)).toBe(true);
  });

  it('обычная поляна замирает на все ступени, кроме «нет» и «кончено»', () => {
    expect(endOn(st('none'))).toBe(false);
    expect(endOn(st('over'))).toBe(false);
    for (const k of ['passed', 'family', 'build', 'raid'] as const) expect(endOn(st(k)), k).toBe(true);
  });

  it('жена и сын стоят у огня с «Семьи» и до конца', () => {
    expect(familyHere(st('passed'))).toBe(false);
    for (const k of ['family', 'build', 'raid'] as const) expect(familyHere(st(k)), k).toBe(true);
  });

  it('«Семья» кончается тремя делами, и ни одно не заменяет остальные', () => {
    expect(familyDone(st('family'))).toBe(false);
    expect(familyDone(st('family', { wood: true, wife: true }))).toBe(false);
    expect(familyDone(st('family', { wood: true, wife: true, son: true }))).toBe(true);
  });

  it('дом сына готов на пятой доске', () => {
    for (let n = 0; n < BOARDS; n++) expect(frameDone(st('build', { boards: n })), String(n)).toBe(false);
    expect(frameDone(st('build', { boards: BOARDS }))).toBe(true);
  });
});

describe('такты последней сцены', () => {
  const ORDER: Beat[] = ['fight', 'aim', 'loose', 'fall', 'take', 'lead', 'blind', 'over'];

  it('идут по порядку и ни один не пропускается', () => {
    const seen: Beat[] = [];
    for (let ms = 0; ms <= finaleMs(BEAT.fightMs) + 500; ms += 50) {
      const b = beatOf(ms, BEAT.fightMs);
      if (seen[seen.length - 1] !== b) seen.push(b);
    }
    expect(seen).toEqual(ORDER);
  });

  it('назад не идут: такт только вперёд', () => {
    let last = -1;
    for (let ms = 0; ms <= finaleMs(BEAT.fightMs) + 500; ms += 37) {
      const i = ORDER.indexOf(beatOf(ms, BEAT.fightMs));
      expect(i).toBeGreaterThanOrEqual(last);
      last = i;
    }
  });

  it('начало такта сходится с самим тактом', () => {
    // Первый такт начинается в нуле, и «за миллисекунду до» у него нет: всё, что
    // раньше ответа игрока, — это и есть драка.
    for (const b of ORDER.slice(1, -1)) {
      const from = beatFrom(b, BEAT.fightMs);
      expect(beatOf(from, BEAT.fightMs), b).toBe(b);
      expect(beatOf(from - 1, BEAT.fightMs), b).not.toBe(b);
    }
    expect(beatFrom('fight', BEAT.fightMs)).toBe(0);
  });

  it('драка, кончившаяся раньше, двигает вперёд и всё остальное', () => {
    const quick = 3000;
    expect(beatOf(quick + 10, quick)).toBe('aim');
    expect(beatOf(quick + 10, BEAT.fightMs)).toBe('fight');
    expect(finaleMs(quick)).toBeLessThan(finaleMs(BEAT.fightMs));
    // Порядок от этого не меняется: короче становится только первый такт.
    const seen: Beat[] = [];
    for (let ms = 0; ms <= finaleMs(quick) + 500; ms += 50) {
      const b = beatOf(ms, quick);
      if (seen[seen.length - 1] !== b) seen.push(b);
    }
    expect(seen).toEqual(ORDER);
  });

  it('вся сцена после ответа укладывается в минуту — столько и держит игрок', () => {
    expect(finaleMs(BEAT.fightMs)).toBeLessThan(60_000);
    expect(finaleMs(BEAT.fightMs)).toBeGreaterThan(25_000);
  });
});

describe('в финале не умирают, и это правило', () => {
  /** Тело, которое в обычной поляне давно бы умерло: и голод, и холод пусты. */
  const doomed = (e: EndState): PrologueSave =>
    kin({ end: e, body: { hunger: 1, cold: 1, harm: WOLF_BITES, coat: false, at: NOW - 40 * 3_600_000, warm: false, roof: false }, hearth: { fuel: 0, at: NOW } });

  it('на любой ступени финала смерти нет, а вне его — есть', () => {
    expect(death(doomed(st('none')), NOW)).not.toBeNull();
    expect(death(doomed(st('over')), NOW)).not.toBeNull();
    for (const k of ['passed', 'family', 'build', 'raid'] as const) {
      expect(death(doomed(st(k)), NOW), k).toBeNull();
    }
  });

  it('удар разбойника втрое с лишним слабее волчьего укуса', () => {
    expect(FOE_HIT).toBeLessThan(1 / 3);
    /*
     * Цена драки считается по **одному** бьющему, а не по троим: сходятся они
     * по очереди (`FOE_TURN_MS`), и в каждую минуту перед человеком стоит один.
     * Потолок — если бы он не отходил ни на секунду; пол — половина череда в
     * касании, вторая уходит на подход.
     */
    const most = Math.floor(BEAT.fightMs / FOE_HIT_GAP);
    expect(most * FOE_HIT).toBeLessThan(WOLF_BITES * 0.6);
    const likely = Math.floor(FOE_TURN_MS / 2 / FOE_HIT_GAP) * RAIDERS_MELEE;
    expect(likely * FOE_HIT).toBeGreaterThan(WOLF_BITES * 0.1);
  });

  it('драка — это три череда, и срок её из них и выведен', () => {
    expect(BEAT.fightMs).toBe(RAIDERS_MELEE * FOE_TURN_MS);
    // Черёда хватает, чтобы дойти от своего места до человека и успеть ударить.
    const walk = (5.2 - FOE_REACH) / (FOE_WALK / 1000);
    expect(FOE_TURN_MS).toBeGreaterThan(walk + FOE_HIT_GAP);
    // И драка не длиннее той, что была до очереди: смотреть её столько же.
    expect(BEAT.fightMs).toBeLessThanOrEqual(14_000);
  });
});

describe('что поляна предлагает в финале', () => {
  it('очаг сперва просит дров, даже когда в руках сырое мясо', () => {
    const s = kin({ end: st('family'), logs: 2, meat: { cooked: 1, raw: 3 }, hearth: { fuel: 1, at: NOW } });
    expect(offer(s, { kind: 'fire', x: FIRE.x, z: FIRE.z, index: -1 }, NOW)).toMatchObject({ deed: 'feed', can: true });
    // Дрова подложены — очаг снова обычный: жарка вперёд.
    const after = { ...s, end: st('family', { wood: true }) };
    expect(offer(after, { kind: 'fire', x: FIRE.x, z: FIRE.z, index: -1 }, NOW).deed).toBe('roast');
  });

  it('доска кладётся, пока дом не готов, и счёт виден на кнопке', () => {
    const s = kin({ end: st('build', { boards: 2 }) });
    const spot = { kind: 'frame' as const, x: SON_HOUSE.x, z: SON_HOUSE.z, index: -1 };
    const what = offer(s, spot, NOW);
    expect(what.deed).toBe('board');
    expect(what.can).toBe(true);
    expect(what.label).toContain(`2/${BOARDS}`);
    // Готовый дом целью тапа не бывает вовсе: делать с ним нечего.
    expect(reach({ ...s, end: st('build', { boards: BOARDS }) }, NOW).frame).toBe(false);
    expect(reach({ ...s, end: st('family') }, NOW).frame).toBe(false);
  });

  it('разбойника бьют топором, а без топора говорят правду', () => {
    const spot = { kind: 'foe' as const, x: 1, z: 1, index: 0 };
    expect(offer(kin({ end: st('raid') }), spot, NOW)).toMatchObject({ deed: 'fight-foe', can: true });
    expect(offer(kin({ end: st('raid'), axe: false }), spot, NOW)).toMatchObject({ can: false, why: 'Нужен топор' });
  });

  it('жену и сына кормят по разу, и погашенная кнопка говорит причину', () => {
    const s = kin({ end: st('family'), meat: { cooked: 2, raw: 0 } });
    expect(share(s, NOW)).toMatchObject({ deed: 'share', can: true });
    expect(feedSon(s)).toMatchObject({ deed: 'feed-son', can: true });
    const fed = { ...s, end: st('family', { wife: true, son: true }) };
    expect(share(fed, NOW)).toMatchObject({ can: false, why: 'Она уже поела' });
    expect(feedSon(fed)).toMatchObject({ can: false, why: 'Он уже поел' });
    const empty = { ...s, meat: { cooked: 0, raw: 0 } };
    expect(share(empty, NOW)).toMatchObject({ can: false, why: 'Мяса нет' });
    expect(feedSon(empty)).toMatchObject({ can: false, why: 'Мяса нет' });
  });

  it('строка задания называет то, что ещё не сделано, и молчит, когда нечего', () => {
    expect(endTask(st('none'))).toBe('');
    expect(endTask(st('family'))).toBe('Подложить дров');
    expect(endTask(st('family', { wood: true }))).toBe('Накормить жену');
    expect(endTask(st('family', { wood: true, wife: true }))).toBe('Накормить сына');
    expect(endTask(st('family', { wood: true, wife: true, son: true }))).toBe('');
    expect(endTask(st('build', { boards: 3 }))).toContain(`3/${BOARDS}`);
  });
});

describe('где что стоит', () => {
  const blocks = [FIRE, TENT, AXE_STUMP, HOUSE, ...TREES.map((t) => ({ ...t, r: TREE_R }))];

  it('дом сына стоит на поляне и ни на ком', () => {
    expect(Math.hypot(SON_HOUSE.x, SON_HOUSE.z) + SON_HOUSE.r).toBeLessThan(GLADE_R);
    for (const b of blocks) {
      const d = Math.hypot(SON_HOUSE.x - b.x, SON_HOUSE.z - b.z);
      expect(d, `${b.x},${b.z}`).toBeGreaterThan(b.r + SON_HOUSE.r + BODY_R * 2);
    }
  });

  it('с места входа до дома сына не дотянуться: первым по-прежнему огонь', () => {
    expect(Math.hypot(START.x - SON_HOUSE.x, START.z - SON_HOUSE.z) - SON_HOUSE.r).toBeGreaterThan(REACH);
    const s = kin({ end: st('build') });
    expect(nearest(START.x, START.z, reach(s, NOW), NOW)?.kind).toBe('fire');
  });

  it('сын стоит рядом с матерью, но тап достаётся тому, к кому подошёл', () => {
    const apart = Math.hypot(SON_SPOT.x - MATE_SPOT.x, SON_SPOT.z - MATE_SPOT.z);
    expect(apart).toBeGreaterThan(MATE_R + 0.5);
    for (const b of blocks) {
      const d = Math.hypot(SON_SPOT.x - b.x, SON_SPOT.z - b.z);
      expect(d, `${b.x},${b.z}`).toBeGreaterThan(b.r + MATE_R + BODY_R * 2);
    }
    const s = kin({ end: st('family') });
    const glade = reach(s, NOW, [], MATE_SPOT, SON_SPOT);
    // Точка вплотную к сыну с внешней стороны: до него ближе, чем до матери.
    const k = (MATE_R + BODY_R) / Math.hypot(SON_SPOT.x - FIRE.x, SON_SPOT.z - FIRE.z);
    const px = SON_SPOT.x + (SON_SPOT.x - FIRE.x) * k;
    const pz = SON_SPOT.z + (SON_SPOT.z - FIRE.z) * k;
    expect(nearest(px, pz, glade, NOW)?.kind).toBe('son');
  });

  it('пришедшие выходят из леса и встают, никого не задевая', () => {
    expect(RAID_FROM).toHaveLength(RAIDERS);
    expect(RAID_STAND).toHaveLength(RAIDERS);
    for (const p of [...RAID_FROM, RAID_AWAY]) {
      expect(Math.hypot(p.x, p.z), `${p.x},${p.z}`).toBeLessThan(GLADE_R);
    }
    for (const p of RAID_STAND) {
      for (const b of blocks) {
        const d = Math.hypot(p.x - b.x, p.z - b.z);
        expect(d, `${p.x},${p.z} → ${b.x},${b.z}`).toBeGreaterThan(b.r + MATE_R);
      }
    }
  });

  /**
   * Где стоит человек, когда кладёт пятую доску.
   *
   * Не круглое число, а то, что получается: он подходит к срубу с юга, от
   * палатки, и останавливается, едва поляна предложит доску — то есть на
   * `REACH` от края сруба. Ближе он тоже может подойти, поэтому проверяется
   * не точка, а весь отрезок подхода.
   */
  const LAY = { x: SON_HOUSE.x - 0.1, z: SON_HOUSE.z - SON_HOUSE.r - REACH };

  it('лучники стоят заведомо дальше, чем достаёт топор, а топорники — в пяти шагах', () => {
    const melee = RAID_STAND.slice(0, RAIDERS_MELEE);
    const bows = RAID_STAND.slice(RAIDERS_MELEE);
    expect(bows).toHaveLength(RAIDERS - RAIDERS_MELEE);
    // Топор достаёт на `REACH` от края чужого круга, то есть на столько от середины.
    const axe = REACH + MATE_R;
    for (const b of bows) {
      const d = Math.hypot(b.x - LAY.x, b.z - LAY.z);
      expect(d, `${b.x},${b.z}`).toBeGreaterThan(axe * 2.5);
    }
    for (const m of melee) {
      const d = Math.hypot(m.x - LAY.x, m.z - LAY.z);
      expect(d, `${m.x},${m.z}`).toBeGreaterThan(axe);
      expect(d, `${m.x},${m.z}`).toBeLessThan(6);
    }
    // И позади: каждый лучник дальше любого топорника.
    const far = Math.max(...melee.map((m) => Math.hypot(m.x - LAY.x, m.z - LAY.z)));
    for (const b of bows) expect(Math.hypot(b.x - LAY.x, b.z - LAY.z)).toBeGreaterThan(far + 2);
  });

  it('лучник не бывает целью топора ни на каком расстоянии — это устройство, а не числа', () => {
    const s = kin({ end: st('raid') });
    // Поляна получает **только** тех, у кого топор: так их и подаёт сцена
    // (`scene.foePts`). Подойди человек к лучнику вплотную — цели всё равно нет.
    const bow = RAID_STAND[RAIDERS - 1];
    const glade = reach(s, NOW, [], null, null, [{ x: bow.x, z: bow.z }]);
    expect(glade.foes).toHaveLength(1);
    const near = nearest(bow.x, bow.z + MATE_R + BODY_R, glade, NOW);
    expect(near?.kind).toBe('foe');
    // А без переданных целей вплотную к месту лучника тапу достаётся не он.
    const empty = reach(s, NOW, [], null, null, []);
    expect(nearest(bow.x, bow.z + MATE_R + BODY_R, empty, NOW)?.kind).not.toBe('foe');
  });

  it('все пятеро укладываются в кадр: середина ватаги держит их в пятидесяти градусах', () => {
    // Поляна смотрит углом не уже `VIEW_H_MIN` по горизонтали, то есть ±25°.
    const mid = Math.atan2(RAID_MID.x - LAY.x, RAID_MID.z - LAY.z);
    for (const p of RAID_STAND) {
      const a = Math.atan2(p.x - LAY.x, p.z - LAY.z);
      const off = Math.abs(((a - mid + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      expect((off * 180) / Math.PI, `${p.x},${p.z}`).toBeLessThan(VIEW_H_MIN / 2);
    }
    // Середина считается из мест, а не пишется рядом с ними.
    expect(RAID_MID.x).toBeCloseTo(RAID_STAND.reduce((a, p) => a + p.x, 0) / RAIDERS, 6);
    expect(RAID_MID.z).toBeCloseTo(RAID_STAND.reduce((a, p) => a + p.z, 0) / RAIDERS, 6);
  });

  it('выходят и уводят они по открытому: не там, где стоит дом, и не там, где пришла гостья', () => {
    // Востоком: старый дом на западе, гостья приходила с юго-востока.
    for (const p of [...RAID_FROM, RAID_AWAY]) {
      expect(p.x, `${p.x},${p.z}`).toBeGreaterThan(0);
      expect(Math.hypot(p.x - GUEST_FROM.x, p.z - GUEST_FROM.z), `${p.x},${p.z}`).toBeGreaterThan(4);
    }
    // И между местом, где человек ставит сруб, и опушкой ухода ничто не стоит:
    // ни дом, ни дерево. Последний кадр режима загородить нечем.
    const from = { x: SON_HOUSE.x, z: SON_HOUSE.z - REACH };
    const dx = RAID_AWAY.x - from.x;
    const dz = RAID_AWAY.z - from.z;
    const len = Math.hypot(dx, dz);
    for (const b of [HOUSE, ...TREES.map((t) => ({ ...t, r: TREE_R }))]) {
      const t = Math.max(0, Math.min(len, ((b.x - from.x) * dx + (b.z - from.z) * dz) / len));
      const cx = from.x + (dx / len) * t;
      const cz = from.z + (dz / len) * t;
      expect(Math.hypot(cx - b.x, cz - b.z), `${b.x},${b.z}`).toBeGreaterThan(b.r + 0.6);
    }
  });
});

describe('оружие висит на руке, а не рядом с телом', () => {
  const strip = (src: string): string =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const scene = strip(readFileSync(join(__dirname, 'scene.ts'), 'utf8'));
  const people = strip(readFileSync(join(__dirname, 'people.ts'), 'utf8'));

  /*
   * ПОЧЕМУ ТЕСТ ПО ИСХОДНИКУ, А НЕ ПО КАДРУ. Как оружие держат, видно только
   * глазами — снимки в docs/prologue.md, раздел 18. Но от чего оно висело рядом
   * с телом, видно в коде: топор был ребёнком туловища и числами задан на нём
   * (`RAIDER_HAND`), а руки при этом качались отдельно. Вернуть это можно одной
   * строкой, и вернувшееся будет выглядеть ровно так же неубедительно.
   */
  it('оружие — ребёнок узла рук, и числами на туловище его больше не ставят', () => {
    expect(scene).toContain('arms.add(weapon)');
    expect(scene, 'вернулся хват числами на туловище').not.toContain('RAIDER_HAND');
    expect(people, 'вернулся хват числами на туловище').not.toContain('RAIDER_HAND');
  });

  it('где кулак, сказано один раз — самой позой рук', () => {
    // Хват отдаёт `limb`, слепивший руку; второго места с местом кулака нет.
    expect(people).toContain('userData.hold');
    expect(people).toMatch(/at:\s*bow\s*\?\s*leftFist\s*:\s*rightFist/);
  });

  it('в цели тапа сцена подаёт только тех, у кого топор', () => {
    // Устройство, а не расстояние: этим лучник и недосягаем при любом шаге
    // игрока. Проверяется по исходнику — кадром это не видно.
    expect(scene).toMatch(/foeList\s*=[\s\S]{0,160}!f\.bow/);
  });

  it('поза рук у лучника и у топорника разная, и обе лежат таблицей', () => {
    expect(people).toContain('RAIDER_ARMS');
    const table = people.slice(people.indexOf('const RAIDER_ARMS'));
    expect(table).toMatch(/axe:\s*\{/);
    expect(table).toMatch(/bow:\s*\{/);
    // Лучнику нужен локоть: прямая рука до тетивы не дотягивается.
    const bowArm = table.slice(table.indexOf('bow:'), table.indexOf('} as const'));
    expect((bowArm.match(/dir:/g) ?? []).length).toBeGreaterThan(2);
  });
});

describe('слова финала', () => {
  const ALL = [PASSED, WIFE_SAYS, WIFE_THANKS, SON_SAYS, SON_THANKS, RAID_SAYS, OVER_SAYS, OVER_NOTE];

  it('ни крови, ни убийства, ни подробностей расправы', () => {
    for (const line of ALL) {
      expect(line.toLowerCase(), line).not.toMatch(/кров|уб(ил|ью|ит|ьют)|труп|мертв|зареж|растерз/);
    }
  });

  it('благодарят коротко и своими словами', () => {
    for (const line of [WIFE_THANKS, SON_THANKS]) {
      expect(line.length, line).toBeLessThan(60);
      expect(line.toLowerCase(), line).toContain('спасибо');
    }
  });

  it('что будет с сыном, не сказано', () => {
    expect(`${OVER_SAYS} ${OVER_NOTE}`.toLowerCase()).not.toMatch(/вернёт|отомст|найдёт|вырастет и/);
  });
});

describe('что финал помнит между заходами', () => {
  const store = new Map<string, string>();
  const host = globalThis as unknown as { localStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> };
  beforeEach(() => {
    store.clear();
    host.localStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, String(v)),
      removeItem: (k) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete host.localStorage;
  });

  it('ступень и сделанное — и ни одного срока', () => {
    const s = kin({ end: st('build', { wood: true, wife: true, son: true, boards: 3 }) });
    savePrologue(s, NOW);
    const raw = JSON.parse(store.get('tribe.prologue.v1') ?? '{}') as { end: Record<string, unknown> };
    expect(Object.keys(raw.end).sort()).toEqual(['boards', 'son', 'stage', 'wife', 'wood']);
    expect(loadPrologue(NOW).end).toEqual(s.end);
  });

  it('запись без финала читается без него, а чужая ступень не принимается', () => {
    store.set('tribe.prologue.v1', JSON.stringify({ v: 1, hearth: { fuel: 3, at: NOW - 5 } }));
    expect(loadPrologue(NOW).end).toEqual(newEnd());
    store.set('tribe.prologue.v1', JSON.stringify({ v: 1, hearth: { fuel: 3, at: NOW - 5 }, end: { stage: 'победа', boards: 99 } }));
    expect(loadPrologue(NOW).end).toEqual({ ...newEnd(), boards: BOARDS });
  });
});
