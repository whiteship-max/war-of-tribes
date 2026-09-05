import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { DAY_LENGTH } from '../constants';
import { dayOf } from '../derived';
import { deserialize, serialize } from '../save';
import { LOG_MAX, LOG_MAX_DAYS, log, trimLog } from './log';
import { catchUp } from './tick';

/** Кладёт запись задним числом: `at` считается от нынешнего времени. */
function backdate(s: ReturnType<typeof createInitialState>, daysAgo: number, text: string): void {
  s.log.unshift({ at: s.time - daysAgo * DAY_LENGTH, text, kind: 'info' });
  s.log.sort((a, b) => b.at - a.at);
}

describe('летопись', () => {
  it('запись помечена временем, и по нему считается возраст', () => {
    const s = createInitialState();
    s.time = 12 * DAY_LENGTH;
    log(s, 'Кузнец встал к горну.');
    expect(s.log[0].at).toBe(s.time);
    expect(dayOf(s.log[0].at)).toBe(13);
  });

  it('старше месяца выбрасывается, младше — остаётся', () => {
    const s = createInitialState();
    s.time = 100 * DAY_LENGTH;
    s.log = [];
    backdate(s, 1, 'вчера');
    backdate(s, LOG_MAX_DAYS - 1, 'почти месяц назад');
    backdate(s, LOG_MAX_DAYS + 1, 'больше месяца назад');
    backdate(s, LOG_MAX_DAYS * 3, 'три месяца назад');

    trimLog(s);

    const texts = s.log.map((e) => e.text);
    expect(texts).toContain('вчера');
    expect(texts).toContain('почти месяц назад');
    expect(texts).not.toContain('больше месяца назад');
    expect(texts).not.toContain('три месяца назад');
  });

  it('обрезка идёт по возрасту, а не по количеству: сотня записей за сутки остаётся целиком', () => {
    const s = createInitialState();
    s.time = 50 * DAY_LENGTH;
    s.log = [];
    // Прежнее правило «последние 80» срезало бы два десятка — а им всего по дню.
    for (let i = 0; i < 100; i++) log(s, `событие ${i}`);
    trimLog(s);
    expect(s.log).toHaveLength(100);
  });

  it('запасной предел держит бурную партию: больше LOG_MAX записей не хранится', () => {
    const s = createInitialState();
    s.time = 50 * DAY_LENGTH;
    s.log = [];
    for (let i = 0; i < LOG_MAX * 2; i++) log(s, `событие ${i}`);
    expect(s.log).toHaveLength(LOG_MAX);
    // Отрезан хвост, а не голова: свежее остаётся.
    expect(s.log[0].text).toBe(`событие ${LOG_MAX * 2 - 1}`);
    trimLog(s);
    expect(s.log.length).toBeLessThanOrEqual(LOG_MAX);
  });

  it('записи из будущего не отбрасываются: у них отрицательный возраст', () => {
    const s = createInitialState();
    s.time = 10 * DAY_LENGTH;
    s.log = [];
    backdate(s, -5, 'из будущего');
    trimLog(s);
    expect(s.log.map((e) => e.text)).toContain('из будущего');
  });

  it('на смене суток летопись сама теряет старое', () => {
    const s = createInitialState();
    s.tutorialDone = true;
    s.log = [];
    log(s, 'первый день');
    // Прокручиваем больше месяца: запись первого дня обязана уйти сама, без
    // единого вызова trimLog со стороны.
    catchUp(s, (LOG_MAX_DAYS + 2) * DAY_LENGTH, 5);
    expect(s.log.map((e) => e.text)).not.toContain('первый день');
    const oldest = Math.min(...s.log.map((e) => e.at));
    expect(s.time - oldest).toBeLessThanOrEqual(LOG_MAX_DAYS * DAY_LENGTH);
  });

  it('сохранение с раздутой летописью приводится к месяцу на загрузке', () => {
    const s = createInitialState();
    s.time = 400 * DAY_LENGTH;
    s.log = [];
    // Такое сохранение могло записать прежнее правило: 80 строк за полгода.
    for (let i = 0; i < 80; i++) backdate(s, i * 5, `старая запись ${i}`);
    const loaded = deserialize(serialize(s));
    expect(loaded).not.toBeNull();
    const oldest = Math.min(...loaded!.log.map((e) => e.at));
    expect(loaded!.time - oldest).toBeLessThanOrEqual(LOG_MAX_DAYS * DAY_LENGTH);
    expect(loaded!.log.length).toBeLessThan(80);
  });
});
