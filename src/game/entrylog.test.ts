// Строка о приведении партии ложится в летопись после догона отлучки — правилом, а не поштучно.
//
// Летопись режется по возрасту (`LOG_MAX_DAYS`, тридцать игровых дней), а догон отлучки идёт до
// `MAX_OFFLINE_DAYS` (сорока восьми). Ступени сохранения прежде писали свои строки при чтении
// записи, до догона: строка вставала на минуту записи, и после суток отлучки её срезал возраст —
// игрок не узнавал, что изменилось. Строка об участи (ступень 19 → 20) писалась уже после догона и
// выживала; остальные — нет.
//
// Держится это с двух сторон. **По исходнику:** в `save.ts` один вызов `log`, и он в двери входа
// (`afterEntry`), — ступени говорят (`tell`), а пишет вход. **Прогоном:** каждая версия, которую
// ещё приводят (от `MIN_SAVE_VERSION` до нынешней), загружается дважды — сразу после записи и после
// отлучки длиннее месяца летописи; что ступени сказали в первый раз, обязано дожить во второй и
// стоять на минуте входа. Список ступеней нигде не пишется: что они говорят, показывает сама
// загрузка без отлучки. Запись в обоих заходах одна и та же, сдвигаются часы (`setServerTime`):
// ступень 12 → 13 выводит сид партии из самой записи, и другая запись дала бы другого правителя.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createInitialState, SAVE_VERSION } from './state';
import { MIN_SAVE_VERSION, adoptSave, loadGame, serialize, loadFold } from './save';
import { DAY_LENGTH, MAX_OFFLINE_DAYS } from './constants';
import { LOG_MAX_DAYS } from './sim/log';
import { POINTS_CAP, REALM_BRANCHES } from './data/realm';
import { realMs } from './pace';
import { resetClock, setServerTime } from '@/net/clock';

// Партии младше 24-й читаются дверью перехода ЗД-1 — своей докачкой, как её подгружает вход (`save.loadFold`).
beforeAll(() => loadFold());

const disk = new Map<string, string>();

beforeEach(() => {
  disk.clear();
  // Пустое устройство спрашивает облако Telegram; вне Telegram его нет — и это законный случай.
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => disk.get(k) ?? null,
      setItem: (k: string, v: string) => void disk.set(k, v),
      removeItem: (k: string) => void disk.delete(k),
    },
  });
});

afterEach(() => {
  resetClock();
  delete (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { window?: unknown }).window;
});

const RECORDED = 500 * DAY_LENGTH;
/** Настоящая минута записи. */
const SAVED_AT = 1_800_000_000_000;

/**
 * Партия версии `version` с пустой летописью: всё, что в ней окажется после загрузки, написала
 * загрузка. Очки правителя — у потолка: строка об участи называет очки, и у потолка она одна и та же
 * до догона и после, — сравниваются строки, а не числа притока.
 */
function record(version: number): string {
  const s = createInitialState(7);
  s.tutorialDone = true;
  s.time = RECORDED;
  s.log = [];
  const raw = JSON.parse(serialize(s)) as Record<string, unknown> & { realm: { points: Record<string, number>; pointsAt: number } };
  raw.version = version;
  for (const b of REALM_BRANCHES) raw.realm.points[b] = POINTS_CAP;
  raw.realm.pointsAt = s.time;
  raw.lastSaved = SAVED_AT;
  return JSON.stringify(raw);
}

/** Войти в запись через `awayMs` настоящего времени после её минуты — дверью игры, `loadGame`. */
async function enterAfter(json: string, awayMs: number) {
  disk.clear();
  expect(adoptSave(json), 'запись читается и легла на диск').toBe(true);
  setServerTime(SAVED_AT + awayMs);
  return (await loadGame()).state;
}

describe('строки о приведении партии — после догона отлучки', () => {
  it('в save.ts летопись пишет одна строка — в двери входа, после догона', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'game', 'save.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    const calls = src.match(/(?<![.\w])log\(/g) ?? [];
    expect(calls, 'вызов log в save.ts ровно один').toHaveLength(1);
    const door = src.slice(src.indexOf('function afterEntry('), src.indexOf('export function enter('));
    expect(door.match(/(?<![.\w])log\(/g) ?? [], 'и он в двери входа').toHaveLength(1);
  });

  const versions: number[] = [];
  for (let v = MIN_SAVE_VERSION; v < SAVE_VERSION; v++) versions.push(v);

  it.each(versions)('версия %i: всё, что сказали ступени, переживает отлучку длиннее месяца летописи', async (version) => {
    const json = record(version);
    const said = (await enterAfter(json, 0)).log.map((e) => e.text);
    expect(said.length, 'точка внутри области: ступени этой версии говорят').toBeGreaterThan(0);

    const state = await enterAfter(json, realMs(MAX_OFFLINE_DAYS * DAY_LENGTH));
    expect(state.time - RECORDED, 'точка внутри области: отлучка длиннее месяца летописи').toBeGreaterThan(LOG_MAX_DAYS * DAY_LENGTH);
    for (const text of said) {
      const at = state.log.filter((e) => e.text === text).map((e) => e.at);
      expect(at.length, `строка пережила отлучку: «${text.slice(0, 60)}…»`).toBeGreaterThan(0);
      expect(Math.max(...at), `и стоит на минуте входа: «${text.slice(0, 60)}…»`).toBe(state.time);
    }
  });
});
