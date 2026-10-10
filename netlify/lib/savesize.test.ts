// Мир с полной полкой отчётов о боях проходит запись партии (docs/bughunt.md, «Мир перерастал потолок»).
//
// Каждый отчёт о бое несёт запись боя, и мир держит их тридцать (`REPORTS_KEPT`). При прежнем потолке мира (160 КБ)
// запись переставала проходить на двадцать втором бою, и сервер отклонял каждую запись партии до конца теста. Числа
// здесь — настоящая запись боя ядра (`resolveField`) и настоящая строка сохранения мира (`worldSaveJson`).
import { describe, expect, it } from 'vitest';
import { resolveField } from '../../src/world/battle.js';
import { worldSaveJson, type WorldSave } from '../../src/world/local/state.js';
import { REPORTS_KEPT } from '../../src/world/data/tuning.js';
import { readRecord } from './contract.js';
import { LIMITS } from './routes/save.js';
import { MAX_BODY_BYTES } from './http.js';

/** Отчёт с записью боя: армии от десятков до сотен — от набега у ворот до войны городов. */
function reportOf(i: number) {
  const n = 30 + ((i * 37) % 300);
  const kinds = (m: number) => ({ spear: Math.round(m * 0.4), infantry: Math.round(m * 0.3), archer: Math.round(m * 0.2), cavalry: Math.round(m * 0.1), heavy: 0 });
  const out = resolveField({ seed: 1000 + i, attacker: { kinds: kinds(n) }, defender: { kinds: kinds(Math.round(n * 0.9)) } });
  return { id: `r${i}`, at: i, read: false, battle: { result: out.result } };
}

describe('запись партии с полной полкой отчётов о боях', () => {
  const world = worldSaveJson({ reports: Array.from({ length: REPORTS_KEPT }, (_, i) => reportOf(i)) } as unknown as WorldSave);
  const record = { v: 1, rev: 1, updatedAt: 1, device: 'd-телефон', game: '{"v":23}', world, card: { name: 'Вождь', day: 1, pop: 30, power: 1, army: 1 } };

  it('граница области: полка полная, и без нового потолка она бы не прошла', () => {
    expect(REPORTS_KEPT).toBeGreaterThanOrEqual(30);
    // Точка внутри области правила: прежний потолок мира эту полку отклонял.
    expect(world.length).toBeGreaterThan(160 * 1024);
  });

  it('сервер принимает мир с тридцатью боями, с запасом не меньше полуторного', () => {
    expect(readRecord(record, LIMITS)).not.toBeNull();
    expect(LIMITS.world).toBeGreaterThanOrEqual(world.length * 1.5);
  });

  it('тело записи — оба потолка частей после экранирования — укладывается в потолок тела', () => {
    const body = JSON.stringify({ baseEtag: 'e1', record: { ...record, game: 'x'.repeat(LIMITS.game), world: world.padEnd(LIMITS.world, ' ') } });
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(MAX_BODY_BYTES);
    // Caddy (`max_size 1MB`) пропускает до миллиона байт: тело приложения ниже него.
    expect(MAX_BODY_BYTES).toBeLessThan(1_000_000);
  });
});
