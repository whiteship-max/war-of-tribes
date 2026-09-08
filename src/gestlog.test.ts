// Журнал касаний. Проверяется одно: он не догадывается.
//
// Прибор заводится ради жалобы, которую иначе не разобрать, и цена вранья здесь
// та же, что у журнала сцены: названная наугад причина уведёт следующую починку
// в сторону, а её сочтут помогшей.
import { beforeEach, describe, expect, it } from 'vitest';
import { TOUCH_MAX, gestLog, type Touch } from './gestlog';

const touch = (o: Partial<Touch> = {}): Touch => ({
  at: 1000,
  where: 'деревня',
  fingers: 1,
  ms: 200,
  far: 3,
  path: 4,
  end: 'тап',
  hit: 'smithy',
  drift: 0,
  ...o,
});

beforeEach(() => gestLog.clear());

describe('журнал помнит ограниченное число касаний', () => {
  it('кольцо на TOUCH_MAX: старое уходит, новое остаётся', () => {
    for (let i = 0; i < TOUCH_MAX + 10; i++) gestLog.add(touch({ ms: i }));
    expect(gestLog.list().length).toBe(TOUCH_MAX);
    expect(gestLog.list()[TOUCH_MAX - 1].ms).toBe(TOUCH_MAX + 9);
  });
});

describe('итог называет факты, а не причины', () => {
  it('пустой журнал так и говорит', () => {
    expect(gestLog.summary()).toEqual(['Касаний не записано.']);
  });

  it('считает исходы', () => {
    gestLog.add(touch());
    gestLog.add(touch({ end: 'ведение', far: 90, hit: null }));
    gestLog.add(touch({ end: 'отменено браузером', hit: null }));
    expect(gestLog.summary()[0]).toContain('тапов 1');
    expect(gestLog.summary()[0]).toContain('ведений 1');
    expect(gestLog.summary()[0]).toContain('отменённых браузером 1');
  });

  it('называет форму самой жалобы: палец стоял, а не открылось ничего', () => {
    gestLog.add(touch({ end: 'ведение', far: 4, hit: null }));
    expect(gestLog.summary().join(' ')).toContain('почти не двигались');
  });

  it('называет вторую форму: картинка уехала, хотя палец стоял', () => {
    gestLog.add(touch({ far: 3, drift: 14 }));
    expect(gestLog.summary().join(' ')).toContain('камеру двигает не палец');
  });

  it('про то, чего не измерил, пишет «не знаю», а не ноль', () => {
    gestLog.add(touch({ drift: null }));
    expect(gestLog.report()).toContain('картинка не знаю');
    // И такое касание не попадает в счёт «картинка уехала»: неизвестное — не факт.
    expect(gestLog.summary().join(' ')).not.toContain('камеру двигает не палец');
  });
});

describe('отчёт для переписки', () => {
  it('содержит и итог, и каждую строку, и подпись клиента', () => {
    gestLog.add(touch({ where: 'карта', hit: 'F7' }));
    const text = gestLog.report({ Telegram: 'Android 8.1' });
    expect(text).toContain('TRIBE, касания:');
    expect(text).toContain('Telegram: Android 8.1');
    expect(text).toContain('карта');
    expect(text).toContain('F7');
  });
});
