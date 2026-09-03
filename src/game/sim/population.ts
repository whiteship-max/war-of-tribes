import type { GameState, JobId, Villager } from '../types';
import { pickName } from '../data/names';
import { chance, pick, rnd, rndInt } from './random';
import { log } from './log';

const TALENTS: JobId[] = ['gatherer', 'hunter', 'woodcutter', 'stonecutter', 'miner', 'farmer', 'herder', 'crafter', 'smith', 'scholar', 'shaman'];

export function randomTalent(): JobId | null {
  return chance(0.3) ? pick(TALENTS) : null;
}

export interface NewVillagerOptions {
  age?: number;
  sex?: 'm' | 'f';
  talent?: JobId | null;
  job?: JobId;
}

export function addVillager(s: GameState, opts: NewVillagerOptions = {}): Villager {
  const sex = opts.sex ?? (rnd() < 0.5 ? 'm' : 'f');
  const v: Villager = {
    id: s.nextId++,
    name: pickName(sex, rnd),
    sex,
    age: opts.age ?? rndInt(16, 34),
    job: opts.job ?? 'idle',
    workplace: null,
    talent: opts.talent === undefined ? randomTalent() : opts.talent,
  };
  s.villagers.push(v);
  return v;
}

export function removeVillager(s: GameState, id: number): Villager | null {
  const idx = s.villagers.findIndex((v) => v.id === id);
  if (idx < 0) return null;
  const [v] = s.villagers.splice(idx, 1);
  return v;
}

/** Убирает случайного жителя (предпочитая свободных), пишет причину в лог. */
export function killRandomVillager(s: GameState, reason: string): Villager | null {
  if (s.villagers.length === 0) return null;
  const idle = s.villagers.filter((v) => v.job === 'idle');
  const pool = idle.length > 0 ? idle : s.villagers;
  const victim = pick(pool);
  removeVillager(s, victim.id);
  s.stats.died++;
  log(s, `${victim.name} ${victim.sex === 'f' ? 'погибла' : 'погиб'}: ${reason}.`, 'bad');
  return victim;
}

/** Забирает самого старого жителя — холод бьёт по слабым первым. */
export function killOldestVillager(s: GameState, reason: string): Villager | null {
  if (s.villagers.length === 0) return null;
  const victim = s.villagers.reduce((a, b) => (b.age > a.age ? b : a));
  removeVillager(s, victim.id);
  s.stats.died++;
  log(s, `${victim.name} ${victim.sex === 'f' ? 'погибла' : 'погиб'}: ${reason}.`, 'bad');
  return victim;
}
