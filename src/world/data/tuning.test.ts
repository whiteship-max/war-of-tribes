// Сроки п. 10 docs/audit/OWNER-DECISIONS.md (АУ-1) — часы игрока, а не мира. Область правила — боевая шкала ×30: при
// шкале «день в минуту» (`game/pace.minute`, её берут тесты правил мира) `worldDays(10)` — те же десять минут, и тест был
// бы зелёным даром. Поэтому файл модуля шкалы не берёт, а шкала проверяется утверждением.
import { describe, expect, it } from 'vitest';
import { timeScale } from '@/game/pace';
import { CAMP_GATE_CLEAR, PACT_BREAK_NOTICE } from './tuning';
import { SIEGE_PHASE } from './siegeroll';

describe('сроки п. 10 — настоящим временем при боевой шкале', () => {
  it('точка внутри области: шкала боевая', () => {
    expect(timeScale()).toBe(30);
  });

  it('проход у рогаток освобождается за десять настоящих минут — короче фазы осады', () => {
    expect(CAMP_GATE_CLEAR).toBe(10 * 60_000);
    expect(CAMP_GATE_CLEAR, 'поток, а не откат: меньше фазы').toBeLessThan(SIEGE_PHASE);
  });

  it('разрыв пакта — двенадцать настоящих часов предупреждения', () => {
    expect(PACT_BREAK_NOTICE).toBe(12 * 3_600_000);
  });
});
