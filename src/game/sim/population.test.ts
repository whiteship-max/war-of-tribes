import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { FREE_JOBS } from '../data/jobs';
import { freeJobCount, idleCount } from '../derived';
import { losePop } from './population';

describe('ECO-4: losePop — первыми уходят свободные руки, посчитанные до убыли', () => {
  it('десять жителей, пятеро на вольном сборе, ушли трое — уходят свободные, сборщики остаются (архив prove-1-1)', () => {
    const s = createInitialState(1);
    for (const k of Object.keys(s.workers)) s.workers[k as keyof typeof s.workers] = 0;
    for (const k of Object.keys(s.freeJobs)) s.freeJobs[k as keyof typeof s.freeJobs] = 0;
    s.pop = 10;
    s.freeJobs[FREE_JOBS[0]] = 5;
    expect(idleCount(s)).toBe(5);
    expect(losePop(s, 3)).toBe(3);
    expect(s.pop).toBe(7);
    expect(freeJobCount(s, FREE_JOBS[0])).toBe(5);
    expect(idleCount(s)).toBe(2);
  });

  it('свободных меньше ушедших — остаток снимается со сбора', () => {
    const s = createInitialState(1);
    for (const k of Object.keys(s.workers)) s.workers[k as keyof typeof s.workers] = 0;
    for (const k of Object.keys(s.freeJobs)) s.freeJobs[k as keyof typeof s.freeJobs] = 0;
    s.pop = 10;
    s.freeJobs[FREE_JOBS[0]] = 8;
    expect(losePop(s, 5)).toBe(5);
    expect(s.pop).toBe(5);
    expect(freeJobCount(s, FREE_JOBS[0])).toBe(5);
    expect(idleCount(s)).toBe(0);
  });
});
