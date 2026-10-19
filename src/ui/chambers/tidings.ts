// Гонец и советник покоев (docs/city_v3.md, Г-10): какие вести важны настолько, что за ними стучат в дверь, что советник
// докладывает после отлучки и куда ведёт каждая строка. Чистый модуль без React и без сцены — его держат тесты.
//
// Своих данных и своей арифметики здесь нет. Вести — то, что мир уже положил: письма на столе (`useWorld.letters`), окно
// осады и свой лагерь (`siege`, `camp` — проломы и предложения у стен), донесения о боях (`reports`). Доклад — летопись
// «Вестей» (ВС-2, `realm/annals.chronEvents`): те же события, тот же род, те же донесения. Число в строке — то, что
// записала партия или мир (правило 18), а сроки — общей дверью часов голода (`parts/hunger.hungerLeft`).
import type { FaithId } from '@/game/types';
import type { CampView, LetterView, Report, SiegeView } from '@/world/types';
import type { ChronEvent, ChronTopic } from '@/ui/realm/annals';
import { letterKey } from '@/ui/realm/unread';
import { hungerLeft } from '@/ui/parts/hunger';
import { gameSeconds, realSec } from '@/game/pace';
import { TITLE } from './talk';

/**
 * Куда ведёт весть или строка доклада — двери игры, а не свои окна: письмо в «Вестях», окно осады, окно лагеря, донесение
 * в летописи, летопись по роду, почта державы.
 */
export type NewsDoor =
  | { to: 'mail'; key: string }
  | { to: 'siege' }
  | { to: 'camp' }
  | { to: 'report'; id: string }
  | { to: 'chronicle'; topic: ChronTopic | null }
  | { to: 'inbox' };

/** Род важной вести — по заданию владельца: набег, осада, пролом, предложение условий или союза, итог боя. */
export type NewsKind = 'raid' | 'siege' | 'breach' | 'offer' | 'pact' | 'battle';

export interface News {
  /** Ключ вести: тот же ключ — та же весть, гонец за ней второй раз не придёт. */
  key: string;
  kind: NewsKind;
  /** Что гонец говорит, протягивая письмо (`{t}` — обращение к правителю). */
  line: string;
  door: NewsDoor;
}

/** Что видно о мире — как его отдаёт стор мира. */
export interface WorldNews {
  letters: readonly LetterView[];
  siege: SiegeView | null;
  camp: CampView | null;
  reports: readonly Report[];
  now: number;
}

/** Был ли в донесении бой — тот же признак, что у итога события в летописи (`Chronicle.outcome`). */
export const isBattle = (r: Report): boolean => !!(r.battle || r.enemyPower !== null || r.siege);

/**
 * Важные вести в эту минуту, по порядку срочности. Своих полей у вестей нет: письмо — пока лежит на столе, пролом и
 * предложение у стен — пока стоят в окне осады, итог боя — донесение.
 */
export function newsOf(w: WorldNews): News[] {
  const out: News[] = [];
  for (const l of w.letters) {
    const from = `«${l.fromName}»`;
    switch (l.kind) {
      case 'raid':
        out.push({ key: letterKey(l.id), kind: 'raid', line: `{T}! Дозор со стены: ${from} идёт на нас набегом!`, door: { to: 'mail', key: letterKey(l.id) } });
        break;
      case 'siege':
        // Осада — окном осады: там срок голода, ответы и переговоры; письмо — только её спутник на столе.
        out.push({ key: letterKey(l.id), kind: 'siege', line: `{T}, беда: ${from} встал лагерем под стенами. Город в осаде.`, door: w.siege ? { to: 'siege' } : { to: 'mail', key: letterKey(l.id) } });
        break;
      case 'alliance':
        out.push({ key: letterKey(l.id), kind: 'pact', line: `{T}, посол от ${from}: зовут в союз${l.againstName ? ` против «${l.againstName}»` : ''}.`, door: { to: 'mail', key: letterKey(l.id) } });
        break;
      case 'pact':
        out.push({ key: letterKey(l.id), kind: 'pact', line: `{T}, от ${from} — предлагают договор. Ждут ответа.`, door: { to: 'mail', key: letterKey(l.id) } });
        break;
      case 'tribute':
        out.push({ key: letterKey(l.id), kind: 'offer', line: `{T}, ${from} шлёт условия: требуют дани.`, door: { to: 'mail', key: letterKey(l.id) } });
        break;
      case 'ransom':
        out.push({ key: letterKey(l.id), kind: 'offer', line: `{T}, ${from} предлагает выкуп пленных. Вот их условия.`, door: { to: 'mail', key: letterKey(l.id) } });
        break;
    }
  }
  const s = w.siege;
  if (s) {
    const breaches = s.phases?.breaches ?? 0;
    // Каждый новый пролом — новая весть: второй пролом — не тот же, что первый.
    if (breaches > 0) out.push({ key: `breach:${s.since}:${breaches}`, kind: 'breach', line: breaches > 1 ? `{T}! Ещё пролом в стене — стену рушат!` : `{T}! Пролом в стене! Враг ломит в брешь.`, door: { to: 'siege' } });
    const o = s.parley?.incoming;
    if (o && o.until > w.now) out.push({ key: `offer:${s.since}:${o.until}`, kind: 'offer', line: o.kind === 'terms' ? `{T}, переговорщик от «${s.byName}»: предлагают условия сдачи.` : `{T}, у ворот — о дани за снятие осады.`, door: { to: 'siege' } });
  }
  const c = w.camp;
  const co = c?.parley?.incoming;
  if (c && co && co.until > w.now) out.push({ key: `camp-offer:${c.targetName}:${co.until}`, kind: 'offer', line: co.kind === 'tribute' ? `{T}, гонец из лагеря: «${c.targetName}» предлагает дань.` : `{T}, гонец из лагеря: «${c.targetName}» шлёт условия.`, door: { to: 'camp' } });
  for (const r of w.reports) {
    if (!isBattle(r)) continue;
    out.push({ key: `report:${r.id}`, kind: 'battle', line: `{T}, донесение: ${r.title}. ${r.won ? 'Наши взяли верх!' : 'Худые вести…'}`, door: { to: 'report', id: r.id } });
  }
  return out.sort((a, b) => RANK[a.kind] - RANK[b.kind]);
}

/** Срочное — первым: гонец с набегом не ждёт за гонцом с договором. */
const RANK: Record<NewsKind, number> = { raid: 0, breach: 1, siege: 2, offer: 3, battle: 4, pact: 5 };

/** Строка с обращением — тем же, что у слуг (`talk.TITLE`): «сир», «княже», «господин»: `{T}` — с большой буквы (в начале фразы), `{t}` — как есть. */
export function says(line: string, faith: FaithId): string {
  const t = TITLE[faith];
  return line.replace(/\{T\}/g, t[0].toUpperCase() + t.slice(1)).replace(/\{t\}/g, t);
}

/**
 * Гонец носит только то, что пришло, пока правитель в покоях: что лежало при входе, доложит советник, а не гонец. `seen` —
 * ключи, о которых уже знают (при входе — все, что были); новые — по порядку срочности.
 */
export function freshNews(list: readonly News[], seen: ReadonlySet<string>): News[] {
  return list.filter((n) => !seen.has(n.key));
}

// ---------- Советник ----------

/** Что советник помнит (устройство, не партия): когда докладывал, сколько было в казне и о каких угрозах уже сказал. */
export interface AdvisorMemory {
  /** Игровое время прошлого доклада (`s.time`); `null` — ещё не докладывал. */
  at: number | null;
  gold: number | null;
  told: string[];
}

export const freshAdvisor = (): AdvisorMemory => ({ at: null, gold: null, told: [] });

/**
 * Сколько игрового времени — «отлучка»: три настоящих часа (шесть игровых суток). Короче — советник не ждёт у стола: всё
 * и так видно из окна.
 */
export const ADVISOR_AWAY = gameSeconds(realSec(3 * 3600));

/** Строка доклада: слова и дверь; `tone` — как в летописи (добро, худо, ровно). */
export interface ReportLine {
  key: string;
  text: string;
  tone: 'good' | 'bad' | 'info';
  door: NewsDoor;
}

/** Что видно советнику: летопись «Вестей» событиями, мир и казна. */
export interface AdvisorInput {
  /** События летописи (`annals.chronEvents` по `s.log` и донесениям мира) — новыми вперёд. */
  events: readonly ChronEvent[];
  /** Игровое время сейчас (`s.time`). */
  time: number;
  gold: number;
  /** Сколько вестей на столе ждут ответа (`s.inbox`). */
  inbox: number;
  world: WorldNews;
}

/** Сколько боёв в докладе по имени; остальные — строкой «и ещё N». */
const BATTLES_MAX = 3;

/**
 * Доклад советника после отлучки: угрозы (о которых он ещё не говорил), бои, стройка и казна — по летописи «Вестей» за
 * время с прошлого доклада. Пусто — докладывать нечего, и советник не ждёт. `null` — отлучки не было.
 */
export function advisorReport(inp: AdvisorInput, mem: AdvisorMemory): { lines: ReportLine[]; next: AdvisorMemory } | null {
  // Ни разу не докладывал — доклад за последнюю отлучку: первый вход в покои — уже возвращение.
  const since = mem.at ?? inp.time - ADVISOR_AWAY;
  if (mem.at !== null && inp.time - mem.at < ADVISOR_AWAY) return null;
  const lines: ReportLine[] = [];
  const threats = threatLines(inp);
  for (const t of threats) if (!mem.told.includes(t.key)) lines.push(t);
  const events = inp.events.filter((e) => e.at > since);
  const war = events.filter((e) => e.topic === 'battle' || e.topic === 'raid' || e.topic === 'siege');
  for (const e of war.slice(0, BATTLES_MAX)) lines.push(eventLine(e));
  if (war.length > BATTLES_MAX) {
    const more = war.length - BATTLES_MAX;
    lines.push({ key: 'war-more', text: `И ещё ${more} ${more === 1 ? 'дело' : more < 5 ? 'дела' : 'дел'} войны — в летописи.`, tone: 'info', door: { to: 'chronicle', topic: 'battle' } });
  }
  const build = events.filter((e) => e.topic === 'build');
  if (build.length > 0) {
    // Летопись — новыми вперёд: в докладе стройка по порядку, как шла.
    const done = build.map((e) => e.head.text).reverse();
    const text = done.length <= 2 ? `Стройка: ${done.join('; ')}.` : `Стройка: ${done[0]}; ${done[1]} — и ещё ${done.length - 2}.`;
    lines.push({ key: 'build', text, tone: 'good', door: { to: 'chronicle', topic: 'build' } });
  }
  if (mem.gold !== null && Math.round(inp.gold - mem.gold) !== 0) {
    const d = Math.round(inp.gold - mem.gold);
    lines.push({
      key: 'gold',
      text: d > 0 ? `Казна: прибыло ${d} золота, теперь ${Math.round(inp.gold)}.` : `Казна: убыло ${-d} золота, осталось ${Math.round(inp.gold)}.`,
      tone: d > 0 ? 'good' : 'bad',
      door: { to: 'chronicle', topic: 'trade' },
    });
  }
  const next: AdvisorMemory = { at: inp.time, gold: inp.gold, told: threats.map((t) => t.key) };
  return { lines, next };
}

/** Событие войны строкой доклада: слова летописи, дверь — его донесение (нет донесения — летопись того же рода). */
function eventLine(e: ChronEvent): ReportLine {
  const r = e.report;
  const tone: ReportLine['tone'] = e.head.kind === 'good' ? 'good' : e.head.kind === 'bad' ? 'bad' : r && isBattle(r) ? (r.won ? 'good' : 'bad') : 'info';
  return { key: `ev:${e.key}`, text: e.head.text, tone, door: r ? { to: 'report', id: r.id } : { to: 'chronicle', topic: e.topic } };
}

/** Угрозы, что стоят сейчас: осада, набеги, наш лагерь, письма и вести, ждущие ответа. */
function threatLines(inp: AdvisorInput): ReportLine[] {
  const w = inp.world;
  const out: ReportLine[] = [];
  if (w.siege) out.push({ key: `siege:${w.siege.since}`, text: `Город в осаде: «${w.siege.byName}» под стенами, хлеба на ${hungerLeft(w.siege.starvesAt, w.now)}.`, tone: 'bad', door: { to: 'siege' } });
  for (const l of w.letters) {
    if (l.kind === 'raid') out.push({ key: letterKey(l.id), text: `Угроза: «${l.fromName}» идёт на город набегом.`, tone: 'bad', door: { to: 'mail', key: letterKey(l.id) } });
    else if (l.kind !== 'siege') out.push({ key: letterKey(l.id), text: `Ждёт ответа: ${l.title.toLowerCase()} — от «${l.fromName}».`, tone: 'info', door: { to: 'mail', key: letterKey(l.id) } });
  }
  if (w.camp) out.push({ key: `camp:${w.camp.targetName}`, text: `Наш лагерь под «${w.camp.targetName}»: у города хлеба на ${hungerLeft(w.camp.starvesAt, w.now)}.`, tone: 'info', door: { to: 'camp' } });
  if (inp.inbox > 0) out.push({ key: `inbox:${inp.inbox}`, text: `На столе ${inp.inbox} ${inp.inbox === 1 ? 'весть ждёт' : inp.inbox < 5 ? 'вести ждут' : 'вестей ждут'} твоего слова.`, tone: 'info', door: { to: 'inbox' } });
  return out;
}

/** Первая фраза доклада: с чем советник встречает — по тому, что за отлучку было. */
export function advisorOpening(lines: readonly ReportLine[]): string {
  const bad = lines.some((l) => l.tone === 'bad');
  return bad ? '{T}, хорошо, что ты вернулся. Пока тебя не было:' : '{T}, с возвращением. Пока тебя не было, вот что:';
}
