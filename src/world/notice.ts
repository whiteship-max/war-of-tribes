// Черновики уведомлений: что сервер может сказать игроку, пока его нет.
//
// Модуль чистый, того же рода, что `siege.ts` и `works.ts`: ни состояния мира, ни часов,
// ни сети, ни слов. Мир отдаёт сюда факты, записанные в его сохранении, — идущий набег,
// окно осады и назначенные события, способные их пересчитать, — а отсюда уходит список
// пунктов: вид, ключ, «когда», «годно до» и числа. Слов здесь нет нарочно: слова собирает
// сервер в минуту отправки (`netlify/lib/words.ts`), и второй правды о том, что сказано, быть
// не должно (docs/NOTIFY.md, раздел 3).
//
// **О чём (решение владельца, 05.10.2026): на город нападают и бой уже был** (docs/NOTIFY.md,
// раздел 12). Набег логова в пути — «нападают» (`raid`); набег дошёл до города — «бой был»
// (`raid-fight`): чем он кончился, мир посчитает при следующем заходе, а минута боя известна уже
// сейчас; хлеб под лагерем логова кончился — город взят (`siege-fall`). О войне между игроками
// говорит сервер сам: её бой считает он.
//
// Полнота списка держится на инварианте, который сторожит `notice.test.ts`: набег на
// деревню рождается только на пульсе. Значит, «ближайшие набеги» на время отсутствия — это
// ровно тот, что уже в пути: нового без игрока не родится. Правдивость — на правиле разрыва
// ниже.
import { NOTICE_LIMITS, plainName, RESULT_KEEP, type NoticeFacts, type NoticeItem, type NoticeKind } from '../../netlify/lib/contract';
import type { Fate } from './types';

/**
 * Набег на деревню в пути. Всё — поля сохранения и то, что из них выводится без
 * будущего: `seenFrom` — минута, с которой игра сама показала бы его (донесение Дозора
 * или вход в живой обзор, что раньше). Окно ответа — от неё до прихода (`arriveAt`): дома
 * перевод дружины мгновенный, и ответить можно до самого прихода (решение владельца
 * 06.10.2026, docs/NOTIFY.md, 12.11).
 */
export interface RaidFacts {
  id: string;
  /** Откуда вышел: номер логова — его сожжение своим походом снимает набег (`LocalWorld.burnLair`). */
  source: string;
  from: string;
  fate: Fate;
  departAt: number;
  arriveAt: number;
  seenFrom: number;
}

/** Осада своей деревни, идущая в минуту составления. */
export interface SiegeFacts {
  campId: string;
  from: string;
  fate: Fate;
  /** Когда лагерь встал. Пересчёт часов голода эту отметку не двигает. */
  since: number;
  starvesAt: number;
  /**
   * Ход осады фазами (docs/siege_v2.md, раздел 2), выведенный вперёд из окна той же дверью, что бросит фазы
   * (`siegeroll.projectPhases`): у бота-осаждающего дел нет, и будущие фазы — то, что случится, пока никто не вмешался;
   * вмешательство — разрыв. `fallAt` — минута падения, если город сдастся раньше голода (`gates`); значимые фазы до
   * неё — пролом и мор, с номером фазы и проломами после неё. Нет полей — окно без фаз: падает голодом.
   */
  fallAt?: number;
  gates?: boolean;
  phases?: { at: number; k: number; out: 'breach' | 'plague'; breaches: number }[];
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
 *   осады — возможная остановка у своих ворот (`breakChase` → `resiege`). О набеге после
 *   неё молчание, но сама встреча — бой в поле, и о ней весть (`raid-fight` с `field`);
 * - `burn` — свой поход доходит до логова, откуда вышел набег: сожжённое логово снимает
 *   свои отряды в пути (`burnLair`). Нижняя граница — приход, а не победа.
 */
export type BreakKind = 'march-home' | 'handover' | 'general-home' | 'strike' | 'chase' | 'burn';

export interface Break {
  kind: BreakKind;
  at: number;
  /** Кого касается погоня: номер отряда. У остальных пусто. */
  march?: string;
  /** Куда идёт свой поход (`burn`): номер цели. */
  target?: string;
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

/**
 * Первый разрыв до минуты `about`. Пункт существует, только если между минутой
 * составления и минутой, **о которой он говорит**, нет ни одного назначенного пересчёта
 * — не до `fireAt`, а дальше: иначе отправленное «набег дошёл в 14:40» могло бы
 * стать неправдой в 14:20 без единого действия игрока.
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
    // Набег снимают погоня полководца за этим отрядом и свой поход на его логово — оба до прихода.
    const gap = firstBreak(
      w.breaks,
      raid.arriveAt,
      (b) => (b.kind === 'chase' && b.march === raid.id) || (b.kind === 'burn' && b.target === raid.source),
    );
    // Ключ — имя момента: этот отряд, вышедший в эту минуту. Номер один не годится:
    // «начать заново» заводит мир со счёта походов с нуля, и первый набег новой партии
    // молчал бы `SENT_KEEP` (`netlify/lib/notify.ts`), наткнувшись на отметку первого набега прежней.
    const name = `${raid.id}:${raid.departAt}`;
    if (gap) {
      silent.push({ kind: 'raid', why: gap.kind }, { kind: 'raid-fight', why: gap.kind });
      // Погоня за этим набегом — сама бой: в минуту встречи полководец бьётся в поле (`LocalWorld.resolveChase`). Прежде
      // о нём молчало всё — и «нападают», и «бой был», — и игрок, выведший полководца ночью, не узнавал ничего (отзыв
      // тестеров 18.10, docs/feedback.md). Разрыв первый, значит, логово набега до встречи не сгорит.
      if (gap.kind === 'chase') {
        put('raid-fight', `raid-fight:${name}:field`, gap.at, gap.at + RESULT_KEEP, {
          from: plainName(raid.from),
          fate: raid.fate,
          about: gap.at,
          field: true,
        });
      }
    } else {
      // Годен до прихода: ответить на набег можно до самой этой минуты — дома перевод дружины мгновенный (решение
      // владельца 06.10.2026), а войне между игроками сервер ставит тот же срок (`war.newsOf`). Прежде пункт был годен,
      // пока полный сбор дома ещё успевал (`musterBy`), а сбора дома больше нет.
      const facts: NoticeFacts = { from: plainName(raid.from), fate: raid.fate, about: raid.arriveAt };
      put('raid', `raid:${name}`, raid.seenFrom, raid.arriveAt, facts);
      // Бой у города — в минуту прихода. Чем кончился (отбили, прорвались, встали лагерем), посчитает мир при
      // следующем заходе: слова говорят о минуте, а итог — в донесении.
      put('raid-fight', `raid-fight:${name}`, raid.arriveAt, raid.arriveAt + RESULT_KEEP, facts);
    }
  }

  const siege = w.siege;
  if (siege) {
    // Все пересчёты окна — разрывы: падение назначено концом хлеба или сдачей на фазе, и пересчёт его двигает.
    const fallAt = siege.fallAt ?? siege.starvesAt;
    const gap = firstBreak(w.breaks, fallAt, () => true);
    if (gap) silent.push({ kind: 'siege-fall', why: gap.kind });
    else
      put('siege-fall', `siege-fall:${siege.campId}:${siege.since}`, fallAt, fallAt + RESULT_KEEP, {
        from: plainName(siege.from),
        fate: siege.fate,
        about: fallAt,
        ...(siege.gates ? { gates: true as const } : {}),
      });
    // Значимые фазы (docs/siege_v2.md, 8.3) — пролом и мор, каждая в свою минуту и со своим разрывом: пересчёт окна до
    // фазы двигает её кость.
    for (const ph of siege.phases ?? []) {
      const cut = firstBreak(w.breaks, ph.at, () => true);
      if (cut) {
        silent.push({ kind: 'siege-phase', why: cut.kind });
        continue;
      }
      put('siege-phase', `siege-phase:${siege.campId}:${siege.since}:${ph.k}`, ph.at, ph.at + RESULT_KEEP, {
        from: plainName(siege.from),
        fate: siege.fate,
        about: ph.at,
        phase: ph.out,
        k: ph.k,
        ...(ph.out === 'breach' ? { breaches: ph.breaches } : {}),
      });
    }
  }
  return { items, silent };
}

/**
 * Стройка, идущая в минуту составления (ВС-1, род «стройка»): что и до какого уровня, когда кончится по осторожному
 * прогнозу партии (`game/buildEta`, серверными часами) и номер партии — чтобы «начать заново» не наткнулось на отметку
 * «ушло» прежней партии той же постройки.
 */
export interface BuildFacts {
  type: string;
  level: number;
  doneAt: number;
  party: number;
}

/** Срок вести дальше этого от составления сервер не принимает (`NOTICE_LIMITS.ahead`); с запасом на расхождение часов. */
const BUILD_AHEAD = NOTICE_LIMITS.ahead - NOTICE_LIMITS.skew;

/**
 * Черновик «достроили». Минута — прогноз с запасом, вверх до целой минуты: список не меняется от пульса к пульсу, пока
 * прогноз не сдвинулся на минуту. Дальше потолка списка — молчание: стройка кончится, а весть о ней — нет.
 */
export function draftBuild(b: BuildFacts | null, now: number): NoticeItem | null {
  if (!b) return null;
  const fireAt = Math.ceil(b.doneAt / 60_000) * 60_000;
  if (fireAt > now + BUILD_AHEAD) return null;
  return {
    key: `build:${b.type}:${b.level}:${b.party}`,
    kind: 'build',
    fireAt,
    until: fireAt + RESULT_KEEP,
    p: { from: 'стройка', fate: 'plunder', about: fireAt, building: b.type, level: b.level },
  };
}

/**
 * Вести стабильности (docs/stability.md, 2.8): «мятеж близок» — минута, когда полоса группы перейдёт порог, и «мятеж» —
 * минута, когда она дойдёт до ста, по прогнозу партии (`sim/stability.stabForecast`) серверными часами. Ключ — группа и номер
 * случая (сколько мятежей уже было): одна весть на случай, без спама.
 */
export interface StabNotice {
  group: NonNullable<NoticeFacts['group']>;
  kind: 'stab-near' | 'stab-revolt';
  /** Когда, настоящие мс. */
  at: number;
  /** Номер случая — сколько мятежей поднялось за партию. */
  episode: number;
}

export function draftStab(f: StabNotice, now: number): NoticeItem | null {
  const fireAt = Math.ceil(Math.max(now, f.at) / 60_000) * 60_000;
  if (fireAt > now + BUILD_AHEAD) return null;
  return {
    key: `${f.kind}:${f.group}:${f.episode}`,
    kind: f.kind,
    fireAt,
    until: fireAt + RESULT_KEEP,
    p: { from: 'держава', fate: 'plunder', about: fireAt, group: f.group },
  };
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
