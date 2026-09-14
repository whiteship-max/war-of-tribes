import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from './buildings';
import { JOBS, JOB_BY_ID } from './jobs';
import { SEASONS, SEASON_MODIFIERS } from './seasons';
import { YARDS } from './yards';

const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (name: string): string => strip(readFileSync(join(__dirname, name), 'utf8'));

describe('дворы — одна таблица', () => {
  it('за стеной стоят ровно дворы, и у каждого двора одна строка', () => {
    const outside = BUILDINGS.filter((b) => b.outside).map((b) => b.id);
    expect(outside.sort()).toEqual(YARDS.map((y) => y.building).sort());
    // Здание, профессия и сезон одного двора сходятся без сверки глазами.
    for (const y of YARDS) {
      const b = BUILDINGS.find((d) => d.id === y.building)!;
      expect(b.job, `${y.building}: профессия здания`).toBe(y.job);
      expect(JOB_BY_ID[y.job].building, `${y.job}: здание профессии`).toBe(y.building);
      expect(JOB_BY_ID[y.job].yield, `${y.job}: выработка`).toBe(y.yield);
      for (const season of SEASONS) {
        expect(SEASON_MODIFIERS[season].jobs[y.job], `${y.job}, ${season}`).toBe(y.seasons[season]);
      }
    }
  });

  it('добывает сырьё только двор, и сезон двигает только дворы', () => {
    const yardJobs = new Set(YARDS.map((y) => y.job));
    for (const j of JOBS) {
      if (Object.keys(j.yield).length > 0) expect(yardJobs.has(j.id), `${j.id} добывает, а двора у него нет`).toBe(true);
    }
    for (const season of SEASONS) {
      for (const job of Object.keys(SEASON_MODIFIERS[season].jobs)) {
        expect(yardJobs.has(job as (typeof YARDS)[number]['job']), `${season}: ${job} — не двор`).toBe(true);
      }
    }
  });

  it('восьмой двор отдельно не заводится: ни здание, ни профессия, ни сезон не пишут двор руками', () => {
    const yardJobs = YARDS.map((y) => y.job).join('|');
    const buildings = read('buildings.ts');
    // Поле «за стеной» и профессия двора приходят из строки двора, а не литералом.
    expect(buildings, 'buildings.ts: outside литералом').not.toMatch(/\boutside:\s*true/);
    expect(buildings, 'buildings.ts: профессия двора литералом').not.toMatch(new RegExp(`\\bjob:\\s*'(${yardJobs})'`));
    expect((buildings.match(/\.\.\.yardBuilding\('/g) ?? []).length).toBe(YARDS.length);

    const jobs = read('jobs.ts');
    // Выработка с ресурсом бывает только у двора, а дворы пришли из таблицы.
    expect(jobs, 'jobs.ts: профессия двора литералом').not.toMatch(new RegExp(`\\bid:\\s*'(${yardJobs})'`));
    expect(jobs, 'jobs.ts: выработка литералом').not.toMatch(/\byield:\s*\{\s*[a-z]+\s*:/);

    const seasons = read('seasons.ts');
    const table = seasons.slice(seasons.indexOf('export const SEASON_MODIFIERS'));
    const rows = [...table.matchAll(/\bjobs:\s*([^\n,]+)/g)].map((m) => m[1].trim());
    expect(rows).toEqual(SEASONS.map((s) => `yardSeason('${s}')`));
  });
});
