// Долг по жалованью в боях выборки W (ПБ-1, п. 4; docs/siege_v2.md, «Решения ПБ-1»). В 22.8 — 16 % боёв мерки с долгом и духом у
// дна. Разбор: долг копит одно поведение — «всё, что прокормит» (`raid-live`, найм `feed`: нанимает, пока хватает еды, о казне не
// думает и не распускает, — так оно и задумано); «по средствам» в долг не уходит — ведомость после найма не больше дохода казны
// (`autopilot.affords`, «казна»). Ошибки порядка трат нет; тест держит это обещание прогоном.
//
// Область (правило 11): лестница мерки 7-го и 8-го уровня — там, где прибор «Дух дружины» показал дно (22.9, п. 4), — прогон
// `ladderRun` тем же автопилотом, что «Найм»; бои в прогоне были (утверждение), и тот же посёлок поведением «всё, что прокормит» в
// долг уходит — правилу есть что держать.
import { describe, expect, it } from 'vitest';
import { ladderRun } from './raid-hiring';
import type { Spirited } from './lib/spirited';

const patient = (s: Spirited): boolean => !s.gate && (s.lines.patience?.morale ?? 0) < 0;

describe('долг по жалованью — поведение «всё, что прокормит», а не правило содержания (ПБ-1, п. 4)', () => {
  it('«по средствам» на лестнице мерки 7–8-го уровня не входит в бой с долгом; «всё, что прокормит» — входит', async () => {
    for (const level of [7, 8]) {
      for (const seed of [7, 11]) {
        const out = await ladderRun({ level, style: 'means', seed });
        const fights = out.l.spirits.filter((s) => !s.gate);
        expect(fights.length, `ур. ${level}, мир ${seed}: точка внутри области — бои были`).toBeGreaterThan(0);
        expect(fights.filter(patient).length, `ур. ${level}, мир ${seed}: «по средствам» в бою с долгом`).toBe(0);
        expect(out.l.whyPay, `ур. ${level}, мир ${seed}: уход неуплатой`).toBe(0);
      }
    }
    const feed = await ladderRun({ level: 7, style: 'feed', seed: 7 });
    expect(feed.l.spirits.filter(patient).length, 'тот же посёлок поведением «всё, что прокормит» — в долгу').toBeGreaterThan(0);
  }, 240_000);
});
