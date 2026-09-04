import type { GameState } from '../types';
import { DAY_LENGTH } from '../constants';
import { buildingOfType, dayOf, housingCapacity, isSite, jobCounts, storageCap } from '../derived';
import { resolveBattle } from '../sim/battle';
import { addVillager, killRandomVillager } from '../sim/population';
import { chance, rnd } from '../sim/random';
import { log } from '../sim/log';

export interface EventOption {
  label: string;
  hint?: string;
  /** Применяет выбор и возвращает текст результата. */
  apply: (s: GameState) => string;
}

export interface EventDef {
  id: string;
  icon: string;
  title: string;
  text: string | ((s: GameState) => string);
  options: EventOption[];
  /** Вес выбора (0 — событие сейчас невозможно). */
  weight: (s: GameState) => number;
}

const addRes = (s: GameState, r: keyof GameState['resources'], n: number): number => {
  const cap = storageCap(s);
  const before = s.resources[r];
  s.resources[r] = Math.max(0, Math.min(cap, before + n));
  return Math.round(s.resources[r] - before);
};

export const EVENTS: EventDef[] = [
  {
    id: 'stranger',
    icon: '🚶',
    title: 'Чужак у костра',
    text: 'К лагерю вышел человек из дальних земель. Он голоден и просит принять его в племя.',
    weight: (s) => (s.villagers.length < housingCapacity(s) + 2 ? 3 : 1),
    options: [
      {
        label: 'Принять',
        hint: '−10 еды, +1 житель',
        apply: (s) => {
          addRes(s, 'food', -10);
          const v = addVillager(s);
          log(s, `${v.name} присоединился к племени.`, 'good');
          return `${v.name} теперь часть племени.`;
        },
      },
      {
        label: 'Прогнать',
        hint: 'Ничего не теряем',
        apply: (s) => {
          s.morale = Math.max(0, s.morale - 2);
          return 'Чужак ушёл в лес. Некоторые жители недовольны.';
        },
      },
    ],
  },
  {
    id: 'wolves',
    icon: '🐺',
    title: 'Волки',
    text: (s) => `Стая волков кружит у поселения. Их ${3 + Math.floor(dayOf(s.time) / 4)}.`,
    weight: (s) => (s.time > DAY_LENGTH ? 3 : 0),
    options: [
      {
        label: 'Защищаться',
        hint: 'Бой',
        apply: (s) => {
          const power = 3 + dayOf(s.time) * 0.8;
          const r = resolveBattle(s, power, 'волки');
          if (r.won) {
            const h = addRes(s, 'hides', 4);
            const b = addRes(s, 'bones', 4);
            s.stats.hunts++;
            return `${r.text} Добыча: ${h} шкур, ${b} костей.`;
          }
          return r.text;
        },
      },
      {
        label: 'Отдать запасы',
        hint: '−15 еды',
        apply: (s) => {
          addRes(s, 'food', -15);
          return 'Волки утащили часть запасов и ушли.';
        },
      },
    ],
  },
  {
    id: 'berries',
    icon: '🍇',
    title: 'Ягодная поляна',
    text: 'Собиратели нашли богатую ягодную поляну.',
    weight: () => 2,
    options: [
      {
        label: 'Собрать всё',
        hint: '+25 еды',
        apply: (s) => {
          const n = addRes(s, 'food', 25);
          return `Собрано ${n} еды.`;
        },
      },
    ],
  },
  {
    id: 'storm',
    icon: '🌩️',
    title: 'Буря',
    text: 'Ночью налетела буря и повалила леса на стройке.',
    weight: (s) => (s.buildings.some(isSite) ? 2 : 0),
    options: [
      {
        label: 'Починить',
        hint: '−10 древесины',
        apply: (s) => {
          addRes(s, 'wood', -10);
          return 'Стройку удалось починить.';
        },
      },
      {
        label: 'Оставить',
        hint: 'Стройка потеряет прогресс',
        apply: (s) => {
          const b = s.buildings.find(isSite);
          if (b) b.work *= 0.5;
          return 'Часть работы придётся переделать.';
        },
      },
    ],
  },
  {
    id: 'specialist',
    icon: '⭐',
    title: 'Мастер своего дела',
    text: 'К племени пришёл опытный человек и просит еду за свои умения.',
    weight: (s) => (s.villagers.length >= 6 ? 1.5 : 0.5),
    options: [
      {
        label: 'Взять к себе',
        hint: '−20 еды, специалист',
        apply: (s) => {
          addRes(s, 'food', -20);
          const talents = ['hunter', 'crafter', 'smith', 'woodcutter'] as const;
          const t = talents[Math.floor(rnd() * talents.length)];
          const v = addVillager(s, { talent: t, age: 25 + Math.floor(rnd() * 10) });
          log(s, `${v.name} — талантливый специалист — в племени.`, 'good');
          return `${v.name} присоединился. Талант: ${t === 'hunter' ? 'охота' : t === 'crafter' ? 'ремесло' : t === 'smith' ? 'кузня' : 'лес'}.`;
        },
      },
      { label: 'Отказать', apply: () => 'Мастер ушёл к соседям.' },
    ],
  },
  {
    id: 'trade',
    icon: '🤝',
    title: 'Соседи предлагают обмен',
    text: 'Соседнее племя предлагает 30 еды за 20 древесины.',
    weight: (s) => (s.resources.wood >= 20 ? 2 : 0),
    options: [
      {
        label: 'Обменять',
        hint: '−20 древесины, +30 еды',
        apply: (s) => {
          addRes(s, 'wood', -20);
          addRes(s, 'food', 30);
          s.prestige += 1;
          return 'Обмен состоялся. Соседи довольны.';
        },
      },
      { label: 'Отказаться', apply: () => 'Соседи ушли ни с чем.' },
    ],
  },
  {
    id: 'sickness',
    icon: '🤒',
    title: 'Болезнь',
    text: 'Один из жителей тяжело заболел.',
    weight: (s) => (s.villagers.length >= 5 ? 1.5 : 0),
    options: [
      {
        label: 'Ритуал шамана',
        hint: 'Нужен шаман',
        apply: (s) => {
          if (jobCounts(s).shaman > 0) {
            s.morale = Math.min(100, s.morale + 4);
            return 'Шаман провёл ритуал. Больной выздоровел, племя воодушевлено.';
          }
          if (chance(0.5)) {
            killRandomVillager(s, 'болезнь');
            return 'Без шамана ритуал не помог. Племя потеряло человека.';
          }
          return 'Ритуала не было, но больной выкарабкался сам.';
        },
      },
      {
        label: 'Выхаживать',
        hint: '−20 еды',
        apply: (s) => {
          addRes(s, 'food', -20);
          return 'Больного выходили. Он поправился.';
        },
      },
      {
        label: 'Ничего не делать',
        hint: 'Риск',
        apply: (s) => {
          if (chance(0.5)) {
            killRandomVillager(s, 'болезнь');
            s.morale = Math.max(0, s.morale - 5);
            return 'Больной умер. Племя скорбит.';
          }
          return 'Больному повезло: он выздоровел.';
        },
      },
    ],
  },
  {
    id: 'raiders',
    icon: '⚔️',
    title: 'Разбойники',
    text: 'Чужие воины требуют дань: 25 еды, иначе нападут.',
    weight: (s) => (dayOf(s.time) >= 5 ? 2 : 0),
    options: [
      {
        label: 'Заплатить',
        hint: '−25 еды',
        apply: (s) => {
          addRes(s, 'food', -25);
          s.prestige = Math.max(0, s.prestige - 2);
          return 'Дань уплачена. Разбойники ушли, но престиж пострадал.';
        },
      },
      {
        label: 'Сражаться',
        hint: 'Бой',
        apply: (s) => {
          const power = 5 + dayOf(s.time) * 1.1;
          const r = resolveBattle(s, power, 'разбойники');
          if (r.won) {
            const w = addRes(s, 'wood', 15);
            const h = addRes(s, 'hides', 5);
            return `${r.text} Трофеи: ${w} древесины, ${h} шкур.`;
          }
          return r.text;
        },
      },
    ],
  },
  {
    id: 'festival',
    icon: '🎉',
    title: 'Праздник',
    text: 'Вождь предлагает устроить праздник у костра.',
    weight: (s) => (s.resources.food >= 25 ? 2 : 0),
    options: [
      {
        label: 'Праздновать',
        hint: '−20 еды, мораль +15',
        apply: (s) => {
          addRes(s, 'food', -20);
          s.morale = Math.min(100, s.morale + 15);
          s.prestige += 1;
          return 'Праздник удался. Племя воодушевлено.';
        },
      },
      { label: 'Сберечь еду', apply: () => 'Праздник отложили до лучших времён.' },
    ],
  },
  {
    id: 'good_hunt',
    icon: '🦌',
    title: 'Удачная охота',
    text: 'Охотники выследили стадо оленей.',
    weight: (s) => (jobCounts(s).hunter > 0 ? 2 : 0),
    options: [
      {
        label: 'Отлично!',
        hint: '+20 еды, +5 шкур',
        apply: (s) => {
          const f = addRes(s, 'food', 20);
          const h = addRes(s, 'hides', 5);
          addRes(s, 'bones', 3);
          s.stats.hunts++;
          return `Добыто ${f} еды и ${h} шкур.`;
        },
      },
    ],
  },
  {
    id: 'fire',
    icon: '🔥',
    title: 'Пожар',
    text: 'Искра от костра попала на крышу хижины!',
    weight: (s) => ((buildingOfType(s, 'hut')?.level ?? 0) >= 2 ? 1 : 0),
    options: [
      {
        label: 'Тушить всем племенем',
        hint: '−10 еды, хижина цела',
        apply: (s) => {
          addRes(s, 'food', -10);
          return 'Хижину спасли. Все устали, но довольны.';
        },
      },
      {
        label: 'Спасать вещи',
        hint: 'Хижина потеряет уровень',
        apply: (s) => {
          // Хижина в посёлке одна: сносить её целиком — значит отнять всё жильё разом.
          // Огонь съедает пристройку, то есть один уровень.
          const hut = buildingOfType(s, 'hut');
          if (hut && hut.level > 1) hut.level -= 1;
          addRes(s, 'wood', 5);
          return 'Пристройка сгорела. Удалось спасти немного древесины.';
        },
      },
    ],
  },
];

export const EVENT_BY_ID = Object.fromEntries(EVENTS.map((e) => [e.id, e])) as Record<string, EventDef>;

export function pickEvent(s: GameState): EventDef | null {
  const weighted = EVENTS.map((e) => [e, e.weight(s)] as const).filter(([, w]) => w > 0);
  const total = weighted.reduce((a, [, w]) => a + w, 0);
  if (total <= 0) return null;
  let roll = rnd() * total;
  for (const [e, w] of weighted) {
    roll -= w;
    if (roll <= 0) return e;
  }
  return weighted[weighted.length - 1][0];
}

export const eventText = (e: EventDef, s: GameState): string => (typeof e.text === 'function' ? e.text(s) : e.text);
