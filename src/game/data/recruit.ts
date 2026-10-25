// Найм агентов в Ратуше (АГ-1): летопись и весть о пустом месте — то, что нужно шагу партии. Слова окна (характеристики, черты,
// что они делают) — `data/agentWords.ts`, едут с окном Ратуши. Числа — `game/agentrules.ts`, дверь — `sim/recruit.ts`.
import type { FigureId } from '@/world/types';

/** Строки летописи найма. */
export const RECRUIT_LOG = {
  hired: (who: string, years: string): string => `${who} нанят в Ратуше, ${years}.`,
  dismissed: (who: string): string => `${who} уволен.`,
};

/** Весть о пустом месте агента (`sim/recruit.agentVacancyDef`): выбор нового — в Ратуше, туда ведёт дверь вести. */
export const RECRUIT_EVENT = {
  id: (role: FigureId): string => `agent_${role}`,
  title: (title: string): string => `Место: ${title.toLowerCase()}`,
  from: 'Писарь ратуши',
  text: (title: string, name: string | null, why: 'fell' | 'rest' | null): string =>
    `${name ? `${title} ${name} ${why === 'fell' ? 'погиб на деле' : 'ушёл на покой'}. ` : ''}Место пустует. В ратуше ждут кандидаты — выбери нового в разделе «Агенты».`,
  later: 'Подождать',
  laterSaid: 'Место ждёт. Кандидаты — в ратуше, «Агенты».',
};
