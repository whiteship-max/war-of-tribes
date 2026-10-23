// Вести покоев (docs/city_v3.md, ПК-1): одна дверь для гонца и советника. Какие вести есть, когда каждая случилась и что
// о ней сказать сейчас. Чистый модуль без React и без сцены — его держат тесты.
//
// **Источник один — журнал «Вестей».** Почта (события партии на столе `s.inbox`, вести державы СБ-2 там же, письма мира,
// походы соседей), летопись (`s.log`, донесения мира) и окно осады. Своих полей у вестей нет: весть — это ссылка в журнал
// (`Tiding.ref`) и минута, когда она случилась, своими часами источника — игровыми у партии (`s.time`), мира — у мира. Одно
// исключение — то, чего журнал не пишет вовсе (кончился хлеб, поход соседа без минуты выхода): минуту ставит двор, когда
// впервые увидел (`real`, `court.stamped`).
//
// **Слова — в минуту рассказа** (`tell`): из настоящего состояния, теми же полями, что «Вести» (заголовок события, письмо,
// донесение), сроки — общими дверями (`parts/wait.realDue`, `parts/hunger.hungerLeft`). Весть устарела — исход («осаду
// сняли», «хлеб снова есть»); сказать нечего (ответили в «Вестях») — `null`, и о ней молчат.
import type { GameState, ActiveEvent } from '@/game/types';
import type { FaithId } from '@/game/types';
import type { LetterView, Report, RivalMarch, SiegeView } from '@/world/types';
import type { ChronTopic } from '@/ui/realm/annals';
import { EVENT_BY_ID } from '@/game/data/events';
import { eventId } from '@/game/sim/mail';
import { STAB_EVENTS } from '@/game/data/stability';
import { eventKey, letterKey } from '@/ui/realm/unread';
import { hungerLeft } from '@/ui/parts/hunger';
import { realDue } from '@/ui/parts/wait';
import { TITLE } from './talk';
import { cityOr } from '../../../netlify/lib/contract';

/**
 * Куда ведёт весть — двери игры, а не свои окна: карта, окно осады, склад, стабильность, письмо или событие в «Вестях»,
 * донесение и летопись по роду.
 */
export type NewsDoor =
  | { to: 'map' }
  | { to: 'siege' }
  | { to: 'store' }
  | { to: 'stab' }
  | { to: 'mail'; key: string }
  | { to: 'report'; id: string }
  | { to: 'chronicle'; topic: ChronTopic | null };

/**
 * Род вести. Гонцу — пять (задание владельца): на нас идут (`march`), город в осаде, кончился хлеб или дрова (`out`),
 * мятеж, бедствие (комета, мор, пожар, засуха, неурожай, буря). Советнику — ещё итог боя, вести, ждущие ответа, и стройка.
 */
export type TidingKind = 'siege' | 'march' | 'revolt' | 'disaster' | 'out' | 'battle' | 'ask' | 'build';

/** Важность: доклад советника — по ней, и при равной — новые вперёд. */
export const WEIGHT: Record<TidingKind, number> = { siege: 9, march: 8, revolt: 7, disaster: 6, out: 6, battle: 4, ask: 2, build: 1 };

/** За чем гонец стучит в дверь. */
export const HERALD_KINDS: ReadonlySet<TidingKind> = new Set<TidingKind>(['siege', 'march', 'revolt', 'disaster', 'out']);

/** Советник встречает, только если за отлучку было что-то важнее стройки. */
export const IMPORTANT = WEIGHT.ask;

/** Бедствия на столе — вести державы (СБ-2) и события города. */
export const DISASTERS: ReadonlySet<string> = new Set(['cr_comet', 'cr_drought', 'cr_lower_fire', 'cr_plague_near', 'cr_plague', 'cr_bad_harvest', 'fire', 'sickness', 'storm']);

/** События у ворот — тоже «на нас идут»: стая и разбойники бьются у своих ворот (`sim/gate`). */
const AT_GATE: ReadonlySet<string> = new Set(['wolves', 'raiders']);

/** Часы, которыми мерится минута вести: партии (`s.time`), мира (`worldNow`) или настоящие — отметка двора. */
export type Clock = 'game' | 'world' | 'real';

/** Минута разом на трёх часах: вход в покои, выход из них. */
export interface Moment {
  game: number;
  world: number;
  real: number;
}

export interface Tiding {
  /** Ключ вести: тот же ключ — та же весть; второй раз о ней не говорят. */
  id: string;
  kind: TidingKind;
  clock: Clock;
  /** Когда случилась — часами `clock`. */
  at: number;
  /** Ссылка в журнал: номер письма, события, донесения, похода; минута осады; ресурс; строка летописи. */
  ref: string;
}

/** Весть до отметки двора: у того, что журнал не датирует, минуты ещё нет. */
export type RawTiding = Omit<Tiding, 'at'> & { at: number | null };

/** Что видно двору: партия, мир, как их отдают сторы. */
export interface CourtSource {
  s: GameState;
  letters: readonly LetterView[];
  siege: SiegeView | null;
  reports: readonly Report[];
  marching: readonly RivalMarch[];
  /** Минута мира (`worldNow`). */
  world: number;
  /** Мир встал: без него походов соседей не видно, и «их нет» — неправда. */
  ready: boolean;
}

/** Была ли в донесении битва — тот же признак, что у итога события в летописи. */
export const isBattle = (r: Report): boolean => !!(r.battle || r.enemyPower !== null || r.siege);

/** Строка летописи ссылкой: минута и слова — строка с тем же и есть она. */
const logRef = (at: number, text: string): string => `${at}|${text}`;

/** Ресурсы, о которых гонец стучит: хлеб — всегда, дрова — когда без них мёрзнут. */
const OUT = ['food', 'wood'] as const;
type OutId = (typeof OUT)[number];
const isOut = (s: GameState, r: OutId): boolean => s.resources[r] < 1 && (r === 'food' || s.freezing > 0);

/**
 * Все вести журнала в эту минуту. `sinceGame` — строки летописи не старше этой игровой минуты (дальше не читать: летопись
 * длинная, а нужна её голова).
 */
export function tidingsOf(src: CourtSource, sinceGame = -Infinity): RawTiding[] {
  const out: RawTiding[] = [];
  const { s } = src;
  for (const l of src.letters) {
    // Осада — окном осады (её минута — `since`); письмо — её спутник на столе.
    if (l.kind === 'siege') continue;
    out.push({ id: letterKey(l.id), kind: l.kind === 'raid' ? 'march' : 'ask', clock: 'world', at: l.at, ref: l.id });
  }
  // Поход соседа — минутой выхода от сервера (`RivalMarch.sentAt`); вид без неё — отметкой двора.
  if (src.ready)
    for (const m of src.marching) out.push({ id: `war:${m.id}`, kind: 'march', ...(typeof m.sentAt === 'number' ? { clock: 'world' as const, at: m.sentAt } : { clock: 'real' as const, at: null }), ref: m.id });
  if (src.siege) out.push({ id: `siege:${src.siege.since}`, kind: 'siege', clock: 'world', at: src.siege.since, ref: String(src.siege.since) });
  for (const ev of s.inbox) out.push({ id: eventKey(ev), kind: eventKind(ev), clock: 'game', at: ev.at, ref: eventId(ev) });
  for (const r of OUT) if (isOut(s, r)) out.push({ id: `out:${r}`, kind: 'out', clock: 'real', at: null, ref: r });
  for (const r of src.reports) if (isBattle(r)) out.push({ id: `report:${r.id}`, kind: 'battle', clock: 'world', at: r.at, ref: r.id });
  for (const e of s.log) {
    if (e.at <= sinceGame) break;
    if (e.topic === 'build') out.push({ id: `log:${logRef(e.at, e.text)}`, kind: 'build', clock: 'game', at: e.at, ref: logRef(e.at, e.text) });
  }
  return out;
}

function eventKind(ev: ActiveEvent): TidingKind {
  if (STAB_EVENTS.includes(ev.defId)) return 'revolt';
  if (DISASTERS.has(ev.defId)) return 'disaster';
  if (AT_GATE.has(ev.defId)) return 'march';
  return 'ask';
}

/** Случилась ли весть позже минуты `m` — своими часами. */
export const after = (t: Tiding, m: Moment): boolean => t.at > m[t.clock];

/** Порядок доклада: важнее — первым, при равной важности — новее (той же часовой меры не бывает — по минуте). */
export const byWeight = (a: Tiding, b: Tiding): number => WEIGHT[b.kind] - WEIGHT[a.kind] || b.at - a.at;

/** Что сказать о вести сейчас: слова, дверь и исход ли это (весть устарела, а сказать есть что). */
export interface Telling {
  t: Tiding;
  text: string;
  door: NewsDoor;
  outcome: boolean;
}

const findEvent = (s: GameState, ref: string): ActiveEvent | undefined => s.inbox.find((e) => eventId(e) === ref);

/** Первое донесение после минуты `at` (часы мира), подходящее под `fit`: исход того, о чём шла весть. */
const outcomeOf = (src: CourtSource, at: number, fit: (r: Report) => boolean): Report | null =>
  src.reports.filter((r) => r.at >= at && fit(r)).sort((a, b) => a.at - b.at)[0] ?? null;

/**
 * Первое донесение войны `warId`: бой (`war-<бой>`, где номер боя — `<война>.<n>` у сервера войны, `war.ts`) или падение
 * города (`war-<война>-fall`, `-fell`); следствия (`-eff`) — не донесения боя. Пару держит тест чтением обоих исходников.
 */
export function warReportOf(warId: string, reports: readonly Report[]): Report | null {
  const own = (id: string): boolean => id.startsWith(`war-${warId}.`) || id === `war-${warId}-fall` || id === `war-${warId}-fell`;
  return reports.filter((r) => own(r.id) && !r.id.endsWith('-eff')).sort((a, b) => a.at - b.at)[0] ?? null;
}

const won = (r: Report): string => (r.won ? 'Наши взяли верх.' : 'Худо вышло.');

/**
 * Слова вести в эту минуту — из настоящего состояния. `null` — сказать нечего: на ответ ответили, донесения нет, исхода не
 * видно. Числа и сроки — дверями, которыми их пишут «Вести».
 */
export function tell(t: Tiding, src: CourtSource): Telling | null {
  const { s } = src;
  const say = (text: string, door: NewsDoor, outcome = false): Telling => ({ t, text, door, outcome });
  switch (t.kind) {
    case 'march': {
      if (t.id.startsWith('letter:')) {
        const l = src.letters.find((x) => x.id === t.ref);
        if (l) return say(`«${l.fromName}» идёт на нас набегом — у ворот через ${realDue((l.until - src.world) / 1000)}.`, { to: 'map' });
        const r = t.clock === 'world' ? outcomeOf(src, t.at, (x) => x.kind === 'defense') : null;
        return r ? say(`Набег, что шёл на нас, кончился. ${r.title}. ${won(r)}`, { to: 'report', id: r.id }, true) : null;
      }
      if (t.id.startsWith('war:')) {
        const m = src.marching.find((x) => x.id === t.ref);
        if (m) return say(`Из «${cityOr(m.city)}» вышел отряд на наш город — ${m.mode === 'storm' ? 'на штурм' : 'осадой'}; будут через ${realDue((m.arriveAt - src.world) / 1000)}.`, { to: 'map' });
        // Поход ушёл со стола: исход — донесение этой войны. Без минуты выхода (вид старше ПК-1б) — не судим: молчание.
        const r = t.clock === 'world' ? warReportOf(t.ref, src.reports) : null;
        return r ? say(`Поход на наш город кончился. ${r.title}. ${won(r)}`, { to: 'report', id: r.id }, true) : null;
      }
      return eventLine(t, src);
    }
    case 'siege': {
      const v = src.siege;
      if (v && String(v.since) === t.ref) return say(`«${v.byName}» стоит лагерем под стенами. Хлеба в городе на ${hungerLeft(v.starvesAt, src.world)}.`, { to: 'siege' });
      const r = outcomeOf(src, Number(t.ref), (x) => !!x.siege);
      return r ? say(`Осада кончилась. ${r.title}. ${won(r)}`, { to: 'report', id: r.id }, true) : say('Осаду сняли: под стенами больше никого.', { to: 'chronicle', topic: 'siege' }, true);
    }
    case 'out': {
      const r = t.ref as OutId;
      const have = Math.floor(s.resources[r] ?? 0);
      if (r === 'food') return isOut(s, r) ? say(`Хлеб кончился: амбары пусты${s.starvation > 0 ? ', люди голодают' : ''}.`, { to: 'store' }) : say(`Хлеб снова есть: еды на складе — ${have}.`, { to: 'store' }, true);
      return isOut(s, r) ? say('Дрова кончились: очаги гаснут, люди мёрзнут.', { to: 'store' }) : say(`Дрова снова есть: на складе — ${have}.`, { to: 'store' }, true);
    }
    case 'revolt': {
      const ev = findEvent(s, t.ref);
      const rv = s.stab?.revolt;
      const def = EVENT_BY_ID[t.ref.split(':')[0]];
      if (ev && def) return say(`${def.title}: ${rv ? `встали ${rv.rebels} чел., не работают` : 'город неспокоен'}. Ждут твоего слова.`, { to: 'stab' });
      if (rv) return say(`Мятеж не кончился: ${rv.rebels} чел. не работают.`, { to: 'stab' }, true);
      return say('Мятеж утих: город снова работает.', { to: 'stab' }, true);
    }
    case 'disaster':
      return eventLine(t, src);
    case 'battle': {
      const r = src.reports.find((x) => x.id === t.ref);
      return r ? say(`${r.title}. ${won(r)}`, { to: 'report', id: r.id }) : null;
    }
    case 'ask': {
      if (t.id.startsWith('letter:')) {
        const l = src.letters.find((x) => x.id === t.ref);
        return l ? say(`${l.title} — от «${l.fromName}», ждут ответа.`, { to: 'mail', key: letterKey(l.id) }) : null;
      }
      return eventLine(t, src);
    }
    case 'build': {
      const e = s.log.find((x) => logRef(x.at, x.text) === t.ref);
      return e ? say(e.text, { to: 'chronicle', topic: 'build' }) : null;
    }
  }
}

/** Событие на столе — заголовком «Вестей»; ответили — сказать нечего. */
function eventLine(t: Tiding, src: CourtSource): Telling | null {
  const ev = findEvent(src.s, t.ref);
  const def = ev ? EVENT_BY_ID[ev.defId] : undefined;
  if (!ev || !def) return null;
  return { t, text: `${def.title} — ждёт твоего слова.`, door: { to: 'mail', key: eventKey(ev) }, outcome: false };
}

/** Весть внутри фразы («Сир, …», «Пока тебя не было: …») — со строчной, если начинается не с имени в кавычках. */
export const lowerFirst = (t: string): string => (t.startsWith('«') ? t : t.charAt(0).toLowerCase() + t.slice(1));

/** Строка с обращением — тем же, что у слуг (`talk.TITLE`): `{T}` — с большой буквы (в начале фразы), `{t}` — как есть. */
export function says(line: string, faith: FaithId): string {
  const t = TITLE[faith];
  return line.replace(/\{T\}/g, t[0].toUpperCase() + t.slice(1)).replace(/\{t\}/g, t);
}

/** Первая фраза доклада: с чем советник встречает — по тому, что за отлучку было. */
export function advisorOpening(lines: readonly Telling[]): string {
  const bad = lines.some((l) => !l.outcome && WEIGHT[l.t.kind] >= WEIGHT.out);
  return bad ? '{T}, хорошо, что ты вернулся. Пока тебя не было:' : '{T}, с возвращением. Пока тебя не было, вот что:';
}
