// Задания — только на то, что есть в мире.
//
// «Взятый замок» висел в заданиях недостижимым: замков на карте нет, у логова
// `castle: false`. Задание занимало одно из трёх мест навсегда, значок на кнопке
// «Задания» не гас, счёт застывал. Задание и достижение убраны, и тест держит это в
// обе стороны: пока мир не ставит замков, ни одно задание не зависит от счётчика
// замков, — а в тот день, когда мир поставит замок, задание на него обязано
// появиться. Без второй половины контент потерялся бы молча.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState } from '../types';
import { createInitialState } from '../state';
import { RESOURCE_IDS } from '../constants';
import { EQUIPMENT_IDS } from './equipment';
import { TROOP_IDS } from './troops';
import { ACHIEVEMENTS, QUESTS, questsDone } from './quests';
import { generateWorld, makeLair, type GenSettlement } from '@/world/gen';
import { LocalWorld } from '@/world/local/LocalWorld';
import type { PlayerProfile } from '@/world/types';

const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const HOUR = 3_600_000;

/**
 * Ставит ли мир замки — хоть где-нибудь. Смотрит всё, из чего мир собирает
 * поселения: генерацию на нескольких сидах, логово, которое мир заводит по ходу
 * партии, и сам мир, проживший двое суток. Считается один раз на файл.
 */
let castlesKnown: Promise<boolean> | null = null;
const worldHasCastles = (): Promise<boolean> => (castlesKnown ??= scanForCastles());

async function scanForCastles(): Promise<boolean> {
  const found: GenSettlement[] = [];
  for (const seed of [1, 7, 42, 2024, 90210]) found.push(...generateWorld(seed).settlements);
  found.push(makeLair('probe', 0, 0, 'Проба'));

  let now = 1_700_000_000_000;
  const world = new LocalWorld({ seed: 7, now: () => now, storage: null });
  const profile: PlayerProfile = {
    name: 'Проба', pop: 120, defense: 30, warriorPower: 3, units: { warrior: 10, scout: 4 },
    command: 60, stock: {}, stash: 0,
  };
  for (let h = 0; h < 48; h++) {
    await world.sync(profile);
    now += HOUR;
  }
  found.push(...(world as unknown as { gen: { settlements: GenSettlement[] } }).gen.settlements);
  return found.some((s) => s.castle);
}

/** Посёлок, где выполнено всё остальное: зависимость от замков не спрячется за другим условием. */
function everythingElse(): GameState {
  const s = createInitialState();
  s.pop = 100_000;
  s.gold = 1_000_000;
  for (const b of s.buildings) b.level = 10;
  for (const r of RESOURCE_IDS) s.resources[r] = 1_000_000;
  for (const id of EQUIPMENT_IDS) s.equipment[id] = 100_000;
  for (const id of TROOP_IDS) s.army[id] = 100_000;
  for (const key of Object.keys(s.stats) as (keyof GameState['stats'])[]) s.stats[key] = 100_000;
  s.time = 1_000_000;
  return s;
}

/** Меняется ли исход хоть одного задания или достижения от одного лишь счётчика замков. */
function dependsOnCastles(): string[] {
  const out: string[] = [];
  for (const base of [createInitialState(), everythingElse()]) {
    const none = structuredClone(base);
    none.stats.castles = 0;
    const many = structuredClone(base);
    many.stats.castles = 100_000;
    for (const q of [...QUESTS, ...ACHIEVEMENTS]) {
      if (q.check(none) !== q.check(many) && !out.includes(q.id)) out.push(q.id);
    }
  }
  return out;
}

describe('задания на замок — тогда и только тогда, когда мир ставит замки', () => {
  it('есть замки в мире — есть задание на взятый замок; нет замков — нет и задания', async () => {
    const castles = await worldHasCastles();
    const depends = dependsOnCastles();
    // Сейчас замков нет, и задания на них нет. Появится замок в генерации — упадёт
    // вторая половина: верни задание и достижение (они лежат в истории data/quests.ts).
    expect(depends.length > 0, `замки в мире: ${castles}; задания от счётчика замков: ${depends.join(', ') || 'нет'}`).toBe(
      castles,
    );
  }, 30_000);

  it('пока замков нет, счётчика замков не читает ни одно задание — даже там, где прогон этого не видит', async () => {
    if (await worldHasCastles()) return;
    const src = stripComments(readFileSync(join(__dirname, 'quests.ts'), 'utf8'));
    expect(src).not.toMatch(/\bcastles\b/);
  }, 30_000);

  it('золото в описании берётся только оттуда, где оно есть', () => {
    // «Полная казна» звала за золотом в чужие замки, а замков нет.
    for (const q of QUESTS) expect(q.description, q.id).not.toMatch(/замк/);
  });
});

describe('счёт выполненного', () => {
  it('считаются только задания нынешнего списка: старый идентификатор в сохранении счёт не раздувает', () => {
    const s = createInitialState();
    s.completedQuests = [...QUESTS.map((q) => q.id), 'castle', 'assign_workers'];
    expect(questsDone(s)).toBe(QUESTS.length);
    s.completedQuests = ['castle', QUESTS[0].id];
    expect(questsDone(s)).toBe(1);
  });
});
