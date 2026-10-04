// Отношения с чужими поселениями: число, состояние и ответ соседа.
//
// Модуль чистый: ни состояния мира, ни часов, ни `Math.random`. Всё, что он
// умеет, — считать по таблицам из `data/diplomacy.ts` и `data/tuning.ts`.
// Это не аккуратность ради аккуратности: пока на карте боты, ответ считает
// клиент, а когда появятся живые игроки, на месте `respond` окажется решение
// человека — и подменить надо будет ровно одну функцию, а не механику.
//
// Второе правило того же порядка: **считаем при чтении, не тикаем**. Истечение
// пакта, отложенный разрыв и занятость дипломата выводятся из отметок времени в
// момент вопроса. Фоновой работы у отношений нет и заводить её нельзя — иначе
// сервер, когда он появится, будет обязан крутить их у себя.
import { seeded } from '@/game/sim/random';
import { realSpan } from '@/game/span';
import type { DiploActionId, DiploRecord, Standing, TemperId } from './types';
import { TEMPER_BY_ID, TEMPER_IDS } from './data/diplomacy';
import {
  ATTITUDE_MAX,
  ATTITUDE_MIN,
  GIFT_ATTITUDE,
  GIFT_REFUSE_ATTITUDE,
  INSULT_ATTITUDE,
  PACT_ATTITUDE,
  PACT_BREAK_NOTICE,
  PACT_DURATION,
  PACT_REFUSE_ATTITUDE,
  PACT_SPAN,
  PEACE_PRESSURE,
  PEACE_SPAN,
  WAR_ATTITUDE,
} from './data/tuning';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export const clampAttitude = (v: number): number =>
  Math.round(Math.min(ATTITUDE_MAX, Math.max(ATTITUDE_MIN, v)));

/**
 * Отношений с этим двором ещё не заводили: ровное знакомство.
 *
 * Ровное — но не обязательно с нуля: сосед иной веры смотрит на нас прохладнее
 * с первого дня (`world/faith.faithAttitude`). Сдвиг симметричен и никого не
 * делает дурным — он про расстояние между обычаями, а не про то, кто прав. И он
 * **только про отношение**: в бой отношение не входит ни одним числом, поэтому
 * «моя вера бьёт твою» отсюда не получается никак.
 */
export function freshRecord(now: number, faithShift = 0): DiploRecord {
  return { attitude: clampAttitude(faithShift), standing: 'neutral', since: now, until: 0, breakAt: 0 };
}

/**
 * Хеш строки — им сеются и характер владельца, и бросок ответа. Написан руками
 * и здесь, а не взят у чего-нибудь готового: от него зависит воспроизводимость
 * мира, и меняться он не должен никогда.
 */
export function hashId(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Характер владельца. Выводится из сида и ключа (имени бота), а не хранится:
 * у одного бота бывает несколько поселений, и характер у него один на все.
 */
export function temperOf(seed: number, key: string): TemperId {
  const rng = seeded((hashId(key) ^ Math.imul(seed >>> 0, 0x9e3779b1)) >>> 0);
  return TEMPER_IDS[Math.floor(rng() * TEMPER_IDS.length) % TEMPER_IDS.length];
}

/**
 * Зерно ответа. В нём **само отношение**, а не счётчик обращений: одно и то же
 * предложение при одинаковых условиях обязано дать один и тот же ответ. Хочешь
 * другого — меняй условия (дари), а не жми кнопку второй раз.
 */
export function orderSeed(
  seed: number,
  id: string,
  action: DiploActionId,
  attitude: number,
  standing: Standing,
): number {
  return hashId(`${seed}|${id}|${action}|${Math.round(attitude)}|${standing}`);
}

/**
 * Состояние отношений на момент `now`. Здесь и живёт правило «считаем при
 * чтении»: истёкший пакт и наступивший срок разрыва разбираются в этой функции,
 * а не тиком где-то в стороне.
 */
export function standingAt(rec: DiploRecord, now: number): Standing {
  if (rec.standing !== 'pact') return rec.standing;
  // Объявленный разрыв: до срока пакт ещё в силе, после — война.
  if (rec.breakAt > 0 && now >= rec.breakAt) return 'war';
  if (rec.until > 0 && now >= rec.until) return 'neutral';
  return 'pact';
}

/** Отношение словами. Число рядом всегда, но словами читается быстрее. */
export function moodOf(attitude: number): string {
  if (attitude <= -60) return 'лютая вражда';
  if (attitude <= -25) return 'неприязнь';
  if (attitude < -5) return 'настороженно';
  if (attitude <= 5) return 'ровно';
  if (attitude < 30) return 'дружелюбно';
  if (attitude < 65) return 'тепло';
  return 'сердечно';
}

export interface DiploContext {
  action: DiploActionId;
  attitude: number;
  temper: TemperId;
  /** Состояние **на момент вопроса** — уже разобранное `standingAt`. */
  standing: Standing;
  /** Насколько разбит гарнизон, 0..1: побитый мирится охотнее. */
  pressure?: number;
  seed: number;
}

/**
 * Шанс, что сосед ответит согласием. У оскорбления это не удача, а риск: там
 * возвращается вероятность войны. У объявления войны броска нет вовсе — она
 * объявляется в одностороннем порядке, — и здесь null.
 */
export function chanceOf(ctx: DiploContext): number | null {
  const t = TEMPER_BY_ID[ctx.temper];
  const a = ctx.attitude;
  switch (ctx.action) {
    case 'gift':
      // Гордый может счесть дар подачкой, и чем холоднее отношения, тем вероятнее.
      return clamp01(t.giftOpen + a / 150);
    case 'pact':
      return clamp01((a - t.pactBar) / PACT_SPAN);
    case 'peace':
      return clamp01((a - t.peaceBar) / PEACE_SPAN + Math.max(0, ctx.pressure ?? 0) * PEACE_PRESSURE);
    case 'insult':
      return clamp01(t.hot + Math.max(0, -(a + INSULT_ATTITUDE * t.insultMult)) / 120);
    case 'war':
      return null;
  }
}

export interface Answer {
  /** Сосед согласился. У войны и оскорбления — всегда истина. */
  accepted: boolean;
  /** Каким стало отношение. */
  attitude: number;
  /** Каким станет состояние. */
  standing: Standing;
  /**
   * Через сколько это состояние вступит в силу, мс. Ноль — уже. Больше нуля
   * бывает у одного случая: война из-под подписанного пакта.
   */
  breakIn: number;
  /** Сколько держится подписанный пакт, мс. Ноль — подписывать нечего. */
  duration: number;
  text: string;
}

/**
 * Ответ соседа — чистая функция от отношения, характера и зерна. Ни времени, ни
 * состояния мира здесь нет: всё, что нужно, приходит в `ctx`.
 */
export function respond(ctx: DiploContext): Answer {
  const t = TEMPER_BY_ID[ctx.temper];
  const chance = chanceOf(ctx);
  const roll = seeded(ctx.seed)();
  const hit = chance !== null && roll < chance;
  const keep = (attitude: number, text: string, accepted: boolean): Answer => ({
    accepted,
    attitude: clampAttitude(attitude),
    standing: ctx.standing,
    breakIn: 0,
    duration: 0,
    text,
  });

  switch (ctx.action) {
    case 'gift': {
      if (!hit) {
        // Отвергнутый дар холодит: иначе настойчивость упиралась бы в вечный
        // отказ — тот же вопрос при тех же условиях даёт тот же ответ.
        return keep(ctx.attitude + GIFT_REFUSE_ATTITUDE, 'Дар вернули. Подачек здесь не берут.', false);
      }
      return keep(
        ctx.attitude + GIFT_ATTITUDE * t.giftMult,
        'Дар приняли с поклоном.',
        true,
      );
    }
    case 'insult': {
      const attitude = clampAttitude(ctx.attitude + INSULT_ATTITUDE * t.insultMult);
      if (!hit) {
        return {
          accepted: true,
          attitude,
          standing: ctx.standing,
          breakIn: 0,
          duration: 0,
          text: 'Обиду проглотили молча, но запомнили.',
        };
      }
      // Война как ответ на оскорбление. Из-под пакта её объявляют с той же
      // отсрочкой, что и мы: бумага держит обе стороны, а не одну.
      const breakIn = ctx.standing === 'pact' ? PACT_BREAK_NOTICE : 0;
      return {
        accepted: true,
        attitude,
        standing: 'war',
        breakIn,
        duration: 0,
        text:
          breakIn > 0
            ? `Оскорбления не снесли. Пакт разорван, война через ${realSpan(breakIn / 1000)}.`
            : 'Оскорбления не снесли. Это война.',
      };
    }
    case 'pact': {
      if (!hit) {
        return keep(ctx.attitude + PACT_REFUSE_ATTITUDE, 'Пакт отвергнут, и говорить дальше не стали.', false);
      }
      return {
        accepted: true,
        attitude: clampAttitude(ctx.attitude + PACT_ATTITUDE),
        standing: 'pact',
        breakIn: 0,
        duration: PACT_DURATION,
        text: 'Пакт подписан.',
      };
    }
    case 'peace': {
      if (!hit) return keep(ctx.attitude, 'Мира не приняли. Крови пролито слишком много.', false);
      // Мир возвращает нейтралитет, но отношение сам собой не выправляет — это
      // и есть разница между «перестали воевать» и «помирились».
      return {
        accepted: true,
        attitude: clampAttitude(ctx.attitude),
        standing: 'neutral',
        breakIn: 0,
        duration: 0,
        text: 'Война окончена. Дружбы это не вернуло.',
      };
    }
    case 'war': {
      const breakIn = ctx.standing === 'pact' ? PACT_BREAK_NOTICE : 0;
      return {
        accepted: true,
        attitude: clampAttitude(ctx.attitude + WAR_ATTITUDE),
        standing: 'war',
        breakIn,
        duration: 0,
        text: breakIn > 0 ? `Пакт разорван. Война через ${realSpan(breakIn / 1000)}.` : 'Война объявлена.',
      };
    }
  }
}

/**
 * Насколько охотно из этого двора выходит набег. Ноль — не выходит вовсе, и это
 * ровно то, за чем игрок подписывал пакт. Считается по состоянию, отношению и
 * характеру: без этой функции дипломатия была бы кнопками без последствий.
 */
export function raidWeight(
  standing: Standing,
  attitude: number,
  temper: TemperId,
  weights: { war: number; quiet: number },
): number {
  if (standing === 'pact') return 0;
  const t = TEMPER_BY_ID[temper];
  if (standing === 'war') return weights.war * t.raid;
  // В нейтралитете живут как жили: ровный сосед почти не ходит, обиженный ходит
  // охотнее. Это и есть прежнее «набеги идут от тех, кого ты трогал», только
  // числом, а не порогом.
  return (weights.quiet + Math.max(0, -attitude) / 50) * t.raid;
}
