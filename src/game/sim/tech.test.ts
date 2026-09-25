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
import { deserialize, enter, serialize } from '../save';
import {
  ADMIN_LEVELS,
  BRANCH_BUILT,
  DIPLO_LEVELS,
  MASTERS_AT,
  DIPLO_RUNGS,
  POINTS_CAP,
  REALM_BRANCHES,
  WAR_CAPTIVES_LEVEL,
  WAR_FATES,
  WAR_GEAR_ORDER,
  WAR_LEVELS,
  diploLevelOf,
  levelPrice,
  levelsOf,
  startingPoints,
  warLevelOfGear,
} from '../data/realm';
import { EQUIPMENT, EQUIPMENT_IDS } from '../data/equipment';
import { BUILDING_BY_ID, slotsAt } from '../data/buildings';
import { maxLevelFor } from '../derived';
import { TROOP_BY_ID, TROOP_IDS } from '../data/troops';
import { RESOURCE_IDS } from '../constants';
import { TUTORIAL, advanceTutorial, type TutorialUi } from '../data/tutorial';
import { forgeCheck, startForge } from './smithy';
import { recruitCheck } from './army';
import { LETTER_DECISIONS } from '@/world/letters';
import { FIGURE_IDS } from '@/world/data/figures';
import { EVENT_BY_ID, EVENTS } from '../data/events';
import {
  creditTech,
  fateLocks,
  fateOpen,
  fateOpenAt,
  gearBlock,
  gearOpen,
  gearOpenAt,
  levelName,
  mailSlots,
  mailSlotsAt,
  mastersBlock,
  mastersCap,
  mastersCapAt,
  placeBlock,
  placeOpen,
  study,
  studyInfo,
  techBlock,
  techGains,
  techLevel,
  techOpen,
  troopBlock,
  troopOpenAt,
} from './tech';
import { pointsOf, spend } from './points';
import { hireInfo } from './hire';
import { raiseEvent } from './mail';
import { settleHires } from './hire';
import { dynastyStep } from './dynasty';
import { playerProfile } from '@/world/bridge';
import { FATE_IDS } from '@/world/spoils';
import type { EquipmentId, GameState } from '../types';

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

/** То же для военной ветви: ступени покупаются дверью, очки копятся часами деревни. */
function warStudied(to: number, seed = 7): GameState {
  const s = party(seed);
  while (techLevel(s, 'war') < to) {
    s.time += 400 * 60;
    expect(study(s, 'war'), `ступень ${techLevel(s, 'war') + 1}`).toBeNull();
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
    // Падеж — из `BRANCH_OF`: прежде строка брала название ветви в именительном и писала
    // «Изучен 2 уровень дипломатическая ветви».
    expect(s.log.some((e) => e.text.includes('Изучен 2 уровень дипломатической ветви')), 'о покупке сказано строкой').toBe(true);
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

  /**
   * Правило спрашивается только у непостроенной ветви. Когда построены все три, перебор
   * «непостроенных» пуст, и тест был бы зелёным при любом коде (правило 11). Поэтому ветвь
   * на время теста закрывается, и что она правда закрыта, — утверждение в самом тесте.
   */
  it('непостроенная ветвь не покупается, и сказано это прямо', () => {
    for (const b of REALM_BRANCHES) {
      const was = BRANCH_BUILT[b];
      BRANCH_BUILT[b] = false;
      try {
        const s = party();
        expect(BRANCH_BUILT[b], `${b}: точка внутри области — ветвь закрыта`).toBe(false);
        s.realm.points[b] = POINTS_CAP;
        s.realm.pointsAt = s.time;
        expect(studyInfo(s, b).blocked, `${b}: ещё не построена`).toMatch(/не построена/);
        expect(study(s, b), `${b}: и не покупается`).toMatch(/не построена/);
        expect(techLevel(s, b), `${b}: уровень на месте`).toBe(1);
      } finally {
        BRANCH_BUILT[b] = was;
      }
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
    // Ступень 17 → 18 подняла версию — выше её поднимали другие пачки, и точное число
    // держит их тест (ниже, «военная ветвь по самой дорогой вещи»). Здесь важно другое:
    // запись семнадцатой версии приезжает засчитанной, а не с умолчанием.
    expect(SAVE_VERSION, 'ступень подняла версию: умолчания тут мало').toBeGreaterThan(17);
    expect(techLevel(s!, 'diplo'), 'ступень засчитана').toBe(diploLevelOf('spy'));
    expect(placeOpen(s!, 'spy'), 'место осталось при племени').toBe(true);
    // Строки ступеней ложатся в летопись при входе, после догона отлучки (`save.enter`); вход — сразу после записи.
    enter(s!, s!.lastSaved);
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
      if (/\bmastersAt\b|\bmastersCapAt\b|\bdiploLevelOf\b|\bopenAtLevel\b|\bmailSlotsAt\b|\bplaceOpenAt\b|\bwarLevelOfGear\b|\bwarLevelOfTroop\b|\bgearOpenAt\b|\btroopOpenAt\b|\bwarLevelOfFate\b|\bfateOpenAt\b/.test(bare(file))) bad.push(file);
    }
    expect(bad, 'открытость считают мимо двери').toEqual([]);
  });

  /**
   * Проводка первых шагов ведёт через разведчика — место, которого гейт не закрывает.
   * Уткнись она в закрытое **место агента**, новичок застрял бы навсегда: мест по ходу
   * обучения не покупают. Про закрытую **вещь** правило другое — обучение открывает её
   * само, своим шагом, и это проверено прогоном («проводка первых шагов под гейтом»).
   */
  it('проводка первых шагов не упирается в закрытое место агента', () => {
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

// ---------- Военная ветвь ----------

describe('военная ветвь: лестница выводится, а не пишется', () => {
  /**
   * Правило ветви целиком: **вид открыт, когда открыто всё, что он носит**. Проверяется
   * на каждом уровне и у каждого вида, а не на одном примере.
   *
   * Область, где правило вообще что-то значит, названа прямо: нужен вид, носящий больше
   * одной вещи, — иначе «всё, что носит» неотличимо от «единственной вещи», и мутация
   * «брать не самую позднюю вещь, а первую» прошла бы зелёной.
   */
  it('вид открыт ровно тогда, когда открыты все его вещи', () => {
    const many = TROOP_IDS.filter((t) => Object.values(TROOP_BY_ID[t].gear).filter((n) => (n ?? 0) > 0).length > 1);
    expect(many.length, 'точка внутри области: есть вид, носящий больше одной вещи').toBeGreaterThan(0);

    for (let level = 1; level <= WAR_LEVELS; level++) {
      for (const t of TROOP_IDS) {
        const worn = (Object.keys(TROOP_BY_ID[t].gear) as EquipmentId[]).filter((i) => (TROOP_BY_ID[t].gear[i] ?? 0) > 0);
        const allOpen = worn.every((i) => gearOpenAt(level, i));
        expect(troopOpenAt(level, t), `${t} на уровне ${level}: носит ${worn.join(', ') || 'ничего'}`).toBe(allOpen);
      }
    }
  });

  /** Вещи идут в порядке работы горна, и первая из них — на втором уровне. */
  it('уровень вещи — её место в порядке работы, и лестница монотонна', () => {
    const byWork = [...EQUIPMENT].sort((a, b) => a.work - b.work || (a.id < b.id ? -1 : 1));
    byWork.forEach((e, i) => expect(warLevelOfGear(e.id), e.id).toBe(i + 2));
    expect(WAR_LEVELS, 'бесплатная ступень, по одной на вещь и участь').toBe(EQUIPMENT.length + 2);
    // Дубинщик снаряжения не просит и открыт с первой секунды — это и есть первый уровень.
    expect(troopOpenAt(1, 'clubman'), 'на первом уровне — дубинщики').toBe(true);
    expect(TROOP_IDS.filter((t) => troopOpenAt(1, t)), 'и только они').toEqual(['clubman']);
  });

  /**
   * Показ и запрет читают одно — и у кузницы, и у казарм. Область: закрытая вещь и
   * закрытый вид; дубинщик стоит контрольным (на нём правило не спрашивается вовсе).
   */
  it('отказ кузницы и отказ казарм — та же строка, что показывает ступень', () => {
    const s = party();
    s.gold = 1_000_000;
    for (const r of RESOURCE_IDS) s.resources[r] = 1_000_000;
    expect(techLevel(s, 'war'), 'точка внутри области: новая партия на первом уровне').toBe(1);

    for (const item of EQUIPMENT_IDS) {
      const gate = gearBlock(s, item);
      expect(gate, `${item}: на первом уровне закрыто`).toBeTruthy();
      expect(forgeCheck(s, item, 1).blocked, `${item}: отказ кузницы — та же строка`).toBe(gate);
    }
    for (const t of TROOP_IDS) {
      const gate = troopBlock(s, t);
      if (t === 'clubman') {
        expect(gate, 'дубинщик открыт: закрывать нечего').toBeNull();
        continue;
      }
      expect(gate, `${t}: на первом уровне закрыто`).toBeTruthy();
      expect(recruitCheck(s, t, 1).blocked, `${t}: отказ казарм — та же строка`).toBe(gate);
    }
  });

  /**
   * **Одна дверь к тяжёлой коннице** (решение владельца 3). Конюшня её больше не
   * открывает: на десятом уровне конюшни латных всадников не нанять, пока не изучен
   * доспех, — и гейт молчит, как только он изучен, даже при конюшне первого уровня.
   * Мутация «вернуть проверку уровня конюшни» роняет вторую половину.
   */
  it('латных всадников открывает доспех, а не уровень конюшни', () => {
    const put = (s: GameState, level: number): void => {
      const b = s.buildings.find((x) => x.type === 'stable');
      if (b) b.level = level;
    };
    // Конюшня на потолке, ветвь на первом уровне — отказ от гейта, а не от здания.
    const closed = party();
    put(closed, 10);
    expect(recruitCheck(closed, 'knight', 1).blocked, 'конюшня на потолке не открывает латных').toBe(troopBlock(closed, 'knight'));
    expect(troopBlock(closed, 'knight'), 'и причина — военная ветвь').toMatch(/военной ветви/);

    // Доспех изучен, конюшня на первом уровне — гейт молчит, и дальше дело за стойлами,
    // жителями и снаряжением, а не за уровнем здания.
    const open = warStudied(warLevelOfGear('armor'));
    put(open, 1);
    expect(troopBlock(open, 'knight'), 'доспех изучен — гейт молчит').toBeNull();
    expect(recruitCheck(open, 'knight', 1).blocked ?? '', 'и уровня конюшни в отказе нет').not.toMatch(/конюшни/);
  });

  /** Ключи гейта не пересекаются: вещь, вид, участь и ступень дипломатии зовутся по-разному. */
  it('ключи гейта не пересекаются', () => {
    const all = [...EQUIPMENT_IDS, ...TROOP_IDS, ...DIPLO_RUNGS, ...WAR_FATES] as string[];
    expect(new Set(all).size, 'одно имя на два смысла').toBe(all.length);
  });

  /**
   * Что даст ступень — замером: названное обязано и правда открыться. Вещи и участи
   * проверяются каждая своей дверью: ступень вещи открывает вещь, ступень участи — участь,
   * и ни одна ступень не открывает ничего.
   */
  it('что открывает ступень военной ветви, сходится с тем, что после неё открылось', () => {
    for (let l = 1; l < WAR_LEVELS; l++) {
      const gains = techGains('war', l);
      expect(gains.length, `у ступени ${l + 1} есть что открыть`).toBeGreaterThan(0);
      const grewGear = EQUIPMENT_IDS.filter((i) => gearOpenAt(l + 1, i)).length - EQUIPMENT_IDS.filter((i) => gearOpenAt(l, i)).length;
      const grewTroops = TROOP_IDS.filter((t) => troopOpenAt(l + 1, t)).length - TROOP_IDS.filter((t) => troopOpenAt(l, t)).length;
      const grewFates = FATE_IDS.filter((f) => fateOpenAt(l + 1, f)).length - FATE_IDS.filter((f) => fateOpenAt(l, f)).length;
      expect(grewGear + grewFates, `ступень ${l + 1} и правда открыла вещь или участь`).toBe(1);
      if (grewGear > 0) expect(gains.join(' ')).toMatch(/Кузница/);
      if (grewTroops > 0) expect(gains.join(' ')).toMatch(/Войско/);
      if (grewFates > 0) expect(gains.join(' ')).toMatch(/Участь взятого города: увести людей/);
    }
  });

  /**
   * **Ступень участи подключена и продаётся** (решение владельца по docs/dynasty.md,
   * раздел 11.2). Область: ветвь изучена до последней вещи, участь закрыта, и очков на
   * ступень хватает — иначе «не продаётся» и «не на что купить» неразличимы.
   *
   * Показ и запрет читают одно: строка, которая едет в мир слепком и которой мир отказывает
   * приказу, — та же, что у ступени в «Технологиях». Мутации: `fateLocks` без участи → падает
   * «до покупки участь заперта»; мост без замков → падает «слепок везёт замок».
   */
  it('ступень участи продаётся, и её замок едет в мир той же строкой', () => {
    expect(WAR_CAPTIVES_LEVEL, 'участь — верх ветви, за последней вещью').toBe(WAR_LEVELS);
    expect(WAR_CAPTIVES_LEVEL - 1, 'и последняя вещь стоит ступенью ниже').toBe(warLevelOfGear(WAR_GEAR_ORDER[WAR_GEAR_ORDER.length - 1]));

    const s = warStudied(WAR_CAPTIVES_LEVEL - 1);
    expect(fateOpen(s, 'captives'), 'точка внутри области: вещи изучены, участь закрыта').toBe(false);
    expect(fateOpen(s, 'plunder'), '«ограбить» гейтом не закрыто: с него партия начинается').toBe(true);
    const lock = techBlock(s, 'captives');
    expect(lock, 'причина названа словами').toMatch(/увести людей.*8 уровень военной ветви/);
    expect(fateLocks(s), 'до покупки участь заперта — той же строкой').toEqual({ captives: lock });
    expect(playerProfile(s).fateLocks, 'слепок везёт замок в мир').toEqual({ captives: lock });

    s.realm.points.war = POINTS_CAP;
    s.realm.pointsAt = s.time;
    expect(studyInfo(s, 'war').next, 'покупается восьмая').toBe(WAR_CAPTIVES_LEVEL);
    expect(study(s, 'war')).toBeNull();
    expect(techLevel(s, 'war')).toBe(WAR_CAPTIVES_LEVEL);
    expect(fateOpen(s, 'captives'), 'купил — открыто').toBe(true);
    expect(fateLocks(s), 'запирать нечего').toEqual({});
    expect('fateLocks' in playerProfile(s), 'и слепок тот же, что до гейта участи: поля нет вовсе').toBe(false);
    expect(studyInfo(s, 'war').blocked, 'дальше продавать нечего').toMatch(/изучена целиком/);
  });
});

describe('начатая партия: военная ветвь по самой дорогой вещи', () => {
  /** Запись до ступени 19: та же партия, но `tech.war` лежит первым уровнем. */
  const aged = (make: (s: GameState) => void): GameState => {
    const before = party();
    before.time = 500 * 60;
    make(before);
    const raw = JSON.parse(serialize(before)) as Record<string, unknown>;
    raw.version = 18;
    (raw.realm as { tech: Record<string, number> }).tech.war = 1;
    const s = deserialize(JSON.stringify(raw));
    expect(s).not.toBeNull();
    return s as GameState;
  };

  it('засчитывается самая дорогая вещь, и ни ступенью выше', () => {
    expect(SAVE_VERSION, 'ступень поднимает версию: умолчания тут мало').toBeGreaterThanOrEqual(19);
    // Точка внутри области: у вещей и правда разные уровни, иначе «самая дорогая» — пустые слова.
    expect(warLevelOfGear('armor')).toBeGreaterThan(warLevelOfGear('spear'));

    const spears = aged((s) => {
      s.equipment.spear = 3;
    });
    expect(techLevel(spears, 'war'), 'копьё на складе — его уровень').toBe(warLevelOfGear('spear'));

    const armor = aged((s) => {
      s.equipment.spear = 3;
      s.equipment.armor = 1;
    });
    expect(techLevel(armor, 'war'), 'доспех на складе — его уровень').toBe(warLevelOfGear('armor'));
    expect(techLevel(armor, 'war'), 'и ни ступенью выше: даром ветвь не проходится').toBeLessThan(levelsOf('war'));

    const empty = aged(() => {});
    expect(techLevel(empty, 'war'), 'кованого нет — засчитывать нечего').toBe(1);
    // Строки ступеней ложатся в летопись при входе, после догона отлучки (`save.enter`); вход — сразу после записи.
    enter(empty, empty.lastSaved);
    expect(empty.log.some((e) => e.text.includes('Военная ветвь начинается с первого уровня')), 'и сказано об этом').toBe(true);
  });

  /**
   * Вещь доказывается не только складом: она на бойце, в заказе, в очереди казарм, в
   * лазарете и в поле. Каждое место — своя точка, и каждая обязана доказать сама.
   */
  it('вещь доказывают и склад, и заказ, и дружина — дома, в поле, в лазарете и на учениях', () => {
    const level = warLevelOfGear('armor');
    const places: [string, (s: GameState) => void][] = [
      ['склад', (s) => { s.equipment.armor = 1; }],
      ['заказ кузницы', (s) => { s.forge.push({ id: 1, item: 'armor', count: 2, done: 0, work: 0 }); }],
      ['дружина дома', (s) => { s.army.legionary = 1; }],
      ['дружина в поле', (s) => { s.away.legionary = 1; }],
      ['учения', (s) => { s.recruits.push({ id: 2, troop: 'legionary', count: 1, done: 0, work: 0, people: 1 }); }],
      ['лазарет', (s) => { s.wounded.push({ troops: { legionary: 1 }, until: null }); }],
    ];
    for (const [what, put] of places) {
      expect(techLevel(aged(put), 'war'), `${what}: доспех засчитан`).toBe(level);
    }
    // Обратная точка: партия, у которой этих вещей нет, не доказывает ничего.
    expect(techLevel(aged(() => {}), 'war')).toBe(1);
  });

  it('засчитывание только поднимает уровень военной ветви и никогда не опускает', () => {
    const s = warStudied(WAR_LEVELS);
    expect(creditTech(s), 'выше засчитанного не трогает').toEqual([]);
    expect(techLevel(s, 'war')).toBe(WAR_LEVELS);
  });

  /**
   * **Засчитывание доходит до седьмой ступени включительно — до последней вещи.** Каждая
   * вещь доказывает ровно свой уровень, и самая дорогая из них (доспех) — последний уровень
   * вещей, а не верх ветви. Область: у каждой вещи свой уровень, и верх вещей ниже верха
   * ветви, — иначе «ровно свой» и «до седьмой» были бы одним утверждением.
   * Мутации: `warLevelOfGear(item) + 1` в засчитывании → падает «spear — ровно свой
   * уровень»; «самая дорогая вещь доказывает верх ветви» → падает «armor — ровно свой уровень».
   */
  it('каждая вещь засчитывает ровно свой уровень, и выше седьмого засчитывание не идёт', () => {
    const top = warLevelOfGear(WAR_GEAR_ORDER[WAR_GEAR_ORDER.length - 1]);
    expect(top, 'точка внутри области: верх вещей — седьмая ступень').toBe(7);
    expect(top, 'и он ниже верха ветви').toBeLessThan(WAR_LEVELS);
    for (const item of EQUIPMENT_IDS) {
      const s = aged((x) => {
        x.equipment[item] = 1;
      });
      expect(techLevel(s, 'war'), `${item} — ровно свой уровень`).toBe(warLevelOfGear(item));
    }
    const all = aged((x) => {
      for (const item of EQUIPMENT_IDS) x.equipment[item] = 1;
      for (const t of TROOP_IDS) x.army[t] = 5;
    });
    expect(techLevel(all, 'war'), 'доспех — седьмой, а не восьмой').toBe(top);
  });

  /**
   * **Участь не засчитывается по доказательству — никакому** (решение владельца по
   * docs/dynasty.md, раздел 11.2). Правило «по самой дорогой вещи» — про вещи; у участи
   * доказательства в сохранении нет, и всякое, какое можно придумать, отдало бы вместе с ней
   * весь доспех. Здесь собраны все, что есть: вся кузница на складе, все виды в дружине,
   * выигранные битвы, невольники, запись до гейта (`hadAll`) — и участь остаётся закрытой.
   *
   * Мутации, каждая роняет своё утверждение: засчитать участь по победам
   * (`battlesWon > 0`) → «приведённая партия»; по `hadAll` → «прямое засчитывание с
   * `hadAll`»; по невольникам — там же, где победы.
   */
  it('участь не засчитывается никому: ни победами, ни невольниками, ни записью до гейта', () => {
    const proven = (x: GameState): void => {
      for (const item of EQUIPMENT_IDS) x.equipment[item] = 10;
      for (const t of TROOP_IDS) x.army[t] = 20;
      x.bonded = 40;
      x.profile.card.battlesWon = 30;
    };
    // Точка внутри области: доказательства и правда стоят в партии.
    const probe = party();
    proven(probe);
    expect(probe.profile.card.battlesWon, 'битвы выиграны').toBeGreaterThan(0);
    expect(probe.bonded, 'невольники есть').toBeGreaterThan(0);

    const old = aged(proven);
    expect(techLevel(old, 'war'), 'приведённая партия: вся ветвь до вещей — и ни ступенью выше').toBe(WAR_CAPTIVES_LEVEL - 1);
    expect(fateOpen(old, 'captives'), 'приведённая партия: участь закрыта').toBe(false);

    const direct = party();
    proven(direct);
    creditTech(direct, true);
    expect(techLevel(direct, 'war'), 'прямое засчитывание с `hadAll`: участь не засчитана').toBe(WAR_CAPTIVES_LEVEL - 1);
    expect(fateLocks(direct), 'и замок едет в мир').toEqual({ captives: techBlock(direct, 'captives') });
  });
});

describe('проводка первых шагов под гейтом', () => {
  /**
   * Шаг про копьё стоит на закрытой вещи, и обучение обязано открывать её само: иначе
   * новичок упирается в кузницу, которая на первом уровне не куёт ничего вовсе.
   *
   * Область названа прямо: у новой партии копьё и правда закрыто, а очков на ступень
   * ровно хватает, — без этого шаг был бы зелёным при любом коде.
   */
  it('новичок доходит до заказа копий: шаг «Технологии» открывает то, что он изучает', () => {
    const s = party();
    s.tutorialStep = TUTORIAL.findIndex((x) => x.id === 'tech');
    expect(s.tutorialStep, 'шаг про технологии есть').toBeGreaterThanOrEqual(0);
    expect(gearOpen(s, 'spear'), 'точка внутри области: копьё закрыто').toBe(false);
    expect(startForge(s, 'spear', 1), 'и кузница его не берёт').toMatch(/Ещё не изучено/);

    const ui: TutorialUi = { building: null, tab: null, mapOpen: false, worldTile: false };
    advanceTutorial(s, ui);
    expect(TUTORIAL[s.tutorialStep].id, 'шаг не проматывается сам').toBe('tech');

    expect(pointsOf(s, 'war'), 'очков ровно на ступень').toBe(levelPrice('war', 2));
    expect(study(s, 'war'), 'и она покупается').toBeNull();
    advanceTutorial(s, ui);
    expect(TUTORIAL[s.tutorialStep].id, 'дальше — заказ копий').toBe('forge');
    expect(startForge(s, 'spear', 1), 'и кузница его берёт').toBeNull();
  });
});

// ---------- Административная ветвь ----------

/** Партия, у которой административная ветвь стоит на уровне `level`. */
function adminAt(level: number, seed = 7): GameState {
  const s = party(seed);
  s.realm.tech.admin = level;
  expect(techLevel(s, 'admin'), 'уровень ветви поставлен').toBe(level);
  return s;
}

describe('административная ветвь: места наёмных мастеров выводятся из Мастерской', () => {
  /**
   * Ступень открывает ровно места одного уровня Мастерской, и длина ветви — длина её лестницы.
   * Проверяется на каждом уровне, а не на одном примере; область названа: ступеней больше двух,
   * иначе «на каждом уровне» сводилось бы к одной точке.
   */
  it('ступень — места одного уровня Мастерской, длина ветви — лестница Мастерской', () => {
    const hall = BUILDING_BY_ID[MASTERS_AT];
    expect(MASTERS_AT, 'мастера стоят в Мастерской').toBe('workshop');
    expect(ADMIN_LEVELS, 'длина ветви — бесплатная ступень плюс уровни Мастерской').toBe(1 + maxLevelFor(MASTERS_AT));
    expect(ADMIN_LEVELS, 'точка внутри области: ступеней больше двух').toBeGreaterThan(2);
    for (let l = 1; l <= ADMIN_LEVELS; l++) {
      expect(mastersCapAt(l), `уровень ${l}`).toBe(slotsAt(hall, l - 1));
    }
    expect(mastersCapAt(1), 'бесплатная ступень — то, с чем партия начинается: наёмных нет').toBe(0);
    expect(mastersCapAt(ADMIN_LEVELS), 'верх ветви — все места Мастерской на её потолке').toBe(
      slotsAt(hall, maxLevelFor(MASTERS_AT)),
    );
  });

  /**
   * Своего числа мест у ветви нет: лестница зовёт ту же формулу, что считает места здания.
   * Мутация «написать 6 × (уровень − 1)» прошла бы проверку выше — числа сейчас совпадают, —
   * и упала бы только здесь.
   */
  it('лестница мастеров не пишет числа мест сама', () => {
    const src = bare(join(SRC, 'game', 'data', 'realm.ts'));
    const at = src.indexOf('export const mastersAt');
    expect(at, 'объявление найдено').toBeGreaterThan(0);
    const body = src.slice(at, src.indexOf(';', at));
    expect(body, 'места — той же формулой, что у здания').toMatch(/\bslotsAt\(/);
    expect(body.replace(/\b[01]\b/g, ''), 'ни одного своего числа').not.toMatch(/\d/);
  });

  it('что открывает ступень — замером, и имя ступени оттуда же', () => {
    for (let l = 1; l < ADMIN_LEVELS; l++) {
      const gains = techGains('admin', l);
      expect(gains, `уровень ${l}: ступень что-то открывает`).toHaveLength(1);
      expect(gains[0], `уровень ${l}: называет числа двери`).toContain(`${mastersCapAt(l)} → ${mastersCapAt(l + 1)}`);
      expect(levelName('admin', l + 1), `имя ступени ${l + 1}`).toContain(String(mastersCapAt(l + 1)));
    }
    expect(techGains('admin', ADMIN_LEVELS), 'выше верха открывать нечего').toEqual([]);
  });

  /**
   * Отказ ветви говорит, какая ступень пустит ещё мастеров, — и молчит там, где правило не
   * спрашивается: в пределах открытого и на верху ветви (дальше решают места Мастерской).
   */
  /**
   * Ступень 20 → 21. Засчитывать нечего — наёмных мастеров не было ни у кого, — и отнимать нечего;
   * партия узнаёт о ветви строкой, и строка ложится при входе (после догона отлучки), называя те же
   * очки, что кнопка «Изучить». Область: запись и правда двадцатой версии, и очков у неё не ноль.
   */
  it('ступень 20 → 21: мастеров ноль, засчитывать нечего, о ветви сказано строкой при входе', () => {
    // Две точки: очков на ступень хватает и не хватает, — у строки две ветви, и спрошены обе.
    for (const rich of [true, false]) {
      const before = party();
      before.time = 500 * 60;
      const raw = JSON.parse(serialize(before)) as Record<string, unknown> & {
        realm: { points: Record<string, number>; pointsAt: number };
      };
      raw.version = 20;
      delete raw.masters;
      if (!rich) {
        raw.realm.points.admin = 0;
        raw.realm.pointsAt = before.time;
      }
      const s = deserialize(JSON.stringify(raw));
      expect(s).not.toBeNull();
      expect(s!.version).toBe(SAVE_VERSION);
      expect(SAVE_VERSION, 'точка внутри области: версия поднята этой ступенью').toBe(21);
      expect(s!.masters, 'мастеров у записи не было — приезжает ноль').toBe(0);
      expect(techLevel(s!, 'admin'), 'засчитывать нечего').toBe(1);
      expect(s!.log.some((e) => e.text.includes('административная ветвь')), 'до входа строки нет').toBe(false);
      enter(s!, s!.lastSaved);
      const info = studyInfo(s!, 'admin');
      expect(info.blocked === null, `точка внутри области: очков ${rich ? 'хватает' : 'не хватает'}`).toBe(rich);
      const line = s!.log.find((e) => e.text.includes('Построена административная ветвь'));
      expect(line, 'о ветви сказано строкой при входе').toBeTruthy();
      expect(line!.text, 'цена — та, что на кнопке').toContain(`из ${info.price} —`);
      expect(line!.text, 'и мест на ступень — столько, сколько откроет дверь').toContain(
        `по ${mastersCapAt(info.level + 1) - mastersCapAt(info.level)} на ступень`,
      );
      expect(line!.text, rich ? 'хватает — сказано, что сразу' : 'не хватает — сказано, когда накопится').toMatch(
        rich ? /изучить сразу/ : /накопится через/,
      );
    }
  });

  it('отказ говорит, какая ступень пустит ещё, и молчит в пределах открытого', () => {
    const closed = adminAt(1);
    expect(mastersCap(closed)).toBe(0);
    expect(mastersBlock(closed, 1), 'на первом уровне наёмных нет').toMatch(/Ещё не изучено: наёмные мастера — 2 уровень/);
    expect(mastersBlock(closed, 0), 'ноль мастеров не спрашивает ничего').toBeNull();

    const two = adminAt(2);
    const cap = mastersCap(two);
    expect(cap, 'точка внутри области: мест больше нуля').toBeGreaterThan(0);
    expect(mastersBlock(two, cap), 'ровно открытое — пускает').toBeNull();
    expect(mastersBlock(two, cap + 1), 'сверх открытого — следующая ступень').toMatch(/3 уровень/);
    expect(mastersBlock(two, cap + 1), 'и сколько она прибавит').toContain(`ещё ${mastersCapAt(3) - cap}`);

    const top = adminAt(ADMIN_LEVELS);
    expect(mastersBlock(top, mastersCap(top) + 100), 'на верху ветви отказа от неё нет').toBeNull();
  });
});
