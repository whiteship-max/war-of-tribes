// Один полководец — одно действие у мира (BTL-2, docs/audit/OWNER-DECISIONS.md, п. 9): то же правило, что у сервера войны
// (`war.generalBusy`, netlify/lib/warbusy.test.ts). Выручка союзнику в пути и удар по лагерю у своих стен лежат в войнах с
// сервера, пока не сошлись в бою, — и пока они там, полководец не уходит ни в поход, ни на выручку, ни ударом по лагерю, ни
// по карте. Прежде мир знал только свой поход (`WAR_BUSY`).
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import { GENERAL_RELIEVES, GENERAL_STRIKES } from './siege';
import type { WarView } from '../../netlify/lib/contract';

const T0 = 1_900_000_000_000;
const ME = 'c-me';

/** Война с сервера: только поля, по которым мир узнаёт своего полководца. */
const war = (over: Partial<WarView>): WarView => ({ id: 'w1', phase: 'camp', battles: [], ...over }) as WarView;

function world(wars: WarView[]): LocalWorld {
  return new LocalWorld({ seed: 11, now: () => T0, storage: null, wars: () => wars, warsKnown: () => true, warOrder: async () => null });
}

describe('полководец занят тем, что у сервера', () => {
  it('выручка союзнику в пути — полководец не уходит по карте и не бьёт', async () => {
    const w = world([war({ role: 'ally', me: ME, reliefs: [{ castle: ME, city: 'Мы', at: T0 + 3_600_000, army: { troops: { spearman: 10 }, resolve: 0, pips: {} } }] })]);
    const home = (await w.info()).home;
    expect(await w.moveFigure('general', { x: home.x + 2, y: home.y })).toBe(GENERAL_RELIEVES);
  });

  it('удар по лагерю у своих стен ждёт прихода — полководец не уходит по карте', async () => {
    const w = world([war({ role: 'def', strike: { at: T0 + 600_000, army: { troops: { spearman: 10 }, resolve: 0, pips: {} }, joint: false } })]);
    const home = (await w.info()).home;
    expect(await w.moveFigure('general', { x: home.x + 2, y: home.y })).toBe(GENERAL_STRIKES);
  });

  it('чужая выручка и чужой удар полководца не держат', async () => {
    const other = war({ role: 'ally', me: ME, reliefs: [{ castle: 'c-other', city: 'Они', at: T0 + 3_600_000, army: { troops: { spearman: 10 }, resolve: 0, pips: {} } }] });
    const theirs = war({ id: 'w2', role: 'atk', strike: { at: T0 + 600_000, army: { troops: { spearman: 10 }, resolve: 0, pips: {} }, joint: false } });
    const w = world([other, theirs]);
    const home = (await w.info()).home;
    const why = await w.moveFigure('general', { x: home.x + 2, y: home.y });
    expect(why === GENERAL_RELIEVES || why === GENERAL_STRIKES, String(why)).toBe(false);
  });
});
