// Классы величин времени (docs/time.md, раздел 13): у каждой величины класс записан там же, где
// число, — конструктором из `game/pace.ts`, — и класс делает то, что обещает, при шкале, отличной
// от единицы. При единице все классы неотличимы, и тест на них был бы зелёным даром (правило 11):
// шкала подменяется в свежем графе модулей, чтобы величины пересчитались при ней с объявления.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CTOR_CLASS, RATE_CTORS, dayConsts, tableRows, timeConsts, unclassified, unclassifiedRates, type TimeConst } from './timeclasses';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCALE = 30;

type Pace = typeof import('@/game/pace');

/** Значения величин при шкале `k` — в свежем графе модулей, с объявления. */
async function valuesAt(k: number, consts: TimeConst[]): Promise<{ pace: Pace; values: Map<string, number> }> {
  vi.resetModules();
  const pace = (await import('@/game/pace')) as Pace;
  pace.setTimeScale(k);
  const values = new Map<string, number>();
  for (const file of new Set(consts.map((c) => c.file))) {
    const mod = (await import(/* @vite-ignore */ `/${file}`)) as Record<string, unknown>;
    for (const c of consts.filter((x) => x.file === file)) {
      const v = mod[c.name];
      if (typeof v === 'number') values.set(`${c.file}:${c.name}`, v);
    }
  }
  return { pace, values };
}

afterEach(() => vi.resetModules());

/** Счёт по классам. Правится сознательно — вместе с объявлением величины. */
const COUNT = {
  // 59 = 57 плюс два срока энергии агентов (docs/agent_energy.md): в дороге запас уходит за `ENERGY_ROAD` дней пути, дома
  // копится за `ENERGY_FILL` — пятьдесят и два игровых дня. Последствие в мире, мерка ему — дорога, как `FIGURE_DOWN`.
  // 57 = 56 плюс срок, за который гарнизон в осаде слабеет до дна `SIEGE_WEAR_SPAN` (война между игроками,
  // docs/pvp.md, раздел 3): последствие осады в мире, как часы голода, — игровое.
  // 56 = 55 плюс срок морали армии между боями `REST_FULL` (поставка 4 боя, docs/battle_eu4.md, 14.31): он же срок
  // лазарета `WOUND_DAYS`, переведённый на часы мира дверью `worldDays`, — последствие в мире, как `FIGURE_DOWN`.
  // 55 = 56 без заморозки обороны `DEFENSE_FREEZE`, ушедшей с поставкой 2 боя (docs/battle_eu4.md, 14.27).
  // 56 = прежние 43 плюс тринадцать сроков занятости, переехавших из настоящего времени в
  // игровое (решение владельца, docs/time.md, раздел 20): фигура вне строя `FIGURE_DOWN`,
  // память цели `PERIL_MEMORY`, пять `ORDER_BUSY_*` дипломата, `SPY_BUSY` и `SPY_HELD`,
  // `HANDOVER_BASE`/`HANDOVER_MAX`/`HANDOVER_PER_MAN` у сбора дружины и `DEED_GAP` у опыта.
  // Все они — последствия в мире, а не окна, дающие игроку время прийти и ответить, и мерка
  // им — дорога. `HANDOVER_PER_MAN` до этого стоял голым числом и класса не имел вовсе.
  // Прежние 43 = 39 сроков, три ставки осадного голода (пачка 5, раздел 18) и пол похода
  // `MARCH_MIN_SECONDS`, переехавший туда же вместе со всей дорогой (раздел 19).
  // 59 — счёт тот же после фаз осады (docs/siege_v2.md, этап 2б): ушёл `SIEGE_WEAR_SPAN` (износ теперь доходит до дна к
  // голоду окна, а не за сорок дней), пришла длина фазы `SIEGE_PHASE` — четыре игровых дня, последствие осады в мире.
  // В таблицах 12: три залпа обстрела `BOMBARD_VOLLEYS[].wear` ушли вместе с таблицей — залп двигает износ долей пути до
  // дна (`data/siegeroll.VOLLEY_SHAKE_*`), а не днями.
  // 58 — проход у рогаток `CAMP_GATE_CLEAR` ушёл в настоящее время: он меряет руку, жмущую вылазку, а не мир
  // (п. 10а docs/audit/OWNER-DECISIONS.md, АУ-1).
  // 57 — срок найма агента в здании `HIRE_SECONDS` ушёл вместе с наймом в здании: кандидат Ратуши встаёт сразу (АГ-1,
  // docs/city_v3.md, «Решения АГ-1», п. 9).
  game: { named: 57, inTables: 12 },
  // 14 = кэш кусков карты `CHUNK_TTL` (инструмент, не мир), срок предупреждения о разрыве
  // пакта `PACT_BREAK_NOTICE` (оно даёт игроку время увести дипломата — его часы), почта
  // (`LETTER_TTL`, две паузы — решение владельца, раздел 16), восемь прочих и сутки энергии
  // промыслов `ENERGY_REFILL` (время игрока, как ежедневка: docs/minigames.md, раздел 1). Алмаз уступил прежнюю долю
  // суток `GEM_REAL_SECONDS` даровым пяти минутам ускорения `RUSH_FREE_SECONDS` (docs/gems.md) — счёт тот же. 15 — и пауза
  // сетки почты, которой сервер меряет ответы на вести державы `CROWN_SLOT_MS` (СБ-2): та же пауза писем мира, копией без
  // `@/`, равенство держит тест вестей. 17 — и рынок РН-1: длина привоза `SHIFT` и полураспад нажима `PRESS_HALF` (docs/city_v3.md,
  // «Решения РН-1»): привоз меняется по часам игрока, а не мира, — каждые 3 часа по UTC (РН-1б: сдвига сетки больше нет).
  // 18 — и проход у рогаток `CAMP_GATE_CLEAR`: десять настоящих минут потока против дробления вылазки (п. 10а
  // docs/audit/OWNER-DECISIONS.md, АУ-1).
  // 21 — и дух дружины ДР-1 (docs/siege_v2.md, «Решения ДР-1»): к потолку за `WAGE_RECOVER_MS` и к дну за `WAGE_FALL_MS` после смены
  // жалованья (слово владельца — «~6 настоящих часов»), память боёв тает вдвое за `GLORY_HALF_MS`: время игрока, как ежедневка.
  real: { named: 21, inTables: 0 },
  owner: { named: 0, inTables: 0 },
  // 15 = 13 плюс дальность истощения лагеря `CAMP_WASTE_DAYS` (docs/siege_v2.md, 3.2): игровые дни пути, при которых
  // лагерь тает вдвое, — мерка дороги, как у энергии; и срок повтора вестей державы `CROWN_EVERY_DAYS` (СБ-2,
  // docs/stability.md): игровые дни по редкости, мерой суток отлучки. 16 — и окно просителей совета Ратуши `WINDOW_DAYS`
  // (РТ-1, docs/city_v3.md): сезон игровых дней, после которого в ратуше новые просители.
  days: 16,
};

describe('классы величин времени: по исходникам', () => {
  const all = timeConsts(ROOT);

  it('величины найдены, и у каждого класса есть свои', () => {
    // Точка внутри области: чтение исходников видит объявления — иначе всё ниже зелёное даром.
    expect(all.length, 'величин с классом').toBeGreaterThan(50);
    // «Решает владелец» может быть пуст — и сейчас пуст: все девять вопросов решены (docs/time.md, раздел 16).
    for (const cls of ['game', 'real'] as const) expect(all.filter((c) => c.cls === cls).length, cls).toBeGreaterThan(0);
    expect(all.map((c) => c.name)).toEqual(expect.arrayContaining(['AI_ATTACK_MIN', 'LETTER_TTL', 'SIEGE_IMMUNE', 'AI_WARNING_BASE']));
    expect(dayConsts(ROOT).length, 'сроки в игровых днях').toBeGreaterThan(5);
    expect(tableRows(ROOT).reduce((n, r) => n + r.n, 0), 'строки таблиц').toBeGreaterThan(5);
  });

  // Счёт по классам — число, на которое ссылаются документы (docs/time.md, раздел 13; правило 12).
  // Новая величина времени меняет его сознательно: ей выбирают класс и правят число здесь.
  it('сколько величин в каждом классе', () => {
    const rows = tableRows(ROOT);
    const count = (cls: 'game' | 'real' | 'owner') => ({
      named: all.filter((c) => c.cls === cls).length,
      inTables: rows.filter((r) => r.cls === cls).reduce((n, r) => n + r.n, 0),
    });
    expect({ game: count('game'), real: count('real'), owner: count('owner'), days: dayConsts(ROOT).length }).toEqual(COUNT);
    expect(all.filter((c) => c.cls === 'owner').map((c) => c.name), 'вопросов владельцу не осталось').toEqual([]);
  });

  it('величины времени без класса нет ни одной', () => {
    expect(unclassified(ROOT), 'объявлена единицей настоящего времени, но без конструктора класса').toEqual([]);
  });

  // Ставка — тоже время, и пачка 2 её не увидела: она искала сроки. `SIEGE_TOWN_EAT` был записан
  // «в настоящий час», единица стояла в прозе, и после поворота шкалы чужой город падал голодом
  // меньше чем за игровой день — раньше собственной вылазки (docs/time.md, раздел 18).
  it('ставки без класса нет ни одной', () => {
    expect(unclassifiedRates(ROOT), 'втекает в имя с настоящей единицей, но не прошла дверь').toEqual([]);
  });

  // Точка внутри области: прибор ставок вообще что-то видит. Без этого утверждения тест выше
  // зелен и при сломанном поиске — ровно так ставка и проскочила мимо пачки 2.
  it('прибор ставок видит ставки, а не молчит', () => {
    const rates = timeConsts(ROOT).filter((c) => RATE_CTORS.includes(c.ctor));
    expect(rates.map((c) => c.name).sort(), 'ставки с классом').toEqual(
      ['BUILDER_RATE', 'CRAFTER_BUILD', 'GEM_REF_RATE', 'RECRUIT_WORK', 'SMITH_WORK', 'SIEGE_EAT_FLOOR', 'SIEGE_TOWN_EAT', 'SIEGE_TOWN_EAT_MAN'].sort(),
    );
  });

  // Та же точка для самого поиска: «ставок без класса нет» проходит и у ослепшего поиска, а
  // ослепнуть ему есть от чего — переводы строк, форма объявления, регистр в имени. Поэтому
  // поиску подсовывают дерево, где ставка без класса заведомо есть, и требуют её назвать.
  it('поиск ставок находит ставку без класса, когда она есть', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'rates-'));
    try {
      for (const zone of ['src/game', 'src/world']) mkdirSync(path.join(fixture, zone), { recursive: true });
      const lines = [
        'export const TOWN_EAT = 1.5;',
        'export const TOWN_EAT_MAN = worldDayRate(1);',
        'export const eatPerHour = (pop: number): number => pop * TOWN_EAT;',
        'export const larder = { perManPerHour: TOWN_EAT_MAN };',
        '',
      ];
      // Два перевода строки, и оба нарочно: в дереве есть файлы и с LF, и с CRLF (`world/siege.ts`
      // — CRLF), а объявление прибор ищет по `;` с переводом строки. Прибор, не сводящий их,
      // молчал бы ровно на половине дерева — и молчал бы зелено.
      writeFileSync(path.join(fixture, 'src/world/lf.ts'), lines.join('\n'));
      writeFileSync(path.join(fixture, 'src/world/crlf.ts'), lines.join('\r\n'));
      writeFileSync(path.join(fixture, 'src/game/keep.ts'), 'export const KEEP = 1;\n');
      const found = unclassifiedRates(fixture);
      expect(found, 'ставка без двери названа в обоих файлах, прошедшая дверь — ни в одном').toEqual([
        'src/world/crlf.ts: eatPerHour ← TOWN_EAT = 1.5',
        'src/world/lf.ts: eatPerHour ← TOWN_EAT = 1.5',
      ]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  /**
   * Окна защиты игрока попарно различны.
   *
   * Это единственное, что прибор классов умеет сказать о **паре** величин, и сказать ему
   * есть о чём: после поворота шкалы `SIEGE_IMMUNE` стал настоящими сутками — ровно тем же
   * числом, что `BURN_IMMUNE`, — и оба ставятся от одной минуты падения. Равные окна значат,
   * что длинное не значит ничего: у своего города второго падения внутри суток не бывало
   * вовсе, и ступень «сжечь → ограбить» не спрашивалась ни разу (docs/time.md, раздел 18.3).
   *
   * Правило list-free: оно ничего не знает про `SIEGE_IMMUNE` и `BURN_IMMUNE` поимённо —
   * берутся все величины, объявленные конструктором окна защиты. Чего оно не умеет: сказать,
   * какое из окон должно быть длиннее. Это смысл ступени, а не объявление, и держит его
   * `world/worldscale.test.ts` при боевой шкале.
   */
  it('окна защиты игрока попарно различны: равные накрывают друг друга', async () => {
    const shields = timeConsts(ROOT).filter((c) => c.ctor === 'shieldTime');
    // Точка внутри области: окон защиты в игре больше одного — иначе правило про пары пусто.
    expect(shields.length, 'сколько окон защиты объявлено').toBeGreaterThan(1);
    const { values } = await valuesAt(SCALE, shields);
    const same: string[] = [];
    for (let i = 0; i < shields.length; i++)
      for (let j = i + 1; j < shields.length; j++) {
        const a = values.get(`${shields[i].file}:${shields[i].name}`);
        const b = values.get(`${shields[j].file}:${shields[j].name}`);
        if (a !== undefined && a === b) same.push(`${shields[i].name} = ${shields[j].name} = ${a}`);
      }
    expect(same, 'два окна защиты с одним числом: длинное накрыто коротким').toEqual([]);
  });

  it('у «решает владелец» вопрос назван словами', () => {
    const silent = all.filter((c) => c.cls === 'owner' && !(c.why && c.why.length > 10)).map((c) => c.name);
    expect(silent).toEqual([]);
  });
});

describe('класс делает, что обещает: прогоном при шкале, отличной от единицы', () => {
  it('игровое время идёт со шкалой, настоящее и «решает владелец» — нет', async () => {
    const all = timeConsts(ROOT);
    const base = await valuesAt(1, all);
    const slow = await valuesAt(SCALE, all);
    expect(slow.pace.timeScale(), 'точка внутри области: шкала отлична от единицы').toBe(SCALE);
    expect(base.values.size, 'точка внутри области: значения прочитаны').toBeGreaterThan(50);
    const wrong: string[] = [];
    for (const c of all) {
      const key = `${c.file}:${c.name}`;
      const a = base.values.get(key);
      const b = slow.values.get(key);
      if (a === undefined || b === undefined || a === 0) continue;
      if (c.cls === 'owner') {
        // Пока владелец не решил, величина идёт, как шла: число не меняется.
        if (a !== b) wrong.push(`${c.name} (${c.ctor}): было ${a}, стало ${b}`);
        continue;
      }
      // Чем измерена величина, говорит конструктор: у мира — настоящие мс, у племени — игровые
      // секунды, у ставки — работа в игровую секунду или за настоящий час. Ставка идёт со шкалой
      // обратно сроку, поэтому сравнивается не она, а срок, за который она отдаёт единицу: так
      // одна мерка годится и сроку, и ставке. Сколько НАСТОЯЩИХ секунд это при каждой шкале:
      const seconds = (p: Pace, v: number): number =>
        c.ctor === 'worldDays' || c.ctor === 'realTime' || c.ctor === 'shieldTime'
          ? v / 1000
          : c.ctor === 'realSec'
            ? v
            : c.ctor === 'gameRate'
              ? p.realSeconds(1 / v)
              : c.ctor === 'worldDayRate' || c.ctor === 'realHourRate'
                ? 3600 / v
                : p.realSeconds(v);
      const ratio = seconds(slow.pace, b) / seconds(base.pace, a);
      const want = c.cls === 'game' ? SCALE : 1;
      if (Math.abs(ratio - want) > 1e-9) wrong.push(`${c.name} (${c.ctor}): настоящая длительность ×${ratio}, по классу ×${want}`);
    }
    expect(wrong).toEqual([]);
  });

  it('решения владельца: угроза и события мира — в игровых днях, почта и окна защиты — в настоящем времени', async () => {
    // Игровое: ритм угрозы, вся семья предупреждения о набеге и сбор дружины против неё, пепелище, разорение и бунт.
    const GAME = ['AI_ATTACK_MIN', 'LAIR_RIPE', 'CAMP_WORKS_RIPE', 'AI_WARNING_BASE', 'HANDOVER_MAX', 'LAIR_RUIN', 'SACK_DURATION', 'REVOLT_DURATION'];
    // Настоящее: почта и окна защиты игрока.
    const REAL = ['LETTER_TTL', 'SIEGE_IMMUNE', 'BURN_IMMUNE'];
    const names = [...GAME, ...REAL];
    const pick = timeConsts(ROOT).filter((c) => names.includes(c.name));
    expect(pick.map((c) => c.name).sort(), 'точка внутри области: величины на месте').toEqual([...names].sort());
    const base = await valuesAt(1, pick);
    const slow = await valuesAt(SCALE, pick);
    const at = (v: Map<string, number>, name: string): number => [...v.entries()].find(([k]) => k.endsWith(`:${name}`))![1];
    const dayMs = (p: Pace): number => p.realMs(p.DAY_LENGTH);
    for (const name of GAME) {
      expect(at(slow.values, name) / dayMs(slow.pace), `${name} в игровых днях`).toBeCloseTo(at(base.values, name) / dayMs(base.pace), 9);
      expect(at(slow.values, name), `${name} в настоящих мс`).toBeCloseTo(at(base.values, name) * SCALE, 6);
    }
    for (const name of REAL) expect(at(slow.values, name), `${name} — настоящее время`).toBe(at(base.values, name));
    expect(at(slow.values, 'LAIR_RUIN') / dayMs(slow.pace), 'пепелище — неделя игрового времени').toBeCloseTo(7, 9);
  });

  // Правило владельца: окно, которое даёт игроку время прийти и ответить, меряется его временем, а не
  // временем мира. Записано оно конструктором `shieldTime`; сетка ниже ловит окно защиты, объявленное
  // мимо него. Сетка — по имени (`IMMUNE`): смысл из числа не выводится, и это сказано прямо.
  it('окна защиты игрока объявлены своим конструктором и со шкалой не идут', async () => {
    const all = timeConsts(ROOT);
    const shields = all.filter((c) => c.ctor === 'shieldTime');
    const byName = all.filter((c) => /IMMUNE/.test(c.name));
    expect(byName.length, 'точка внутри области: сетка по имени видит окна').toBeGreaterThan(0);
    expect(byName.filter((c) => c.ctor !== 'shieldTime').map((c) => `${c.name} (${c.ctor})`), 'окно защиты объявлено не своим классом').toEqual([]);
    expect(shields.map((c) => c.name).sort(), 'точка внутри области: окна защиты найдены').toEqual(['BURN_IMMUNE', 'SIEGE_IMMUNE']);
    const base = await valuesAt(1, shields);
    const slow = await valuesAt(SCALE, shields);
    expect(slow.pace.timeScale(), 'точка внутри области: шкала отлична от единицы').toBe(SCALE);
    for (const [key, v] of base.values) expect(slow.values.get(key), `${key}: настоящие миллисекунды при любой шкале`).toBe(v);
  });

  it('конструкторы сведены в классы без дыр', () => {
    expect(Object.values(CTOR_CLASS).sort().filter((c, i, a) => a.indexOf(c) === i)).toEqual(['game', 'owner', 'real']);
  });
});
