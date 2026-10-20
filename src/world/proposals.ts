// Предложение между игроками (ДП-1, docs/AGENTS.md, раздел 17): кто, кому, что, срок, ответ. Один вид на союз сейчас и на
// мир, перемирие, дань, торговлю и объявление войны потом — новый вид дописывается строкой таблицы `PROPOSALS`, а дверь
// ответа, срок, «Вести», летопись и вести в Telegram остаются те же.
//
// Правило ответа (кто может и пока ли срок) и слова игроку — здесь, одни на сервер войны (`netlify/lib/war.ts`) и на
// «Вести»: кнопка гаснет по той же проверке, по которой сервер откажет. Без `@/`-импортов: файл читает и сервер.

/** Что предлагают. Сейчас — союз; таблица — задел (раздел 17.3). */
export const PROPOSAL_KINDS = ['pact'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/**
 * Чем кончилось: приняли (`yes`), отклонили (`no`), срок вышел (`expired`), предложивший отозвал (`withdrawn`); `broken` —
 * одна из сторон разорвала договор, заключённый по такому предложению (у игроков это и есть «война», AGENTS.md, 16.4, 6).
 */
export const PROPOSAL_ENDS = ['yes', 'no', 'expired', 'withdrawn', 'broken'] as const;
export type ProposalEnd = (typeof PROPOSAL_ENDS)[number];

/** Ответ стороны: тот, кому предложили, — принять или отклонить; тот, кто предложил, — отозвать. */
export const PROPOSAL_ACTS = ['yes', 'no', 'withdraw'] as const;
export type ProposalAct = (typeof PROPOSAL_ACTS)[number];

export interface ProposalDef {
  id: ProposalKind;
  /** Имя договора: «Союз». */
  name: string;
  /** Что предлагают — продолжение «Город «X» …»: «зовёт в союз». */
  asks: string;
  /** «Предложение …»: «союза». */
  of: string;
  /** Договор заключён — продолжение «… с «X»»: «Союз … заключён» (род слова у каждого вида свой). */
  made: string;
  /** Что договор даст обеим сторонам — одна строка на «Вести», карточку и Telegram. */
  gives: string;
  /** Сколько предложение ждёт ответа, мс настоящего времени. */
  ttlMs: number;
}

/**
 * Виды предложений. Срок союза — сутки, как у вести города без ответа (`EventDef.silence`): игрок, заходящий раз в день,
 * успевает ответить, а забытое не висит неделями.
 */
export const PROPOSALS: Record<ProposalKind, ProposalDef> = {
  pact: {
    id: 'pact',
    name: 'Союз',
    asks: 'зовёт в союз',
    of: 'союза',
    made: 'заключён',
    gives: 'Союзники приходят друг другу на выручку и походом друг на друга не ходят.',
    ttlMs: 24 * 3600_000,
  },
};

/** Предложение глазами одной из сторон — так его отдаёт сервер войны (без ключей игроков) и рисуют «Вести». */
export interface ProposalView {
  /** Номер предложения: по нему отвечают (`WarOrder` `deal`) и по нему открывает «Вести» весть в Telegram. */
  id: string;
  kind: ProposalKind;
  /** `in` — предложили нам, `out` — предложили мы. */
  side: 'in' | 'out';
  /** Другая сторона: замок и имя города на минуту предложения. */
  castle: string;
  city: string;
  /** Когда предложили и до какой минуты ждут ответа. */
  at: number;
  until: number;
  /** Чем кончилось. Нет — ждёт ответа. */
  end?: ProposalEnd;
  endAt?: number;
  /** Кто закрыл: мы или сосед. Нет — никто (срок вышел). */
  endBy?: 'us' | 'them';
}

/** Сколько предложение ждёт ответа — словами: «сутки», «2 сут.», «12 ч». */
export function waitWords(kind: ProposalKind): string {
  const h = Math.round(PROPOSALS[kind].ttlMs / 3600_000);
  if (h % 24 !== 0) return `${h} ч`;
  return h === 24 ? 'сутки' : `${h / 24} сут.`;
}

/** Ждёт ли ответа. */
export const proposalOpen = (p: Pick<ProposalView, 'end' | 'until'>, now: number): boolean => !p.end && now < p.until;

/**
 * Можно ли так ответить: отказ словами или `null`. Одна проверка у сервера (ЗЩ-1: отвечает адресат, отзывает предложивший,
 * пока срок не вышел) и у кнопки в «Вестях».
 */
export function answerBlock(p: Pick<ProposalView, 'side' | 'end' | 'until'>, act: ProposalAct, now: number): string | null {
  if (p.end) return p.end === 'expired' ? 'Срок ответа вышел.' : 'На это предложение уже ответили.';
  if (now >= p.until) return 'Срок ответа вышел.';
  if (act === 'withdraw') return p.side === 'out' ? null : 'Отозвать можно только своё предложение.';
  return p.side === 'in' ? null : 'Ответить может только тот, кому предложили.';
}

/** Заголовок строки «Вестей»: «Союз: «Альфа»». */
export const proposalTitle = (p: Pick<ProposalView, 'kind' | 'city'>): string => `${PROPOSALS[p.kind].name}: «${p.city}»`;

/** Что в предложении — словами стороны: кто кого зовёт и что это даст. */
export function proposalText(p: Pick<ProposalView, 'kind' | 'side' | 'city'>): string {
  const def = PROPOSALS[p.kind];
  return p.side === 'in'
    ? `Город «${p.city}» ${def.asks}. ${def.gives}`
    : `Мы предложили городу «${p.city}» ${def.name.toLowerCase()}. ${def.gives} Ждём их ответа.`;
}

/**
 * Итог словами стороны — строка «Вестей» и летописи. Свои слова у каждой стороны: тот, кто отклонил, и тот, кому отказали,
 * читают разное.
 */
export function endWords(p: Pick<ProposalView, 'kind' | 'side' | 'city' | 'end' | 'endBy'>): string {
  const def = PROPOSALS[p.kind];
  const name = def.name.toLowerCase();
  const city = `«${p.city}»`;
  const us = p.endBy === 'us';
  switch (p.end) {
    case 'yes':
      return `${def.name} с ${city} ${def.made}. ${def.gives}`;
    case 'no':
      return us ? `Мы отклонили предложение ${def.of} от ${city}.` : `${city} отклонил наше предложение ${def.of}.`;
    case 'expired':
      return p.side === 'out'
        ? `${city} не ответил на предложение ${def.of}: срок вышел.`
        : `Предложение ${def.of} от ${city} осталось без ответа: срок вышел.`;
    case 'withdrawn':
      return us ? `Мы отозвали предложение ${def.of} городу ${city}.` : `${city} отозвал предложение ${def.of}.`;
    case 'broken':
      return us ? `Мы разорвали ${name} с ${city}.` : `${city} разорвал ${name} с нами.`;
    default:
      return proposalText(p);
  }
}
