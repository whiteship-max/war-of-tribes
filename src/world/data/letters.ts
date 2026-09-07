// Виды писем: заголовки, значки, тексты и подписи выбора в одном месте.
//
// Форма та же, что у приказов дипломата и лазутчика: всё, что игрок читает,
// собирается здесь, а разметка только раскладывает готовые строки. Причина та
// же, по которой карточка вида бойцов выводится из конфига: текст, написанный
// руками в JSX, расходится с числом при первой же правке баланса, и игрок
// учится неправде.
import type { Letter, LetterKindId, Loot } from '../types';

export interface LetterKindDef {
  id: LetterKindId;
  title: string;
  icon: string;
  /** Тело письма. Числа берутся из самого письма, а не из таблицы. */
  body: (l: Letter, goods: string) => string;
  /** Подпись согласия. Пусто — у письма нет выбора (предупреждение). */
  yes: string | null;
  no: string | null;
  /** Что даст согласие и что даст отказ — теми же словами, что и летопись. */
  yesHint: (l: Letter, goods: string) => string;
  noHint: (l: Letter) => string;
  /** Что будет, если промолчать. */
  silence: (l: Letter) => string;
}

const KINDS: LetterKindDef[] = [
  {
    id: 'pact',
    title: 'Предлагают пакт',
    icon: '🤝',
    body: (l) =>
      `Из «${l.fromName}» пришёл гонец с грамотой: границ не двигать, оружия друг на друга не поднимать. ` +
      'Пока грамота в силе, оттуда не выйдет ни одного набега.',
    yes: 'Подписать',
    no: 'Отказать',
    yesHint: (l) => `Пакт с «${l.fromName}» — набегов оттуда не будет.`,
    noHint: (l) => `«${l.fromName}» затаит обиду.`,
    silence: (l) => `Гонец уедет ни с чем: пакта не будет, а молчание в «${l.fromName}» сочтут за спесь.`,
  },
  {
    id: 'tribute',
    title: 'Требуют дань',
    icon: '💰',
    body: (l, goods) =>
      `«${l.fromName}» требует дань: ${goods}. Заплатим — оставят в покое; откажем — придут за ней сами.`,
    yes: 'Заплатить',
    no: 'Отказать',
    yesHint: (_l, goods) => `Со склада уйдёт ${goods}.`,
    noHint: (l) => `«${l.fromName}» объявит войну.`,
    silence: (l) => `Гонец не дождётся ответа: дань не дана, «${l.fromName}» объявит войну.`,
  },
  {
    id: 'alliance',
    title: 'Зовут в поход',
    icon: '⚔️',
    body: (l) =>
      `«${l.fromName}» зовёт встать вместе против «${l.againstName}». ` +
      'Встанем — будем в союзе с одними и в войне с другими; останемся дома — обидим зовущих.',
    yes: 'Встать вместе',
    no: 'Остаться дома',
    yesHint: (l) => `Пакт с «${l.fromName}», война с «${l.againstName}».`,
    noHint: (l) => `«${l.fromName}» сочтёт нас ненадёжными.`,
    silence: (l) => `Ответа не будет — в «${l.fromName}» поймут это как отказ, и хуже, чем отказ в лицо.`,
  },
  {
    id: 'ransom',
    title: 'Выкуп за пленных',
    icon: '⛓️',
    body: (l, goods) =>
      `В «${l.fromName}» держат наших, взятых в последнем набеге, — ${l.men ?? 0} чел. ` +
      `За ${goods} обещают отпустить всех.`,
    yes: 'Выкупить',
    no: 'Отказать',
    yesHint: (l, goods) => `${l.men ?? 0} чел. вернутся в племя, со склада уйдёт ${goods}.`,
    noHint: () => 'Пленных уведут, и выкупать будет уже некого.',
    silence: (l) => `Гонец уедет ни с чем: пленных уведут, а в «${l.fromName}» это запомнят.`,
  },
  {
    id: 'raid',
    title: 'На нас идут',
    icon: '🔥',
    body: (l) =>
      `Дозор доносит: из «${l.fromName}» вышел отряд и идёт на нашу деревню. ` +
      'Решать это письмо нечем — решают на карте: перехватить в поле или встретить у частокола.',
    yes: null,
    no: null,
    yesHint: () => '',
    noHint: () => '',
    silence: () => 'Отряд дойдёт и ударит в то, что стоит у ворот.',
  },
];

export const LETTER_KINDS: LetterKindDef[] = KINDS;

export const LETTER_KIND_BY_ID: Record<LetterKindId, LetterKindDef> = Object.fromEntries(
  KINDS.map((k) => [k.id, k]),
) as Record<LetterKindId, LetterKindDef>;

/** Названия ресурсов для писем. Своего словаря не заводим — берём общий. */
export const RESOURCE_WORD: Record<string, string> = {
  wood: 'лес',
  stone: 'камень',
  food: 'еда',
  hides: 'шкуры',
  bones: 'кость',
  copper: 'медь',
  iron: 'железо',
  gold: 'золото',
};

/** Добро словами: «лес 40, шкуры 12». Пусто — «ничего». */
export function goodsText(loot: Loot): string {
  const parts = Object.entries(loot)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([r, n]) => `${RESOURCE_WORD[r] ?? r} ${Math.round(n ?? 0)}`);
  return parts.length > 0 ? parts.join(', ') : 'ничего';
}
