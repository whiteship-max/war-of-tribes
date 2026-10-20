// Дела агентов у цели (Р-4, docs/AGENTS.md, раздел 16): кто что делает и при какой цели. Таблица одна: по ней «Походы»
// собирают меню, а мир проверяет приказ (`LocalWorld.errand`) — дело чужого агента или не к той цели не пройдёт ни
// кнопкой, ни подделанным вызовом. Числа дел (цена в энергии, шанс, гибель, срок) — не здесь, а у их прежних дверей:
// `data/energy.ENERGY_PRICE`, `data/spy`, `data/diplomacy`, `world/peril`.
import type { ErrandId, ErrandTargetKind, FigureId } from '../types';
import { DEALS } from './figures';
import { DIPLO_ACTIONS } from './diplomacy';
import { RIVAL_DEEDS, SPY_ACTIONS } from './spy';

export interface ErrandDef {
  id: ErrandId;
  agent: FigureId;
  /** Имя на кнопке. */
  name: string;
  /** Что сделает — одной фразой, для подтверждения. */
  does: string;
  /** При каких целях дело есть. */
  on: readonly ErrandTargetKind[];
}

const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

export const ERRANDS: readonly ErrandDef[] = [
  // Полководец. Дома дружина при нём — гарнизон: «встать в оборону» и есть «домой».
  { id: 'home', agent: 'general', name: 'Встать в оборону', does: 'Вернётся в свой город, его отряд станет гарнизоном.', on: ['home'] },
  { id: 'storm', agent: 'general', name: 'Ударить', does: 'Дойдёт и сразу пойдёт на штурм. После боя вернётся домой.', on: ['place', 'rival'] },
  { id: 'siege', agent: 'general', name: 'Осадить', does: 'Дойдёт и встанет лагерем у стен. Домой вернётся, когда осада кончится.', on: ['place', 'rival'] },
  // Р-5 (docs/siege_v2.md, 21.1): та же осада, но с кольцом — если мощи хватит, в минуту постановки.
  {
    id: 'blockade',
    agent: 'general',
    name: 'Блокада',
    does: 'Дойдёт, встанет лагерем и замкнёт кольцо вокруг города, если лагерь вчетверо сильнее гарнизона; не хватит мощи — будет обычная осада. Домой вернётся, когда осада кончится.',
    on: ['place', 'rival'],
  },
  { id: 'intercept', agent: 'general', name: 'Перехватить', does: 'Встретит отряд в поле до его цели и даст бой. После боя вернётся домой.', on: ['march'] },
  { id: 'strike', agent: 'general', name: 'Ударить по лагерю', does: 'Ударит по осадному лагерю с тыла. После боя вернётся домой.', on: ['home', 'place'] },
  { id: 'relief', agent: 'general', name: 'Выручить союзника', does: 'Дойдёт до союзника и ударит по лагерю под его стенами с тыла. После боя вернётся домой.', on: ['rival'] },
  // Разведчик.
  { id: 'home', agent: 'scout', name: 'Домой', does: 'Вернётся в свой город.', on: ['home'] },
  { id: 'recon', agent: 'scout', name: 'Разведать', does: 'Дойдёт до ворот, пересчитает гарнизон и вернётся домой с донесением.', on: ['place'] },
  { id: 'shadow', agent: 'scout', name: 'Следить за отрядом', does: 'Выйдет навстречу отряду, сочтёт его и вернётся домой с донесением.', on: ['march'] },
  // Дипломат: приказы двору и договоры с державой — у ворот её города; с игроком — союз и его разрыв.
  { id: 'home', agent: 'diplomat', name: 'Домой', does: 'Вернётся в свой город.', on: ['home'] },
  ...DIPLO_ACTIONS.map((a): ErrandDef => ({ id: a.id, agent: 'diplomat', name: a.name, does: `${a.description} Потом вернётся домой.`, on: a.id === 'pact' ? ['place', 'rival'] : ['place'] })),
  ...DEALS.map((d): ErrandDef => ({ id: d.id, agent: 'diplomat', name: d.name, does: `Договор с державой: ${lower(d.description)} Потом вернётся домой.`, on: ['place'] })),
  { id: 'ransom', agent: 'diplomat', name: 'Откупиться', does: 'Выйдет к лагерю у наших стен и предложит дань за снятие осады. Справедливую цену называет лагерь.', on: ['home'] },
  { id: 'unpact', agent: 'diplomat', name: 'Разорвать союз', does: 'Отвезёт соседу разрыв союза: вы снова не связаны ничем. Потом вернётся домой.', on: ['rival'] },
  // Лазутчик.
  { id: 'home', agent: 'spy', name: 'Домой', does: 'Вернётся в свой город.', on: ['home'] },
  ...SPY_ACTIONS.map((a): ErrandDef => ({ id: a.id, agent: 'spy', name: a.name, does: `${a.description} Потом вернётся домой.`, on: ['place'] })),
  { id: 'watch', agent: 'spy', name: 'Наблюдать', does: 'Заляжет у этого места и будет видеть округу, пока не позовёшь домой.', on: ['place'] },
  ...RIVAL_DEEDS.map((d): ErrandDef => ({ id: d.id, agent: 'spy', name: d.name, does: `${d.description} Потом вернётся домой.`, on: ['rival'] })),
];

/** Дела агента при цели этого вида — в порядке таблицы. */
export const errandsOf = (agent: FigureId, kind: ErrandTargetKind): ErrandDef[] =>
  ERRANDS.filter((e) => e.agent === agent && e.on.includes(kind));

/** Строка таблицы для пары «агент — дело». Undefined — такого дела у агента нет. */
export const errandDef = (agent: FigureId, id: ErrandId): ErrandDef | undefined =>
  ERRANDS.find((e) => e.agent === agent && e.id === id);
