// Прибор обязан быть честным: назвать причину он может только тогда, когда её
// видно по показаниям, а во всех остальных случаях сказать «не знаю».
import { describe, expect, it } from 'vitest';
import { diagnose, sceneLog, STALL_MS, LOG_MAX, VERDICT_TEXT, type Vitals } from './scenelog';

const OK: Vitals = {
  now: 10_000,
  frames: 600,
  lastFrame: 9_990,
  lost: false,
  blocks: [],
  css: { w: 390, h: 844 },
  buffer: { w: 780, h: 1688 },
};

const with_ = (p: Partial<Vitals>): Vitals => ({ ...OK, ...p });

describe('приговор по показаниям', () => {
  it('кадры идут — сцена жива', () => {
    expect(diagnose(OK)).toBe('ok');
  });

  it('приборов нет — «не знаю», а не догадка', () => {
    expect(diagnose(null)).toBe('unknown');
    expect(VERDICT_TEXT.unknown).toMatch(/не знаю/i);
  });

  it('потерянный контекст называется потерянным', () => {
    expect(diagnose(with_({ lost: true }))).toBe('lost');
    expect(diagnose(with_({ blocks: ['lost'] }))).toBe('lost');
  });

  it('нулевой холст — своя причина, а не «кадры не идут»', () => {
    expect(diagnose(with_({ css: { w: 0, h: 844 } }))).toBe('zero');
    expect(diagnose(with_({ buffer: { w: 780, h: 0 } }))).toBe('zero');
  });

  it('кадры встали при живом контексте и целом холсте — остановка', () => {
    expect(diagnose(with_({ lastFrame: OK.now - STALL_MS - 1 }))).toBe('stall');
    // Заминка короче порога остановкой не считается: сезон переливается дольше кадра.
    expect(diagnose(with_({ lastFrame: OK.now - STALL_MS + 1 }))).toBe('ok');
  });

  it('остановленный нарочно луп не выдаётся за поломку', () => {
    expect(diagnose(with_({ blocks: ['map'], lastFrame: 0 }))).toBe('map');
    expect(diagnose(with_({ blocks: ['hidden'], lastFrame: 0 }))).toBe('hidden');
    expect(diagnose(with_({ blocks: ['gone'], lastFrame: 0 }))).toBe('gone');
  });

  it('причина называется одна, и это самая объясняющая', () => {
    // Потерянный контекст останавливает и кадры, и луп. Назвать надо потерю:
    // чинить остановку кадров тут бесполезно.
    const both = with_({ lost: true, blocks: ['lost', 'hidden'], lastFrame: 0 });
    expect(diagnose(both)).toBe('lost');
  });

  it('кадров не было ни одного, а причин не видно — «не знаю»', () => {
    expect(diagnose(with_({ frames: 0, now: 10, lastFrame: 10 }))).toBe('unknown');
  });
});

describe('журнал', () => {
  it('кольцо не растёт без предела и держит последние записи', () => {
    for (let i = 0; i < LOG_MAX * 2; i++) sceneLog.mark('watch', `n${i}`);
    const list = sceneLog.list();
    expect(list.length).toBe(LOG_MAX);
    expect(list[list.length - 1].note).toBe(`n${LOG_MAX * 2 - 1}`);
  });

  it('без подключённой сцены отчёт говорит «не знаю» и не выдумывает чисел', () => {
    const text = sceneLog.report();
    expect(text).toMatch(/не знаю/i);
    expect(text).not.toMatch(/холст/);
    expect(text).toMatch(/журнал:/);
  });

  it('подключённая сцена отдаёт в отчёт свои числа', () => {
    const wired = { vitals: () => OK, revive: () => undefined };
    sceneLog.attach(wired);
    const text = sceneLog.report({ Telegram: 'android 8.0' });
    expect(text).toContain('390×844');
    expect(text).toContain('780×1688');
    expect(text).toContain('android 8.0');
    sceneLog.detach(wired);
    expect(sceneLog.vitals()).toBeNull();
  });

  it('пересборка есть только тогда, когда есть кому её делать', () => {
    expect(sceneLog.revive()).toBe(false);
    let called = 0;
    const wired = { vitals: () => null, revive: () => void called++ };
    sceneLog.attach(wired);
    expect(sceneLog.revive()).toBe(true);
    expect(called).toBe(1);
    sceneLog.detach(wired);
  });
});
