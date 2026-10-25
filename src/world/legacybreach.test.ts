// Проломы окна из старого сохранения переживают первое дело с журналом (MAP-7, docs/audit/WORKPLAN.md). Окно до фаз
// помнит прежние залпы одним счётчиком (`Craft.shots`) без журнала; проломы и износ гарнизона от них читались, только пока
// журнала нет вовсе, и первое же дело, заводящее журнал (цель артиллерии, кольцо, починка, новый залп), их стирало.
// Решение (правило 19): прежние залпы — счётчик минус залпы журнала (`siegeroll.legacyShots`), без миграции и без нового
// вида строки журнала: залп фаз всегда кладёт и счётчик, и строку (`craftAfter`), так что разница — ровно прежние.
import { describe, expect, it } from 'vitest';
import { openSiege, starvesAt, type SiegeWindow } from './siege';
import { breachesOf, legacyShots, phaseAt } from './siegeroll';
import { craftAfter, garrisonWear } from './siegecraft';
import { SIEGE_PHASE } from './data/siegeroll';

const T0 = 1_700_000_000_000;

/** Окно из сохранения до фаз: три прежних залпа (20 + 10 + 5 % стены → 1 пролом), журнала нет. */
function legacy(): SiegeWindow {
  const hours = 5.5 * (SIEGE_PHASE / 3_600_000);
  const w = openSiege({ byId: 'lair-1', campId: 'm7', now: T0, food: 100 * hours, garrison: 0, townPerHour: 100, perManPerHour: 0, log: [] });
  return { ...w, log: undefined, craft: { shots: 3 } };
}

describe('прежние залпы переживают журнал (MAP-7)', () => {
  it('первое дело с журналом — пролом остаётся', () => {
    const old = legacy();
    expect(breachesOf(old), 'точка внутри области: у окна до фаз есть пролом').toBe(1);
    const aimed = { ...old, log: [{ at: T0 + 1, act: 'aim' as const, aim: 'wall' as const }] };
    expect(breachesOf(aimed)).toBe(1);
    const shot = { ...old, ...craftAfter(old, 'bombard', T0 + 1) };
    expect(legacyShots(shot)).toBe(3);
    expect(breachesOf(shot)).toBe(1);
  });

  it('износ гарнизона: прежние залпы считаются и после журнала', () => {
    const old = legacy();
    const at = T0 + (starvesAt(old) - T0) / 4;
    const aimed = { ...old, log: [{ at: T0 + 1, act: 'aim' as const, aim: 'wall' as const }] };
    expect(garrisonWear(aimed, at)).toBeCloseTo(garrisonWear(old, at), 12);
  });

  it('окно фаз своих залпов в проломы не переводит: залпов в журнале столько же, сколько в счётчике', () => {
    let w: SiegeWindow = { ...legacy(), craft: undefined, log: [] };
    for (let k = 0; k < 3; k++) w = { ...w, ...craftAfter(w, 'bombard', phaseAt(T0, k) + 1) };
    expect(w.craft?.shots).toBe(3);
    expect(legacyShots(w)).toBe(0);
    expect(breachesOf(w)).toBe(0);
  });
});
