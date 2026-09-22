// Гейт: одна дверь, выводимое правило, трата очков и засчитывание пройденного.
//
// Области, где правила вообще спрашиваются, названы в самих тестах (CLAUDE.md, правило 11):
// - «закрыто» спрашивается только у гейтованных ступеней: у негейтованного места правило
//   не действует, и точка на нём была бы зелёной при любом коде;
// - трата очков — только там, где очков **хватает**: отказ по нехватке проверяется своей
//   точкой, иначе «не списалось» и «нечего списывать» неразличимы;
// - засчитывание — на партии, у которой место **есть**: на новой доказывать нечего.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInitialState, SAVE_VERSION } from '../state';
import { deserialize, serialize } from '../save';
import { BRANCH_BUILT, DIPLO_LEVELS, DIPLO_RUNGS, POINTS_CAP, REALM_BRANCHES, diploLevelOf, levelPrice, levelsOf, startingPoints } from '../data/realm';
import { LETTER_DECISIONS } from '@/world/letters';
import { FIGURE_IDS } from '@/world/data/figures';
import { EVENT_BY_ID, EVENTS } from '../data/events';
import { creditTech, mailSlots, mailSlotsAt, placeBlock, placeOpen, study, studyInfo, techBlock, techGains, techLevel, techOpen } from './tech';
import { pointsOf, spend } from './points';
import { hireInfo } from './hire';
import { raiseEvent } from './mail';
import { settleHires } from './hire';
import { dynastyStep } from './dynasty';
import type { GameState } from '../types';

/** Новая партия с названной верой: имена есть, ветви — на первом уровне. */
function party(seed = 7): GameState {
  const s = createInitialState(seed);
  s.faith.id = 'catholic';
  settleHires(s);
  dynastyStep(s);
  return s;
}

/** Партия, у которой ветвь изучена до уровня `to`: покупкой, а не подстановкой. */
function studied(to: number, seed = 7): GameState {
  const s = party(seed);
  while (techLevel(s, 'diplo') < to) {
    // Очки копятся сами: двигаем часы деревни, а не пишем число в партию.
    s.time += 400 * 60;
    expect(study(s, 'diplo'), `ступень ${techLevel(s, 'diplo') + 1}`).toBeNull();
  }
  return s;
}

describe('гейт: одна дверь на показ и на запрет', () => {
  /**
   * Показ и запрет обязаны читать одно. Область, где правило спрашивается, — гейтованные
   * ступени: у разведчика, дипломата и полководца гейта нет вовсе, и точка на них зелёная
   * при любом коде, поэтому они здесь стоят **контрольными**, а не доказательством.
   */
  it('отказ найма — та же строка, что показывает ступень, и только у гейтованных мест', () => {
    const s = party();
    const gated = FIGURE_IDS.filter((id) => (DIPLO_RUNGS as readonly string[]).includes(id));
    expect(gated, 'точка внутри области: гейтованное место есть').toEqual(['spy']);

    for (const id of FIGURE_IDS) {
      // Для фигуры спрашивают `placeBlock` — типизованную дверь места, а не ступени:
      // каст к ключу ступени увёл бы проверку мимо того правила, которое она держит.
      const gate = placeBlock(s, id);
      if (gated.includes(id)) {
        expect(placeOpen(s, id), `${id}: у новой партии место закрыто`).toBe(false);
        expect(gate, `${id}: причина названа словами`).toBeTruthy();
        expect(gate, `${id}: и это та же строка, что у самой ступени`).toBe(techBlock(s, 'spy'));
        expect(hireInfo(s, id).blocked, `${id}: отказ найма — та же строка`).toBe(gate);
      } else {
        expect(placeOpen(s, id), `${id}: гейта нет`).toBe(true);
        expect(gate, `${id}: закрывать нечего`).toBeNull();
      }
    }

    // Ступень куплена — и та же дверь отпирает и место, и найм.
    const open = studied(diploLevelOf('spy'));
    expect(placeOpen(open, 'spy')).toBe(true);
    expect(techBlock(open, 'spy')).toBeNull();
    open.gold = 1_000_000;
    expect(hireInfo(open, 'spy').blocked, 'открытое место нанимается').toBeNull();
  });

  /** Уровень ступени выводится из места в списке ветви, а не пишется рядом. */
  it('уровень ступени — место в списке, и лестница монотонна', () => {
    DIPLO_RUNGS.forEach((rung, i) => expect(diploLevelOf(rung), rung).toBe(i + 2));
    expect(levelsOf('diplo')).toBe(DIPLO_LEVELS);
    expect(DIPLO_LEVELS, 'бесплатная ступень плюс живые').toBe(DIPLO_RUNGS.length + 1);
    // Открытое на уровне L открыто и на всех выше: иначе покупка отнимала бы.
    for (const rung of DIPLO_RUNGS) {
      for (let l = 1; l <= DIPLO_LEVELS; l++) {
        const s = party();
        s.realm.tech.diplo = l;
        expect(techOpen(s, rung), `${rung} на уровне ${l}`).toBe(l >= diploLevelOf(rung));
      }
    }
  });

  /**
   * Что даст уровень — **замером**: то, что ступень назвала, обязано и правда измениться.
   * Подпись, написанная рядом, разошлась бы с правилом; здесь она сверяется с дверьми.
   */
  it('что открывает ступень, сходится с тем, что после неё открылось', () => {
    for (let l = 1; l < DIPLO_LEVELS; l++) {
      const before = studied(l);
      const gains = techGains('diplo', l);
      expect(gains.length, `у ступени ${l + 1} есть что открыть`).toBeGreaterThan(0);
      const after = studied(l + 1);
      const grewPlaces = FIGURE_IDS.filter((id) => placeOpen(after, id)).length - FIGURE_IDS.filter((id) => placeOpen(before, id)).length;
      const grewSlots = mailSlots(after) - mailSlots(before);
      expect(grewPlaces + grewSlots, `ступень ${l + 1} и правда что-то открыла`).toBe(gains.length);
      if (grewPlaces > 0) expect(gains.join(' ')).toMatch(/Место в игре/);
      if (grewSlots > 0) expect(gains.join(' ')).toMatch(/Стол донесений/);
    }
  });
});

describe('трата очков', () => {
  /** Точка внутри области: очков хватает ровно на ступень — новая партия так и начинает. */
  it('изучение списывает ровно цену и поднимает уровень на одну ступень', () => {
    const s = party();
    const price = levelPrice('diplo', 2);
    expect(pointsOf(s, 'diplo'), 'точка внутри области: очков ровно на ступень').toBe(startingPoints('diplo'));
    expect(price).toBe(startingPoints('diplo'));

    expect(study(s, 'diplo')).toBeNull();
    expect(techLevel(s, 'diplo'), 'уровень вырос на одну ступень').toBe(2);
    expect(pointsOf(s, 'diplo'), 'очки списаны ровно на цену').toBeCloseTo(0, 6);
    expect(s.log.some((e) => e.text.includes('Изучен 2 уровень')), 'о покупке сказано строкой').toBe(true);
  });

  /** Без очков ступень не покупается, и уровень при отказе не двигается. */
  it('не хватает очков — отказ словами, и ничего не меняется', () => {
    const s = studied(2);
    const level = techLevel(s, 'diplo');
    const info = studyInfo(s, 'diplo');
    expect(info.price, 'следующая ступень дороже того, что есть').toBeGreaterThan(pointsOf(s, 'diplo'));
    expect(study(s, 'diplo')).toMatch(/Не хватает очков/);
    expect(techLevel(s, 'diplo'), 'уровень не сдвинулся').toBe(level);
  });

  /**
   * Трата у потолка — то место, где забытый `bank` виден. Очки стоят у потолка, ступень
   * покупается, и следующее же чтение **не возвращает** потраченное: без перекладки базы
   * потолок затянул бы их обратно, и уровень достался бы даром.
   */
  it('потраченное у потолка не возвращается следующим чтением', () => {
    const s = party();
    s.realm.ruler.skills.diplo = 5;
    s.time += POINTS_CAP * 60;
    expect(pointsOf(s, 'diplo'), 'точка внутри области: стоим ровно у потолка').toBe(POINTS_CAP);
    const price = levelPrice('diplo', 2);
    expect(spend(s, 'diplo', price)).toBe(true);
    expect(pointsOf(s, 'diplo'), 'сразу после траты').toBeCloseTo(POINTS_CAP - price, 6);
    // Час спустя приток идёт от списанного, а не от потолка.
    s.time += 60;
    expect(pointsOf(s, 'diplo'), 'через игровой день').toBeCloseTo(POINTS_CAP - price + 5, 6);
  });

  it('непостроенная ветвь не покупается, и сказано это прямо', () => {
    const s = party();
    for (const b of REALM_BRANCHES) {
      if (BRANCH_BUILT[b]) continue;
      s.realm.points[b] = POINTS_CAP;
      s.realm.pointsAt = s.time;
      expect(studyInfo(s, b).blocked, `${b}: ещё не построена`).toMatch(/не построена/);
      expect(study(s, b), `${b}: и не покупается`).toMatch(/не построена/);
      expect(techLevel(s, b), `${b}: уровень на месте`).toBe(1);
    }
  });

  it('изученная целиком ветвь больше ничего не продаёт', () => {
    const s = studied(DIPLO_LEVELS);
    expect(studyInfo(s, 'diplo').next).toBe(0);
    expect(study(s, 'diplo')).toMatch(/изучена целиком/);
  });
});

describe('стол донесений растёт ступенью', () => {
  it('ячейка ровно одна, и вытесняет стол по открытому числу', () => {
    const closed = party();
    const open = studied(diploLevelOf('letterSlot'));
    expect(mailSlots(closed), 'до ступени — стол писем мира').toBe(LETTER_DECISIONS);
    expect(mailSlots(open), 'ступень даёт ровно одну ячейку').toBe(LETTER_DECISIONS + 1);
    expect(mailSlotsAt(1), 'по уровню считается тем же правилом').toBe(LETTER_DECISIONS);

    // Событий кладут больше, чем ячеек: у закрытого стола лишнее сгоняется, у открытого — нет.
    const kinds = EVENTS.filter((e) => !EVENT_BY_ID[e.id]?.silence === false).map((e) => e.id);
    expect(kinds.length, 'точка внутри области: видов хватает, чтобы переполнить стол').toBeGreaterThan(LETTER_DECISIONS + 1);
    for (const s of [closed, open]) {
      for (let i = 0; i < LETTER_DECISIONS + 1; i++) {
        raiseEvent(s, kinds[i]);
        s.inbox[s.inbox.length - 1].until = 1e12 + i;
      }
    }
    expect(closed.inbox.length, 'закрытый стол не вырос сверх своего').toBe(LETTER_DECISIONS);
    expect(open.inbox.length, 'открытая ячейка приняла лишнее').toBe(LETTER_DECISIONS + 1);
  });
});

describe('начатая партия: засчитывается пройденное', () => {
  /**
   * Область, где правило спрашивается: партия, у которой место **есть**. На новой
   * доказывать нечего, и точка на ней прошла бы при любом коде — поэтому она здесь стоит
   * второй, обратной проверкой.
   */
  it('приведённой партии место лазутчика не отнимают, и сказано об этом строкой', () => {
    const before = party();
    before.time = 500 * 60;
    // Так выглядела запись до гейта: место лазутчика было у каждой партии.
    before.agents.spy.vacant = false;
    expect(before.agents.spy.vacant, 'точка внутри области: у записи место занято').toBe(false);
    const raw = JSON.parse(serialize(before)) as Record<string, unknown>;
    raw.version = 17;
    (raw.realm as { tech: Record<string, number> }).tech.diplo = 1;

    const s = deserialize(JSON.stringify(raw));
    expect(s).not.toBeNull();
    expect(s!.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION, 'ступень поднимает версию: умолчания тут мало').toBe(18);
    expect(techLevel(s!, 'diplo'), 'ступень засчитана').toBe(diploLevelOf('spy'));
    expect(placeOpen(s!, 'spy'), 'место осталось при племени').toBe(true);
    expect(s!.log.some((e) => e.text.includes('Место лазутчика засчитано')), 'о засчитанном сказано').toBe(true);
    expect(s!.log.some((e) => e.text.includes('открылись «Технологии»')), 'и о самих технологиях').toBe(true);
    // Даром ветвь не проходится: третья ступень остаётся непокупленной.
    expect(techLevel(s!, 'diplo'), 'засчитали ровно пройденное').toBeLessThan(DIPLO_LEVELS);
  });

  it('новой партии засчитывать нечего: доказательства нет', () => {
    const s = party();
    expect(creditTech(s), 'нечего засчитывать').toEqual([]);
    expect(techLevel(s, 'diplo')).toBe(1);
    // А сыгранной — есть: место занято, и это само доказательство.
    s.agents.spy.vacant = false;
    expect(creditTech(s)).toEqual(['diplo']);
    expect(techLevel(s, 'diplo')).toBe(diploLevelOf('spy'));
  });

  it('засчитывание только поднимает уровень и никогда не опускает', () => {
    const s = studied(DIPLO_LEVELS);
    expect(creditTech(s), 'выше засчитанного не трогает').toEqual([]);
    expect(techLevel(s, 'diplo')).toBe(DIPLO_LEVELS);
  });
});

// ---------- Замки по исходникам ----------

const SRC = join(process.cwd(), 'src');

function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
  };
  walk(SRC);
  return out;
}

const bare = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('замки гейта', () => {
  /**
   * **Рукописного поля `requiresTech` нет ни у здания, ни у бойца, ни у вещи, ни у
   * агента** (решение владельца 1, docs/dynasty.md, раздел 10.1). Список, написанный
   * рукой, разойдётся с лестницей при первом же новом виде, и не заметит этого никто.
   * Мутация: приписать такое поле любому определению контента — тест падает здесь.
   */
  it('объявления контента не ссылаются на уровень технологии руками', () => {
    const bad: string[] = [];
    for (const file of sources()) {
      if (/requiresTech|techRequired|requiresTechnology|minTech|techLevelRequired/i.test(bare(file))) bad.push(file);
    }
    expect(bad, 'рукописная ссылка на уровень технологии').toEqual([]);
  });

  /**
   * Правило открытия выводится в одном месте. Кто считает «открыто ли» сам — заводит
   * вторую правду: показ обещает одно, запрет делает другое, и расходятся они молча.
   */
  it('лестницу ветви читает только дверь гейта', () => {
    // Дверь и модуль чисел, где лестница объявлена. Всё остальное спрашивает дверь.
    const allowed = [join('src', 'game', 'sim', 'tech.ts'), join('src', 'game', 'data', 'realm.ts')];
    const bad: string[] = [];
    for (const file of sources()) {
      if (allowed.some((a) => file.endsWith(a))) continue;
      if (/\bdiploLevelOf\b|\bopenAtLevel\b|\bmailSlotsAt\b|\bplaceOpenAt\b/.test(bare(file))) bad.push(file);
    }
    expect(bad, 'открытость считают мимо двери').toEqual([]);
  });

  /**
   * Проводка первых шагов ведёт через кузницу, казармы, карту и **разведчика** — ни одна
   * её ступень не упирается в гейт, и это проверяется, а не наблюдается: припиши шагу
   * гейтованное место — и правку обучения придётся сделать в той же пачке, что и гейт
   * (решение владельца 7, docs/dynasty.md, раздел 6.1).
   */
  it('проводка первых шагов не упирается в гейт', () => {
    const src = bare(join(SRC, 'game', 'data', 'tutorial.ts'));
    for (const rung of DIPLO_RUNGS) {
      expect(src.includes(`'${rung}'`), `обучение уткнулось в закрытое: ${rung}`).toBe(false);
    }
    expect(src.includes("'scout'") || src.includes('scoutsAway'), 'точка внутри области: обучение и правда про агента').toBe(true);
  });

  /** Очки списывает одна дверь: уменьшать `realm.points` может только `sim/points`. */
  it('очки списывает одна дверь', () => {
    const allowed = [join('src', 'game', 'sim', 'points.ts')];
    const bad: string[] = [];
    for (const file of sources()) {
      if (allowed.some((a) => file.endsWith(a))) continue;
      if (/realm\??\.points\s*\[[^\]]*\]\s*(-=|=)/.test(bare(file))) bad.push(file);
    }
    expect(bad, 'очки правят мимо двери траты').toEqual([]);
  });
});
