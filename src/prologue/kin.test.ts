/**
 * Род: гостья, жена, любовь и сын.
 *
 * Здесь собраны обещания, ради которых род заведён, — все про правила, и пальцем
 * их не поймать:
 *
 *   1. гостья приходит к достроенному дому, а отказ — не тупик: отказал — приходит
 *      другая, и так сколько угодно раз;
 *   2. любовь — чистая функция от накопленного, а не от кадров и не от часов: одни
 *      и те же засчитанные дни дают одну и ту же любовь, дело засчитывается раз в
 *      сутки поляны, и одним мясом до ста не дойти;
 *   3. имя сына лежит там, откуда его возьмёт основная игра, а пустое и мусорное
 *      не принимается;
 *   4. родословная показывает ровно то, что есть, на каждой из трёх ступеней;
 *   5. хозяйка бережёт огонь на выведенное число и с минуты, когда осталась, а
 *      полоса называет срок, который сбудется;
 *   6. род переживает выход и смерть, и старая запись читается без новой версии;
 *   7. место женщины у огня — у огня, но на дороге не стоит, вплотную к ней не
 *      подойти, а у самого очага тап по-прежнему достаётся дровам.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NAME_MAX } from '@/profile/identity';
import { offer, reach, share } from './act';
import { fireOutAt } from './body';
import { HOUSE_LOGS } from './craft';
import { HEARTH_CAP, KEEP_BURN, burnLeftMs, feed, fuelAt, keepHearth, newHearth, spend } from './fire';
import {
  AXE_STUMP,
  BODY_R,
  FIRE,
  GUEST_FROM,
  GLADE_R,
  HOUSE,
  MATE_R,
  MATE_SPOT,
  REACH,
  START,
  TENT,
  TREES,
  TREE_R,
  byFire,
  nearest,
  type Spot,
} from './glade';
import {
  BOND_KINDS,
  GUESTS,
  GUEST_FIRST_MS,
  GUEST_GAP_MS,
  HEIR_MAX,
  HEIR_MIN,
  LOVE_DAYS,
  LOVE_FULL,
  LOVE_STEP,
  counts,
  dayOf,
  guestHere,
  guestOf,
  heirName,
  lineage,
  love,
  newBond,
  newTally,
  tally,
  welcome,
  wifeSays,
  type Bond,
  type Hearthside,
} from './kin';
import { PROLOGUE_VERSION, freshPrologue, loadPrologue, revive, savePrologue, type PrologueSave } from './save';
import { BURN_MEAN, RING_MS, SKY_MS, DAY_SHARE } from './sky';
import { WOLF_FIRE_R, wolfKeepsOut } from './wolves';

const H = 3_600_000;

/** Достроенный дом, никого не звали. */
const BUILT: Hearthside = { house: HOUSE_LOGS, builtAt: 10_000, refused: 0, refusedAt: 0, wife: null };

/** Дни общей жизни числами — без привязки к суткам. */
const bondOf = (meal: number, hug: number, night: number, wood: number, day = 0): Bond => ({
  meal: { n: meal, day },
  hug: { n: hug, day },
  night: { n: night, day },
  wood: { n: wood, day },
});

describe('гостья приходит к достроенному дому, и отказ — не тупик', () => {
  it('пока дом не достроен, не приходит никто, сколько ни жди', () => {
    for (const house of [0, 1, 20, HOUSE_LOGS - 1]) {
      for (const now of [0, GUEST_FIRST_MS, 24 * H, 365 * 24 * H]) {
        expect(guestHere({ ...BUILT, house }, now), `${house} брёвен, ${now}`).toBe(false);
      }
    }
  });

  it('первая выходит через GUEST_FIRST_MS после последнего бревна и ждёт ответа', () => {
    expect(guestHere(BUILT, BUILT.builtAt + GUEST_FIRST_MS - 1)).toBe(false);
    expect(guestHere(BUILT, BUILT.builtAt + GUEST_FIRST_MS)).toBe(true);
    // Не уходит, пока не ответили: вернувшийся через месяц застаёт её у огня.
    expect(guestHere(BUILT, BUILT.builtAt + 30 * 24 * H)).toBe(true);
  });

  it('отказал — приходит другая, и так сколько угодно раз', () => {
    let k: Hearthside = { ...BUILT };
    let now = k.builtAt + GUEST_FIRST_MS;
    const seen: string[] = [];
    for (let i = 0; i < GUESTS.length * 3; i++) {
      expect(guestHere(k, now), `${i + 1}-я не пришла`).toBe(true);
      const g = guestOf(k.refused);
      if (seen.length) expect(g.name, 'пришла та же, что ушла').not.toBe(seen[seen.length - 1]);
      seen.push(g.name);
      // Отказ: ушла сразу, следующая — ровно через GUEST_GAP_MS, не раньше.
      k = { ...k, refused: k.refused + 1, refusedAt: now };
      expect(guestHere(k, now)).toBe(false);
      expect(guestHere(k, now + GUEST_GAP_MS - 1)).toBe(false);
      now += GUEST_GAP_MS;
      expect(guestHere(k, now), `после ${i + 1}-го отказа тупик`).toBe(true);
      // Игрок раздумывал: минута ответа не обязана совпадать с минутой прихода.
      now += 7_000 + i * 1_000;
    }
    // Все шесть прошли, дальше круг — плата названа вслух в `kin.GUESTS`.
    expect(new Set(seen).size).toBe(GUESTS.length);
  });

  it('принял — больше не приходит никто', () => {
    const k: Hearthside = { ...BUILT, refused: 3, refusedAt: 5, wife: { name: 'Милава', at: 7 } };
    for (const now of [0, GUEST_GAP_MS * 10, 365 * 24 * H]) expect(guestHere(k, now)).toBe(false);
  });

  it('у каждой своё имя и своя беда, и вышла она на огонь', () => {
    expect(new Set(GUESTS.map((g) => g.name)).size).toBe(GUESTS.length);
    expect(new Set(GUESTS.map((g) => g.story)).size).toBe(GUESTS.length);
    expect(new Set(GUESTS.map((g) => g.kin)).size).toBe(GUESTS.length);
    for (const g of GUESTS) {
      // Причина сказана словами, а не подразумевается, — и кончается вопросом.
      expect(g.story, g.name).toMatch(/(дым|огон|огн)/);
      expect(g.story.endsWith('?'), g.name).toBe(true);
      // Карточка на 360 px держит три строки текста; четвёртая — уже простыня.
      expect(g.story.length, g.name).toBeLessThanOrEqual(130);
    }
  });

  it('старая запись с достроенным домом ждёт гостью сразу', () => {
    expect(guestHere({ ...BUILT, builtAt: 0 }, 1_700_000_000_000)).toBe(true);
  });
});

describe('любовь — чистая функция от накопленного, не от кадров', () => {
  it('ни одного дня — ноль, и каждый засчитанный день прибавляет ровно LOVE_STEP', () => {
    expect(love(newBond())).toBe(0);
    for (const k of BOND_KINDS) {
      for (let n = 0; n <= LOVE_DAYS; n++) {
        const b = newBond();
        b[k] = { n, day: 0 };
        expect(love(b), `${k} × ${n}`).toBe(n * LOVE_STEP);
      }
    }
  });

  it('одни и те же дни — одна и та же любовь, когда бы их ни засчитали', () => {
    const a = bondOf(3, 2, 1, 4, 5);
    const b: Bond = { meal: { n: 3, day: 123_456 }, hug: { n: 2, day: 1 }, night: { n: 1, day: 999 }, wood: { n: 4, day: 7 } };
    expect(love(a)).toBe(love(b));
    // Спрашивать можно сколько угодно раз: чтение ничего не копит и не меняет.
    const before = JSON.stringify(a);
    for (let i = 0; i < 100; i++) love(a);
    expect(JSON.stringify(a)).toBe(before);
    expect(love(a)).toBe(50);
  });

  it('дело засчитывается раз в сутки поляны — и отлучка в неделю тоже один день', () => {
    const t0 = 100 * SKY_MS + 5_000;
    let t = newTally();
    t = tally(t, t0);
    expect(t).toEqual({ n: 1, day: dayOf(t0) });
    // В те же сутки второй раз не засчитывается — возвращается тот же счёт.
    expect(tally(t, t0 + 1_000)).toBe(t);
    expect(tally(t, (dayOf(t0) + 1) * SKY_MS - 1)).toBe(t);
    expect(counts(t, t0 + 1_000)).toBe(false);
    // Новые сутки — новый день.
    t = tally(t, (dayOf(t0) + 1) * SKY_MS);
    expect(t.n).toBe(2);
    // Часы, переведённые назад, не засчитывают заново.
    expect(tally(t, t0)).toBe(t);
    // Неделя без игры — это один день по возвращении, а не две с половиной тысячи.
    expect(tally(t, t0 + 7 * 24 * H).n).toBe(3);
  });

  it('одним мясом — и любым одним или двумя делами — до ста не дойти', () => {
    for (const k of BOND_KINDS) {
      const b = newBond();
      b[k] = { n: 1_000, day: 0 };
      expect(love(b), k).toBe(LOVE_DAYS * LOVE_STEP);
      expect(love(b), k).toBeLessThan(LOVE_FULL);
    }
    for (let i = 0; i < BOND_KINDS.length; i++) {
      for (let j = i + 1; j < BOND_KINDS.length; j++) {
        const b = newBond();
        b[BOND_KINDS[i]] = { n: 1_000, day: 0 };
        b[BOND_KINDS[j]] = { n: 1_000, day: 0 };
        expect(love(b), `${BOND_KINDS[i]} + ${BOND_KINDS[j]}`).toBeLessThan(LOVE_FULL);
      }
    }
    // А три любых — доходят.
    for (let skip = 0; skip < BOND_KINDS.length; skip++) {
      const b = newBond();
      BOND_KINDS.forEach((k, i) => {
        if (i !== skip) b[k] = { n: LOVE_DAYS, day: 0 };
      });
      expect(love(b), `без ${BOND_KINDS[skip]}`).toBe(LOVE_FULL);
    }
  });

  it('путь до ста — от трёх заходов, обычно пять: расчёт прогоном, а не на бумаге', () => {
    const days = Math.ceil(LOVE_FULL / LOVE_STEP);
    expect(days).toBe(20);
    // Заход в четыре минуты, начатый с каждой секунды суток поляны. Старательный
    // игрок делает каждое дело в каждые задетые сутки и встречает дома каждую
    // задетую ночь: столько дней заход может дать самое большее.
    const session = 4 * 60_000;
    let best = 0;
    for (let s = 0; s < SKY_MS; s += 1_000) {
      const touched = dayOf(s + session - 1) - dayOf(s) + 1;
      let nights = 0;
      for (let c = dayOf(s) - 1; c <= dayOf(s + session) + 1; c++) {
        const from = c * SKY_MS + DAY_SHARE * SKY_MS;
        const to = (c + 1) * SKY_MS;
        if (from < s + session && to > s) nights++;
      }
      best = Math.max(best, touched * 3 + nights);
    }
    expect(best).toBe(8);
    expect(Math.ceil(days / best)).toBe(3);
    // Обычный заход: каждое дело по разу и одна ночь дома — четыре дня.
    expect(days / BOND_KINDS.length).toBe(5);
  });

  it('модуль рода не читает ни часов, ни кадров, ни случайности', () => {
    const src = readFileSync(join(__dirname, 'kin.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const word of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'performance.now', 'Date', 'Math.random', 'serverNow']) {
      expect(src, `род начал тикать: ${word}`).not.toContain(word);
    }
  });

  it('сцена и надстройка любви не считают: только спрашивают', () => {
    for (const file of ['scene.ts', 'Prologue.tsx']) {
      const src = readFileSync(join(__dirname, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(src, `${file}: своя арифметика любви`).not.toContain('LOVE_STEP');
    }
  });
});

describe('имя сына: пустое и мусор не принимаются', () => {
  it('настоящие имена принимаются и приводятся к виду', () => {
    const good: [string, string][] = [
      ['Ратибор', 'Ратибор'],
      ['  ратибор  ', 'Ратибор'],
      ['ЯРОСЛАВ', 'Ярослав'],
      ['Ян', 'Ян'],
      ['Лев', 'Лев'],
      ['жан-поль', 'Жан-Поль'],
      ['олег   вещий', 'Олег Вещий'],
      ['Ivan', 'Ivan'],
      ['Мстислав', 'Мстислав'],
      ['Святополк', 'Святополк'],
      ['Всеволод', 'Всеволод'],
    ];
    for (const [raw, name] of good) expect(heirName(raw), raw).toEqual({ name, why: '' });
  });

  it('пустое, мусор и лишнее — нет, и сказано почему', () => {
    const bad = [
      '',
      '   ',
      'Р',
      '1',
      '123',
      'Ратибор2',
      'Рати_бор',
      'Ян.',
      '💩',
      '<script>',
      'Ra-тибор',
      'Ivaн',
      'ааа',
      'Аааня',
      'ффф',
      'кпрст',
      '-Ян',
      'Ян-',
      'Иван-да-Марья',
      'Ратиборратиборрат',
      'Ἀλέξανδρος',
    ];
    for (const raw of bad) {
      const r = heirName(raw);
      expect(r.name, `принято: «${raw}»`).toBe('');
      expect(r.why.length, `не сказано почему: «${raw}»`).toBeGreaterThan(0);
    }
    expect(heirName('').why).toBe('Впиши имя');
    expect(heirName('Ратибор2').why).toBe('Только буквы');
  });

  it('длина разумная: от двух букв, и влезает туда, куда имя поедет потом', () => {
    expect(HEIR_MIN).toBe(2);
    expect(HEIR_MAX).toBeLessThanOrEqual(NAME_MAX);
    expect(heirName('Я'.repeat(HEIR_MAX)).why).not.toBe('');
    expect(heirName('Ратиборрадомирс').name).toBe('Ратиборрадомирс');
  });
});

describe('имя лежит там, откуда его возьмёт основная игра', () => {
  const KEY = 'tribe.prologue.v1';
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

  it('`heir.name` в записи `tribe.prologue.v1` — и версия записи прежняя', () => {
    const s = freshPrologue(0);
    s.house = HOUSE_LOGS;
    s.wife = { name: 'Ведана', at: 1 };
    s.bond = bondOf(7, 7, 6, 0);
    s.heir = { name: 'Ратибор', at: 2 };
    savePrologue(s, 1_000);
    const raw = JSON.parse(store.get(KEY) ?? '{}') as { v: number; heir: { name: string } };
    // Договор с будущей передачей — ровно это: ключ, поле, строка.
    expect(raw.heir.name).toBe('Ратибор');
    expect(raw.v).toBe(PROLOGUE_VERSION);
    expect(PROLOGUE_VERSION).toBe(1);
    const back = loadPrologue(2_000);
    expect(back.heir).toEqual({ name: 'Ратибор', at: 2 });
    expect(back.wife).toEqual({ name: 'Ведана', at: 1 });
    expect(back.bond).toEqual(s.bond);
  });

  it('старая запись без рода читается без новой версии: никого нет, дней ноль', () => {
    // Минута настоящая, а не нулевая: запись из прошлого читают в сегодняшний день.
    const now = 1_700_000_000_000;
    store.set(KEY, JSON.stringify({ v: 1, house: HOUSE_LOGS, hearth: { fuel: 3, at: now - 5 }, logs: 2 }));
    const s = loadPrologue(now);
    expect(s).toMatchObject({ builtAt: 0, refused: 0, refusedAt: 0, wife: null, heir: null, logs: 2 });
    expect(s.bond).toEqual(newBond());
    expect(s.hearth.kept).toBeUndefined();
    // У такого дома гостья уже ждёт: дом достроили до того, как в игре появился род.
    expect(guestHere(s, now)).toBe(true);
  });

  it('битый род в записи — нет человека, а не падение', () => {
    store.set(KEY, JSON.stringify({ v: 1, wife: { name: 42 }, heir: { name: '   ' }, bond: { meal: { n: 'x' } }, refused: -4 }));
    const s = loadPrologue(10);
    expect(s.wife).toBeNull();
    expect(s.heir).toBeNull();
    expect(s.bond.meal).toEqual({ n: 0, day: -1 });
    expect(s.refused).toBe(0);
  });

  it('жена в записи, а очаг без хозяйки — мера меняется с минуты чтения, а не задним числом', () => {
    store.set(KEY, JSON.stringify({ v: 1, house: HOUSE_LOGS, wife: { name: 'Злата', at: 1 }, hearth: { fuel: 4, at: 0 } }));
    const now = 6 * H;
    const s = loadPrologue(now);
    expect(s.hearth.kept).toBe(true);
    expect(s.hearth.at).toBe(now);
    expect(s.hearth.fuel).toBeCloseTo(fuelAt({ fuel: 4, at: 0 }, now), 12);
  });
});

describe('родословная показывает ровно то, что есть', () => {
  const wife = { name: 'Злата', at: 1 };
  const son = { name: 'Ратибор', at: 2 };

  it('до жены — один человек и пустая страница', () => {
    const l = lineage(null, null);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ who: 'you', name: 'Ты' });
  });

  it('после согласия — ты и жена', () => {
    const l = lineage(wife, null);
    expect(l.map((x) => x.who)).toEqual(['you', 'wife']);
    expect(l[1].name).toBe('Злата');
    // Откуда она — её же словами из родословной гостий.
    expect(l[1].note).toContain('мор');
  });

  it('после рождения — ты, жена и сын с именем', () => {
    const l = lineage(wife, son);
    expect(l.map((x) => x.who)).toEqual(['you', 'wife', 'son']);
    expect(l[2]).toMatchObject({ name: 'Ратибор', note: 'сын' });
  });

  it('ступени — из записи, а не из шкалы и не из числа отказов', () => {
    // Полная любовь без названного сына — ещё две строки: сына нет, пока его не назвали.
    const s: PrologueSave = { ...freshPrologue(0), house: HOUSE_LOGS, wife, bond: bondOf(7, 7, 7, 7) };
    expect(lineage(s.wife, s.heir)).toHaveLength(2);
    // Жена после трёх отказов — это она, а не та, что пришла бы четвёртой.
    expect(lineage({ name: 'Ведана', at: 1 }, null)[1].name).toBe('Ведана');
    expect(guestOf(3).name).not.toBe('Ведана');
    // Имени нет в кругу гостий — строка всё равно есть, без подробностей.
    expect(lineage({ name: 'Беляна', at: 1 }, null)[1].note).toBe('жена');
  });
});

describe('хозяйка бережёт огонь — на выведенное число и с минуты, когда осталась', () => {
  it('число выведено: средняя ставка горения с хозяйкой — ровно единица', () => {
    expect(KEEP_BURN * BURN_MEAN).toBeCloseTo(1, 12);
    expect(KEEP_BURN).toBeLessThan(1);
    expect(KEEP_BURN).toBeGreaterThan(0.5);
  });

  it('полный очаг с хозяйкой снова держит двое суток — в любую фазу погоды', () => {
    let lo = Infinity;
    let hi = 0;
    let sum = 0;
    let n = 0;
    for (let t0 = 0; t0 < RING_MS; t0 += 20_000, n++) {
      const left = burnLeftMs({ fuel: HEARTH_CAP, at: t0, kept: true }, t0) / H;
      lo = Math.min(lo, left);
      hi = Math.max(hi, left);
      sum += left;
    }
    expect(sum / n).toBeGreaterThan(47.5);
    expect(sum / n).toBeLessThan(48.5);
    expect(hi - lo).toBeLessThan(1);
    // Без неё — тридцать с лишним: ровно то, что забрала погода.
    expect(burnLeftMs({ fuel: HEARTH_CAP, at: 0 }, 0) / H).toBeLessThan(36);
  });

  it('отрезок до её прихода сгорел прежней мерой, а дальше горит её', () => {
    const h = { fuel: 5, at: 0 };
    const t = 3 * H;
    const kept = keepHearth(h, t);
    expect(kept).toMatchObject({ at: t, kept: true });
    expect(kept.fuel).toBeCloseTo(fuelAt(h, t), 12);
    const later = t + 2 * H;
    const plain = { fuel: kept.fuel, at: t };
    expect((kept.fuel - fuelAt(kept, later)) / (plain.fuel - fuelAt(plain, later))).toBeCloseTo(KEEP_BURN, 9);
  });

  it('мера переезжает вместе с дровами и расходом, но не заводится сама', () => {
    const kept = { fuel: 3, at: 0, kept: true };
    expect(feed(kept, H, 1).kept).toBe(true);
    expect(spend(kept, H, 0.5).kept).toBe(true);
    expect(feed({ fuel: 3, at: 0 }, H, 1)).not.toHaveProperty('kept');
    expect(newHearth(0, true).kept).toBe(true);
    expect(newHearth(0)).not.toHaveProperty('kept');
  });

  it('полоса обещает то, что случится, и холод узнаёт о гашении из того же числа', () => {
    for (let t0 = 0; t0 < RING_MS; t0 += 97_000) {
      const h = { fuel: 3, at: t0, kept: true };
      const out = t0 + burnLeftMs(h, t0);
      expect(fuelAt(h, out - 60_000), `${t0}`).toBeGreaterThan(0);
      expect(fuelAt(h, out + 60_000), `${t0}`).toBe(0);
      expect(fireOutAt(h)).toBeCloseTo(out, 3);
    }
  });

  it('жена встречает словами — тем же сроком, что называет полоса', () => {
    const s: PrologueSave = { ...freshPrologue(0), house: HOUSE_LOGS, wife: { name: 'Любава', at: 0 } };
    const h = { fuel: 4, at: 0, kept: true };
    expect(welcome(s, h, 60_000, 60_000)).toBe('');
    const long = welcome(s, h, 60_000, 3 * H);
    expect(long).toContain('Любава');
    expect(long).toContain('сберегла');
    expect(welcome(s, { fuel: 0, at: 0, kept: true }, 60_000, 3 * H)).toContain('погас');
    expect(welcome({ ...s, bond: bondOf(7, 7, 7, 0) }, h, 60_000, 3 * H)).toContain('что-то сказать');
    // У огня никого — встречать некому; гостья ждёт — так и сказано.
    expect(welcome({ ...s, wife: null, house: 0 }, h, 60_000, 3 * H)).toBe('');
    expect(welcome({ ...s, wife: null }, h, 60_000, 0)).toContain('ждёт');
  });

  it('что жена говорит — из того, что считает игра', () => {
    const k = { wife: { name: 'Дарина', at: 0 }, heir: null, bond: newBond() };
    expect(wifeSays(k, { fuel: 2, at: 0, kept: true }, 0)).toContain('берегу');
    expect(wifeSays(k, { fuel: 0, at: 0, kept: true }, 0)).toContain('погас');
    expect(wifeSays({ ...k, bond: bondOf(7, 7, 7, 0) }, { fuel: 2, at: 0 }, 0)).toContain('сын');
    expect(wifeSays({ ...k, heir: { name: 'Ян', at: 1 } }, { fuel: 2, at: 0 }, 0)).toContain('Ян');
  });
});

describe('род переживает выход и смерть', () => {
  it('смерть не отнимает ни жены, ни дней общей жизни, ни сына — и очаг нового утра бережёт она', () => {
    const s = freshPrologue(0);
    s.house = HOUSE_LOGS;
    s.wife = { name: 'Горислава', at: 1 };
    s.bond = bondOf(2, 3, 1, 4, 9);
    s.heir = { name: 'Ян', at: 3 };
    s.refused = 2;
    s.refusedAt = 5;
    const next = revive(s, 5_000);
    expect(next).toMatchObject({ wife: s.wife, heir: s.heir, refused: 2, refusedAt: 5 });
    expect(next.bond).toEqual(s.bond);
    expect(next.hearth.kept).toBe(true);
    // Без жены новое утро — у обычного очага, как прежде.
    expect(revive(freshPrologue(0), 5_000).hearth).not.toHaveProperty('kept');
  });
});

describe('разговор — своя дверь, и кнопки в нём гаснут с причиной', () => {
  const AT_MATE: Spot = { kind: 'mate', x: MATE_SPOT.x, z: MATE_SPOT.z, index: -1 };
  const AT_HOUSE: Spot = { kind: 'house', x: HOUSE.x, z: HOUSE.z, index: -1 };
  const S = (over: Partial<PrologueSave> = {}): PrologueSave => ({ ...freshPrologue(0), ...over });
  const wed = { house: HOUSE_LOGS, wife: { name: 'Ведана', at: 0 } };

  it('к женщине подошёл — говорить; к достроенному дому — родословная', () => {
    expect(offer(S(wed), AT_MATE, 0)).toMatchObject({ deed: 'talk', can: true });
    expect(offer(S({ house: HOUSE_LOGS }), AT_MATE, 0)).toMatchObject({ deed: 'talk', can: true });
    expect(offer(S(wed), AT_HOUSE, 0)).toMatchObject({ deed: 'kin', can: true });
  });

  it('дать мясо: некому, нечего, сегодня уже, одним мясом, полна — у каждого своя причина', () => {
    const meat = { meat: { cooked: 1, raw: 2 } };
    const day = 50 * SKY_MS;
    expect(share(S(meat), day)).toMatchObject({ can: false, why: 'Некого угостить' });
    expect(share(S(wed), day)).toMatchObject({ can: false, why: 'Мяса нет' });
    expect(share(S({ ...wed, ...meat, bond: { ...newBond(), meal: { n: 1, day: dayOf(day) } } }), day)).toMatchObject({
      can: false,
      why: 'Сегодня уже ели вместе',
    });
    expect(share(S({ ...wed, ...meat, bond: { ...newBond(), meal: { n: LOVE_DAYS, day: 0 } } }), day)).toMatchObject({
      can: false,
      why: 'Одним мясом любви не прибавишь',
    });
    expect(share(S({ ...wed, ...meat, bond: bondOf(5, 7, 7, 7) }), day)).toMatchObject({ can: false, why: 'Любовь полна' });
    expect(share(S({ ...wed, ...meat, bond: { ...newBond(), meal: { n: 1, day: dayOf(day) - 1 } } }), day)).toMatchObject({
      deed: 'share',
      can: true,
    });
  });
});

describe('место женщины у огня', () => {
  it('у очага, в тепле и в круге, куда при горящем огне не входит волк', () => {
    expect(byFire(MATE_SPOT.x, MATE_SPOT.z)).toBe(true);
    expect(Math.hypot(MATE_SPOT.x - FIRE.x, MATE_SPOT.z - FIRE.z)).toBeLessThan(WOLF_FIRE_R);
    expect(wolfKeepsOut(MATE_SPOT.x, MATE_SPOT.z, true)).toBe(true);
  });

  it('вплотную к ней не подойти: глаза останавливаются дальше метра', () => {
    // Иначе голова во весь экран — тот же «коричневый экран», что у ствола дерева.
    expect(MATE_R + BODY_R).toBeGreaterThanOrEqual(1.2);
    expect(MATE_R).toBeLessThanOrEqual(TREE_R);
  });

  it('с места входа до неё не дотянуться: первым по-прежнему огонь', () => {
    expect(Math.hypot(START.x - MATE_SPOT.x, START.z - MATE_SPOT.z) - MATE_R).toBeGreaterThan(REACH);
    const glade = { felled: TREES.map(() => 0), arrows: [], carcass: null, tent: false, house: true, wolves: [], mate: MATE_SPOT };
    expect(nearest(START.x, START.z, glade, 0)?.kind).toBe('fire');
  });

  it('между ней и очагом, колодой, палаткой, домом и деревьями проходит человек', () => {
    for (const b of [FIRE, TENT, AXE_STUMP, HOUSE, ...TREES.map((t) => ({ ...t, r: TREE_R }))]) {
      const d = Math.hypot(MATE_SPOT.x - b.x, MATE_SPOT.z - b.z);
      expect(d, `${b.x},${b.z}`).toBeGreaterThan(b.r + MATE_R + BODY_R * 2 + 0.3);
    }
  });

  it('вплотную к очагу с её стороны тап достаётся дровам, а не разговору', () => {
    const dx = MATE_SPOT.x - FIRE.x;
    const dz = MATE_SPOT.z - FIRE.z;
    const k = (FIRE.r + BODY_R) / Math.hypot(dx, dz);
    const glade = reach({ ...freshPrologue(0), house: HOUSE_LOGS, kit: true }, 0, [], MATE_SPOT);
    expect(nearest(FIRE.x + dx * k, FIRE.z + dz * k, glade, 0)?.kind).toBe('fire');
  });

  it('путь гостьи от опушки до очага не задевает ни дерева, ни палатки, ни дома', () => {
    expect(Math.hypot(GUEST_FROM.x, GUEST_FROM.z)).toBeLessThan(GLADE_R);
    const blocks = [FIRE, TENT, AXE_STUMP, HOUSE, ...TREES.map((t) => ({ ...t, r: TREE_R }))];
    for (let i = 0; i <= 200; i++) {
      const k = i / 200;
      const x = GUEST_FROM.x + (MATE_SPOT.x - GUEST_FROM.x) * k;
      const z = GUEST_FROM.z + (MATE_SPOT.z - GUEST_FROM.z) * k;
      for (const b of blocks) {
        expect(Math.hypot(x - b.x, z - b.z), `${k}: ${b.x},${b.z}`).toBeGreaterThan(b.r + MATE_R);
      }
    }
  });

  it('подошёл к ней — тап достаётся ей, а не очагу за её спиной', () => {
    // Точка, где до неё и до очага ровно одно расстояние от края.
    const dx = MATE_SPOT.x - FIRE.x;
    const dz = MATE_SPOT.z - FIRE.z;
    const d = Math.hypot(dx, dz);
    const along = (FIRE.r + (d - MATE_R - FIRE.r) / 2) / d;
    const px = FIRE.x + dx * along;
    const pz = FIRE.z + dz * along;
    const glade = reach({ ...freshPrologue(0), house: HOUSE_LOGS }, 0, [], MATE_SPOT);
    expect(Math.hypot(px - MATE_SPOT.x, pz - MATE_SPOT.z) - MATE_R).toBeCloseTo(Math.hypot(px - FIRE.x, pz - FIRE.z) - FIRE.r, 9);
    expect(nearest(px, pz, glade, 0)?.kind).toBe('mate');
  });
});
