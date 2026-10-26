// Этап 7 аудита, п. 9: удар по лагерю у своих стен и выручка союзника стоят энергию полководца, а потолок сервера
// (`generalCap`) знал только свои походы игрока: приказ с выдуманным полным запасом проходил удар за ударом. Теперь принятый
// удар (выручка) оставляет серверу отметку (`WarFile.gens`) — минус цена, дальше копится, как дома.
import { afterEach, describe, expect, it } from 'vitest';
import { readWarOrder, type CastleClaim, type WarArmy, type WarSheet } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, emptyWars, generalCap, pruneWars, readWars, type SheetAt, type WarFile, type WarRow } from './war.js';
import { setPhaseDie } from '../../src/world/siegeroll.js';
import { energyBlock, priceOf } from '../../src/world/energy.js';
import { ENERGY_FILL, ENERGY_MAX } from '../../src/world/data/energy.js';

afterEach(() => setPhaseDie(null));

const A = 'tg-2001';
const B = 'tg-2002';
const T0 = 1_900_000_000_000;

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });

const sheet = (over: Partial<WarSheet> = {}): WarSheet => ({
  army: { spearman: 600 },
  home: { spearman: 600 },
  militia: 0,
  archers: 0,
  resolve: 0,
  pips: {},
  rest: 1,
  food: 2_000_000,
  townPerHour: 20,
  perManPerHour: 1,
  stock: { food: 1_000_000 },
  stash: 0,
  gold: 0,
  pop: 400,
  bonded: 0,
  levels: { farm: 4 },
  power: 5000,
  locks: {},
  seen: [],
  ...over,
});

function camped() {
  let roster = emptyRoster();
  roster = upsert(roster, A, claim('Альфа'), T0);
  roster = upsert(roster, B, claim('Бета'), T0);
  const sheets = new Map<string, SheetAt>([
    [A, { sheet: sheet(), at: T0 }],
    [B, { sheet: sheet(), at: T0 }],
  ]);
  const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
  const file = emptyWars() as WarFile;
  const army: WarArmy = { troops: { spearman: 600 }, resolve: 0, pips: {} };
  expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army }, T0, ctx)).toBeNull();
  const w = file.wars[0] as WarRow;
  advance(file, w.arriveAt + 1, sheets);
  expect(w.phase, 'точка внутри области: лагерь у стен Беты').toBe('camp');
  return { file, ctx, sheets, w };
}

describe('удар по лагерю тратит энергию полководца и у сервера (этап 7, п. 9)', () => {
  it('удары подряд с выдуманным полным запасом: принято столько, сколько хватило бы честного запаса', () => {
    setPhaseDie(() => 7);
    const { file, ctx, sheets, w } = camped();
    const price = priceOf('strike');
    const can = Math.floor(ENERGY_MAX / price);
    let at = w.arriveAt + 2;
    let taken = 0;
    for (let i = 0; i <= can; i++) {
      expect(w.phase, 'точка внутри области: лагерь стоит').toBe('camp');
      // Ровно в шаге отдыха: за 10 с запас копится на тысячную долю цены — точки внутри срока `ENERGY_FILL`.
      expect(at - w.arriveAt, 'точка внутри области: до полного отдыха').toBeLessThan(ENERGY_FILL / 10);
      const forged: WarArmy = { troops: { spearman: 100 }, resolve: 0, pips: {}, energy: { value: ENERGY_MAX, at, mode: 'fill' } };
      const told = applyOrder(file, B, { op: 'strike', id: w.id, army: forged, joint: false, walkMs: 0, from: w.to }, at, ctx);
      if (told !== null) {
        expect(told, 'отказ — словами нехватки энергии').toBe(energyBlock(generalCap(file, B, at), price, 0));
        break;
      }
      taken++;
      advance(file, at + 1, sheets);
      expect(w.strike, 'удар разобран').toBeUndefined();
      const b = w.battles[w.battles.length - 1];
      expect(b?.at === at && Object.values(b.genLost ?? {}).reduce((n, x) => n + (x ?? 0), 0) < 100, 'точка внутри области: бой был, дружина цела').toBe(true);
      at += 10_000;
    }
    expect(taken, 'ударов не больше, чем хватит полного запаса').toBe(can);
  });

  it('отметка переживает запись и чтение и уходит, когда запас полон и так', () => {
    setPhaseDie(() => 7);
    const { file, ctx, w } = camped();
    const at = w.arriveAt + 2;
    const forged: WarArmy = { troops: { spearman: 1 }, resolve: 0, pips: {}, energy: { value: ENERGY_MAX, at, mode: 'fill' } };
    expect(applyOrder(file, B, readWarOrder({ op: 'strike', id: w.id, army: forged, joint: false, walkMs: 0, from: w.to })!, at, ctx)).toBeNull();
    const back = readWars(JSON.parse(JSON.stringify(file)));
    expect(generalCap(back, B, at)).toBeCloseTo(ENERGY_MAX - priceOf('strike'), 6);
    pruneWars(back, at + ENERGY_FILL + 1);
    expect(back.gens).toBeUndefined();
    expect(generalCap(back, B, at + ENERGY_FILL + 1)).toBe(ENERGY_MAX);
  });

  it('дружина удара легла вся — потолка нет, как у войска, не вернувшегося из похода', () => {
    setPhaseDie(() => 7);
    const { file, ctx, sheets, w } = camped();
    const at = w.arriveAt + 2;
    const one: WarArmy = { troops: { spearman: 1 }, resolve: 0, pips: {}, energy: { value: ENERGY_MAX, at, mode: 'fill' } };
    expect(applyOrder(file, B, { op: 'strike', id: w.id, army: one, joint: false, walkMs: 0, from: w.to }, at, ctx)).toBeNull();
    expect(generalCap(file, B, at), 'после приказа — отметка').toBeCloseTo(ENERGY_MAX - priceOf('strike'), 6);
    advance(file, at + 1, sheets);
    const b = w.battles[w.battles.length - 1];
    expect(b?.at === at && b.genLost?.spearman === 1, 'точка внутри области: бой был, дружина легла').toBe(true);
    expect(generalCap(file, B, at + 1)).toBe(ENERGY_MAX);
  });
});
