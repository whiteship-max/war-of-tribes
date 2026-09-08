// Письма: чистая часть и то, как она живёт в мире.
//
// Разделено надвое нарочно. Первая половина не знает ни про мир, ни про часы —
// она проверяет договор `resolveLetter`: одна дверь на три повода, ничего
// неотстраиваемого, ни одной случайности. Вторая половина гоняет настоящий
// `LocalWorld` с ручными часами: срок, переполнение, летопись и возвращение
// после офлайна.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import { WORLD_SAVE_VERSION, parseWorldSave, type WorldSave } from './local/state';
import {
  LETTER_DECISIONS,
  crowdedOut,
  letterExpired,
  letterOrder,
  letterPause,
  letterUntil,
  pickLetter,
  resolveLetter,
  type LetterCandidate,
} from './letters';
import { LETTER_KIND_BY_ID, RHUMB_WORDS } from './data/letters';
import { BARBARIAN_NAMES, PLACE_FIRST, PLACE_SECOND, TRIBE_NAMES } from './data/meta';
import { rhumbOf } from './geo';
import {
  LETTER_PAUSE_MAX,
  LETTER_PAUSE_MIN,
  LETTER_SILENCE_EXTRA,
  LETTER_SLOTS,
  LETTER_TTL,
} from './data/tuning';
import type { Letter, LetterKindId, PlayerProfile } from './types';

const START = 1_700_000_000_000;
const HOUR = 3_600_000;

const letter = (over: Partial<Letter> = {}): Letter => ({
  id: 'L1',
  kind: 'pact',
  at: START,
  until: START + LETTER_TTL,
  fromId: 's1',
  fromName: 'Кривой Лог',
  cost: {},
  ...over,
});

const candidate = (over: Partial<LetterCandidate> = {}): LetterCandidate => ({
  id: 's1',
  name: 'Кривой Лог',
  pop: 120,
  lootMix: ['food', 'wood'],
  standing: 'neutral',
  attitude: 0,
  captives: 0,
  rivalId: 's2',
  rivalName: 'Дальний Стан',
  ...over,
});

const DECISIONS: LetterKindId[] = ['pact', 'tribute', 'alliance', 'ransom'];

describe('письмо — чистая функция', () => {
  it('какое письмо придёт, решают только зерно, номер и то, что видно у соседей', () => {
    const cands = [candidate(), candidate({ id: 's2', name: 'Дальний Стан', attitude: 20 })];
    const a = pickLetter(11, 3, cands, { food: 500 });
    const b = pickLetter(11, 3, cands, { food: 500 });
    expect(a).toEqual(b);
    // Другой номер — другое письмо (хотя бы на каком-то из первых десяти).
    const others = [...Array(10)].map((_, i) => JSON.stringify(pickLetter(11, i, cands, { food: 500 })));
    expect(new Set(others).size).toBeGreaterThan(1);
  });

  it('расписание приходов — тоже чистая функция, и держится в объявленных рамках', () => {
    for (let n = 0; n < 50; n++) {
      const p = letterPause(31, n);
      expect(p).toBe(letterPause(31, n));
      expect(p).toBeGreaterThanOrEqual(LETTER_PAUSE_MIN);
      expect(p).toBeLessThanOrEqual(LETTER_PAUSE_MAX);
    }
  });

  it('разрешение — чистая функция: тот же исход при тех же входах', () => {
    for (const kind of DECISIONS) {
      const l = letter({ kind, cost: { food: 30 }, men: 4, againstId: 's2', againstName: 'Дальний Стан' });
      for (const answer of ['yes', 'no', 'lapse'] as const) {
        expect(resolveLetter(l, answer)).toEqual(resolveLetter(l, answer));
      }
    }
  });

  it('молчание — это отказ, только холоднее ровно на объявленное число', () => {
    for (const kind of DECISIONS) {
      const l = letter({ kind, cost: { food: 30 }, men: 4, againstId: 's2', againstName: 'Дальний Стан' });
      const no = resolveLetter(l, 'no');
      const silent = resolveLetter(l, 'lapse');
      expect(silent.attitude, kind).toBe(no.attitude + LETTER_SILENCE_EXTRA);
      // Ни одной ветки, которой не было бы у отказа: состояние, добро и люди
      // у молчания те же. В этом и весь смысл одной двери.
      expect(silent.standing, kind).toBe(no.standing);
      expect(silent.resources, kind).toEqual(no.resources);
      expect(silent.pop, kind).toBe(no.pop);
      // Строка своя: игрок обязан узнать, что гонец уехал без ответа.
      expect(silent.text, kind).not.toBe(no.text);
      expect(silent.text.length, kind).toBeGreaterThan(0);
    }
  });

  it('ни одно письмо не отнимает того, что нельзя отстроить', () => {
    for (const kind of DECISIONS) {
      const l = letter({ kind, cost: { food: 30, wood: 30 }, men: 6, againstId: 's2', againstName: 'Дальний Стан' });
      for (const answer of ['yes', 'no', 'lapse'] as const) {
        const out = resolveLetter(l, answer);
        // Людей письмо может только вернуть.
        expect(out.pop, `${kind}/${answer}`).toBeGreaterThanOrEqual(0);
        // Со склада уходит ровно то, о чём в письме сказано вперёд, и ничего
        // сверх: неожиданных списаний у письма быть не может.
        for (const [r, n] of Object.entries(out.resources)) {
          expect(n).toBeLessThan(0);
          expect(Math.abs(n ?? 0)).toBeLessThanOrEqual(l.cost[r as 'food'] ?? 0);
        }
        // Ни зданий, ни дружины письмо не касается вовсе: полей для этого в
        // исходе нет — это структурный запрет, а не обещание.
        expect(Object.keys(out)).toEqual(
          expect.not.arrayContaining(['lost', 'lostTroops', 'sacked', 'battle']),
        );
      }
    }
  });

  it('плата уходит только по согласию: отказ и молчание не стоят ни зерна', () => {
    for (const kind of ['tribute', 'ransom'] as const) {
      const l = letter({ kind, cost: { food: 40 }, men: 5 });
      expect(resolveLetter(l, 'yes').resources).toEqual({ food: -40 });
      expect(resolveLetter(l, 'no').resources).toEqual({});
      expect(resolveLetter(l, 'lapse').resources).toEqual({});
    }
  });

  it('предупреждение о набеге не разрешается письмом и в летопись не пишет', () => {
    const raid = letter({ kind: 'raid', marchId: 'm1' });
    for (const answer of ['yes', 'no', 'lapse'] as const) {
      const out = resolveLetter(raid, answer);
      expect(out.text, 'строку о бое оставит отчёт, а не письмо').toBe('');
      expect(out.attitude).toBe(0);
      expect(out.standing).toBe(null);
    }
    // И выбора в нём нет: решают на карте.
    expect(LETTER_KIND_BY_ID.raid.yes).toBe(null);
    expect(LETTER_KIND_BY_ID.raid.no).toBe(null);
  });

  it('порядок на столе — по сроку: набег ложится поверх суточных писем', () => {
    const list: Letter[] = [
      letter({ id: 'a', at: START, until: START + LETTER_TTL }),
      letter({ id: 'b', at: START - HOUR, until: START - HOUR + LETTER_TTL }),
      letter({ id: 'r', kind: 'raid', at: START, until: START + 7 * 60_000, marchId: 'm1' }),
    ];
    expect(letterOrder(list).map((l) => l.id)).toEqual(['r', 'b', 'a']);
  });

  it('стол вытесняет то, у чего срок ближе всех, и никогда — предупреждение', () => {
    const list: Letter[] = [];
    // На единицу меньше, чем помещается решений: гнать ещё некого.
    for (let i = 0; i < LETTER_DECISIONS - 1; i++) {
      list.push(letter({ id: `d${i}`, at: START + i * HOUR, until: START + i * HOUR + LETTER_TTL }));
    }
    expect(crowdedOut(list)).toBe(null);
    // Предупреждение о набеге в счёт решений не идёт: у него своя, пятая ячейка.
    list.push(letter({ id: 'raid', kind: 'raid', at: START, until: START + 60_000, marchId: 'm1' }));
    expect(crowdedOut(list), 'набег никого не сгоняет').toBe(null);
    // А вот последнее решение стол переполняет — и уходит то, у чего срок ближе.
    list.push(letter({ id: 'last', at: START + 9 * HOUR, until: START + 9 * HOUR + LETTER_TTL }));
    expect(crowdedOut(list)?.id, 'сгоняют самое старое, а не предупреждение').toBe('d0');
  });

  it('срок считается при чтении, а не отмечается заранее', () => {
    const l = letter();
    expect(letterExpired(l, START + LETTER_TTL - 1)).toBe(false);
    expect(letterExpired(l, START + LETTER_TTL)).toBe(true);
    expect(letterUntil({ kind: 'pact', fromId: 's1', fromName: 'x', cost: {} }, START)).toBe(START + LETTER_TTL);
    // У набега срок — приход отряда, а не сутки.
    expect(letterUntil({ kind: 'raid', fromId: 's1', fromName: 'x', cost: {} }, START, START + 5000)).toBe(START + 5000);
  });
});

// ---------- Мир ----------

const profile = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Тест',
  pop: 120,
  defense: 30,
  warriorPower: 3,
  units: { warrior: 10, scout: 4 },
  command: 60,
  resources: { food: 4000, wood: 4000, stone: 4000, hides: 4000, bones: 4000, copper: 4000, iron: 4000 },
  ...over,
});

/** Мир с ручными часами и без сохранения — как в остальных тестах мира. */
function makeWorld(seed = 7) {
  let now = START;
  const world = new LocalWorld({ seed, now: () => now, storage: null });
  return {
    world,
    at: (t: number): void => {
      now = t;
    },
    now: (): number => now,
  };
}

/** Все последствия, доставленные племени за прогон. */
async function pulse(w: ReturnType<typeof makeWorld>): Promise<string[]> {
  const out = await w.world.sync(profile());
  return out.effects.map((e) => e.text);
}

/**
 * Шагает по часу, пока на столе не появится решение. Ждать приходится: письма
 * приходят раз в шесть-десять часов нарочно — это `LETTER_TTL / (слоты − 1)`,
 * и наступать на этот срок в тестах значило бы проверять не ту игру.
 */
async function waitLetter(w: ReturnType<typeof makeWorld>, hours = 24) {
  for (let h = 1; h <= hours; h++) {
    w.at(START + h * HOUR);
    await pulse(w);
    const found = (await w.world.letters()).filter((l) => l.kind !== 'raid')[0];
    if (found) return found;
  }
  throw new Error('за сутки не пришло ни одного письма');
}

describe('письма в мире', () => {
  it('письмо разрешается само ровно через сутки — и пишет одну строку', async () => {
    const w = makeWorld(21);
    await pulse(w);
    const l = await waitLetter(w);
    expect(l.until - l.at).toBe(LETTER_TTL);

    // За секунду до срока оно ещё на столе.
    w.at(l.until - 1000);
    await pulse(w);
    expect((await w.world.letters()).some((x) => x.id === l.id)).toBe(true);

    // Ровно на сроке — разрешилось, и в летопись ушла ровно одна строка.
    w.at(l.until);
    const texts = await pulse(w);
    expect((await w.world.letters()).some((x) => x.id === l.id)).toBe(false);
    const mine = texts.filter((t) => t.includes(l.fromName));
    expect(mine.length, 'разрешённое письмо пишет одну строку').toBe(1);
  });

  it('видимых не больше пяти, а сверх стола не хранится ничего', async () => {
    const w = makeWorld(33);
    await pulse(w);
    // Двое суток подряд, шагами по часу: писем приходит заведомо больше пяти.
    for (let h = 1; h <= 48; h++) {
      w.at(START + h * HOUR);
      await pulse(w);
      const list = await w.world.letters();
      expect(list.length, `час ${h}`).toBeLessThanOrEqual(LETTER_SLOTS);
      // Пятая ячейка — предупреждения: решений на столе не больше четырёх, и
      // набег, выходящий каждые четверть часа, никого с него не сгоняет.
      expect(list.filter((l) => l.kind !== 'raid').length, `час ${h}`).toBeLessThanOrEqual(
        LETTER_SLOTS - 1,
      );
      const save = (w.world as unknown as { save: WorldSave }).save;
      expect(save.letters.length, 'очереди за столом нет').toBe(list.length);
    }
  });

  it('вытесненное письмо разрешается тем же плохим сценарием и не пропадает молча', async () => {
    const w = makeWorld(33);
    await pulse(w);
    const seen = new Set<string>();
    const lines: string[] = [];
    for (let h = 1; h <= 48; h++) {
      w.at(START + h * HOUR);
      lines.push(...(await pulse(w)));
      for (const l of await w.world.letters()) seen.add(l.id);
    }
    const left = new Set((await w.world.letters()).map((l) => l.id));
    // Каждое письмо, которое лежало на столе и со стола ушло, оставило строку.
    const gone = [...seen].filter((id) => !left.has(id) && !id.startsWith('L-raid'));
    expect(gone.length, 'за двое суток что-то обязано было уйти').toBeGreaterThan(0);
    const closed = lines.filter((t) => t.includes('«'));
    expect(closed.length).toBeGreaterThanOrEqual(gone.length);
  });

  it('возвращение после офлайна: часть протухла, часть жива, и всё считается при чтении', async () => {
    // Один и тот же мир, две дороги: непрерывная игра и три дня молчания.
    const live = makeWorld(51);
    await pulse(live);
    for (let h = 1; h <= 72; h++) {
      live.at(START + h * HOUR);
      await pulse(live);
    }
    const away = makeWorld(51);
    await pulse(away);
    away.at(START + 72 * HOUR);
    const lines = await pulse(away);

    const table = await away.world.letters();
    expect(table.length, 'что-то ещё живо').toBeGreaterThan(0);
    expect(table.length).toBeLessThanOrEqual(LETTER_SLOTS);
    for (const l of table) expect(l.seconds).toBeGreaterThan(0);
    expect(lines.length, 'что-то разрешилось без игрока — и об этом сказано').toBeGreaterThan(0);

    // Считаем при чтении: догон даёт ровно то же, что непрерывная игра.
    //
    // Ровно то же — про письма, которые назначает сам стол: их расписание, срок
    // и отправитель выводятся из зерна и номера, и к часам устройства отношения
    // не имеют. Предупреждение о набеге в это сравнение не входит, и это не
    // послабление, а честность: оно не письмо, а отражение чужого отряда, а
    // отряды офлайн и не должны совпадать — набег, пришедшийся на время без
    // игрока, не состоится вовсе (`AWAY_GRACE`). Совпадать обязано другое: что
    // предупреждение есть на обеих дорогах и стоит на нём один и тот же час
    // прихода — час назначен, а не выбран по дороге.
    const key = (l: { kind: string; fromId: string; until: number }): string =>
      `${l.kind}|${l.fromId}|${l.until}`;
    const mine = await live.world.letters();
    expect(table.filter((l) => l.kind !== 'raid').map(key)).toEqual(
      mine.filter((l) => l.kind !== 'raid').map(key),
    );
    expect(table.filter((l) => l.kind === 'raid').map((l) => l.until)).toEqual(
      mine.filter((l) => l.kind === 'raid').map((l) => l.until),
    );
  });

  it('ответ игрока меняет отношения, а просроченному письму ответа уже не дают', async () => {
    const w = makeWorld(21);
    await pulse(w);
    const l = await waitLetter(w);
    const before = (await w.world.settlement(l.fromId))?.diplomacy?.attitude ?? 0;
    expect(await w.world.answerLetter(l.id, 'no')).toBe(null);
    const after = (await w.world.settlement(l.fromId))?.diplomacy?.attitude ?? 0;
    expect(after).toBeLessThan(before);
    // Второй раз то же письмо не отвечается: его на столе уже нет.
    expect(await w.world.answerLetter(l.id, 'yes')).toBeTruthy();
  });

  it('предупреждение о набеге приходит тогда же, когда отряд становится виден', async () => {
    const w = makeWorld(43);
    let raid: { id: string; fromName: string } | null = null;
    for (let m = 1; m <= 240 && !raid; m++) {
      w.at(START + m * 60_000);
      await pulse(w);
      const hostile = (await w.world.marches()).find((x) => x.hostile);
      const mail = (await w.world.letters()).find((x) => x.kind === 'raid');
      // Второй правды о том, когда видно набег, нет: письмо есть ровно тогда,
      // когда отряд виден на карте.
      expect(Boolean(mail), `минута ${m}`).toBe(Boolean(hostile));
      if (mail) raid = { id: mail.id, fromName: mail.fromName };
    }
    expect(raid, 'за четыре часа набег обязан случиться').toBeTruthy();
    const view = (await w.world.letters()).find((x) => x.id === raid?.id);
    expect(view?.choices.length, 'решают на карте, а не в письме').toBe(0);
    // Выбора в предупреждении нет, а место — есть: набег вышел из чужого двора,
    // и лупа обязана вести туда же, куда и у решений.
    expect(view?.from, 'у набега тоже есть источник на карте').toBeTruthy();
    expect(await w.world.answerLetter(raid!.id, 'yes')).toBeTruthy();
  });
});

describe('пленные и выкуп', () => {
  it('прорвавшийся набег оставляет пленных, и выкуп возвращает их людьми', async () => {
    // Числом деревня сильна (от него мир считает мощь набега), а в строю у неё
    // почти никого: набег прорвётся наверняка. Шаг мельче `AWAY_GRACE` — иначе
    // набег «не состоится», и брать в плен будет некого.
    const w = makeWorld(43);
    const weak = profile({ defense: 200, units: { warrior: 8, scout: 0 }, army: { clubman: 1 }, militia: 0 });
    let held: Record<string, number> = {};
    for (let m = 1; m <= 900; m++) {
      w.at(START + m * 15_000);
      await w.world.sync(weak);
      held = (w.world as unknown as { save: WorldSave }).save.captives;
      if (Object.keys(held).length > 0) break;
    }
    const from = Object.keys(held)[0];
    expect(from, 'за три часа хоть один набег прорвётся').toBeTruthy();
    expect(held[from]).toBeGreaterThan(0);

    // Пленные — это доля тех, кого племя уже посчитало убитыми: новой потери
    // здесь нет, поэтому выкуп только возвращает.
    // Двор, который кого-то держит, может предложить и выкуп — берём тот номер
    // письма, на котором он его и предлагает: вес у выкупа выше прочих, но
    // единственным видом он не становится.
    const cands = [candidate({ id: from, name: 'Двор', captives: held[from] })];
    const draft = [...Array(20)]
      .map((_, n) => pickLetter(1, n, cands, { food: 900 }))
      .find((d) => d?.kind === 'ransom');
    expect(draft, 'выкуп предлагает тот, кто и правда кого-то держит').toBeTruthy();
    expect(draft?.men).toBe(held[from]);
    const paid = resolveLetter(letter({ ...draft!, id: 'r1' }), 'yes');
    expect(paid.pop, 'вернулись людьми, а не в строй').toBe(held[from]);
    expect(resolveLetter(letter({ ...draft!, id: 'r1' }), 'lapse').pop).toBe(0);
  });
});

describe('сохранение мира', () => {
  it('пятая версия приводится к шестой: стол пуст, расписание с нуля', () => {
    const old = {
      v: 5,
      seed: 9,
      createdAt: START,
      home: { x: 10, y: 10 },
      diplomacy: {},
      figures: {},
    };
    const back = parseWorldSave(JSON.stringify(old));
    expect(back?.v).toBe(WORLD_SAVE_VERSION);
    expect(back?.letters).toEqual([]);
    expect(back?.captives).toEqual({});
    // Ноль, а не «сейчас плюс пауза»: назначает первый приход тот же код, что и
    // все следующие, — иначе первое подключение выложило бы письма толпой.
    expect(back?.nextLetterAt).toBe(0);
  });

  it('версия младше четвёртой по-прежнему отбрасывается', () => {
    expect(parseWorldSave(JSON.stringify({ v: 3, seed: 9, home: { x: 1, y: 1 } }))).toBe(null);
  });
});

/**
 * Самое длинное имя поселения, какое вообще может сгенерироваться. Считается из
 * тех же списков, из которых имена и собирает `generateWorld`, — вписать сюда
 * строку значило бы, что тест устареет молча при первом же новом слове.
 */
function longestName(): string {
  const longest = (list: string[]): string => list.reduce((a, b) => (b.length > a.length ? b : a));
  const place = `${longest(PLACE_FIRST)} ${longest(PLACE_SECOND)}`;
  const capital = `${longest(TRIBE_NAMES.map((t) => t.split(' ').pop() ?? t))}, стан`;
  return longest([place, capital, longest(BARBARIAN_NAMES)]);
}

describe('длинные имена', () => {
  it('в подписи выбора имени нет ни у одного вида писем', () => {
    const name = longestName();
    const against = longestName();
    for (const kind of DECISIONS) {
      const def = LETTER_KIND_BY_ID[kind];
      const l = letter({
        kind,
        fromName: name,
        againstId: 's2',
        againstName: against,
        men: 12,
        cost: { food: 40, wood: 40 },
      });
      // Плата подставляется коротким знаком нарочно: перечень товаров растёт с
      // размером просьбы, и укоротить его нельзя — ради него подпись и
      // переносится. Мерить надо то, что написали мы, а не то, что посчитала игра.
      const goods = '…';
      for (const [where, text] of [
        ['согласие', def.yesHint(l, goods)],
        ['отказ', def.noHint(l)],
      ] as const) {
        expect(text, `${kind}/${where} — подпись не пуста`).not.toBe('');
        expect(text.includes(name), `${kind}/${where} — имени в подписи выбора нет`).toBe(false);
        // Кнопка стоит на 360 px и обязана уместиться в две строки.
        expect(text.length, `${kind}/${where} — подпись короче полусотни знаков`).toBeLessThanOrEqual(52);
      }
    }
  });

  it('имя стоит там, где строка переносится: в теле и в строке молчания', () => {
    const name = longestName();
    for (const kind of DECISIONS) {
      const def = LETTER_KIND_BY_ID[kind];
      const l = letter({ kind, fromName: name, againstId: 's2', againstName: 'Сосед', men: 3, cost: { food: 9 } });
      const said = `${def.body(l, 'еда 9')} ${def.silence(l)}`;
      expect(said.includes(name), `${kind} — кто прислал, сказано словами`).toBe(true);
    }
  });
});

describe('откуда письмо и лупа', () => {
  it('румб считается от деревни: север — это убывающий y', () => {
    const home = { x: 100, y: 100 };
    expect(rhumbOf(home, { x: 100, y: 80 })).toBe(0);
    expect(rhumbOf(home, { x: 120, y: 80 })).toBe(1);
    expect(rhumbOf(home, { x: 120, y: 100 })).toBe(2);
    expect(rhumbOf(home, { x: 100, y: 120 })).toBe(4);
    expect(rhumbOf(home, { x: 80, y: 100 })).toBe(6);
    expect(RHUMB_WORDS).toHaveLength(8);
  });

  it('у письма есть место, и разведанную клетку отдают, а неразведанную — нет', async () => {
    const w = makeWorld(21);
    await pulse(w);
    const l = await waitLetter(w);
    expect(l.from, 'у соседа есть место на карте').toBeTruthy();
    expect(l.from!.cells, 'до него считанные клетки').toBeGreaterThan(0);

    // Разведанное отдаётся клеткой, и это та же клетка, что у поселения.
    const known = l.from!.cell;
    if (known) {
      const card = await w.world.settlement(l.fromId);
      expect(card && card.x === known.x && card.y === known.y, 'клетка та же, что у карточки').toBe(true);
    }

    // Двор, которого игрок не разведал, места не выдаёт — только румб и даль.
    const hidden = (await w.world.letters()).map((x) => x.from).filter((f): f is NonNullable<typeof f> => !!f);
    for (const f of hidden) {
      if (f.cell) continue;
      expect(f.cells, 'неразведанному остаются румб и расстояние').toBeGreaterThan(0);
      expect(RHUMB_WORDS[f.rhumb], 'румб называется словом').toBeTruthy();
    }
  });

  it('двор, которого игрок не разведал, места не выдаёт', async () => {
    const w = makeWorld(21);
    await pulse(w);
    const save = (w.world as unknown as { save: WorldSave }).save;
    const gen = (w.world as unknown as { gen: { settlements: { id: string; x: number; y: number }[] } }).gen;
    const fog = (w.world as unknown as { fog: { has: (x: number, y: number) => boolean } }).fog;
    const dark = gen.settlements.find((x) => !fog.has(x.x, x.y));
    expect(dark, 'разведан не весь мир').toBeTruthy();

    save.letters.push({
      id: 'L-dark',
      kind: 'pact',
      at: w.now(),
      until: w.now() + LETTER_TTL,
      fromId: dark!.id,
      fromName: 'Далёкий двор',
      cost: {},
    });
    const view = (await w.world.letters()).find((x) => x.id === 'L-dark');
    expect(view, 'письмо на столе').toBeTruthy();
    expect(view!.from, 'место у него есть').toBeTruthy();
    expect(view!.from!.cell, 'но клетки неразведанного не отдают').toBe(null);
    expect(view!.from!.cells, 'остаются румб и расстояние').toBeGreaterThan(0);
    expect(RHUMB_WORDS[view!.from!.rhumb]).toBeTruthy();
  });

  it('лупа не отвечает за игрока и не трогает стол', () => {
    const src = readFileSync(join(__dirname, 'store.ts'), 'utf8');
    // Именно реализация, а не строка в объявлении стора: `lastIndexOf`.
    const spot = src.slice(src.lastIndexOf('spotLetter: ('), src.lastIndexOf('leaveMap: ('));
    expect(spot.length, 'кнопка лупы найдена в сторе').toBeGreaterThan(0);
    // Ни ответа, ни переписывания стола: письмо всё это время лежит у мира.
    expect(spot.includes('answerLetter'), 'ответа лупа не даёт').toBe(false);
    expect(spot.includes('letters:'), 'стол лупа не переписывает').toBe(false);
    // А возврат обязан вернуть карточку — иначе уход посмотреть стоил бы письма.
    const back = src.slice(src.lastIndexOf('leaveMap: ('));
    expect(back.slice(0, 400).includes('openLetter: back'), 'с карты возвращаются к тому же письму').toBe(true);
  });

  it('уход на карту письма не трогает: ни ответа, ни срока, ни строки в летописи', async () => {
    const w = makeWorld(21);
    await pulse(w);
    const l = await waitLetter(w);

    // Лупа — дело интерфейса: она закрывает карточку и открывает карту. Мир при
    // этом не спрашивают вовсе, и проверяется это тем, что стол не изменился.
    const before = await w.world.letters();
    w.at(w.now() + 60_000);
    const texts = await pulse(w);
    const after = await w.world.letters();
    const same = after.find((x) => x.id === l.id);
    expect(same, 'письмо на месте').toBeTruthy();
    expect(same!.until, 'срок идёт как шёл').toBe(l.until);
    expect(before.length).toBe(after.length);
    expect(texts.some((t) => t.includes(l.fromName)), 'в летопись ничего не ушло').toBe(false);
  });
});
