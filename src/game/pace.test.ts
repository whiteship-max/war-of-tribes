// Дверь времени (`game/pace.ts`): перевод настоящих секунд в игровые один, и стоит он везде, где
// игровая секунда встречается с настоящей. При шкале 1 перевод неотличим от его отсутствия, и тест
// на «перевод на месте» при ней зелёный даром — поэтому каждое свойство ниже снято при шкале,
// отличной от единицы, и это утверждается в самом тесте, а не подразумевается (правило 11).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState, SAVE_VERSION } from './state';
import { deserialize, serialize } from './save';
import { PACE_TEXT } from './data/pace';
import { serverNow } from '@/net/clock';
import { DAY_LENGTH, MAX_OFFLINE_DAYS } from './constants';
import { asGame, gameSeconds, gameSecondsOfMs, realMs, realSeconds, setTimeScale, timeScale } from './pace';
import { AWAY_AFTER, absence, awayGameSeconds, awaySeconds, liveStep } from './sim/tick';
import { clockText } from './data/order';
import { townFoodPerDay } from './derived';
import { playerProfile, syncSiege } from '@/world/bridge';
import { awayOf } from '@/world/muster';
import { LocalWorld } from '@/world/local/LocalWorld';
import type { SiegeView } from '@/world/types';
import { waitDays, waitEta, waitShort } from '@/ui/parts/wait';
import { daysBoth, daysSpan } from './span';
import { HOUR_MS } from './time';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NOW = 1_700_000_000_000;

afterEach(() => setTimeScale());

/** Свойство снимается только там, где перевод что-то меняет. */
function scaled(k: number): void {
  setTimeScale(k);
  expect(timeScale(), 'точка внутри области: шкала отлична от единицы').not.toBe(1);
}

const town = () => {
  const s = createInitialState(7);
  s.tutorialDone = true;
  s.nextEventAt = Infinity;
  return s;
};

describe('шкала времени', () => {
  it('для игроков шкала — тридцать: игровой день длится полчаса', () => {
    expect(timeScale()).toBe(30);
    expect(realSeconds(DAY_LENGTH)).toBe(30 * 60);
  });

  it('при единице перевод точен: ни одно число игры от двери не меняется', () => {
    setTimeScale(1);
    for (const x of [0.5, 1, 2, 15, 0.1 + 0.2, 14400, 1e9 / 7]) {
      expect(gameSeconds(x)).toBe(x);
      expect(realSeconds(x)).toBe(x);
      expect(gameSecondsOfMs(x * 1000)).toBe((x * 1000) / 1000);
      expect(realMs(x)).toBe(x * 1000);
    }
  });

  it('перевод туда и обратно — одно число', () => {
    scaled(30);
    expect(gameSeconds(3600)).toBe(120);
    expect(realSeconds(120)).toBe(3600);
    expect(gameSecondsOfMs(realMs(77))).toBeCloseTo(77, 9);
    expect(() => setTimeScale(0)).toThrow();
  });
});

describe('время племени — функция часов, а не счёт срабатываний', () => {
  it('короткий шаг сдвигает время на прошедшее, делённое на шкалу', () => {
    scaled(3);
    const s = town();
    const t0 = s.time;
    expect(1.5, 'точка внутри области: это шаг, а не отлучка').toBeLessThanOrEqual(AWAY_AFTER);
    liveStep(s, 1.5, NOW);
    expect(s.time - t0, 'полторы настоящие секунды при шкале 3').toBeCloseTo(0.5, 9);
  });

  it('сколько раз сработал таймер, не важно: редкие шаги дают то же время, что частые', () => {
    scaled(2);
    const often = town();
    const rarely = town();
    for (let i = 0; i < 10; i++) liveStep(often, 0.5, NOW);
    for (let i = 0; i < 2; i++) liveStep(rarely, 2.5, NOW);
    expect(2.5, 'точка внутри области: редкий шаг — всё ещё шаг').toBeLessThanOrEqual(AWAY_AFTER);
    expect(often.time, 'пять настоящих секунд').toBeCloseTo(2.5, 9);
    expect(rarely.time, 'те же пять секунд двумя срабатываниями').toBeCloseTo(often.time, 9);
  });

  it('страница спала: промежуток длиннее порога — отлучка с догоном, а не потерянное время', () => {
    scaled(3);
    const s = town();
    const t0 = s.time;
    const real = 600;
    expect(real, 'точка внутри области: это отлучка').toBeGreaterThan(AWAY_AFTER);
    expect(real / 3, 'и она под потолком догона').toBeLessThan(MAX_OFFLINE_DAYS * DAY_LENGTH);
    liveStep(s, real, NOW);
    expect(s.time - t0, 'десять настоящих минут при шкале 3').toBeCloseTo(200, 6);
  });

  // Потолок догона — в игровых днях (решение владельца, docs/time.md, раздел 16): одно правило
  // вместо числа часов, которое значит разное на разных шкалах. Область правила — отлучка длиннее
  // потолка; точка короче потолка проходит при любом потолке, и обе стороны проверены утверждением.
  it('потолок догона — в игровых днях: при любой шкале отлучка длиннее потолка даёт одни и те же дни', () => {
    const cap = MAX_OFFLINE_DAYS * DAY_LENGTH;
    for (const k of [2, 4, 30]) {
      scaled(k);
      const s = town();
      const t0 = s.time;
      const since = NOW - 3 * cap * k * 1000;
      expect(gameSeconds(awaySeconds(since, NOW)), `точка внутри области: отлучка при шкале ${k} длиннее потолка`).toBeGreaterThan(cap);
      expect(awayGameSeconds(since, NOW), `догон при шкале ${k}`).toBe(cap);
      absence(s, since, NOW);
      expect((s.time - t0) / DAY_LENGTH, `прожито игровых дней при шкале ${k}`).toBeCloseTo(MAX_OFFLINE_DAYS, 6);
    }
  });

  it('потолок догона при шкале поворота — настоящие сутки, а под потолком отлучка догоняется целиком', () => {
    scaled(30);
    expect(realSeconds(MAX_OFFLINE_DAYS * DAY_LENGTH), 'потолок настоящими секундами при ×30').toBe(24 * 3600);
    const half = NOW - 12 * 3600 * 1000;
    expect(awayGameSeconds(half, NOW), 'точка внутри области: полсуток — под потолком').toBeLessThan(MAX_OFFLINE_DAYS * DAY_LENGTH);
    expect(awayGameSeconds(half, NOW) / DAY_LENGTH, 'полсуток при ×30 — 24 игровых дня').toBeCloseTo(24, 9);
  });

  it('сколько игрока не было — правда об отлучке, без потолка', () => {
    expect(awaySeconds(NOW - 72 * 3600 * 1000, NOW)).toBe(72 * 3600);
  });

  it('нулевой и отрицательный промежуток времени не двигают', () => {
    const s = town();
    const t0 = s.time;
    liveStep(s, 0, NOW);
    liveStep(s, -5, NOW);
    expect(s.time).toBe(t0);
  });
});

describe('игровая секунда не равна настоящей молча', () => {
  it('срок осады для догона: миллисекунды мира переведены в игровые секунды', () => {
    scaled(4);
    const s = town();
    const view = { byId: 'x', byName: 'Лагерь', since: NOW, starvesAt: NOW + 80_000 } as unknown as SiegeView;
    expect(syncSiege(s, view, NOW)).toBe(true);
    expect(s.siege!.until - s.time, '80 настоящих секунд при шкале 4').toBeCloseTo(20, 9);
  });

  it('расход еды в час мира считается от настоящей длины игрового дня', () => {
    scaled(2);
    const s = town();
    const p = playerProfile(s, awayOf([], []));
    expect(townFoodPerDay(s), 'точка внутри области: город ест').toBeGreaterThan(0);
    expect(p.foodPerHour).toBeCloseTo((townFoodPerDay(s) * HOUR_MS) / (DAY_LENGTH * 2 * 1000), 9);
  });

  it('часы деревни в мире: прошедшие миллисекунды мира прибавляются игровыми секундами', () => {
    scaled(4);
    const w = new LocalWorld({ seed: 7, now: () => NOW, storage: null }) as unknown as {
      save: { profile: { time: number } | null; profileAt?: number };
      villageTime(at: number): number;
    };
    w.save.profile = { time: 100 };
    w.save.profileAt = NOW;
    expect(w.villageTime(NOW + 8_000), 'восемь настоящих секунд при шкале 4').toBeCloseTo(102, 9);
  });

  it('срок ропота и сроки в панелях показаны настоящим временем', () => {
    scaled(2);
    expect(clockText(90)).toBe('3:00');
    expect(waitShort(asGame(40))).toBe('80 с');
    scaled(30);
    expect(waitEta(asGame(40))).toBe('~20 м');
  });
});

// ---------- старая партия ----------

describe('ступень сохранения 15 → 16: время пошло медленнее, а партия та же', () => {
  it('состояние не пересчитывается — ни одна отметка времени; партии говорят об этом строкой и окном', () => {
    const before = town();
    before.time = 36_000;
    before.feastUntil = 36_500;
    before.feastAt = 36_100;
    before.resources.wood = 777;
    const raw = JSON.parse(serialize(before)) as Record<string, unknown>;
    raw.version = 15;
    raw.lastSaved = serverNow();
    const s = deserialize(JSON.stringify(raw))!;
    expect(s.version, 'точка внутри области: ступень пройдена').toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(16);
    expect(s.paceNotice, 'окно ждёт показа').toBe(true);
    expect(s.log[0].text).toBe(PACE_TEXT.log(daysSpan(1)));
    // Всё остальное — буква в букву: те же игровые секунды, тот же склад.
    const strip = (g: typeof s) => ({ ...g, version: 0, paceNotice: undefined, log: [], lastSaved: 0 });
    // Сверка — с той же партией, прочитанной без ступени: чтение само приводит поля, ступень — ничего.
    raw.version = SAVE_VERSION;
    expect(strip(s)).toEqual(strip(deserialize(JSON.stringify(raw))!));
  });

  it('новой партии и партии нынешней версии окно не показывают', () => {
    expect(createInitialState().paceNotice).toBeUndefined();
    const s = deserialize(serialize(town()))!;
    expect(s.paceNotice).toBeUndefined();
  });
});

// ---------- по исходникам ----------

const code = (abs: string): string =>
  readFileSync(abs, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...sources(abs));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(abs);
  }
  return out;
}
const rel = (abs: string): string => path.relative(ROOT, abs).split(path.sep).join('/');

/** Имена, взятые файлом из шага симуляции (`game/sim/tick`). */
function takenFromTick(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!/(^|\/)sim\/tick$|^\.\/tick$/.test(m[2])) continue;
    out.push(...m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean));
  }
  return out;
}

describe('дверь одна: по исходникам', () => {
  const SRC = sources(path.join(ROOT, 'src'));

  it('голый шаг (`tick`, `catchUp`) в src не берёт никто: время подают `liveStep` и `absence`', () => {
    const takers = SRC.map((f) => ({ file: rel(f), names: takenFromTick(code(f)) })).filter((x) => x.names.length > 0);
    // Точка внутри области: проверка видит тех, кто берёт шаг, — стор и сохранение.
    expect(takers.map((x) => x.file)).toEqual(expect.arrayContaining(['src/game/store.ts', 'src/game/save.ts']));
    const bare = takers.filter((x) => x.names.some((n) => n === 'tick' || n === 'catchUp')).map((x) => `${x.file}: ${x.names.join(', ')}`);
    expect(bare, 'кто подаёт dt мимо двери').toEqual([]);
  });

  it('сам шаг переводит настоящие секунды дверью, и автопилот отчётов — тоже', () => {
    const tick = code(path.join(ROOT, 'src/game/sim/tick.ts'));
    expect(tick, 'живой шаг').toMatch(/tick\(s,\s*gameSeconds\(real\)\)/);
    expect(tick, 'догон отлучки').toMatch(/catchUp\(s,\s*awayGameSeconds\(since, now\)/);
    expect(tick, 'и сам догон — через дверь').toMatch(/awayGameSeconds = [^;]*gameSeconds\(awaySeconds\(since, now\)\)/);
    const pilot = code(path.join(ROOT, 'scripts/autopilot.ts'));
    expect(pilot, 'пульс мира → игровые секунды').toMatch(/gameSeconds\(pulseSec\)/);
  });

  it('игровое время с миллисекундами мира складывается только через дверь', () => {
    const files = SRC.filter((f) => /\/src\/(game|world)\//.test(f.split(path.sep).join('/')));
    expect(files.length, 'точка внутри области: файлы найдены').toBeGreaterThan(50);
    const silent: string[] = [];
    for (const f of files) {
      code(f)
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (/\b(s|p|g|state|profile)\.time\b/.test(line) && /\b1000\b/.test(line)) silent.push(`${rel(f)}:${i + 1}`);
        });
    }
    expect(silent, 'строки, где игровая секунда молча равна настоящей').toEqual([]);
    // Мутация, на которой тест обязан падать: мост и мир зовут дверь.
    expect(code(path.join(ROOT, 'src/world/bridge.ts'))).toMatch(/gameSecondsOfMs\(/);
    expect(code(path.join(ROOT, 'src/world/local/LocalWorld.ts'))).toMatch(/gameSecondsOfMs\(/);
  });

  /**
   * Решение владельца (docs/time.md, раздел 19): **поход идёт игровым временем**, как и всё,
   * с чем он сравнивается, — ритм угрозы, хозяйство, лечение, рогатки. Пока путь шёл настоящими
   * минутами, игрок был в тридцать раз быстрее собственной деревни, и от этого ехали сразу два
   * вывода: добыча логова из надбавки становилась заменой хозяйству, а раненый не успевал
   * встать между боями (разделы 18.6 и 18.7).
   *
   * Правило держат две проверки, и одной мало. Тип не даёт напечатать путь настоящими часами
   * (`ui/parts/wait.test.ts`), но арифметика метку снимает: `seconds * 1000` компилятор
   * пропустит молча — ровно тем и был устроен обход. Эта проверка закрывает вторую половину:
   * в часы мира путь переводит только дверь.
   */
  it('время пути в часы мира идёт только дверью', () => {
    const world = SRC.filter((f) => rel(f).startsWith('src/world/'));
    expect(world.length, 'точка внутри области: файлы мира найдены').toBeGreaterThan(20);
    // Кто несёт время пути: имя, объявленное из функции дороги. Один переход — тем же
    // правилом, каким ищутся ставки без класса (`scripts/lib/timeclasses.unclassifiedRates`).
    const FROM_ROAD = /\b(?:const|let)\s+(\w+)(?::[^=]+)?\s*=\s*(?:[^;]*?\b)?(?:travelTime|marchSeconds|travelSeconds)\s*\(/g;
    // Часы мира — миллисекунды: умножение или деление на них и есть перевод мимо двери.
    const RAW = /\b(\w+)\s*[*/]\s*(?:1_?000|60_?000|MIN|HOUR)\b|\b1_?000\s*\*\s*(\w+)\b/g;
    const carriers: string[] = [];
    const raw: string[] = [];
    for (const f of world) {
      const src = code(f);
      const names = new Set([...src.matchAll(FROM_ROAD)].map((m) => m[1]));
      for (const name of names) carriers.push(`${rel(f)}: ${name}`);
      src.split(/\r?\n/).forEach((line, i) => {
        for (const m of line.matchAll(RAW)) if (names.has(m[1] ?? '') || names.has(m[2] ?? '')) raw.push(`${rel(f)}:${i + 1}`);
      });
    }
    // Точка внутри области: носители времени пути в мире есть — значит, поиск их видит.
    expect(carriers, 'кто несёт время пути').toContain('src/world/local/LocalWorld.ts: seconds');
    expect(raw, 'время пути идёт в часы мира мимо двери').toEqual([]);
    // И дверь при этом вправду зовут: правило зелёное не оттого, что пути не стало.
    expect(code(path.join(ROOT, 'src/world/local/LocalWorld.ts')), 'путь переводит дверь').toMatch(/realMs\(seconds\)/);
  });

  /**
   * Второй замок того же правила: **своей формулы дороги нет ни у кого**. Дверь внутри
   * `geo.travelTime`, и обойти её можно ровно одним способом — посчитав время пути самому,
   * от скорости. Поэтому скорость в мире читают только объявления (`data/`) и та строка,
   * которая тут же зовёт дверь.
   */
  it('своей формулы времени пути нет: скорость читают только рядом с дверью', () => {
    const world = SRC.filter((f) => rel(f).startsWith('src/world/') && !rel(f).startsWith('src/world/data/'));
    const lines = world.flatMap((f) =>
      code(f)
        .split(/\r?\n/)
        .map((line, i) => ({ at: `${rel(f)}:${i + 1}`, line })),
    );
    const speed = lines.filter((x) => /\.speed\b/.test(x.line));
    // Точка внутри области: скорость в мире читают — значит, поиск видит строки о ней.
    expect(speed.length, 'строки со скоростью').toBeGreaterThan(0);
    expect(
      speed.filter((x) => !/\btravelTime\s*\(/.test(x.line)).map((x) => x.at),
      'кто считает дорогу своей формулой',
    ).toEqual([]);
  });

  it('шкалу подменяют только тесты — и прибор поворота', () => {
    const callers = [...SRC, ...sources(path.join(ROOT, 'scripts'))].filter((f) => rel(f) !== 'src/game/pace.ts' && /\bsetTimeScale\s*\(/.test(code(f)));
    // Единственное исключение названо: `time:report` меряет игру после поворота шкалы до поворота
    // («Вернувшийся») и шкалу за собой возвращает. Второе — закрепление «день — минута» для тестов правил
    // мира (`game/pace.minute.ts`): модуль берут только файлы тестов, и это проверено ниже.
    expect(callers.map(rel).sort()).toEqual(['scripts/time-report.ts', 'src/game/pace.minute.ts']);
    const all = [...SRC, ...sources(path.join(ROOT, 'scripts'))];
    expect(all.filter((f) => /pace\.minute/.test(code(f)) && rel(f) !== 'src/game/pace.minute.ts').map(rel), 'кто в игре берёт закрепление').toEqual([]);
  });

  it('секунды, минуты и часы в интерфейсе печатает только `ui/parts/wait.ts`', () => {
    // «${x} с», «{x} мин», «{h} ч» — число и единица; предлог «с» перед словом («с человека») и
    // слово, начинающееся с той же буквы («чел.», «минут»), сюда не попадают. Игровые дни держит
    // соседний тест: голого «дн.» нет нигде.
    const unit = /\}\s*(с|мин|ч|м)(?![а-яёА-ЯЁ])(?!\s+[а-яё])/;
    const ui = SRC.filter((f) => rel(f).startsWith('src/ui/'));
    const hits = ui.filter((f) => code(f).split(/\r?\n/).some((line) => unit.test(line))).map(rel);
    // Точка внутри области: сам модуль сроков под правило попадает, значит правило видит печать единиц.
    expect(hits).toContain('src/ui/parts/wait.ts');
    expect(hits.filter((f) => f !== 'src/ui/parts/wait.ts'), 'кто печатает срок мимо модуля сроков').toEqual([]);
  });

  // Решение владельца (docs/time.md, раздел 16): где игрок ждёт — настоящее время; игровые дни — только
  // с названной единицей. Голое «дн.» после поворота шкалы прочли бы сутками. Сетка по виду строки:
  // она ловит единицу без имени, а не то, верно ли выбрано «ждёт» против «свойство мира».
  it('голого «дн.» в игре нет: игровые дни названы, слова о них собирает `game/span.ts`', () => {
    const lines = SRC.flatMap((f) => code(f).split(/\r?\n/).map((line, i) => ({ at: `${rel(f)}:${i + 1}`, line })));
    const named = lines.filter((x) => /игр\. дн\./.test(x.line)).map((x) => x.at.replace(/:\d+$/, ''));
    // Точка внутри области: названная единица в исходниках есть — значит, поиск видит строки о днях.
    expect(named).toContain('src/game/span.ts');
    const bare = lines.filter((x) => /(?<!игр\. )дн\./.test(x.line)).map((x) => x.at);
    expect(bare, 'срок в днях без названной единицы').toEqual([]);
  });

  it('срок в игровых днях игроку показан настоящим временем — и оба числа там, где нужны оба', () => {
    scaled(30);
    expect(daysSpan(3), 'три игровых дня при ×30').toBe('1 ч 30 мин');
    expect(daysSpan(12)).toBe('6 ч');
    expect(daysSpan(200), 'дольше двух суток — сутками').toBe('4 сут 4 ч');
    expect(daysBoth(6.5)).toBe('6.5 игр. дн. — 3 ч 15 мин');
    expect(waitDays(3), 'интерфейс берёт ту же формулу').toBe(daysSpan(3));
  });

  it('форматтер мира интерфейс берёт только через модуль сроков', () => {
    const takers = SRC.filter((f) => rel(f).startsWith('src/ui/') && /\bformatLeft\b/.test(code(f))).map(rel);
    // Точка внутри области: модуль сроков его берёт — значит, поиск видит импорт.
    expect(takers).toEqual(['src/ui/parts/wait.ts']);
  });
});
