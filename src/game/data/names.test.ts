// Имена агентов: сеяные, по вере, и чистые.
//
// Области (правило 11): «без повтора» — окна из сорока наймов подряд, начатые с разных
// номеров, на каждой вере и нескольких сидах; «тот же сид — то же имя» — одинаковые
// номер и вера; очистка — каждая строка набора и самое длинное сочетание.
import { describe, expect, it } from 'vitest';
import { AGENT_EPITHETS, AGENT_NAMES, agentName, shuffleOrder } from './names';
import { CITY_MAX, cityName } from '../../../netlify/lib/contract';
import { createInitialState } from '../state';
import { tick } from '../sim/tick';
import { applyEffects } from '@/world/bridge';
import { hireAgent } from '../sim/hire';
import { study } from '../sim/tech';
import type { FaithId } from '../types';

const FAITHS = Object.keys(AGENT_NAMES) as FaithId[];
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

describe('наборы имён', () => {
  it('сорок имён на каждую из четырёх вер и семнадцать прозвищ; числа взаимно простые, повторов внутри нет', () => {
    expect(FAITHS.sort()).toEqual(['catholic', 'islam', 'orthodox', 'pagan']);
    for (const f of FAITHS) {
      expect(AGENT_NAMES[f], f).toHaveLength(40);
      expect(new Set(AGENT_NAMES[f]).size, `${f}: имена без повторов`).toBe(40);
    }
    expect(AGENT_EPITHETS).toHaveLength(17);
    expect(new Set(AGENT_EPITHETS).size).toBe(17);
    expect(gcd(40, 17)).toBe(1);
  });

  it('каждая строка проходит очистку имени без изменений: без разметки, невидимок, составных букв и эмодзи', () => {
    const all = [...FAITHS.flatMap((f) => AGENT_NAMES[f]), ...AGENT_EPITHETS];
    for (const x of all) {
      expect(cityName(x), x).toBe(x);
      expect(x.normalize('NFC'), `${x}: буквы не составные`).toBe(x);
      expect(/\p{Extended_Pictographic}/u.test(x), `${x}: без эмодзи`).toBe(false);
    }
    const longest = Math.max(...FAITHS.flatMap((f) => AGENT_NAMES[f]).map((x) => x.length)) + 1 + Math.max(...AGENT_EPITHETS.map((x) => x.length));
    expect(longest, 'самое длинное сочетание влезает в потолок имени').toBeLessThanOrEqual(CITY_MAX);
  });
});

describe('имя сеется', () => {
  it('тот же сид, номер и вера — то же имя; перестановка — перестановка', () => {
    for (const seed of [1, 42, 20260915, 0x7fffffff]) {
      for (const f of FAITHS) {
        for (let hire = 0; hire < 60; hire++) expect(agentName(seed, hire, f)).toBe(agentName(seed, hire, f));
      }
      const order = shuffleOrder(40, seed);
      expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i));
    }
    expect(agentName(1, 0, 'orthodox'), 'разные сиды — разный порядок').not.toBe(agentName(2, 0, 'orthodox'));
  });

  it('сорок наймов подряд без повтора имени — с какого бы номера ни начать', () => {
    let windows = 0;
    for (const seed of [3, 77, 9001]) {
      for (const f of FAITHS) {
        for (const from of [0, 13, 39, 400]) {
          const firsts = Array.from({ length: 40 }, (_, i) => agentName(seed, from + i, f).split(' ')[0]);
          expect(firsts, `точка внутри области: сорок подряд с ${from}`).toHaveLength(40);
          expect(new Set(firsts).size, `${f}, сид ${seed}, с найма ${from}`).toBe(40);
          windows++;
        }
      }
    }
    expect(windows).toBe(48);
  });

  it('в партии: сорок наймов подряд на одно место — сорок разных имён, у живых четверых полные имена не совпадают, и тот же сид даёт тех же', () => {
    const run = (seed: number): string[] => {
      const s = createInitialState(seed);
      s.faith.id = 'islam';
      s.gold = 1_000_000;
      // Место лазутчика у новой партии закрыто: его отпирает вторая ступень
      // дипломатической ветви, и очков на неё у новой партии ровно столько, сколько она
      // стоит. Открывается оно здесь той же дверью, какой его открывает игрок, — иначе
      // проверка про имена уткнулась бы в гейт, а не в имена.
      expect(study(s, 'diplo'), 'ступень куплена стартовым котлом').toBeNull();
      s.agents.spy.vacant = false;
      tick(s, 1);
      const names: string[] = [];
      for (let i = 0; i < 40; i++) {
        const person = s.agents.spy.person;
        applyEffects(s, [
          { id: `f${i}`, lost: {}, resources: {}, prestige: 0, morale: 0, battle: null, fell: { agent: 'spy', person, peril: 0.04, where: 'у логова', why: [] }, text: '', good: false },
        ]);
        expect(s.agents.spy.vacant, `точка внутри области: место ${i} пустует`).toBe(true);
        expect(hireAgent(s, 'spy')).toBeNull();
        tick(s, s.agents.spy.hiring!.until - s.time);
        expect(s.agents.spy.person).toBe(person + 1);
        names.push(s.agents.spy.name!);
        const living = (['scout', 'diplomat', 'spy', 'general'] as const).map((id) => s.agents[id].name);
        expect(new Set(living).size, `после найма ${i}: у живых четверых имена разные`).toBe(4);
      }
      return names;
    };
    const a = run(555);
    expect(a).toHaveLength(40);
    expect(new Set(a.map((n) => n.split(' ')[0])).size, 'сорок разных имён').toBe(40);
    expect(run(555), 'тот же сид — те же люди').toEqual(a);
  });
});
