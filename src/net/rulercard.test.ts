// Черты правителя на сервере (ПН-2, docs/gdd/path_of_sword.md, «Решения ПН-2»): одна дверь на две стороны — опись игры
// (`net/snapshot.watchOf`) везёт счёт дел, сервер выводит черты той же функцией (`rulerbook.claimedRuler`), и его потолки —
// сословия, дух, рынок, стройка — читают те же числа, что игра. Подделку держат `rulerFaults` и `rulerFlags` (сверка через
// обработчик — `security.test.ts`, «ПН-2»).
//
// Области (правило 11): у каждой черты точка внутри — черта правда держится в игре (утверждением), а рядом опись без черт.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { DAY_LENGTH } from '@/game/pace';
import { BUILDINGS } from '@/game/data/buildings';
import { GENERAL_DRILL } from '@/game/spiritrules';
import { COMMONER_SLIGHT } from '@/game/commandrules';
import { noteRulerDeed } from '@/game/sim/dynasty';
import { setWageMode } from '@/game/sim/upkeep';
import { RULER_BUILD, rulerNumbersOf, rulerTraitNumbers, rulerTraitsNow, type RulerTraitId } from '@/game/rulertraits';
import type { GameState, RulerTally } from '@/game/types';
import { watchOf } from './snapshot';
import { claimedRuler, rulerFaults, rulerFlags } from '../../netlify/lib/rulerbook';
import { buildMult, estateFaults, readWatchRecord, spiritCeilOf } from '../../netlify/lib/watch';
import type { WatchCard } from '../../netlify/lib/contract';

/** Партия лорда с днями правления и счётом дел — через дверь записи. */
function lord(tally: RulerTally = {}, minWage = false): GameState {
  const s = createInitialState(7);
  s.realm.ruler.bornAt = 0;
  s.time = 0;
  if (minWage) setWageMode(s, 'min');
  s.time = 40 * DAY_LENGTH;
  for (const [k, n] of Object.entries(tally) as [keyof RulerTally, number][]) noteRulerDeed(s, k, n);
  return s;
}

const CASES: [RulerTraitId | 'нет', GameState][] = [
  ['warrior', lord({ won: 5 })],
  ['coward', lord({ won: 1, fled: 2 })],
  ['builder', lord({ built: BUILDINGS.length })],
  ['merciful', lord({ mercy: 5 })],
  ['cruel', lord({ mercy: 1, cruel: 2 })],
  ['generous', lord({ feasts: 5 })],
  ['miser', lord({}, true)],
  ['нет', lord({ won: 3, lost: 1, feasts: 2 })],
];

describe('одна дверь на две стороны: опись игры и потолки сервера читают те же числа черт', () => {
  it.each(CASES)('%s: черты описи — те, что даёт счёт; числа сервера — числа игры', (id, s) => {
    const card = watchOf(s);
    expect(rulerTraitsNow(s), 'граница: черта правда держится в игре').toEqual(id === 'нет' ? [] : [id]);
    expect(card.ruler, 'дела были — опись несёт правителя').toBeDefined();
    expect(card.ruler?.held).toEqual(rulerTraitsNow(s));
    expect(rulerFaults(card), 'честная опись без флага').toEqual([]);
    expect(claimedRuler(card)).toEqual(rulerTraitNumbers(s));
  });

  it('дел не было — правителя в описи нет, числа — нули', () => {
    const s = createInitialState(7);
    s.time = 40 * DAY_LENGTH;
    const card = watchOf(s);
    expect(card.ruler).toBeUndefined();
    expect(claimedRuler(card)).toEqual(rulerNumbersOf([]));
  });

  it('стройка «Строителя» — в потолке стройки сервера той же формулой', () => {
    const builder = watchOf(lord({ built: BUILDINGS.length }));
    const plain = watchOf(lord({ built: 1 }));
    // Старосты нет: множитель совета — единица, и прибавка черты ложится целиком под потолок.
    expect(buildMult(builder, builder.buildings) / buildMult(plain, plain.buildings)).toBeCloseTo(1 + RULER_BUILD, 12);
  });

  it('дисциплина «Щедрого» — в потолке духа сервера', () => {
    const at = 1_900_000_000_000;
    const ceil = (card: WatchCard): number => {
      const rec = readWatchRecord({});
      rec.card = card;
      return spiritCeilOf(rec, at).spirit?.discipline ?? NaN;
    };
    const generous = ceil(watchOf(lord({ feasts: 5 })));
    const plain = ceil(watchOf(lord({ feasts: 1 })));
    expect(plain, 'граница: потолок не у верха шкалы').toBeLessThan(100 - GENERAL_DRILL);
    expect(generous - plain).toBeCloseTo(GENERAL_DRILL, 9);
  });

  it('указ рыцарства: обида «Труса» в лояльности сервера закрывает указ, который без неё открыт', () => {
    // Привилегии купцам и цехам: зависть рыцарства — две доли, потолок лояльности 66.25 — указ открыт; Трус — минус 15.
    const decree = (s: GameState): WatchCard => ({ ...watchOf(s), estates: { priv: [1, 1, 0, 0, 0], decree: 'knights', infl: [], grants: 2, revokes: 0, gifts: 0 } });
    expect(estateFaults(decree(lord({ won: 1, lost: 1 })))).toEqual([]);
    const coward = estateFaults(decree(lord({ won: 1, fled: 2 })));
    expect(coward.join(' ')).toMatch(/указ «knights» при лояльности не выше 51/);
    expect(66.25 - COMMONER_SLIGHT, 'граница: обида уводит ниже порога').toBeLessThan(60);
  });

  it('новый правитель — счёт с нуля без флага; тот же — убыль флагом', () => {
    const s = lord({ won: 5 });
    const a = watchOf(s);
    const later = { ...a, time: a.time + DAY_LENGTH, won: a.won };
    expect(rulerFlags(a, { ...later, ruler: { ...a.ruler!, n: a.ruler!.n + 1, deeds: { ...a.ruler!.deeds, won: 0, days: 0.5 } } })).toEqual([]);
    expect(rulerFlags(a, { ...later, ruler: { ...a.ruler!, deeds: { ...a.ruler!.deeds, won: 0, days: a.ruler!.deeds.days + 1 } } }).join(' ')).toMatch(/убыл: won 5 → 0/);
  });
});
