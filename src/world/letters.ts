// Письма: что придёт, что это меняет и чем оно кончится без игрока.
//
// Модуль чистый — ни состояния мира, ни часов, ни `Math.random`. Причина та же,
// что у `world/diplomacy.ts`: пока на карте боты, письма пишет клиент, а когда
// появится сервер, писать их будет он, и переносить придётся ровно этот файл, а
// не механику. Отсюда же и второе правило: **считаем при чтении, не тикаем**.
// Протухшее письмо не отмечается таймером — оно выводится из `until` в момент,
// когда на стол посмотрели.
//
// Главное здесь — `resolveLetter`. У неё три повода и одна дверь: ответ игрока
// «да», ответ «нет» и разрешение без него (`lapse`). Одна дверь — это не
// экономия строк, а гарантия: разрешение без игрока не может сделать того,
// чего не мог бы сделать он сам. Отсюда и правило «письмо отнимает
// возможность, а не посёлок»: ни один исход не трогает ни людей, ни здания, ни
// дружину — только отношения и то добро, о котором в письме сказано вперёд.
import { seeded } from '@/game/sim/random';
import { hashId } from './diplomacy';
import type { Letter, LetterAnswerId, LetterKindId, Loot, SettlementId, Standing } from './types';
import type { ResourceId } from '@/game/types';
import {
  ALLY_CALL_ATTITUDE,
  ALLY_CALL_REFUSE,
  ALLY_CALL_TARGET_ATTITUDE,
  LETTER_PACT_ATTITUDE,
  LETTER_PACT_REFUSE,
  LETTER_PAUSE_MAX,
  LETTER_PAUSE_MIN,
  LETTER_SILENCE_EXTRA,
  LETTER_SLOTS,
  LETTER_TTL,
  LETTER_WEIGHT,
  PACT_DURATION,
  RANSOM_PAID_ATTITUDE,
  RANSOM_PER_MAN,
  RANSOM_REFUSE_ATTITUDE,
  TRIBUTE_MAX_SHARE,
  TRIBUTE_PAID_ATTITUDE,
  TRIBUTE_PER_POP,
  TRIBUTE_REFUSE_ATTITUDE,
} from './data/tuning';

/** Зерно письма: сид мира и номер письма. Ни часов, ни счётчика обращений. */
export const letterSeed = (seed: number, n: number): number => hashId(`${seed}|letter|${n}`);

/**
 * Через сколько после предыдущего придёт письмо номер `n`. Чистая функция от
 * зерна: тот же сейв и то же прошедшее время дают тот же порядок приходов, и
 * догон офлайна выкладывает ровно те же письма, что выложила бы непрерывная игра.
 */
export function letterPause(seed: number, n: number): number {
  const rng = seeded(letterSeed(seed, n) ^ 0x5bf03635);
  return LETTER_PAUSE_MIN + rng() * (LETTER_PAUSE_MAX - LETTER_PAUSE_MIN);
}

/** Двор, от которого может прийти письмо, и всё, что для этого надо знать. */
export interface LetterCandidate {
  id: SettlementId;
  name: string;
  pop: number;
  lootMix: ResourceId[];
  standing: Standing;
  attitude: number;
  /** Сколько наших там держат после прорвавшегося набега. 0 — никого. */
  captives: number;
  /** Ближний двор чужого племени: против него и зовут вставать. */
  rivalId?: SettlementId;
  rivalName?: string;
}

/** Письмо до того, как ему проставили время: вид, отправитель и условия. */
export type LetterDraft = Omit<Letter, 'id' | 'at' | 'until'>;

/**
 * Какие письма может прислать этот двор. Правила простые и все — про то, что
 * сосед вообще стал бы предлагать: под пактом дани не требуют, из-под войны не
 * зовут в союз, а выкуп предлагает только тот, кто и правда кого-то держит.
 */
function kindsFor(c: LetterCandidate): LetterKindId[] {
  const out: LetterKindId[] = [];
  if (c.captives > 0) out.push('ransom');
  if (c.standing !== 'pact') out.push('tribute');
  if (c.standing === 'neutral' && c.attitude >= 0) out.push('pact');
  if (c.standing !== 'war' && c.attitude >= 0 && c.rivalId) out.push('alliance');
  return out;
}

/** Долю добра раскладываем по тому же списку, каким отсюда берут добычу. */
function spread(total: number, mix: ResourceId[]): Loot {
  const out: Loot = {};
  if (mix.length === 0 || total <= 0) return out;
  const share = Math.max(1, Math.round(total / mix.length));
  for (const r of mix) out[r] = (out[r] ?? 0) + share;
  return out;
}

/** Сколько всего добра в этой просьбе. */
export const lootTotal = (loot: Loot): number =>
  Object.values(loot).reduce((n, v) => n + Math.max(0, v ?? 0), 0);

/**
 * Чего просит письмо. Считается от размера просящего двора — большому мелочи
 * не поднесёшь, — но сверху упирается в долю склада игрока: дань, которая
 * опустошает амбар, нарушила бы главное правило («отнимает возможность, а не
 * посёлок»), а безответное письмо всегда можно не заметить.
 */
export function letterCost(kind: LetterKindId, c: LetterCandidate, stock: Loot): Loot {
  if (kind === 'tribute') {
    const asked = Math.max(1, Math.round(c.pop * TRIBUTE_PER_POP));
    const cap = Math.max(1, Math.floor(lootTotal(stock) * TRIBUTE_MAX_SHARE));
    return spread(Math.min(asked, cap), c.lootMix);
  }
  if (kind === 'ransom') {
    const men = Math.max(1, Math.round(c.captives));
    const asked = Math.max(1, Math.round(men * RANSOM_PER_MAN));
    const cap = Math.max(1, Math.floor(lootTotal(stock) * TRIBUTE_MAX_SHARE));
    return spread(Math.min(asked, cap), c.lootMix);
  }
  return {};
}

/**
 * Какое письмо придёт. Чистая функция от зерна, номера письма и того, что мир
 * знает про соседей прямо сейчас: тот же сейв и то же время дают то же письмо.
 *
 * Выбор идёт по весам, а не поровну: выкуп вперёд остальных — у пленных срок
 * свой, и ждать очереди им нечего.
 */
export function pickLetter(
  seed: number,
  n: number,
  candidates: LetterCandidate[],
  stock: Loot,
): LetterDraft | null {
  const pool: { c: LetterCandidate; kind: LetterKindId; w: number }[] = [];
  let total = 0;
  for (const c of candidates) {
    for (const kind of kindsFor(c)) {
      const w = LETTER_WEIGHT[kind as keyof typeof LETTER_WEIGHT] ?? 1;
      total += w;
      pool.push({ c, kind, w });
    }
  }
  if (pool.length === 0) return null;

  const rng = seeded(letterSeed(seed, n));
  let roll = rng() * total;
  let hit = pool[pool.length - 1];
  for (const item of pool) {
    roll -= item.w;
    if (roll <= 0) {
      hit = item;
      break;
    }
  }
  const { c, kind } = hit;
  return {
    kind,
    fromId: c.id,
    fromName: c.name,
    ...(kind === 'alliance' ? { againstId: c.rivalId, againstName: c.rivalName } : {}),
    ...(kind === 'ransom' ? { men: Math.max(1, Math.round(c.captives)) } : {}),
    cost: letterCost(kind, c, stock),
  };
}

/** Срок письма. У решений — сутки; у предупреждения о набеге — приход отряда. */
export const letterUntil = (draft: LetterDraft, at: number, arriveAt = 0): number =>
  draft.kind === 'raid' ? arriveAt : at + LETTER_TTL;

/**
 * Что письмо меняет. Ни зерна, ни времени: чем кончится письмо, решено в тот
 * момент, когда его написали, — игроку остаётся выбрать одну из двух строк,
 * которые он и так видит. Третья строка (`lapse`) — та же, что отказ, только
 * холоднее: отказ это ответ, а неотвеченного гонца считают спесью.
 */
export interface LetterOutcome {
  /** На сколько сдвинуть отношение к отправителю. */
  attitude: number;
  /** Каким станет состояние с отправителем. null — не менять. */
  standing: Standing | null;
  /** Сколько держится подписанный пакт, мс. 0 — подписывать нечего. */
  duration: number;
  /** Третий двор: с кем и как поссорились, встав в союз. null — не с кем. */
  against: { id: SettlementId; attitude: number; standing: Standing } | null;
  /** Что уходит со склада (минусом) или приходит на него. */
  resources: Loot;
  /** Сколько людей вернулось в племя. Отнять людей письмо не может никогда. */
  pop: number;
  prestige: number;
  morale: number;
  /** Строка в летопись. Пусто — писать нечего. */
  text: string;
  good: boolean;
}

const NOTHING: LetterOutcome = {
  attitude: 0,
  standing: null,
  duration: 0,
  against: null,
  resources: {},
  pop: 0,
  prestige: 0,
  morale: 0,
  text: '',
  good: true,
};

/** Списание: то же добро, только минусом. */
const spend = (cost: Loot): Loot => {
  const out: Loot = {};
  for (const [r, n] of Object.entries(cost) as [keyof Loot, number][]) out[r] = -(n ?? 0);
  return out;
};

const goods = (cost: Loot): number => Math.round(lootTotal(cost));

/**
 * Чем кончилось письмо. Одна дверь на три повода — «да», «нет» и разрешение
 * без игрока, — и это главная гарантия всей затеи: у `lapse` нет ни одной
 * ветки, которой не было бы у отказа. Письмо не может ни забрать людей, ни
 * снести уровень здания, ни распустить дружину.
 */
export function resolveLetter(l: Letter, answer: LetterAnswerId): LetterOutcome {
  // Предупреждение о набеге не разрешается письмом вовсе: оно разрешается тем,
  // что отряд дошёл, и об этом пишет отчёт о бое. Второй строки здесь быть не
  // должно — письмо и летопись не дублируют друг друга.
  if (l.kind === 'raid') return NOTHING;

  const silent = answer === 'lapse';
  // Молчание — это отказ, и разбирается оно той же веткой. Разница ровно одна
  // и записана одним числом: неотвеченный гонец обиднее отказа в лицо.
  const said = silent ? 'no' : answer;
  const extra = silent ? LETTER_SILENCE_EXTRA : 0;
  const who = `«${l.fromName}»`;

  switch (l.kind) {
    case 'pact': {
      if (said === 'yes') {
        return {
          ...NOTHING,
          attitude: LETTER_PACT_ATTITUDE,
          standing: 'pact',
          duration: PACT_DURATION,
          prestige: 2,
          morale: 2,
          text: `Пакт с ${who} подписан: набегов оттуда не будет.`,
          good: true,
        };
      }
      return {
        ...NOTHING,
        attitude: LETTER_PACT_REFUSE + extra,
        text: silent
          ? `Гонец из ${who} уехал без ответа: пакта не будет, а молчание сочли за спесь.`
          : `Пакт с ${who} отвергнут.`,
        good: false,
      };
    }
    case 'tribute': {
      if (said === 'yes') {
        return {
          ...NOTHING,
          attitude: TRIBUTE_PAID_ATTITUDE,
          resources: spend(l.cost),
          morale: -2,
          text: `Дань ${who} уплачена: ${goods(l.cost)} добра.`,
          good: false,
        };
      }
      return {
        ...NOTHING,
        attitude: TRIBUTE_REFUSE_ATTITUDE + extra,
        standing: 'war',
        prestige: 1,
        morale: silent ? 0 : 2,
        text: silent
          ? `Гонец из ${who} не дождался ответа: дани нет, и оттуда объявили войну.`
          : `Дань ${who} не дана. Это война.`,
        good: false,
      };
    }
    case 'alliance': {
      if (said === 'yes') {
        return {
          ...NOTHING,
          attitude: ALLY_CALL_ATTITUDE,
          standing: 'pact',
          duration: PACT_DURATION,
          against: l.againstId
            ? { id: l.againstId, attitude: ALLY_CALL_TARGET_ATTITUDE, standing: 'war' }
            : null,
          prestige: 2,
          morale: 2,
          text: `Встали вместе с ${who} против «${l.againstName}»: с одними союз, с другими война.`,
          good: true,
        };
      }
      return {
        ...NOTHING,
        attitude: ALLY_CALL_REFUSE + extra,
        text: silent
          ? `Зов ${who} остался без ответа: в поход не пошли, и там это запомнили хуже отказа.`
          : `В поход с ${who} не пошли.`,
        good: false,
      };
    }
    case 'ransom': {
      const men = Math.max(0, Math.round(l.men ?? 0));
      if (said === 'yes') {
        return {
          ...NOTHING,
          attitude: RANSOM_PAID_ATTITUDE,
          resources: spend(l.cost),
          pop: men,
          morale: 4,
          text: `Выкуплено у ${who}: ${men} чел. вернулись в племя за ${goods(l.cost)} добра.`,
          good: true,
        };
      }
      return {
        ...NOTHING,
        attitude: RANSOM_REFUSE_ATTITUDE + extra,
        morale: -3,
        text: silent
          ? `Гонец из ${who} уехал ни с чем: ${men} чел. увели, и выкупать больше некого.`
          : `Выкуп ${who} не дан: ${men} чел. увели.`,
        good: false,
      };
    }
  }
}

/**
 * Порядок на столе: первым лежит то, что раньше всего разрешится само.
 *
 * Меряется срок, а не возраст, и это важнее, чем кажется. У решений срок ровно
 * сутки от прихода, поэтому «по сроку» и «с самого старого» — одно и то же; а
 * предупреждение о набеге живёт минуты, и оно обязано лечь сверху. Иначе
 * столбик показывал бы первым письмо, до которого у игрока ещё двадцать часов,
 * а под ним — отряд, который придёт через семь минут.
 */
export const letterOrder = <T extends Letter>(list: T[]): T[] =>
  [...list].sort((a, b) => a.until - b.until || a.at - b.at);

/** Письмо, у которого вышел срок. Считается при чтении, а не отмечается тиком. */
export const letterExpired = (l: Letter, now: number): boolean => now >= l.until;

/**
 * Сколько решений помещается на стол. Одна ячейка из пяти держится под
 * предупреждение о набеге и стоит пустой, пока никто не идёт: предупреждение
 * не должно никого сгонять, а выходит набег каждые четверть часа.
 */
export const LETTER_DECISIONS = LETTER_SLOTS - 1;

/**
 * Кого сгонит со стола новое решение. Стол на `LETTER_SLOTS`, и очереди за ним
 * нет: сверх видимых не хранится ничего.
 *
 * Почему так, а не «хранить и подавать по очереди». Скрытая очередь означает
 * две плохие вещи сразу. Первая: вернувшийся после долгой отлучки игрок
 * получает не игру, а работу — двадцать решений подряд, из которых половина
 * уже неактуальна. Вторая, хуже: у письма, простоявшего очередь, срок вышел бы
 * в очереди, то есть там, где игрок его не видел, — а это ровно те
 * «последствия, о которых нигде не сказано», которых быть не должно.
 *
 * Поэтому стол вытесняет: приходит лишнее — то, у которого срок ближе всех,
 * разрешается тем же `lapse`, что и по истечении суток, и пишет ту же одну
 * строку в летопись. Ни новых правил, ни невидимых исходов.
 *
 * Предупреждение о набеге не вытесняется и само не вытесняет: у него своя
 * ячейка. Убрать его со стола значило бы спрятать то, что уже случилось, а
 * дать ему сгонять решения — превратить стол в ленту.
 */
export function crowdedOut<T extends Letter>(list: T[]): T | null {
  const kickable = letterOrder(list).filter((l) => l.kind !== 'raid');
  if (kickable.length < LETTER_DECISIONS) return null;
  return kickable[0] ?? null;
}
