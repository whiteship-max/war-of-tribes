// Переговоры у стен — одна дверь на мир и на сервер войны (docs/siege_v2.md, раздел 7; этап 2е).
//
// Модуль чистый, того же рода, что `siegeroll.ts`: ни состояния мира, ни часов, ни `Math.random`. Два предложения:
//
// - **сдача на условиях** (`terms`) — от осаждающего: «откройте ворота, и участь будет мягче объявленной». Принята — город
//   падает той же дверью, что «ворота открыли» (`spoils.fate`, гарнизон уходит живым), с участью из условий;
// - **дань за снятие** (`tribute`) — от осаждённого: «вот добро, уходите». Принята — добро переходит от города лагерю той же
//   дверью дележа, что добыча (`spoils.plunder`: что в тайнике — остаётся), лагерь снимается, город получает
//   неприкосновенность, как после падения (`SIEGE_IMMUNE`).
//
// Цена — по правилу проекта (7.2): **справедливая дань = добыча объявленной участи × доля пути осады**. Доля пути —
// большее из двух: ход осады к сдаче или прошедшее к сроку голода. Это не прогноз исхода, а уже случившееся. Логова
// отвечают той же формулой: лагерь логова принимает дань не меньше справедливой, логово под нашим лагерем сдаётся на
// условиях, которые обходятся ему не дороже справедливой дани, и само предлагает выкуп, когда доля пути перевалила за
// половину. Алмазов здесь нет ни в каком виде: дань — добро города, и переходит, а не начисляется.
import type { SiegeWindow } from './siege';
import type { Fate, Loot } from './types';
import { siegeSince } from './siege';
import { breachesOf, breadLeft, phaseAt, phaseOf, progressOf, type RollWindow } from './siegeroll';
import { FATE_IDS, HEAD_CARRY, plunder, type FateResult, type Spoils } from './spoils';
import { COURSE_FACES, GATES_SURE, LAIR_RANSOM_SHARE } from './data/parley';

/** Предложение: сдача на условиях (от осаждающего) или дань за снятие (от осаждённого). */
export type OfferKind = 'terms' | 'tribute';

/** Кто предлагает: условия — осаждающий, дань — осаждённый. Второго поля «кто» нет — оно разошлось бы с видом. */
export const offerBy = (kind: OfferKind): 'atk' | 'def' => (kind === 'terms' ? 'atk' : 'def');

/** Предложение у стен — строка окна осады (`SiegeWindow.offers`) и лагеря войны (`contract.WarCamp.offers`). */
export interface SiegeOffer {
  kind: OfferKind;
  /** Минута предложения, мс мира. */
  at: number;
  /** До какой минуты стоит: конец следующей фазы (7.3). */
  until: number;
  /** Условия сдачи — участь мягче объявленной. Только у `terms`. */
  fate?: Fate;
  /** Дань — сколько добра всего (припасы и казна). Только у `tribute`. Заморожена при предложении. */
  price?: number;
  /** Ответ: принято или отклонено. Нет — ждёт ответа или истекло. */
  answer?: 'yes' | 'no';
  /** Когда ответили. */
  answeredAt?: number;
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/**
 * Доля пути осады в минуту `at`, 0..1 (7.2): большее из хода к сдаче и прошедшего к сроку голода. Ход к сдаче — набранные
 * проломы и ступени хода в гранях против хода, при котором ворота открываются и на единице кости (`GATES_SURE`). Прошедшее
 * к голоду — к концу текущей фазы: фаза — единица хода осады, и начатая считается пройденной (предложение и стоит до конца
 * следующей). Иначе в первую минуту осады справедливая дань была бы нулём, и лагерь снимался бы даром.
 */
export function siegeShare(w: RollWindow, at: number): number {
  const since = siegeSince(w as SiegeWindow);
  const end = phaseAt(since, phaseOf(since, at));
  const hunger = 1 - breadLeft(w, end);
  const course = (breachesOf(w) * COURSE_FACES.breach + progressOf(w) * COURSE_FACES.progress) / GATES_SURE;
  return clamp01(Math.max(hunger, course));
}

/**
 * Добыча участи — что падение отнимает у города добром (7.2): у грабежа и увода — увезённое, уведённые люди — курсом обоза
 * (`HEAD_CARRY`: столько добра стоит в обозе один человек); у сожжения — сгоревшее. Дань платят, чтобы этого не было, и
 * стоит она в той же мере. Постройки в цену не входят: дань — добро, а не уровни.
 */
export const bountyOf = (r: FateResult): number =>
  Math.max(0, r.lostTotal) + HEAD_CARRY * (Math.max(0, r.ledBonded.taken) + Math.max(0, r.ledPop.taken));

/** Справедливая дань: добыча объявленной участи × доля пути, вверх до целого. */
export const fairTribute = (bounty: number, share: number): number => Math.max(0, Math.ceil(Math.max(0, bounty) * clamp01(share) - 1e-9));

/**
 * Дань, которую просит лагерь у осаждённого с дипломатом красноречия `cut` (АГ-1, `agentrules.eloquenceCut`): справедливая,
 * сбавленная на долю, вверх до целого. Одна функция на лагерь логова у наших стен (мир) и на лагерь игрока (сервер войны, со
 * своей книгой агентов): дипломат без красноречия и пустое место — ровно справедливая.
 */
export const tributeAsk = (fair: number, cut = 0): number =>
  Math.max(0, Math.ceil(Math.max(0, fair) * (1 - clamp01(Number.isFinite(cut) ? cut : 0)) - 1e-9));

/**
 * Что уходит данью: добро города на `price` той же дверью дележа, что добыча (`spoils.plunder`) — что в тайнике, остаётся,
 * берётся поровну долям того, что лежит на виду. Казна — восьмым припасом, как в участи.
 */
export const tributeGoods = (stock: Loot, gold: number, stash: number, price: number): Spoils =>
  plunder({ ...stock, gold: Math.max(0, Math.floor(gold)) }, stash, price);

/** Мягче ли участь `offered` объявленной: ниже по лестнице (`spoils.FATE_IDS`). */
export const softerThan = (offered: Fate, declared: Fate): boolean => FATE_IDS.indexOf(offered) < FATE_IDS.indexOf(declared);

/** Условия сдачи, которые можно предложить при объявленной участи: все ступени мягче неё. */
export const termsChoices = (declared: Fate): Fate[] => FATE_IDS.filter((f) => softerThan(f, declared));

/** Почему условия `offered` не предложить при объявленной `declared`; null — можно. */
export function termsBlock(declared: Fate, offered: Fate | undefined): string | null {
  if (!termsChoices(declared).length) return 'Мягче грабежа участи нет: условий не предложить. Остаётся ждать дани или брать город.';
  if (!offered || !softerThan(offered, declared)) return 'Условия сдачи — участь мягче объявленной.';
  return null;
}

/** Минута, до которой стоит предложение, сделанное в `at`: конец следующей фазы (7.3). */
export const offerUntil = (w: RollWindow, at: number): number => {
  const since = siegeSince(w as SiegeWindow);
  return phaseAt(since, phaseOf(since, at) + 1);
};

/** Предложения окна. */
export const offersOf = (w: Pick<SiegeWindow, 'offers'>): readonly SiegeOffer[] => w.offers ?? [];

/** Предложение вида `kind`, ждущее ответа в минуту `now`; нет — null. */
export const liveOffer = (w: Pick<SiegeWindow, 'offers'>, kind: OfferKind, now: number): SiegeOffer | null =>
  offersOf(w).find((o) => o.kind === kind && !o.answer && now < o.until) ?? null;

/**
 * Почему сторона не может предложить в минуту `now`; null — может. Одно предложение на сторону в фазу (7.3): и принятое,
 * и отклонённое, и истёкшее занимают свою фазу.
 */
export function offerBlock(w: RollWindow, kind: OfferKind, now: number): string | null {
  const since = siegeSince(w as SiegeWindow);
  const k = phaseOf(since, now);
  if (offersOf(w).some((o) => o.kind === kind && phaseOf(since, o.at) === k)) return 'В эту фазу уже предлагали. Следующее — в новой фазе.';
  return null;
}

/** Окно после предложения. */
export function offerAfter(w: RollWindow, offer: Omit<SiegeOffer, 'until'>): { offers: SiegeOffer[] } {
  return { offers: [...offersOf(w), { ...offer, until: offerUntil(w, offer.at) }] };
}

/** Окно после ответа на предложение вида `kind`, ждущее в минуту `now`. Нечего ответить — окно как было. */
export function answerAfter(w: Pick<SiegeWindow, 'offers'>, kind: OfferKind, answer: 'yes' | 'no', now: number): { offers: SiegeOffer[] } {
  const live = liveOffer(w, kind, now);
  return { offers: offersOf(w).map((o) => (o === live ? { ...o, answer, answeredAt: now } : { ...o })) };
}

// ------------------------------------------------ ответы логова (та же формула, 7.2) ---

/** Лагерь логова принимает дань не меньше справедливой. */
export const botTakesTribute = (price: number, fair: number): boolean => price >= fair;

/**
 * Логово под нашим лагерем сдаётся на условиях, когда они обходятся ему не дороже справедливой дани: добыча участи из
 * условий не больше дани, которую ему пришлось бы дать сейчас. Та же формула с другой стороны.
 */
export const botTakesTerms = (termsBounty: number, fair: number): boolean => termsBounty <= fair;

/** Логово под нашим лагерем само предлагает выкуп, когда доля пути осады перевалила за половину. */
export const lairRansoms = (share: number): boolean => share >= LAIR_RANSOM_SHARE;
