import { describe, expect, it } from 'vitest';
import { readRecord, type SaveRecord } from './contract.js';

const LIMITS = { game: 200, world: 100 };

const sent = (over: Record<string, unknown> = {}): unknown => ({
  v: 1,
  rev: 7,
  updatedAt: 1,
  device: 'd-abc',
  game: '{"pop":30}',
  world: '{"v":6}',
  card: { name: 'Вождь', day: 12, pop: 300, power: 4000, army: 40 },
  ...over,
});

describe('сервер не верит телу запроса', () => {
  it('честная запись разбирается', () => {
    const r = readRecord(sent(), LIMITS) as SaveRecord;
    expect(r.game).toBe('{"pop":30}');
    expect(r.card.day).toBe(12);
  });

  /**
   * Время ставит сервер. Присланное выбрасывается молча — не потому, что клиент
   * злодей, а потому, что часы у него свои: приняв их, мы получили бы записи из
   * будущего, и предел «не чаще раза в четыре секунды» перестал бы работать.
   */
  it('время из тела не принимается ни в каком виде', () => {
    expect(readRecord(sent({ updatedAt: 9_999_999_999_999 }), LIMITS)!.updatedAt).toBe(0);
  });

  it('лишние поля не проезжают в хранилище', () => {
    const r = readRecord(sent({ gems: 9999, admin: true }), LIMITS) as unknown as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual(['card', 'device', 'game', 'rev', 'updatedAt', 'v', 'world']);
  });

  it('опись приводится к числам: строкой в неё не подставить ничего', () => {
    const r = readRecord(sent({ card: { name: 5, day: '99', pop: -3, power: null } }), LIMITS)!;
    expect(r.card).toEqual({ name: '', day: 0, pop: 0, power: 0, army: 0 });
  });

  it('слишком длинное сохранение — отказ, а не обрезка', () => {
    expect(readRecord(sent({ game: 'x'.repeat(LIMITS.game + 1) }), LIMITS)).toBeNull();
    expect(readRecord(sent({ world: 'x'.repeat(LIMITS.world + 1) }), LIMITS)).toBeNull();
  });

  it('мира может не быть — карту игрок мог не открывать', () => {
    expect(readRecord(sent({ world: null }), LIMITS)!.world).toBeNull();
    expect(readRecord(sent({ world: undefined }), LIMITS)!.world).toBeNull();
  });

  it('без сохранения записи нет', () => {
    for (const bad of [null, 'строка', 42, {}, sent({ game: '' }), sent({ game: 7 }), sent({ device: '' })]) {
      expect(readRecord(bad, LIMITS)).toBeNull();
    }
  });

  it('имя длиннее разумного не проезжает', () => {
    expect(readRecord(sent({ card: { name: 'и'.repeat(200) } }), LIMITS)!.card.name).toBe('');
  });
});
