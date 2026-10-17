import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BANDIT_ARMS, DEFAULT_ARMS, armsCode, lairArms } from '@/heraldry/arms';
import type { Report, SettlementView } from '@/world/types';
import type { CastleView, WarView } from '../../../netlify/lib/contract';

/** Мир, реестр и войны — подставные: герб в ролике решает донесение, а знать о них ролику нечего. */
const world = vi.hoisted(() => ({ wars: [] as unknown[], castles: [] as unknown[], places: [] as unknown[] }));
vi.mock('@/net/war', () => ({ wars: () => world.wars }));
vi.mock('@/net/roster', () => ({ castles: () => world.castles }));
vi.mock('@/world/cache', () => ({
  settlementAt: (x: number, y: number) => (world.places as SettlementView[]).find((s) => s.x === x && s.y === y) ?? null,
}));

const { coatsOfRecord, foeArmsCode } = await import('./coats');
const { useGame } = await import('@/game/store');

const MINE = 'french-quarterly-azure-or-lion-gules';
const NEIGHBOUR = 'kite-plain-sable-sable-eagle-or';

const report = (over: Partial<Report>): Report => ({ id: 'r1', target: { id: 'home', name: 'Дом', x: 0, y: 0 }, ...over }) as Report;

beforeEach(() => {
  world.wars = [];
  world.castles = [];
  world.places = [];
  useGame.getState().s.profile.arms = MINE;
});

describe('гербы на знамёнах роликов (П-2)', () => {
  it('наш — герб державы из профиля; без выбора — прежняя башня', () => {
    expect(coatsOfRecord({ us: 'attacker' } as never, undefined).attacker).toBe(MINE);
    useGame.getState().s.profile.arms = undefined;
    expect(coatsOfRecord({ us: 'defender' } as never, undefined).defender).toBe(armsCode(DEFAULT_ARMS));
  });

  it('война с соседом: его герб из реестра, на нападении и на защите', () => {
    world.castles = [{ id: 'cN', arms: NEIGHBOUR } as CastleView];
    world.wars = [{ id: 'w1', role: 'def', atkCastle: 'cN', defCastle: 'cMe', battles: [{ id: 'b7' }] } as unknown as WarView];
    expect(foeArmsCode(report({ id: 'war-b7' }))).toBe(NEIGHBOUR);
    world.wars = [{ id: 'w2', role: 'atk', atkCastle: 'cMe', defCastle: 'cN', battles: [] } as unknown as WarView];
    expect(foeArmsCode(report({ id: 'war-w2-fall' }))).toBe(NEIGHBOUR);
    // Сосед не собирал герба — прежняя башня.
    world.castles = [{ id: 'cN' } as CastleView];
    expect(foeArmsCode(report({ id: 'war-w2-fall' }))).toBe(armsCode(DEFAULT_ARMS));
  });

  it('логово — свой герб по номеру; набег без логова и ворота — разбойники', () => {
    world.places = [{ id: 'lair-3', x: 5, y: 6, relation: 'barbarian', castle: false, mine: false } as SettlementView];
    expect(foeArmsCode(report({ target: { id: 'lair-3', name: 'Логово', x: 5, y: 6 } }))).toBe(armsCode(lairArms('lair-3')));
    expect(foeArmsCode(report({}))).toBe(armsCode(BANDIT_ARMS));
    expect(foeArmsCode(undefined)).toBe(armsCode(BANDIT_ARMS));
  });
});
