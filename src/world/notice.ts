// Черновики уведомлений: что сервер может сказать игроку, пока его нет.
//
// Модуль чистый, того же рода, что `siege.ts` и `works.ts`: ни состояния мира, ни часов,
// ни сети, ни слов. Мир отдаёт сюда факты, записанные в его сохранении, — идущий набег,
// окно осады и назначенные события, способные их пересчитать, — а отсюда уходит список
// пунктов: вид, ключ, «когда», «годно до» и числа. Слов здесь нет нарочно: одни и те же
// числа прочтут и сервер, и настройки игры, и второй правды о том, что сказано, быть не
// должно (docs/NOTIFY.md, раздел 3).
//
// Полнота списка держится на инварианте, который сторожит `notice.test.ts`: набег на
// деревню рождается только на пульсе. Правдивость — на правиле разрыва ниже.
//
// **Сроки здесь выражены долями окна, а не минутами.** Все осадные числа игры условны и
// переедут, когда игра станет медленнее, — форма механизма от этого меняться не должна:
// «на полпути к дозревшим рогаткам» и «в последней четверти хлеба» остаются правдой при
// любой длине осады.
import { plainName, type NoticeFacts, type NoticeItem, type NoticeKind } from '../../netlify/lib/contract';
import type { Fate } from './types';

/**
 * Набег на деревню в пути. Всё — поля сохранения и то, что из них выводится без
 * будущего: `seenFrom` — минута, с которой игра сама показала бы его (донесение Дозора
 * или вход в живой обзор, что раньше), `musterBy` — последняя минута, когда полный сбор
 * дружины, начатый дома, ещё кончается до прихода (приход минус потолок сбора с чертой
 * полководца, `LocalWorld.musterBy`; docs/battle_eu4.md, 14.26–14.27).
 */
export interface RaidFacts {
  id: string;
  from: string;
  fate: Fate;
  departAt: number;
  arriveAt: number;
  seenFrom: number;
  musterBy: number;
}

/** Осада своей деревни, идущая в минуту составления. */
export interface SiegeFacts {
  campId: string;
  from: string;
  fate: Fate;
  /** Когда лагерь встал. Пересчёт часов голода эту отметку не двигает. */
  since: number;
  starvesAt: number;
  /** Когда дозреют рогатки со стороны города и со стороны поля. null — никогда. */
  frontAt: number | null;
  rearAt: number | null;
}

/**
 * Что уже назначено в сохранении и после чего окно или поход пересчитываются. Каждый
 * вид назван по месту в `LocalWorld`, где случается пересчёт:
 *
 * - `march-home` — свой отряд доходит домой (`arriveHome` → `resiege`);
 * - `handover` — кончается сбор или роспуск дружины (`settleHandover` → `resiege`);
 * - `general-home` — полководец встаёт у своих ворот (`stepFigures` → `resiege`);
 * - `strike` — полководец приходит бить лагерь под своим городом (`resolveStrike`);
 * - `chase` — полководец настигает отряд (`resolveChase`): у набега это его судьба, у
 *   осады — возможная остановка у своих ворот (`breakChase` → `resiege`).
 */
export type BreakKind = 'march-home' | 'handover' | 'general-home' | 'strike' | 'chase';

export interface Break {
  kind: BreakKind;
  at: number;
  /** Кого касается погоня: номер отряда. У остальных пусто. */
  march?: string;
}

export interface NoticeWorld {
  raid: RaidFacts | null;
  siege: SiegeFacts | null;
  breaks: Break[];
}

/** Почему пункта нет. Отчёт считает эти причины — молчание обязано быть видно числом. */
export type Silence = BreakKind | 'passed' | 'no-window';

export interface Drafts {
  items: NoticeItem[];
  silent: { kind: NoticeKind; why: Silence }[];
}

/** «Рогатки растут» — на этой доле пути от постановки лагеря до дозревших рогаток фронта. */
export const WORKS_FIRE_SHARE = 0.5;

/** «Хлеб кончается» — когда до голода остаётся эта доля всей осады. */
export const BREAD_LEAD_SHARE = 0.25;

/**
 * Первый разрыв до минуты `about`. Пункт существует, только если между минутой
 * составления и минутой, **о которой он говорит**, нет ни одного назначенного пересчёта
 * — не до `fireAt`, а дальше: иначе отправленное «хлеба до 14:40» могло бы стать
 * неправдой в 14:20 без единого действия игрока.
 */
function firstBreak(breaks: Break[], about: number, touches: (b: Break) => boolean): Break | null {
  let first: Break | null = null;
  for (const b of breaks) {
    // Отметка в прошлом — не «уже было», а «ещё не разобрано»: передачу дружины мир
    // сводит при чтении, и пересчёт случится в минуту следующего взгляда. Разрыв это
    // тот же, только раньше.
    if (!touches(b) || b.at >= about) continue;
    if (!first || b.at < first.at) first = b;
  }
  return first;
}

/** Черновики на минуту `now`. Чистая функция: тот же вход — тот же список. */
export function draftNotices(w: NoticeWorld, now: number): Drafts {
  const items: NoticeItem[] = [];
  const silent: Drafts['silent'] = [];
  const put = (kind: NoticeKind, key: string, fireAt: number, until: number, p: NoticeFacts): void => {
    if (!(fireAt < until)) return void silent.push({ kind, why: 'no-window' });
    if (until <= now) return void silent.push({ kind, why: 'passed' });
    items.push({ key, kind, fireAt, until, p });
  };

  const raid = w.raid;
  if (raid) {
    const gap = firstBreak(w.breaks, raid.arriveAt, (b) => b.kind === 'chase' && b.march === raid.id);
    if (gap) silent.push({ kind: 'raid', why: gap.kind });
    else {
      // Годен, пока полный сбор ещё успевает (`musterBy`): после этой минуты сбор, начатый дома, не кончится к приходу, и
      // люди в сборе встретят набег на дороге, а не у частокола. Полный сбор не успевает уже в минуту, когда отряд стал
      // виден (сбор дольше предупреждения — черта «Мясник»), — пункт всё равно есть (слово владельца по 14.26): уходит в
      // эту же минуту с пометкой `late` и годен до прихода — набег правда идёт, а доставка шлёт только до `until`.
      const late = raid.musterBy <= raid.seenFrom;
      // Ключ — имя момента: этот отряд, вышедший в эту минуту. Номер один не годится:
      // «начать заново» заводит мир со счёта походов с нуля, и первый набег новой партии
      // молчал бы `SENT_KEEP` (`netlify/lib/notify.ts`), наткнувшись на отметку первого набега прежней.
      put('raid', `raid:${raid.id}:${raid.departAt}`, raid.seenFrom, late ? raid.arriveAt : raid.musterBy, {
        from: plainName(raid.from),
        fate: raid.fate,
        about: raid.arriveAt,
        ...(late ? { late: true as const } : {}),
      });
    }
  }

  const siege = w.siege;
  if (siege) {
    // Все пересчёты окна — разрывы для обоих пунктов осады: оба называют «хлеба до».
    const gap = firstBreak(w.breaks, siege.starvesAt, () => true);
    if (gap) {
      silent.push({ kind: 'siege-works', why: gap.kind }, { kind: 'siege-bread', why: gap.kind });
    } else {
      const facts: NoticeFacts = {
        from: plainName(siege.from),
        fate: siege.fate,
        about: siege.starvesAt,
        ...(siege.frontAt !== null ? { frontAt: siege.frontAt } : {}),
        ...(siege.rearAt !== null ? { rearAt: siege.rearAt } : {}),
      };
      const name = `${siege.campId}:${siege.since}`;
      if (siege.frontAt === null) silent.push({ kind: 'siege-works', why: 'no-window' });
      else
        put(
          'siege-works',
          `siege-works:${name}`,
          siege.since + (siege.frontAt - siege.since) * WORKS_FIRE_SHARE,
          Math.min(siege.frontAt, siege.starvesAt),
          facts,
        );
      put(
        'siege-bread',
        `siege-bread:${name}`,
        siege.starvesAt - (siege.starvesAt - siege.since) * BREAD_LEAD_SHARE,
        siege.starvesAt,
        facts,
      );
    }
  }
  return { items, silent };
}

/**
 * С какой минуты отряд, идущий по прямой с постоянной скоростью, попадает в живой
 * обзор. Тот же круг и то же движение, что у `fog.inSight` и `geo.marchPosition`, только
 * решённые уравнением: перебирать минуты значило бы завести тик. Не попадает до
 * прихода — `Infinity`.
 */
export function sightFrom(
  m: { from: { x: number; y: number }; to: { x: number; y: number }; departAt: number; arriveAt: number },
  discs: readonly { x: number; y: number; r: number }[],
): number {
  const span = Math.max(1, m.arriveAt - m.departAt);
  const dx = m.to.x - m.from.x;
  const dy = m.to.y - m.from.y;
  let best = Infinity;
  for (const d of discs) {
    // |from + k·(to − from) − d|² ≤ r², k ∈ [0, 1] — первое k.
    const fx = m.from.x - d.x;
    const fy = m.from.y - d.y;
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - d.r * d.r;
    let k: number;
    if (c <= 0) k = 0;
    else if (a === 0) continue;
    else {
      const disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      k = (-b - Math.sqrt(disc)) / (2 * a);
      if (k < 0 || k > 1) continue;
    }
    best = Math.min(best, m.departAt + k * span);
  }
  return best;
}
