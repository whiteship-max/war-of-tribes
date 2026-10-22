// Вести державы (СБ-2, docs/stability.md, «СБ-2») — единственная дверь: когда весть приходит, что делает ответ и что
// записано для книги сервера. Пишет `GameState.crown` только она.
//
// **Приход — на сетке почты, а не своим счётом.** Сетка одна (`sim/mail.mailArrive`): на каждом её приходе сперва
// спрашивается весть державы. У каждой вести своя частота λ = вес / срок (`data/crown` — вес, `crownrules` — срок по
// редкости), и вероятность, что за промежуток сетки Δ «наступила» хоть одна, — `1 − exp(−Δ · Σλ)`, как среднее время
// до наступления у EU4. Выпала — она и приходит вместо обычной вести, какая именно — пропорционально λ; не выпала —
// приходит обычная, как прежде. Кость — одна на приход (`sim/roll`).
//
// **Повтор не чаще срока, не больше одной за вход.** Пришедшая весть помнит минуту прихода (`crown.seen`) и до срока
// повтора не приходит; пока на столе лежит одна весть державы (или её следствие), другой нет, и за одно окно почты
// (вход или шаг живой игры) их приходит не больше одной (`sim/mail`).
//
// **Ответ — данными.** Стабильность и приток очков — из общей с сервером таблицы (`crownrules`), прочее — последствия
// вести (`data/crown.Fx`), каждое своей прежней дверью: стабильность — `sim/stability.stabNudge`, очки — `sim/points.grant`,
// обида и милость групп — усилитель (`sim/boons`), вера — `sim/faith.addStrain`, люди — `sim/population`, следствие —
// `sim/chains`. Своего счёта у вести нет.
import type { CrownState, GameState } from '../types';
import type { EventDef } from '../data/events';
import { CROWN, CROWN_BY_ID, type CrownDef, type Fx } from '../data/crown';
import { BOON_BY_ID, boonWords } from '../data/boons';
import { BRANCH_NAME } from '../data/realm';
import { RESOURCE_META } from '../constants';
import { daysSpan } from '../span';
import { SEASON_DAYS } from '../data/seasons';
import { CROWN_BOOK, CROWN_MTTH, CROWN_RULES, RARITY_SLOW, crownEvery, crownStab, isCrown } from '../crownrules';
import { addRes, cap, fameWord, moraleWord, moveFame, moveMorale, people } from '../data/eventKit';
import { roll, chance } from './roll';
import { stabNudge } from './stability';
import { grant } from './points';
import { grantBoon } from './boons';
import { chainPending, scheduleChain } from './chains';
import { addStrain, grantRelic } from './faith';
import { killPop, loseBonded, losePop } from './population';
import { grantPrivilege } from './estates';
import { ESTATE_META } from '../data/estates';

/** Пустая книга: так читаются новая и старая партия. */
const empty = (): CrownState => ({ seen: {}, n: 0, last: [] });

/** Вести державы партии — чтение. Поля нет — вестей ещё не было. */
export const crownOf = (s: GameState): CrownState => s.crown ?? empty();

/** Поле для записи: заводится на первой записи. */
function own(s: GameState): CrownState {
  if (!s.crown) s.crown = empty();
  return s.crown;
}

// ---------- Приход ----------

/**
 * Частота вести, в игровой день: вес / (срок × редкость). Ноль — сейчас она прийти не может: условие не выполнено, срок
 * повтора не вышел, она на столе или ждёт следствием. Следствие случаем не выпадает вовсе.
 */
export function crownRate(s: GameState, d: CrownDef): number {
  const rule = CROWN_RULES[d.id];
  if (!rule || rule.kind === 'chain') return 0;
  const w = d.weight(s);
  if (!(w > 0)) return 0;
  const last = s.crown?.seen[d.id];
  if (last !== undefined && s.time - last < crownEvery(d.id)) return 0;
  if (chainPending(s, d.id)) return 0;
  return w / (CROWN_MTTH * RARITY_SLOW[rule.rarity]);
}

/** Вести, которые могут прийти сейчас, с частотой. */
export const crownRates = (s: GameState): [CrownDef, number][] =>
  CROWN.map((d) => [d, crownRate(s, d)] as [CrownDef, number]).filter(([, l]) => l > 0);

/** Лежит ли на столе весть державы или её следствие: пока лежит, другой не приходит. */
export const crownOnTable = (s: GameState): boolean => s.inbox.some((e) => isCrown(e.defId));

/**
 * Весть державы на приход сетки: `days` — сколько игровых дней с прошлого прихода. Одна кость на приход: она решает и
 * «пришла ли», и какая — пропорционально частоте. null — пришла обычная весть.
 */
export function crownPick(s: GameState, days: number): CrownDef | null {
  if (crownOnTable(s)) return null;
  const rates = crownRates(s);
  const sum = rates.reduce((n, [, l]) => n + l, 0);
  if (!(sum > 0) || !(days > 0)) return null;
  const p = 1 - Math.exp(-days * sum);
  const u = roll(s);
  if (u >= p) return null;
  let x = (u / p) * sum;
  for (const [d, l] of rates) {
    if (x < l) return d;
    x -= l;
  }
  return rates[rates.length - 1][0];
}

/** Весть легла на стол — минута прихода: до срока повтора она не придёт. */
export function crownArrived(s: GameState, id: string): void {
  own(s).seen[id] = s.time;
}

// ---------- Ответ ----------

/** Последствия ответа в эту минуту — то же, что исполнит ответ и что покажет окно. */
export const crownFx = (s: GameState, id: string, i: number): Fx[] => CROWN_BY_ID[id]?.opts[i]?.fx?.(s) ?? [];

/** Исполнить одно последствие его дверью. */
function applyFx(s: GameState, f: Fx): void {
  switch (f.k) {
    case 'boon':
      grantBoon(s, f.id);
      return;
    case 'res':
      addRes(s, f.r, f.n);
      return;
    case 'gold':
      s.gold = Math.max(0, s.gold + f.n);
      return;
    case 'fame':
      moveFame(s, f.n);
      return;
    case 'morale':
      moveMorale(s, f.n);
      return;
    case 'strain':
      addStrain(s, f.n);
      return;
    case 'pop':
      if (f.n < 0) {
        if (f.died) killPop(s, -f.n, 'мор');
        else losePop(s, -f.n);
      }
      return;
    case 'bonded':
      if (f.n < 0) loseBonded(s, -f.n);
      return;
    case 'relic':
      grantRelic(s);
      return;
    case 'chain':
      if (f.p >= 1 || chance(s, f.p)) scheduleChain(s, f.id, f.seasons);
      return;
    case 'priv':
      grantPrivilege(s, f.e);
      return;
  }
}

/**
 * Ответ на весть державы — его исполняет почта (`sim/mail.closeEvent`) после того, как цена списана, и молчание идёт тем же
 * путём. Последствия считаются до исполнения: окно показывало именно их. Возвращает строку летописи — что ответ дал.
 */
export function applyCrown(s: GameState, id: string, i: number): string {
  const list = crownFx(s, id, i);
  const words = crownWords(s, id, i);
  stabNudge(s, crownStab(id, i));
  const gain = CROWN_RULES[id]?.opts[i]?.gain;
  if (gain) grant(s, gain[0], gain[1]);
  for (const f of list) applyFx(s, f);
  book(s, id, i);
  return words ? `${cap(words)}.` : 'Всё осталось как было.';
}

/** Строка книги: номер, вид, ответ и минута, когда весть легла на стол. */
function book(s: GameState, id: string, opt: number): void {
  const c = own(s);
  const at = s.inbox.find((e) => e.defId === id)?.at ?? s.time;
  c.n++;
  c.last = [...c.last, { n: c.n, id, opt, at }].slice(-CROWN_BOOK);
}

// ---------- Слова последствий ----------

/** «+21 %», «−43 %» — сдвиг стабильности целыми процентами, минус длинный. */
const pct = (d: number): string => `${d > 0 ? '+' : '−'}${Math.round(Math.abs(d))}\u00a0%`;
const signed = (d: number): string => `${d > 0 ? '+' : '−'}${Math.abs(Math.round(d))}`;

/** Одно последствие словами. */
export function fxWord(f: Fx): string {
  switch (f.k) {
    case 'boon': {
      const b = BOON_BY_ID[f.id];
      return b ? `${b.name.toLowerCase()} на ${daysSpan(b.days)}: ${boonWords(b).toLowerCase()}` : '';
    }
    case 'res':
      return `${RESOURCE_META[f.r].name.toLowerCase()} ${signed(f.n)}`;
    case 'gold':
      return `золото ${signed(f.n)}`;
    case 'fame':
      return fameWord(f.n);
    case 'morale':
      return moraleWord(f.n);
    case 'strain':
      return `надлом веры +${Math.round(f.n)}`;
    case 'pop':
      return f.died ? `умрут ${people(-f.n)}` : `уйдут ${people(-f.n)}`;
    case 'bonded':
      return `невольников ${signed(f.n)}`;
    case 'relic':
      return 'святыня в храм';
    case 'chain': {
      const next = CROWN_BY_ID[f.id]?.title ?? '';
      const when = daysSpan(f.seasons * SEASON_DAYS);
      return f.p >= 1 ? `через ${when} — «${next}»` : `риск ${Math.round(f.p * 100)} %: «${next}» через ${when}`;
    }
    case 'priv':
      return `${ESTATE_META[f.e].to} — привилегия «${f.name}»`;
  }
}

/** Что ответ даст — словами: стабильность, очки, последствия. Пусто — ничего не меняется. */
export function crownWords(s: GameState, id: string, i: number): string {
  const parts: string[] = [];
  const d = crownStab(id, i);
  if (d !== 0) parts.push(`стабильность ${pct(d)}`);
  const gain = CROWN_RULES[id]?.opts[i]?.gain;
  if (gain) parts.push(`${BRANCH_NAME[gain[0]].toLowerCase()} +${gain[1]}`);
  for (const f of crownFx(s, id, i)) {
    const w = fxWord(f);
    if (w) parts.push(w);
  }
  return parts.join(', ');
}

// ---------- Вести в общей таблице ----------

/**
 * Вести державы в общей таблице событий (`data/events.EVENTS`): случаем по весу почты они не выпадают (вес ноль) — их
 * приводит `crownPick` на сетке, следствия — `sim/chains`. Текста здесь нет: он едет куском «Вестей» (`data/crownWords`).
 */
export function crownEvents(): EventDef[] {
  return CROWN.map(
    (d): EventDef => ({
      id: d.id,
      title: d.title,
      from: d.from,
      weight: () => 0,
      silence: d.silence,
      topic: 'stab',
      named: true,
      options: d.opts.map((o, i) => ({
        label: o.label,
        hint: (s: GameState) => cap(crownWords(s, d.id, i)) || 'Ничего не изменится',
        ...(o.cost ? { cost: o.cost } : {}),
        ...(o.points ? { points: o.points } : {}),
        apply: (s: GameState) => applyCrown(s, d.id, i),
      })),
    }),
  );
}
