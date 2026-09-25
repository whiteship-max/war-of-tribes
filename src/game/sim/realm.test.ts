import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInitialState, SAVE_VERSION } from '../state';
import { deserialize, enter, serialize } from '../save';
import { DAY_LENGTH, MAX_OFFLINE_DAYS } from '../constants';
import {
  MAX_RULER_SKILL,
  MIN_RULER_SKILL,
  POINTS_CAP,
  REALM_BRANCHES,
  levelPrice,
  levelsOf,
  startingPoints,
} from '../data/realm';
import { AGENT_AGE0, RETIRE_AGE } from '../data/agents';
import { LINEAGE_KEEP } from '../data/traits';
import { allPoints, bank, pointsOf } from './points';
import { settleHires } from './hire';
import { dynastyStep, livingNames, rulerAge, skillsOf, succeed } from './dynasty';
import { placeOpen, study } from './tech';
import { nameAgents } from './agents';
import { FIGURE_IDS } from '@/world/data/figures';
import type { GameState } from '../types';

/** Партия с известной верой: имена дому и местам агентов даёт первый же шаг, как в игре. */
function party(seed = 7): GameState {
  const s = createInitialState(seed);
  s.faith.id = 'catholic';
  settleHires(s);
  dynastyStep(s);
  return s;
}

/**
 * Навык всем трём ветвям — и котёл в ноль: новая партия начинает со стартовыми очками
 * (`startingPoints`), а эти проверки про приток, и начало отсчёта у них должно быть пустым.
 */
const skill = (s: GameState, v: number): void => {
  for (const b of REALM_BRANCHES) {
    s.realm.ruler.skills[b] = v;
    s.realm.points[b] = 0;
  }
  s.realm.pointsAt = s.time;
};

describe('очки правителя: функция времени, а не счётчик', () => {
  /**
   * Точка **внутри области**, где потолок не спрашивается вовсе: десять игровых дней у
   * сильнейшего правителя — пятьдесят очков из двухсот сорока. Без этой точки тест на потолок
   * был бы зелёным и при сломанном притоке (правило 11).
   */
  it('внутри потолка приток ровно линейный, и чтение партию не трогает', () => {
    const s = party();
    skill(s, MAX_RULER_SKILL);
    bank(s);
    const days = 10;
    expect(days * MAX_RULER_SKILL, 'точка внутри области: потолок ещё далеко').toBeLessThan(POINTS_CAP);
    s.time += days * DAY_LENGTH;

    // «До» снимается ДО первого чтения: сними его после — и счётчик, спрятанный в чтении,
    // уже переписал бы отложенное, а сверка с ним прошла бы. Ровно на этом тест однажды и
    // был зелёным при мутации «чтение копит в партию».
    const stored = s.realm.points.admin;
    const at = s.realm.pointsAt;
    let last = 0;
    for (let i = 0; i < 100; i++) last = pointsOf(s, 'admin');
    expect(last, 'сто чтений равны одному').toBeCloseTo(days * MAX_RULER_SKILL, 6);
    expect(s.realm.points.admin, 'отложенное не сдвинулось от чтения').toBe(stored);
    expect(s.realm.pointsAt, 'отметка не сдвинулась от чтения').toBe(at);
  });

  /**
   * Потолок — своя проверка, и **отдельно от зажима догона**. Догон (`awayGameSeconds`) двигает
   * `s.time` не дальше `MAX_OFFLINE_DAYS`, и потому отлучка любой длины упирается в то же число,
   * что потолок: тест, идущий через `absence`, прошёл бы и без потолка вовсе. Здесь `s.time`
   * двигают **прямо**, на срок заведомо больше потолка догона, — тогда зажать очки может только
   * сам потолок.
   */
  it('потолок зажимает сам, без догона: время двигают прямо', () => {
    const s = party();
    skill(s, MAX_RULER_SKILL);
    bank(s);
    const days = MAX_OFFLINE_DAYS * 20;
    expect(days, 'точка за границей области догона: догон бы столько не отдал').toBeGreaterThan(MAX_OFFLINE_DAYS);
    s.time += days * DAY_LENGTH;
    const free = days * MAX_RULER_SKILL;
    expect(free, 'без потолка вышло бы куда больше').toBeGreaterThan(POINTS_CAP * 10);
    for (const b of REALM_BRANCHES) expect(pointsOf(s, b), `${b}: потолок`).toBe(POINTS_CAP);
  });

  /** Потолок выведен, а не выбран: полная отлучка самого сильного правителя. */
  it('потолок равен притоку сильнейшего правителя за потолок догона', () => {
    expect(POINTS_CAP).toBe(MAX_OFFLINE_DAYS * MAX_RULER_SKILL);
    const s = party();
    skill(s, MAX_RULER_SKILL);
    bank(s);
    s.time += MAX_OFFLINE_DAYS * DAY_LENGTH;
    expect(pointsOf(s, 'war'), 'сутки отлучки сильнейшего — ровно потолок, ни очка сверх').toBe(POINTS_CAP);
  });

  /** Ночь не сжигает ни очка ни у одного правителя — то самое обещание, ради которого потолок и выведен. */
  it('ночь не сжигает ни очка ни при каком навыке', () => {
    // Восемь настоящих часов при нынешней шкале — шестнадцать игровых дней (`time:report`, раздел 6).
    const night = 16;
    for (let k = MIN_RULER_SKILL; k <= MAX_RULER_SKILL; k++) {
      const s = party();
      skill(s, k);
      bank(s);
      s.time += night * DAY_LENGTH;
      expect(pointsOf(s, 'admin'), `навык ${k}: ночь не сгорела`).toBeCloseTo(night * k, 6);
      expect(night * k, `навык ${k}: и до потолка ещё далеко`).toBeLessThanOrEqual(POINTS_CAP);
    }
  });

  it('новая партия начинает с очками ровно на первый покупаемый уровень', () => {
    const s = createInitialState(7);
    for (const b of REALM_BRANCHES) {
      expect(s.realm.points[b]).toBe(startingPoints(b));
      expect(s.realm.points[b]).toBe(levelPrice(b, 2));
      expect(s.realm.tech[b], 'первый уровень — состояние новой партии').toBe(1);
    }
  });

  it('ни один уровень не дороже потолка: иначе его нельзя накопить', () => {
    for (const b of REALM_BRANCHES) {
      for (let l = 1; l <= levelsOf(b); l++) expect(levelPrice(b, l), `${b}, уровень ${l}`).toBeLessThanOrEqual(POINTS_CAP);
      expect(levelPrice(b, levelsOf(b)), `${b}: последний уровень стоит ровно потолок`).toBe(POINTS_CAP);
    }
  });
});

describe('дом правителя', () => {
  it('навыки — кость от сида партии, в границах лестницы, и общий поток не трогают', () => {
    const s = createInitialState(7);
    const rolls = s.rolls;
    for (let n = 0; n < 50; n++) {
      const sk = skillsOf(s.seed, n);
      for (const b of REALM_BRANCHES) {
        expect(sk[b]).toBeGreaterThanOrEqual(MIN_RULER_SKILL);
        expect(sk[b]).toBeLessThanOrEqual(MAX_RULER_SKILL);
      }
    }
    expect(s.rolls, 'кость дома не двигает поток партии: иначе сдвинулись бы все события').toBe(rolls);
    // Повторяемость: то же сохранение, прочитанное дважды, даёт того же правителя.
    expect(skillsOf(s.seed, 3)).toEqual(skillsOf(s.seed, 3));
    // Разные сиды дают разных правителей — иначе кости нет вовсе.
    const others = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => JSON.stringify(skillsOf(seed, 0)));
    expect(new Set(others).size, 'сиды дают разные навыки').toBeGreaterThan(1);
  });

  it('правитель стареет часами деревни и в срок оставляет правление наследнику', () => {
    const s = party();
    expect(rulerAge(s)).toBeCloseTo(AGENT_AGE0, 6);
    const was = { ruler: s.realm.ruler.name, heir: s.realm.heir.name };
    expect(was.ruler).not.toBe(was.heir);

    // Точка внутри области: до покоя ещё далеко, смены быть не должно.
    s.time += DAY_LENGTH;
    dynastyStep(s);
    expect(s.realm.ruler.name, 'молодой правитель на месте').toBe(was.ruler);

    // Дожил: правление переходит наследнику, и наследник — тот самый, что был назван заранее.
    s.time = s.realm.ruler.bornAt + (RETIRE_AGE - AGENT_AGE0) * 20 * DAY_LENGTH;
    expect(rulerAge(s)).toBeGreaterThanOrEqual(RETIRE_AGE);
    dynastyStep(s);
    expect(s.realm.ruler.name, 'вступил названный наследник').toBe(was.heir);
    expect(rulerAge(s), 'новый правитель молод').toBeCloseTo(AGENT_AGE0, 6);
    expect(s.realm.heir.name, 'дом сразу выставил следующего: междуцарствия нет').toBeTruthy();
    expect(s.realm.heir.name).not.toBe(s.realm.ruler.name);
  });

  /**
   * Решение владельца: смерть отнимает **только навыки**. Очки и изученное остаются, а прошлое
   * не пересчитывается по новой ставке — для этого `succeed` и перекладывает базу (`bank`).
   * Мутация «убрать `bank` из `succeed`» роняет именно это утверждение: накопленное сильным
   * правителем пересчиталось бы по ставке слабого наследника и осело бы вдвое меньше.
   */
  it('смена правителя меняет только ставку: накопленное и изученное остаются', () => {
    const s = party();
    skill(s, MAX_RULER_SKILL);
    s.realm.heir.skills = { admin: MIN_RULER_SKILL, diplo: MIN_RULER_SKILL, war: MIN_RULER_SKILL };
    bank(s);
    s.realm.tech.war = 3;
    const days = 20;
    s.time += days * DAY_LENGTH;
    const before = allPoints(s);
    expect(before.admin).toBeCloseTo(days * MAX_RULER_SKILL, 6);

    succeed(s);
    expect(allPoints(s).admin, 'накопленное на месте: ставка сменилась, прошлое нет').toBeCloseTo(before.admin, 6);
    expect(s.realm.tech.war, 'изученное смерть не отнимает').toBe(3);

    // Дальше идёт уже ставка наследника, а не прежняя.
    s.time += 10 * DAY_LENGTH;
    expect(pointsOf(s, 'admin')).toBeCloseTo(before.admin + 10 * MIN_RULER_SKILL, 6);
  });

  it('книга родословной одна, и правитель — место в ней, а не вторая книга', () => {
    const s = party();
    const gen = s.lineage.general ?? [];
    s.time = s.realm.ruler.bornAt + (RETIRE_AGE - AGENT_AGE0) * 20 * DAY_LENGTH;
    dynastyStep(s);
    const rows = s.lineage.ruler ?? [];
    expect(rows.length, 'запись об ушедшем правителе легла в ту же книгу').toBe(1);
    expect(rows[0].skills, 'у правителя не уровень, а три навыка').toBeTruthy();
    expect(rows[0].level, 'уровня у правителя нет').toBe(0);
    expect(rows[0].end).toBe('rest');
    expect(s.lineage.general ?? [], 'место полководца не тронуто').toEqual(gen);
    expect(LINEAGE_KEEP.ruler, 'потолок дома — тот же, что у Статуи').toBe(LINEAGE_KEEP.general);
  });

  it('книга не растёт выше потолка места', () => {
    const s = party();
    for (let i = 0; i < LINEAGE_KEEP.ruler + 4; i++) {
      s.time = s.realm.ruler.bornAt + (RETIRE_AGE - AGENT_AGE0) * 20 * DAY_LENGTH;
      dynastyStep(s);
    }
    expect((s.lineage.ruler ?? []).length).toBe(LINEAGE_KEEP.ruler);
  });
});

describe('правило об именах: два источника, и третьего нет', () => {
  /**
   * Число живых поимённых людей — **не записанное число, а длина двух списков**: дом (двое) плюс
   * те места агентов, которые держава открыла. Заведи третьего в доме — упадёт именно это
   * утверждение, и решение придётся принять вслух; заведи пятое место агента — обе стороны
   * сойдутся сами.
   *
   * С гейтом у счёта две точки, и обе нужны: новая партия начинает без места лазутчика
   * (оно за второй ступенью дипломатической ветви), а изучившая ветвь и нанявшая человека
   * получает полную шестёрку. Одной первой точки мало — она прошла бы и у кода, который
   * закрыл место навсегда.
   */
  it('живых поимённых ровно двое в доме плюс открытые места агентов', () => {
    const s = party();
    const open = FIGURE_IDS.filter((id) => placeOpen(s, id));
    expect(open.length, 'у новой партии место лазутчика ещё закрыто').toBe(FIGURE_IDS.length - 1);
    expect(livingNames(s).length).toBe(2 + open.length);

    expect(study(s, 'diplo'), 'очков новой партии хватает на первую ступень').toBeNull();
    for (const id of FIGURE_IDS) s.agents[id].vacant = false;
    nameAgents(s);
    expect(FIGURE_IDS.filter((id) => placeOpen(s, id)).length).toBe(FIGURE_IDS.length);
    expect(livingNames(s).length).toBe(2 + FIGURE_IDS.length);
  });

  it('тёзок среди живых не бывает ни при каком сиде', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = party(seed);
      const names = livingNames(s);
      expect(new Set(names).size, `сид ${seed}: ${names.join(', ')}`).toBe(names.length);
    }
  });

  it('имя дома — по вере деревни, и до веры его нет', () => {
    const s = createInitialState(7);
    expect(s.realm.ruler.name, 'вера ещё не названа миром — имени нет').toBeNull();
    dynastyStep(s);
    expect(s.realm.ruler.name, 'без веры шаг имени не даёт').toBeNull();
    s.faith.id = 'islam';
    dynastyStep(s);
    expect(s.realm.ruler.name).toBeTruthy();
    expect(s.realm.heir.name).toBeTruthy();
  });

  it('имена агентов дом не сдвигает: у него свой счётчик и своя соль', () => {
    const a = createInitialState(7);
    a.faith.id = 'catholic';
    // Имена агентов выдаются своим счётчиком (`s.hires`); дом его не трогает.
    const hires = a.hires;
    dynastyStep(a);
    expect(a.hires, 'дом не двигает счётчик имён агентов').toBe(hires);
  });
});

describe('ступень сохранения 16 → 17: у державы появился правитель', () => {
  it('правление приведённой партии начинается в минуту входа, а не в нулевую секунду', () => {
    const before = party();
    before.time = 500 * DAY_LENGTH;
    const raw = JSON.parse(serialize(before)) as Record<string, unknown>;
    raw.version = 16;
    delete raw.realm;
    const s = deserialize(JSON.stringify(raw));
    expect(s).not.toBeNull();
    expect(s!.version).toBe(SAVE_VERSION);
    // Номер закреплён нарочно: следующая пачка, поднявшая версию, спотыкается здесь и
    // пишет свою ступень, а не надеется на умолчания. Восемнадцатая — дипломатическая
    // ветвь, девятнадцатая — военная, двадцатая — участь покупной ступенью, двадцать первая —
    // административная ветвь и наёмные мастера.
    expect(SAVE_VERSION).toBe(21);
    // Сыгранная партия не отправляет правителя на покой первым же пульсом: он молод.
    expect(rulerAge(s!)).toBeCloseTo(AGENT_AGE0, 0);
    expect(s!.realm.ruler.bornAt, 'правление началось не в нулевую секунду').toBeGreaterThanOrEqual(s!.time);
    for (const b of REALM_BRANCHES) expect(s!.realm.points[b], 'очки — стартовый котёл, а не полный').toBe(startingPoints(b));
    // Строки ступеней ложатся в летопись при входе, после догона отлучки (`save.enter`); вход — сразу после записи.
    enter(s!, s!.lastSaved);
    expect(s!.log.some((e) => e.text.includes('Во главе державы')), 'о правителе сказано строкой').toBe(true);
  });

  it('новая партия о правителе в летописи не узнаёт: ей и так его видно', () => {
    const s = createInitialState(7);
    expect(s.log.some((e) => e.text.includes('Во главе державы'))).toBe(false);
  });

  it('дом из сохранения читается с проверкой: мусор не роняет партию', () => {
    const before = party();
    const raw = JSON.parse(serialize(before)) as Record<string, unknown>;
    raw.realm = { ruler: 'нет', heir: 7, points: { admin: 'много' }, pointsAt: 'вчера', tech: null, born: -5 };
    const s = deserialize(JSON.stringify(raw));
    expect(s).not.toBeNull();
    for (const b of REALM_BRANCHES) {
      expect(s!.realm.ruler.skills[b]).toBeGreaterThanOrEqual(MIN_RULER_SKILL);
      expect(s!.realm.points[b]).toBeGreaterThanOrEqual(0);
      expect(s!.realm.tech[b]).toBeGreaterThanOrEqual(1);
    }
    expect(s!.realm.born).toBeGreaterThanOrEqual(0);
  });

  it('очки не выше потолка и после чтения испорченного сохранения', () => {
    const before = party();
    const raw = JSON.parse(serialize(before)) as Record<string, unknown>;
    (raw.realm as Record<string, unknown>).points = { admin: 1e9, diplo: 1e9, war: 1e9 };
    const s = deserialize(JSON.stringify(raw))!;
    for (const b of REALM_BRANCHES) expect(pointsOf(s, b)).toBe(POINTS_CAP);
  });
});

// ---------- по исходникам ----------

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

/** Код без комментариев: правило про код, а не про то, что о нём написано. */
const bare = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('замки державы', () => {
  /**
   * Очки — одна дверь. Писать в `realm.points` и `realm.pointsAt` может только `sim/points.ts`;
   * собрать их целиком — `sim/dynasty.ts` (новый дом и чтение сохранения). Третьего места нет, и
   * это тот же замок, что у алмазов: начисление мимо двери не проверить ничем.
   */
  it('в очки пишут только двери sim/points и сборка дома', () => {
    const allowed = [join('src', 'game', 'sim', 'points.ts'), join('src', 'game', 'sim', 'dynasty.ts')];
    const bad: string[] = [];
    for (const file of sources()) {
      if (allowed.some((a) => file.endsWith(a))) continue;
      const code = bare(file);
      // Ищется само поле державы, а не любое `points`: в трёхмерной сцене так зовут облако точек.
      if (/realm\??\.points/.test(code)) bad.push(file);
    }
    expect(bad, 'очки правителя правят мимо двери').toEqual([]);
  });

  /**
   * Правитель даёт очки и ничего больше: числами, которыми уже владеет здание, он не владеет.
   * Тот же запрет, что у навыков агентов (`data/agents.owners.test.ts`), только проверяемый с
   * другой стороны — по тем модулям, куда прибавке правителя пролезть было бы проще всего.
   */
  it('ни выработка, ни оборона, ни мораль, ни мир о правителе не знают', () => {
    const closed = [
      join('src', 'game', 'derived.ts'),
      join('src', 'world', 'bridge.ts'),
      join('src', 'game', 'battle', 'kinds.ts'),
      join('src', 'game', 'sim', 'upkeep.ts'),
      join('src', 'game', 'sim', 'population.ts'),
    ];
    for (const rel of closed) {
      const file = sources().find((f) => f.endsWith(rel));
      expect(file, `${rel} не найден`).toBeTruthy();
      expect(bare(file as string), `${rel} читает державу`).not.toMatch(/\brealm\b/);
    }
  });

  /** Книга родословной одна: кладёт в неё одна дверь, и трогает поле только она. */
  it('в книгу родословной пишет одна дверь', () => {
    const allowed = [join('src', 'game', 'sim', 'agents.ts')];
    const bad: string[] = [];
    for (const file of sources()) {
      if (allowed.some((a) => file.endsWith(a))) continue;
      if (/\.lineage\s*(\[[^\]]*\])?\s*=/.test(bare(file))) bad.push(file);
    }
    expect(bad, 'родословную правят мимо двери').toEqual([]);
  });

  /**
   * Уровень ветви лежит в партии, и трогают его двое: дверь гейта (`sim/tech`) и дом,
   * который поле заводит и читает из сохранения (`sim/dynasty`). Третий читатель поля —
   * это вторая правда о том, что открыто, и разойдётся она молча.
   *
   * Пачка 1 держала здесь более сильное утверждение — «гейтов нет ни одного», — и оно
   * снято той пачкой, которая гейт завела (решение владельца 1, docs/dynasty.md, раздел
   * 10.1). На его месте — запрет обходить дверь; что двери хватает на всё, держит
   * `sim/tech.test.ts`.
   */
  it('в поле уровня ветви смотрят только дверь гейта и дом', () => {
    const allowed = [join('src', 'game', 'sim', 'tech.ts'), join('src', 'game', 'sim', 'dynasty.ts')];
    const bad: string[] = [];
    for (const file of sources()) {
      if (allowed.some((a) => file.endsWith(a))) continue;
      if (/realm\??\.tech\b/.test(bare(file))) bad.push(file);
    }
    expect(bad, 'уровень технологии читают мимо двери').toEqual([]);
  });

  /** Поля `requiresTech` нет и заводить его нельзя — решение владельца 1 (docs/dynasty.md, 10.1). */
  it('поля requiresTech нет ни у здания, ни у бойца, ни у вещи', () => {
    const bad = sources().filter((f) => /requiresTech/.test(bare(f)));
    expect(bad, 'гейт полем в таблице — то, что решением 1 запрещено').toEqual([]);
  });
});
