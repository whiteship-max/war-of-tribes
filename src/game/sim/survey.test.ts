import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameState } from '../types';
import { createInitialState } from '../state';
import { catchUp, tick } from './tick';
import { SURVEY_MAX, SURVEY_STEPS, surveyRadiusOf } from '../data/survey';
import { buildingOfType, storageCap, surveyRadius } from '../derived';
import { cancelSurvey, startSurvey, surveyInfo, surveySeconds } from './survey';

/** Посёлок с богатым складом и Дозором нужного уровня: цена ступеней не мешает. */
function rich(watchLevel: number): GameState {
  const s = createInitialState();
  for (const r of Object.keys(s.resources) as (keyof typeof s.resources)[]) s.resources[r] = 100_000;
  const watch = buildingOfType(s, 'watch');
  if (watch) watch.level = watchLevel;
  return s;
}

describe('Дозор: изучение округи', () => {
  it('ступень выше уровня здания не изучить', () => {
    const s = rich(1);
    // Первая ступень требует Дозора первого уровня — она доступна.
    expect(surveyInfo(s).blocked).toBeNull();
    expect(startSurvey(s)).toBeNull();
    catchUp(s, SURVEY_STEPS[0].seconds + 2);
    expect(s.survey.done).toBe(1);

    // Вторая требует второго — и не начинается, пока Дозор первого.
    const info = surveyInfo(s);
    expect(info.next?.n).toBe(2);
    expect(info.blocked).toContain('Дозор 2 уровня');
    expect(startSurvey(s)).toContain('Дозор 2 уровня');
    expect(s.survey.done).toBe(1);

    // Подняли здание — та же ступень пошла.
    buildingOfType(s, 'watch')!.level = 2;
    expect(startSurvey(s)).toBeNull();
  });

  it('изучение доводится из времени начала, а не из работы', () => {
    const s = rich(1);
    startSurvey(s);
    const until = s.survey.until;
    expect(until).toBeGreaterThan(0);

    // Ни одного рабочего никуда не ставили — и это ничего не меняет: срок идёт.
    tick(s, 1);
    expect(s.survey.done).toBe(0);

    // Офлайн-догон проходит мимо отметки ровно так же, как непрерывная игра.
    const offline = rich(1);
    startSurvey(offline);
    catchUp(offline, SURVEY_STEPS[0].seconds + 5);
    expect(offline.survey.done).toBe(1);
    expect(offline.survey.until).toBe(0);

    const online = rich(1);
    startSurvey(online);
    for (let i = 0; i < SURVEY_STEPS[0].seconds + 5; i++) tick(online, 1);
    expect(online.survey.done).toBe(offline.survey.done);
  });

  it('цена снимается на старте, отмена возвращает половину', () => {
    const s = rich(1);
    const step = SURVEY_STEPS[0];
    // Возврат ложится на склад под потолок вместимости (`pay.refund`), поэтому
    // мерить его надо на складе, где место есть: у `rich` запасы выше потолка.
    s.resources.wood = storageCap(s) - 1000;
    const before = s.resources.wood;
    startSurvey(s);
    expect(s.resources.wood).toBe(before - (step.cost.wood ?? 0));
    cancelSurvey(s);
    expect(s.resources.wood).toBe(before - (step.cost.wood ?? 0) + Math.floor((step.cost.wood ?? 0) / 2));
    expect(s.survey.done).toBe(0);
    expect(surveyInfo(s).running).toBeNull();
  });

  it('радиус растёт со ступенями и упирается в десятую', () => {
    const s = rich(SURVEY_MAX);
    expect(surveyRadius(s)).toBe(0);
    for (let n = 1; n <= SURVEY_MAX; n++) {
      expect(startSurvey(s)).toBeNull();
      catchUp(s, SURVEY_STEPS[n - 1].seconds + 2);
      expect(s.survey.done).toBe(n);
      expect(surveyRadius(s)).toBe(SURVEY_STEPS[n - 1].radius);
    }
    expect(surveyInfo(s).blocked).toBe('Округа изучена вся.');
    expect(startSurvey(s)).toBe('Округа изучена вся.');
    // Радиусы строго растут: ступень, не открывшая ни клетки, была бы обманом.
    for (let i = 1; i < SURVEY_STEPS.length; i++) {
      expect(SURVEY_STEPS[i].radius).toBeGreaterThan(SURVEY_STEPS[i - 1].radius);
    }
    expect(surveyRadiusOf(SURVEY_MAX + 5)).toBe(SURVEY_STEPS[SURVEY_MAX - 1].radius);
  });

  it('пока идут разъезды, вторую ступень не начать', () => {
    const s = rich(SURVEY_MAX);
    startSurvey(s);
    expect(startSurvey(s)).toBe('Разъезды в поле: Дозор занят.');
  });

  it('ступень пишет в летопись одну строку', () => {
    const s = rich(1);
    s.log = [];
    startSurvey(s);
    catchUp(s, SURVEY_STEPS[0].seconds + 2);
    const lines = s.log.filter((l) => l.text.startsWith('Дозор:'));
    expect(lines).toHaveLength(2); // «пошли» и «изучена»
  });

  it('срок ступени у панели и у постановки один — с ускорением от веры', () => {
    const s = rich(SURVEY_MAX);
    s.faith.id = 'islam';
    const church = buildingOfType(s, 'church');
    if (church) church.level = SURVEY_MAX;
    const info = surveyInfo(s);
    // Точка внутри области правила: вера и правда ускоряет разъезды.
    expect(info.learning, 'медресе ускоряет').toBeGreaterThan(1);
    const step = info.next!;
    expect(startSurvey(s)).toBeNull();
    expect(s.survey.until - s.survey.startedAt, 'поставлено на обещанный срок').toBe(surveySeconds(step, info.learning));
    expect(surveySeconds(step, info.learning)).toBeLessThan(step.seconds);
    // Панель Дозора сырого срока ступени не пишет: только через ту же функцию.
    const panel = readFileSync(join(__dirname, '..', '..', 'ui', 'parts', 'Watch.tsx'), 'utf8');
    expect(panel, 'Watch.tsx: срок ступени без веры').not.toMatch(/\.seconds\b/);
  });
});
