// Кольцо значков над целью на карте (К-2, docs/AGENTS.md, раздел 18).
//
// Касание места — города, логова, лагеря, своего города, отряда в пути — поднимает над ним четыре значка ЗН-1: письмо
// (дипломат), меч (полководец), глаз (разведчик и лазутчик) и «i» (сведения о месте). Касание значка — короткий список дел
// этого человека у этой цели (`ActionMenu`); погашенный значок касанием говорит, почему.
//
// Своей правды у кольца нет: доступен ли человек — словами мира (`WorldApi.errands`, те же строки, что в меню дел и в
// отказе приказа). Здесь только сборка: человек доступен, если хоть одно его дело у этой цели можно начать сейчас; иначе
// причина — первая, которую назвал мир. Модуль чистый — без React и сторов: его держит тест.
import { FIGURE_BY_ID } from '@/world/data/figures';
import type { ErrandOption, ErrandTarget, FigureId, FigureView } from '@/world/types';
import type { IconName } from '@/ui/icons/alias';

/** Гнездо кольца: три человека и сведения. Глаз — разведчик и лазутчик одним значком. */
export type RingSlotId = 'diplomat' | 'general' | 'eye' | 'info';

export interface RingSlot {
  id: RingSlotId;
  icon: IconName;
  /** Подпись значка (и `aria-label`). */
  label: string;
  /** Чьи дела открывает касание; у «i» — никого. */
  agent: FigureId | null;
  /** Можно ли начать хоть одно дело. */
  on: boolean;
  /** Почему погашен — словами мира. null — горит. */
  why: string | null;
}

/** Порядок по дуге слева направо: письмо, меч, глаз, сведения. */
export const RING_ORDER: readonly RingSlotId[] = ['diplomat', 'general', 'eye', 'info'];

const ICON: Record<RingSlotId, IconName> = { diplomat: 'ui-mail', general: 'gear-sword', eye: 'ui-eye', info: 'ui-info' };
const LABEL: Record<RingSlotId, string> = { diplomat: 'Дипломат', general: 'Полководец', eye: 'Разведчик и лазутчик', info: 'Сведения' };

/** Состояние одного человека у цели: горит или почему нет. `deeds` null — дела ещё считаются. */
export function agentState(
  agent: FigureId,
  goal: ErrandTarget,
  deeds: readonly ErrandOption[] | null | undefined,
  figure: FigureView | undefined,
  hireAt: string,
): { on: boolean; why: string | null } {
  const def = FIGURE_BY_ID[agent];
  if (figure?.place === 'vacant') {
    return { on: false, why: `${def.name} ${figure.gone === 'retired' ? 'ушёл на покой' : 'погиб'}. Найми нового ${hireAt}.` };
  }
  if (!deeds) return { on: false, why: 'Считаем дела…' };
  // «Домой» у чужой цели — не дело у неё: человек, которому остаётся только вернуться, здесь ничего не сделает.
  const here = goal.kind === 'home' ? deeds : deeds.filter((o) => o.id !== 'home');
  if (here.some((o) => o.can)) return { on: true, why: null };
  const why = here.find((o) => o.reason)?.reason;
  if (why) return { on: false, why };
  if (agent === 'diplomat' && goal.kind === 'place') return { on: false, why: 'С логовом не договариваются. Дипломат ездит к соседям.' };
  return { on: false, why: `У ${def.one} здесь дел нет.` };
}

/**
 * Четыре гнезда кольца. Глаз ведёт к тому из двоих, у кого дело есть: у города игрока первым спрашивается лазутчик
 * (город игрока разведывает он), у логова и отряда — разведчик; погашены оба — причина обоих.
 */
export function ringSlots(
  goal: ErrandTarget,
  deeds: Partial<Record<FigureId, readonly ErrandOption[] | null>>,
  figures: readonly FigureView[],
  hireAt: (agent: FigureId) => string,
  rival: boolean,
): RingSlot[] {
  const st = (a: FigureId) => agentState(a, goal, deeds[a], figures.find((f) => f.id === a), hireAt(a));
  const slot = (id: RingSlotId, agent: FigureId | null, s: { on: boolean; why: string | null }): RingSlot => ({
    id,
    icon: ICON[id],
    label: LABEL[id],
    agent,
    ...s,
  });
  const eyes: FigureId[] = rival ? ['spy', 'scout'] : ['scout', 'spy'];
  const [first, second] = eyes.map((a) => ({ a, s: st(a) }));
  const eye = first.s.on ? first : second.s.on ? second : null;
  return RING_ORDER.map((id) => {
    if (id === 'info') return slot('info', null, { on: true, why: null });
    if (id === 'eye') {
      if (eye) return slot('eye', eye.a, eye.s);
      const why = [first, second].map((x) => `${FIGURE_BY_ID[x.a].name}: ${x.s.why ?? ''}`).join(' ');
      return slot('eye', first.a, { on: false, why });
    }
    return slot(id, id, st(id));
  });
}
