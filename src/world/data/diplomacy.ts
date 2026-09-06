// Характеры владельцев и приказы дипломата: подписи, иконки и веса в одном месте.
// Логика ответа живёт в `world/diplomacy.ts` и только читает эти таблицы —
// баланс правится здесь и в `data/tuning.ts`, а не по коду.
//
// Пока на карте одни боты, но механику закладываем под живых игроков: ответ
// соседа — чистая функция от отношения, характера и зерна, и её место потом
// займёт решение живого человека. Поэтому здесь нет ни одной величины, которая
// имела бы смысл только «потому что соседом управляем мы сами».
import type { DiploActionId, Standing, TemperId } from '../types';
import {
  ORDER_BUSY_GIFT,
  ORDER_BUSY_INSULT,
  ORDER_BUSY_PACT,
  ORDER_BUSY_PEACE,
  ORDER_BUSY_WAR,
} from './tuning';

export interface TemperDef {
  id: TemperId;
  name: string;
  icon: string;
  /** Как он отвечает — словами, теми же, что видит игрок в карточке. */
  note: string;
  /** Готовность вообще принять дар: гордый может счесть его подачкой. */
  giftOpen: number;
  /** Во сколько раз дар греет сильнее обычного. */
  giftMult: number;
  /** Во сколько раз больнее оскорбление. */
  insultMult: number;
  /** Отношение, ниже которого пакт не подпишут ни при каком броске. */
  pactBar: number;
  /** То же для мира: свирепый мирится позже прочих. */
  peaceBar: number;
  /** Склонность сорваться в войну после оскорбления. */
  hot: number;
  /** Во сколько раз охотнее ходит в набег. */
  raid: number;
}

/**
 * Пять характеров. Список закрыт и порядок в нём — порядок показа; сам характер
 * выводится из имени владельца и сида (`temperOf`), а не хранится в сохранении:
 * у одного бота бывает несколько поселений, и характер у него один на все.
 */
export const TEMPERS: TemperDef[] = [
  {
    id: 'proud',
    name: 'Гордый',
    icon: '🦚',
    note: 'Ценит почёт выше добра: дар может принять за подачку, а оскорбления не прощает.',
    giftOpen: 0.5,
    giftMult: 0.8,
    insultMult: 1.4,
    pactBar: 20,
    peaceBar: 10,
    hot: 0.45,
    raid: 1,
  },
  {
    id: 'greedy',
    name: 'Расчётливый',
    icon: '⚖️',
    note: 'Мерит всё выгодой: дары принимает охотно, договоры подписывает легко, воюет неохотно.',
    giftOpen: 1,
    giftMult: 1.4,
    insultMult: 0.8,
    pactBar: -10,
    peaceBar: -20,
    hot: 0.1,
    raid: 0.7,
  },
  {
    id: 'fierce',
    name: 'Свирепый',
    icon: '🐗',
    note: 'Ищет повода. Пакт с ним почти не заключить, а оскорбление кончится войной.',
    giftOpen: 0.6,
    giftMult: 0.7,
    insultMult: 1.2,
    pactBar: 35,
    peaceBar: 25,
    hot: 0.7,
    raid: 2,
  },
  {
    id: 'wary',
    name: 'Осторожный',
    icon: '🦊',
    note: 'Боится сильных соседей: на пакт идёт охотно, но обиды помнит долго.',
    giftOpen: 0.8,
    giftMult: 1,
    insultMult: 1.2,
    pactBar: -5,
    peaceBar: -5,
    hot: 0.2,
    raid: 0.8,
  },
  {
    id: 'steady',
    name: 'Степенный',
    icon: '🪨',
    note: 'Ровен со всеми: ни быстрых друзей, ни быстрых врагов.',
    giftOpen: 0.85,
    giftMult: 1,
    insultMult: 1,
    pactBar: 5,
    peaceBar: 0,
    hot: 0.15,
    raid: 1,
  },
];

export const TEMPER_BY_ID: Record<TemperId, TemperDef> = Object.fromEntries(
  TEMPERS.map((t) => [t.id, t]),
) as Record<TemperId, TemperDef>;

export const TEMPER_IDS: TemperId[] = TEMPERS.map((t) => t.id);

export interface StandingDef {
  id: Standing;
  name: string;
  icon: string;
  note: string;
  color: string;
}

export const STANDING_META: Record<Standing, StandingDef> = {
  neutral: {
    id: 'neutral',
    name: 'Нейтралитет',
    icon: '➖',
    note: 'Живут как жили: набег оттуда возможен, но не чаще прочих.',
    color: '#cbbca6',
  },
  pact: {
    id: 'pact',
    name: 'Пакт о ненападении',
    icon: '📜',
    note: 'Пока пакт в силе, набегов отсюда не будет.',
    color: '#6bb6e8',
  },
  war: {
    id: 'war',
    name: 'Война',
    icon: '⚔️',
    note: 'Они целятся в нас, а не в других: набеги отсюда идут чаще.',
    color: '#e06b5a',
  },
};

/**
 * Приказы дипломата. Порядок — порядок показа в меню: сначала то, чем отношения
 * правят, потом то, чем их ломают. Цена и шанс считаются в `world/diplomacy.ts`
 * и приезжают в меню числами, а не пересчитываются в разметке.
 */
export interface DiploActionDef {
  id: DiploActionId;
  name: string;
  icon: string;
  description: string;
  /** Что означает показанный шанс: у оскорбления это риск, а не удача. */
  chanceLabel: string;
  /** Сколько дипломат будет занят после приказа, мс. */
  busy: number;
}

export const DIPLO_ACTIONS: DiploActionDef[] = [
  {
    id: 'gift',
    name: 'Передать дар',
    icon: '🎁',
    description: 'Обоз добра к чужим воротам. Принятый дар греет отношение, отвергнутый возвращается.',
    chanceLabel: 'примут',
    busy: ORDER_BUSY_GIFT,
  },
  {
    id: 'pact',
    name: 'Предложить пакт',
    icon: '📜',
    description: 'Ненападение с этим двором. Согласие зависит от отношения и характера владельца.',
    chanceLabel: 'согласятся',
    busy: ORDER_BUSY_PACT,
  },
  {
    id: 'peace',
    name: 'Заключить мир',
    icon: '🕊️',
    description: 'Вернуть нейтралитет. Отношение от этого само не выправится — только состояние.',
    chanceLabel: 'согласятся',
    busy: ORDER_BUSY_PEACE,
  },
  {
    id: 'insult',
    name: 'Нанести оскорбление',
    icon: '🖕',
    description: 'Уронить отношение нарочно. Горячий владелец может ответить войной.',
    chanceLabel: 'риск войны',
    busy: ORDER_BUSY_INSULT,
  },
  {
    id: 'war',
    name: 'Объявить войну',
    icon: '⚔️',
    description: 'Объявляется в одностороннем порядке. Из пакта — не сразу: сутки предупреждения.',
    chanceLabel: '',
    busy: ORDER_BUSY_WAR,
  },
];

export const DIPLO_ACTION_BY_ID: Record<DiploActionId, DiploActionDef> = Object.fromEntries(
  DIPLO_ACTIONS.map((a) => [a.id, a]),
) as Record<DiploActionId, DiploActionDef>;
