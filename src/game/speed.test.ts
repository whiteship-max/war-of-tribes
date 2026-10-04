// Скорость проверки: часы партии (`game/pace`, «Скорость проверки»; `net/clock`).
//
// Что держат эти тесты. Скорость — инструмент проверки за выключателем кодов, и у неё три обещания:
// **одна дверь** (племя и мир проживают одно и то же время, шкала не поворачивается), **правила
// присутствия** (ускоренная партия живёт шагом при игроке, а не догоном отлучки) и **замок** (с опущенным
// выключателем скорости нет). Плюс честность: партия, которую ускоряли, помечена навсегда.
//
// Все свойства сняты при скорости, отличной от единицы, и это утверждение стоит в самих тестах: при ×1
// опережение ноль, и «племя прожило столько же, сколько мир» зелёно при любом коде (правило 11).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAY_LENGTH,
  SPEEDS,
  dayRealSeconds,
  gameSeconds,
  gameSecondsOfMs,
  livedSeconds,
  realMs,
  speed,
  timeScale,
} from './pace';
import { enterLead, hurry, leadAt, leadNow, partyNow, serverNow } from '@/net/clock';
import { AWAY_AFTER, CATCHUP_STEP, liveStep, present, tick } from './sim/tick';
import { createInitialState } from './state';
import { moraleTarget } from './derived';
import { deserialize, serialize } from './save';
import { markHaste } from './sim/cheat';
import { CHEATS_ON, HASTE_MARK } from '@/cheats';
import { TICK_MS } from './store';
import { PULSE_MS } from '@/world/store';
import { PULSE_FLOOR } from '../../scripts/autopilot';

const T0 = 1_800_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  enterLead(0);
});

afterEach(() => {
  enterLead(0);
  vi.useRealTimers();
});

describe('ступени скорости выведены, а не выбраны', () => {
  it('×30 — игровой день за минуту, и пульс мира при нём — ровно пол пульса отчётов', () => {
    const k = SPEEDS[1];
    expect(dayRealSeconds() / k, 'игровой день при ×30 — настоящая минута').toBe(DAY_LENGTH);
    expect(k, 'та же шкала, при которой написаны тесты правил мира (`pace.minute`)').toBe(timeScale());
    expect((PULSE_MS * k) / 1000, 'пульс мира при ×30 — секунд партии').toBe(PULSE_FLOOR);
  });

  it('×120 — шаг живой игры ровно шаг догона, пульс мира — внутри мерянного', () => {
    const k = SPEEDS[SPEEDS.length - 1];
    expect(gameSeconds((TICK_MS / 1000) * k), 'шаг живой игры при верхней ступени, игровых секунд').toBe(CATCHUP_STEP);
    // Шаг `siege:report` — десять игровых секунд (300 с при ×30): на нём отчёт совпал с шагом в
    // шестьдесят, из 151 строки разошлась одна (docs/time.md, раздел 18.10). Выше верхней ступени пульс
    // грубее всего мерянного.
    expect(PULSE_MS * k, 'пульс мира при ×120, мс партии').toBeLessThanOrEqual(realMs(10));
    expect(PULSE_MS * k * 2, 'следующая удвоенная ступень уже вне мерянного').toBeGreaterThan(realMs(10));
  });

  it('первая ступень — правда: ×1', () => {
    expect(SPEEDS[0]).toBe(1);
    expect(speed(), 'партия входит в игру на ×1').toBe(1);
  });
});

describe('ускорение идёт одной дверью: племя и мир проживают одно время', () => {
  it('за шаг цикла на ×30 мир уходит на тридцать шагов, и племя — ровно туда же', () => {
    hurry(SPEEDS[1]);
    expect(speed(), 'точка внутри области: скорость не единица').toBe(30);
    const s = createInitialState(7);
    const t0 = s.time;
    const world0 = leadNow();
    const lead0 = leadAt();

    vi.setSystemTime(T0 + TICK_MS);
    const real = TICK_MS / 1000;
    const lived = livedSeconds(real, lead0, leadAt());
    liveStep(s, real, leadNow(), lived);
    const world = leadNow() - world0;

    expect(world, 'мир: часы партии ушли на скорость × настоящее').toBe(30 * TICK_MS);
    expect(s.time - t0, 'племя прожило столько же, сколько мир').toBeCloseTo(gameSecondsOfMs(world), 12);
    expect(s.time - t0, 'и не вдвое: скорость приложена один раз').toBeCloseTo(gameSeconds(30 * real), 12);
    expect(timeScale(), 'шкала при скорости не поворачивается: числа мира считаны при импорте').toBe(30);
  });

  it('смена скорости не переписывает прошлое: набежавшее остаётся, дальше идёт новым ходом', () => {
    const top = SPEEDS[SPEEDS.length - 1];
    hurry(SPEEDS[1]);
    vi.setSystemTime(T0 + 10_000);
    const before = leadAt();
    expect(before, 'точка внутри области: партия ушла вперёд').toBe(29 * 10_000);
    hurry(1);
    expect(leadAt(), 'на ×1 опережение то же').toBe(before);
    vi.setSystemTime(T0 + 20_000);
    expect(leadAt(), 'и не растёт и не тает').toBe(before);
    hurry(top);
    vi.setSystemTime(T0 + 21_000);
    expect(leadAt(), 'новый ход — только с минуты смены').toBe(before + (top - 1) * 1000);
  });

  it('вход партии: опережение из партии, скорость — ×1', () => {
    hurry(SPEEDS[SPEEDS.length - 1]);
    enterLead(5_000);
    expect(speed()).toBe(1);
    vi.setSystemTime(T0 + 60_000);
    expect(leadAt(), 'партия входит со своим опережением и дальше идёт правдой').toBe(5_000);
    expect(leadNow() - serverNow(), 'часы партии впереди настоящих ровно на опережение').toBe(5_000);
  });
});

describe('ускоренная партия живёт правилами присутствия, а не догоном', () => {
  it('шаг на ×30 длиннее порога отлучки в часах партии — и всё равно шаг, а не отлучка', () => {
    // Отлучку от шага отличает осада: догон снимает её по сроку (`opts.offline`), шаг — нет (снимает мир).
    const s = createInitialState(7);
    const real = TICK_MS / 1000;
    const lived = 30 * real * 2;
    expect(real, 'точка внутри области: по часам устройства это шаг').toBeLessThanOrEqual(AWAY_AFTER);
    expect(lived, 'а по часам партии — дольше порога отлучки').toBeGreaterThan(AWAY_AFTER);
    const until = s.time + gameSeconds(lived) / 2;
    s.siege = { byName: 'логово', until };
    liveStep(s, real, T0, lived);
    expect(s.siege, 'осада стоит: шаг при игроке её не снимает').not.toBeNull();
    expect(s.time, 'точка внутри области: срок осады по часам племени прошёл').toBeGreaterThan(until);
  });

  it('длинный шаг при игроке идёт кусками шага догона: подтяжка морали — тем же ходом', () => {
    const dt = 30 * CATCHUP_STEP;
    const long = createInitialState(7);
    long.morale = 10;
    const steps = createInitialState(7);
    steps.morale = 10;
    present(long, dt);
    for (let i = 0; i < 30; i++) tick(steps, CATCHUP_STEP);
    expect(dt, 'точка внутри области: шаг длиннее шага догона').toBeGreaterThan(CATCHUP_STEP);
    expect(long.time).toBeCloseTo(steps.time, 9);
    expect(long.morale, 'мораль — как у шагов догона, а не прыжком к цели за один шаг').toBeCloseTo(steps.morale, 9);
    expect(Math.abs(moraleTarget(long) - long.morale), 'точка внутри области: до цели ещё далеко').toBeGreaterThan(1);
    expect(long.morale - 10, 'и мораль сдвинулась').toBeGreaterThan(10);
  });
});

describe('метка ускоренной партии', () => {
  it('первое ускорение пишет строку и ставит поле, следующие — только поле', () => {
    const s = createInitialState(7);
    expect(s.lead, 'новая партия не помечена').toBeUndefined();
    markHaste(s, 0);
    markHaste(s, 1234);
    expect(s.lead).toBe(1234);
    expect(s.log.filter((e) => e.text === HASTE_MARK).length, 'строка — одна за партию').toBe(1);
  });

  it('метка переживает запись и чтение при опущенном выключателе; непомеченная партия поля не получает', () => {
    expect(CHEATS_ON, 'проверка — при выключателе игроков').toBe(false);
    const s = createInitialState(7);
    expect(JSON.parse(serialize(s)), 'не ускоряли — поля нет').not.toHaveProperty('lead');
    markHaste(s, 42_000);
    const back = deserialize(serialize(s));
    expect(back?.lead, 'метка и данные часов на месте').toBe(42_000);
  });
});

// ---------- Замок: скорость живёт за выключателем кодов ----------

const ROOT = join(__dirname, '..', '..');
const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
const sources = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
  };
  walk(dir);
  return out;
};
const rel = (f: string): string => relative(ROOT, f).split(sep).join('/');
const SRC = sources(join(ROOT, 'src'));
const callers = (re: RegExp): string[] => SRC.filter((f) => re.test(strip(readFileSync(f, 'utf8')))).map(rel).sort();

describe('замок: с опущенным выключателем скорости нет', () => {
  it('часы партии при опущенном выключателе — настоящие часы, та же функция', () => {
    expect(CHEATS_ON).toBe(false);
    expect(partyNow, 'сборка игроков читает serverNow как есть').toBe(serverNow);
  });

  it('скорость меняет одна кнопка, и рисуется она только под выключателем', () => {
    expect(callers(/\bsetSpeed\s*\(/), 'pace.setSpeed зовёт одна дверь').toEqual(['src/game/pace.ts', 'src/net/clock.ts']);
    expect(callers(/\bhurry\s*\(/), 'дверь зовёт одна кнопка').toEqual(['src/ui/SpeedButton.tsx']);
    const shown = SRC.map((f) => ({ f: rel(f), src: strip(readFileSync(f, 'utf8')) })).filter((x) => /<SpeedButton\b/.test(x.src));
    // Место показа одно — карта: в городе кнопка стояла в верхней строке прежнего интерфейса, удалённого
    // (docs/ui_audit.md, 16).
    expect(shown.map((x) => x.f).sort(), 'точка внутри области: место показа есть').toEqual(['src/ui/map/WorldMap.tsx']);
    for (const { f, src } of shown) {
      const bare = src.match(/[^\n]*<SpeedButton\b[^\n]*/g)!.filter((line) => !/CHEATS_ON\s*&&\s*<SpeedButton\b/.test(line));
      expect(bare, `${f}: кнопка скорости мимо выключателя`).toEqual([]);
    }
  });

  it('опережение партии входит в игру и уходит на диск только под выключателем', () => {
    const save = strip(readFileSync(join(ROOT, 'src/game/save.ts'), 'utf8'));
    const store = strip(readFileSync(join(ROOT, 'src/game/store.ts'), 'utf8'));
    expect(callers(/\benterLead\s*\(/), 'кто ставит опережение').toEqual(['src/game/save.ts', 'src/game/store.ts']);
    expect(save, 'вход партии').toMatch(/if \(CHEATS_ON\) enterLead\(state\.lead \?\? 0\);/);
    expect(store, 'новая партия').toMatch(/if \(CHEATS_ON\) enterLead\(0\);/);
    expect(save, 'запись').toMatch(/CHEATS_ON && s\.lead !== undefined \? \{ \.\.\.s, lastSaved: partyNow\(\), lead: leadAt\(\) \}/);
  });

  it('шаг племени в цикле стора получает прожитое партией, а часы — партии', () => {
    const store = strip(readFileSync(join(ROOT, 'src/game/store.ts'), 'utf8'));
    expect(store, 'прожитое — одной дверью').toMatch(/lived = livedSeconds\(real, lastLead, ahead\);/);
    expect(store, 'шаг получает прожитое').toMatch(/liveStep\(s, real, partyNow\(\), lived\);/);
    expect(store, 'почта — часы партии').toMatch(/mailStep\(s, partyNow\(\)\)/);
  });
});
