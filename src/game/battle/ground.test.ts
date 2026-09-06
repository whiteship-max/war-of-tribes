// Земля и свет ролика: где и когда шёл бой.
//
// Главное здесь не числа, а две границы. Первая: место и час выводятся из
// записи боя **чистой функцией** — тот же бой обязан дать тот же свет и ту же
// землю и через неделю, и на сервере. Вторая: запись боя, сделанная до того,
// как место стали записывать, обязана открываться и показываться.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { simulateBattle } from '@/battle/sim';
import { quickSetup } from '@/battle/setup';
import { PLAIN_GROUND, type BattleResult } from '@/battle';
import { DAY_LENGTH } from '../constants';
import { seasonOf } from '../derived';
import { castOfRecord } from './faces';
import { NOON, REPLAY_ARC, groundName, groundOf, hourName, solarOfTime, type BattlePlace } from './ground';

const fight = (seed = 7): BattleResult =>
  simulateBattle({
    seed,
    attacker: quickSetup({ spear: 150, infantry: 200, archer: 150, cavalry: 100 }),
    defender: quickSetup({ spear: 200, infantry: 200, archer: 150, cavalry: 50 }),
  });

/** Игровое время: день `day`, час `hour`. Из одного числа выводятся и час, и сезон. */
const at = (day: number, hour: number): number => (day + hour / 24) * DAY_LENGTH;

const place = (extra: Partial<BattlePlace> = {}): BattlePlace => ({ land: 'plain', ...extra });

describe('место и час боя — чистая функция от записи', () => {
  it('одна и та же запись даёт один и тот же свет и одну и ту же землю', () => {
    const p = place({ river: true, ford: true, woods: true, time: at(3, 18.5) });
    const once = groundOf(p, 41);
    const twice = groundOf({ ...p }, 41);
    expect(twice).toEqual(once);
    // И через сборку раскадровки — тем же путём, которым ходит игра.
    const result = fight();
    const a = castOfRecord(result, 'attacker', { attacker: {}, defender: {} }, undefined, p);
    const b = castOfRecord(result, 'attacker', { attacker: {}, defender: {} }, undefined, { ...p });
    expect(b.ground).toEqual(a.ground);
  });

  it('час выводится из игрового времени, а не из часов устройства', () => {
    // Ни `Date`, ни `Math.random` в модуле нет — иначе повтор ролика через
    // неделю показал бы другое небо.
    const src = readFileSync(join(__dirname, 'ground.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/Date\.|new Date|Math\.random|performance\.now/);
  });

  it('чем позже случился бой, тем ниже солнце: сутки уложены в светлую дугу', () => {
    const hours = [0, 4, 8, 12, 16, 20, 23.9];
    const solars = hours.map((h) => solarOfTime(at(1, h)));
    for (let i = 1; i < solars.length; i++) expect(solars[i]).toBeGreaterThan(solars[i - 1]);
    expect(solars[0]).toBeGreaterThanOrEqual(REPLAY_ARC.from);
    expect(solars[solars.length - 1]).toBeLessThanOrEqual(REPLAY_ARC.to);
    // Ночного боя в ролике нет: за закат солнце не уходит ни при каком часе.
    for (const s of solars) expect(s).toBeLessThanOrEqual(0.5);
    // Полдень игровых суток — полдень и в ролике.
    expect(solarOfTime(at(1, 12))).toBeCloseTo(NOON, 6);
  });

  it('снег — из времени года того же числа, а не из отдельного поля', () => {
    const winterDay = 15;
    expect(seasonOf(at(winterDay, 12))).toBe('winter');
    expect(groundOf(place({ time: at(winterDay, 12) }), 1).winter).toBe(true);
    expect(groundOf(place({ time: at(0, 12) }), 1).winter).toBe(false);
  });

  it('приметы места переносятся как есть, а брода без реки не бывает', () => {
    const g = groundOf(place({ river: true, ford: true, ridge: true, road: true, woods: true }), 5);
    expect([g.river, g.ford, g.ridge, g.road, g.woods]).toEqual([true, true, true, true, true]);
    expect(groundOf(place({ ford: true }), 5).ford).toBe(false);
  });

  it('у каждого боя своя трава: сид земли — сид боя', () => {
    expect(groundOf(place(), 11).seed).toBe(11);
    expect(groundOf(undefined, 11).seed).toBe(11);
  });
});

describe('старая запись боя открывается', () => {
  it('без места — ровное поле в полдень, а не пустота и не выдумка', () => {
    const g = groundOf(undefined, 3);
    expect(g).toEqual({ ...PLAIN_GROUND, seed: 3 });
    expect(g.solar).toBe(NOON);
    expect(g.winter).toBe(false);
  });

  it('место есть, а времени нет — земля своя, свет полуденный', () => {
    const g = groundOf(place({ river: true, ford: true }), 3);
    expect(g.ford).toBe(true);
    expect(g.solar).toBe(NOON);
    expect(g.winter).toBe(false);
  });

  it('раскадровка собирается и без места: ролик обязан пойти', () => {
    const cast = castOfRecord(fight(), 'attacker', { attacker: {}, defender: {} });
    expect(cast.ground.land).toBe('plain');
    expect(cast.ground.seed).toBe(cast.seed);
    expect(cast.sectors.length).toBeGreaterThan(0);
  });
});

describe('место называется словами', () => {
  it('у каждого места есть имя, и оно меняется вместе с приметами', () => {
    expect(groundName(groundOf(place(), 1))).toBe('в чистом поле');
    expect(groundName(groundOf(place({ river: true, ford: true }), 1))).toContain('брод');
    expect(groundName(groundOf(place({ river: true }), 1))).toContain('рек');
    expect(groundName(groundOf(place({ ridge: true }), 1))).toContain('гребн');
    expect(groundName(groundOf(place({ land: 'shore' }), 1))).toContain('берег');
  });

  it('час тоже называется, и рассвет с закатом не путаются', () => {
    expect(hourName(groundOf(place({ time: at(1, 0.2) }), 1))).toBe('на рассвете');
    expect(hourName(groundOf(place({ time: at(1, 12) }), 1))).toBe('в полдень');
    expect(hourName(groundOf(place({ time: at(1, 23.5) }), 1))).toBe('на закате');
  });
});
