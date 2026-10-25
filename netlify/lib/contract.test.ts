import { describe, expect, it } from 'vitest';
import { WALK_MS_MAX, readArmy, readCounts, readEnergy, readPrefs, readRecord, readWarOrder, type SaveRecord } from './contract.js';
import { energyAt } from '../../src/world/energy.js';

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

describe('AC-8: длинный ключ пропускается, а не обрывает разбор', () => {
  it('readCounts и отметки полководца: ключ длиннее потолка — мимо, остальные читаются', () => {
    const long = 'x'.repeat(40);
    expect(readCounts({ [long]: 5, spearman: 3, archer: 2 })).toEqual({ spearman: 3, archer: 2 });
    const army = readArmy({ troops: { [long]: 1, spearman: 4 }, pips: { [long]: 0.5, shock: 1.5 } })!;
    expect(army.troops).toEqual({ spearman: 4 });
    expect(army.pips).toEqual({ shock: 1.5 });
  });
});

describe('AC-8: минуты отметки энергии — к часам сервера', () => {
  const NOW = 1_900_000_000_000;
  const LATEST = NOW + 5 * 60_000;
  it('отметка из будущего — не позже часов сервера с допуском; поворот домой и остановка — не раньше отметки', () => {
    const e = readEnergy({ value: 100, at: NOW + 365 * 86_400_000, mode: 'drain', stopAt: NOW + 400 * 86_400_000 }, LATEST)!;
    expect(e.at).toBe(LATEST);
    expect(energyAt(e, NOW + 3_600_000)).toBeLessThan(100);
    const back = readEnergy({ value: 40, at: NOW, mode: 'drain', homeAt: 0, stopAt: 5 }, LATEST)!;
    expect(back.homeAt).toBe(NOW);
    expect(back.stopAt).toBe(NOW);
    // Честная отметка — как прислана.
    const fair = readEnergy({ value: 70, at: NOW - 1000, mode: 'drain', homeAt: NOW + 3_600_000 }, LATEST)!;
    expect(fair).toEqual({ value: 70, at: NOW - 1000, mode: 'drain', homeAt: NOW + 3_600_000 });
    // Тем же правилом — армия приказа.
    expect(readArmy({ troops: { spearman: 1 }, energy: { value: 100, at: NOW + 1e12, mode: 'drain' } }, LATEST)!.energy!.at).toBe(LATEST);
  });
});

describe('AC-8: пояс игрока — только настоящий', () => {
  it('выдуманный пояс и мусор — умолчание; настоящий и синоним — как прислан', () => {
    expect(readPrefs({ tz: 'Mars/Olympus' }).tz).toBe('');
    expect(readPrefs({ tz: '<b>x</b>' }).tz).toBe('');
    expect(readPrefs({ tz: 'Europe/Berlin' }).tz).toBe('Europe/Berlin');
    expect(readPrefs({ tz: 'UTC' }).tz).toBe('UTC');
    expect(readPrefs({ tz: '' }).tz).toBe('');
  });
});

describe('AC-8: срок пути удара и выручки — без среза в сутки', () => {
  it('честный путь длиннее суток доходит до сервера как есть; бесконечность — нет', () => {
    const base = { id: 'w1', army: { troops: { spearman: 5 } }, from: { x: 3, y: 4 } };
    const HOUR = 3_600_000;
    for (const op of ['strike', 'relief'] as const) {
      const o = readWarOrder({ op, ...base, walkMs: 30 * HOUR }) as { walkMs: number } | null;
      expect(o?.walkMs, op).toBe(30 * HOUR);
      const far = readWarOrder({ op, ...base, walkMs: 1e300 }) as { walkMs: number } | null;
      expect(Number.isFinite(far!.walkMs)).toBe(true);
      expect(far!.walkMs).toBe(WALK_MS_MAX);
    }
  });
});
