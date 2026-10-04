// Участь «увести людей» стала покупной ступенью, и кредита ей нет (docs/dynasty.md, раздел 11.2).
// Начатая партия теряет её до покупки — и узнаёт об этом строкой летописи, а не молча
// (ступень сохранения 19 → 20). Строка говорит, чего участь стоит, почему закрыта и хватает ли
// очков прямо сейчас, — и каждое её слово сверяется здесь с той же дверью, что стоит на кнопке
// «Изучить» (`sim/tech.studyInfo`).
//
// Область названа в каждом тесте: партия и правда старая (версия младше двадцатой), участь у неё
// и правда закрыта, — а там, где строка говорит об очках, очки и правда по ту или иную сторону
// цены. Иначе «строка говорит правду» было бы зелёным при любой строке.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInitialState, SAVE_VERSION } from './state';
import { adoptSave, loadGame, serialize } from './save';
import { fateOpen, studyInfo, techLevel } from './sim/tech';
import { pointsOf, rulerRate } from './sim/points';
import { levelPrice, WAR_CAPTIVES_LEVEL } from './data/realm';
import { gameSpan } from './span';
import { DAY_LENGTH } from './constants';
import { serverNow } from '@/net/clock';
import type { GameState } from './types';

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
  delete (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { window?: unknown }).window;
});

/**
 * Положить на диск партию версии `version`: военная ветвь на уровне `war`, военных очков `points`
 * на минуту записи, записана `awayMs` назад. Поля ставятся в запись так, как их оставила бы игра
 * той версии: уровень ветви и очки лежат в партии с семнадцатой.
 */
function stored(o: { version: number; war: number; points: number; awayMs?: number; armor?: boolean }): void {
  const s = createInitialState(7);
  s.tutorialDone = true;
  s.time = 500 * DAY_LENGTH;
  if (o.armor) s.equipment.armor = 2;
  const raw = JSON.parse(serialize(s)) as Record<string, unknown> & { realm: { tech: Record<string, number>; points: Record<string, number>; pointsAt: number } };
  raw.version = o.version;
  raw.realm.tech.war = o.war;
  raw.realm.points.war = o.points;
  raw.realm.pointsAt = s.time;
  raw.lastSaved = serverNow() - (o.awayMs ?? 0);
  // На диск — дверью игры: ключ и формат сохранения знает один save.ts.
  expect(adoptSave(JSON.stringify(raw)), 'запись читается и легла на диск').toBe(true);
}

const notice = (s: GameState): string[] => s.log.filter((e) => e.text.includes('«увести людей» стала технологией')).map((e) => e.text);

describe('старая партия узнаёт, что участь стала покупной', () => {
  it('очков хватает — строка так и говорит, и кнопка «Изучить» с ней согласна', async () => {
    stored({ version: 19, war: 7, points: 240 });
    const { state } = await loadGame();
    expect(techLevel(state, 'war'), 'точка внутри области: вещи изучены, участь — следующая').toBe(WAR_CAPTIVES_LEVEL - 1);
    expect(fateOpen(state, 'captives'), 'и она закрыта').toBe(false);
    const lines = notice(state);
    expect(lines, 'строка ровно одна').toHaveLength(1);
    const info = studyInfo(state, 'war');
    expect(info.next, 'кнопка продаёт восьмую').toBe(WAR_CAPTIVES_LEVEL);
    expect(info.blocked, 'и продаёт её сразу').toBeNull();
    expect(lines[0]).toContain(`${WAR_CAPTIVES_LEVEL} уровень войны, ${levelPrice('war', WAR_CAPTIVES_LEVEL)} очков`);
    expect(lines[0], 'почему закрыта').toMatch(/Засчитать её нечем, засчитываются только вещи на складе и в дружине/);
    expect(lines[0]).toContain(`Очков войны ${Math.floor(pointsOf(state, 'war'))} из ${info.price}, хватает.`);
  });

  it('очков не хватает — строка называет, сколько есть и сколько ждать, теми же числами', async () => {
    stored({ version: 19, war: 7, points: 50 });
    const { state } = await loadGame();
    const info = studyInfo(state, 'war');
    expect(info.blocked, 'точка внутри области: очков и правда не хватает').not.toBeNull();
    const [line] = notice(state);
    expect(line).toContain(`Очков войны ${Math.floor(info.have)} из ${info.price}, не хватает.`);
    expect(line).toContain(`накопится через ${gameSpan(info.wait)}`);
    expect(line).not.toMatch(/, хватает\./);
  });

  /**
   * Правда строки — на минуту входа, а не на минуту записи. Партия записана без полных очков, а
   * за отлучку их набегает на цену: строка обязана сказать «хватает». Отлучка — десять настоящих
   * часов, двадцать игровых дней: короче месяца летописи, чтобы строка, записанная и до догона,
   * дожила до проверки, — иначе мутация «писать до догона» падала бы на пропаже строки, а не на
   * её неправде. Мутация роняет именно «и строка говорит это».
   */
  it('очки считаются после догона отлучки: что набежало за отлучку, то и сказано', async () => {
    const probe = createInitialState(7);
    const rate = rulerRate(probe, 'war');
    const price = levelPrice('war', WAR_CAPTIVES_LEVEL);
    // Недостаёт десяти игровых дней притока, а отлучка — двадцать: догон их покроет.
    stored({ version: 19, war: 7, points: price - rate * 10, awayMs: 10 * 3600 * 1000 });
    const { state } = await loadGame();
    expect(state.time, 'точка внутри области: догон и правда был').toBeGreaterThan(500 * DAY_LENGTH + 10 * DAY_LENGTH);
    expect(state.time, 'и короче месяца летописи').toBeLessThan(500 * DAY_LENGTH + 30 * DAY_LENGTH);
    expect(studyInfo(state, 'war').blocked, 'к минуте входа очков хватает').toBeNull();
    const lines = notice(state);
    expect(lines, 'строка есть').toHaveLength(1);
    expect(lines[0], 'и строка говорит это, а не то, что было на минуту записи').toMatch(/, хватает\./);
  });

  /**
   * Летопись режется по возрасту — тридцать игровых дней, — а отлучка догоняется до сорока восьми.
   * Строка, записанная до догона, стояла бы на минуте записи и после суток отлучки ушла бы
   * вместе со старыми: игрок не увидел бы её вовсе. Мутация «писать до догона» роняет «строка
   * пережила отлучку».
   */
  it('строка переживает долгую отлучку: её не срезает возраст летописи', async () => {
    stored({ version: 19, war: 7, points: 100, awayMs: 24 * 3600 * 1000 });
    const { state } = await loadGame();
    expect(state.time, 'точка внутри области: отлучка длиннее месяца летописи').toBeGreaterThan(500 * DAY_LENGTH + 30 * DAY_LENGTH);
    expect(notice(state), 'строка пережила отлучку').toHaveLength(1);
  });

  it('ветвь не дошла до участи — строка называет ступени до неё и их цену вместе', async () => {
    stored({ version: 19, war: 3, points: 20 });
    const { state } = await loadGame();
    expect(techLevel(state, 'war'), 'точка внутри области: до участи далеко').toBe(3);
    let rest = 0;
    for (let l = 4; l <= WAR_CAPTIVES_LEVEL; l++) rest += levelPrice('war', l);
    const [line] = notice(state);
    expect(line).toContain(`Изучено до 3 уровня. Перед ней уровни 4–${WAR_CAPTIVES_LEVEL - 1}, вместе с ней ${rest} очков`);
    expect(line).toContain(`очков войны сейчас ${Math.floor(pointsOf(state, 'war'))}`);
  });

  it('партия восемнадцатой версии проходит обе ступени: ветвь засчитана, участь названа', async () => {
    stored({ version: 18, war: 1, points: 240, armor: true });
    const { state } = await loadGame();
    expect(techLevel(state, 'war'), 'ступень 18 → 19 засчитала доспех').toBe(WAR_CAPTIVES_LEVEL - 1);
    expect(notice(state), 'и ступень 19 → 20 сказала об участи').toHaveLength(1);
  });

  it('двадцатая версия и новая партия ничего не теряли — и строки нет', async () => {
    stored({ version: SAVE_VERSION, war: 7, points: 240 });
    const { state } = await loadGame();
    expect(fateOpen(state, 'captives'), 'точка внутри области: участь и у неё закрыта').toBe(false);
    expect(notice(state), 'но партия двадцатой версии записана уже при гейте').toHaveLength(0);

    disk.clear();
    const fresh = await loadGame();
    expect(fresh.fresh).toBe(true);
    expect(notice(fresh.state)).toHaveLength(0);
  });
});
