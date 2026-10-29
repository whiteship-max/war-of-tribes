// Весть «Просятся в отряд» (ПН-6, docs/gdd/path_of_sword.md, 3.4.1; «Решения ПН-6»): случайные люди сами приходят в лагерь — главный
// источник людей бродяги. Всегда дубинщики.
//
// Приход — на сетке почты (`game/mailgrid.awayArrival` — та же, что у вестей посёлка) по настоящему времени и сиду партии: при игроке и
// без него одинаково, не чаще одной такой вести на столе (`raiseEvent` второй раз того же вида не кладёт). Сколько пришло — в минуту
// прихода, функцией ступени престижа, лагеря, сезона и духа (`askrules.askCount`; ориентиры — заглушки игры), и запоминается
// (`RoamState.ask`): ответ сутки спустя берёт тех, кто пришёл. Закрывает весть почта (`sim/mail`) — ответом или молчанием.
//
// Варианты: «Принять всех» · «Взять, сколько прокормим» (число — `askrules.askFeedable` от хлеба обоза и пайка отряда) · «Прогнать» —
// молчание, даром. Принятые — приказ книги отряда сервера (`join`: номер прихода и сколько взяли, `netlify/lib/roambook.ts`).
// Своим модулем — в куске пути (`game/roamdoor`): вид вести ложится в таблицу почты при загрузке куска (`data/events.addEventDef`).
import type { GameState, RoamState } from '../types';
import { addEventDef, type EventDef } from '../data/events';
import { awayArrival, firstArrival } from '../mailgrid';
import { EVENT_TTL, mailStep, raiseEvent } from './mail';
import { ASK_KIND, askCount, askFeedable, type AskAt } from '../askrules';
import { bandRationPerDay, bandWage } from '../roamrules';
import { prestigeStage } from './prestige';
import { roamStub } from '../roamstubs';
import { seasonMods, seasonOf } from '../derived';
import { spiritOf } from './spirit';
import { num } from '../num';
import { bandOf, bookKey, sendBook } from './bandranks';

/** Вид вести. */
export const BAND_ASK = 'band_ask';

/** Разновидности прихода — те же правила, другие слова (3.4.1); «Дезертиры» и «Лесной люд» — с духом и склонами (ПН-8). */
const KINDS = ['Беглые крестьяне', 'Сыновья мельника', 'Батраки после жатвы'] as const;

/** Условия прихода сейчас: ступень престижа, лагерь, зима ли, мораль отряда. */
export function askAt(s: GameState): AskAt {
  const r = s.roam;
  return {
    stage: prestigeStage(Math.max(0, s.prestige), roamStub('stages')),
    camp: r?.camp?.kind ?? 'none',
    winter: seasonOf(s.time) === 'winter',
    morale: spiritOf(s).morale,
  };
}

/** Паёк одного дубинщика за игровой день по сезону — той же дверью пайка, что шаг отряда. */
const headRation = (s: GameState): number => bandRationPerDay({ band: { [ASK_KIND]: 1 }, wounded: [] }, seasonMods(s).food);

/** Сколько из пришедших отряд прокормит (`askrules.askFeedable`): хлеб обоза, паёк отряда и новых на `askFeed` игр. дн. */
export function askTake(s: GameState): number {
  const r = s.roam;
  if (!r?.ask) return 0;
  const per = headRation(s);
  const mouths = per > 0 ? bandRationPerDay(r, seasonMods(s).food) / per : 0;
  return Math.min(r.ask.men, askFeedable(r.cargo.food ?? 0, per, mouths));
}

/** Принять `n` пришедших дубинщиками: строй, приказ книги, весть снята. */
function accept(s: GameState, r: RoamState, n: number): string {
  const k = r.ask?.k ?? 0;
  delete r.ask;
  if (n <= 0) return 'Никого не взяли.';
  r.band[ASK_KIND] = (r.band[ASK_KIND] ?? 0) + n;
  sendBook(s, { op: 'join', key: bookKey(s, 'join'), k, n });
  return `В отряде прибыло: дубинщики, ${n}. Жалованье +${num(bandWage(ASK_KIND) * n, 1)} золота в игр. день.`;
}

export const BAND_ASK_DEF: EventDef = {
  id: BAND_ASK,
  title: 'Просятся в отряд',
  from: 'Дозорный у костра',
  text: (s) => {
    const a = s.roam?.ask;
    const who = KINDS[(a?.k ?? 0) % KINDS.length];
    return `${who} у костров, ${a?.men ?? 0} чел.: просятся в отряд. Пойдут дубинщиками — вступление даром, дальше жалованье и паёк.`;
  },
  named: true,
  weight: () => 0,
  waits: 'Уйдут сами через',
  silence: 2,
  options: [
    {
      label: 'Принять всех',
      hint: (s) => {
        const n = s.roam?.ask?.men ?? 0;
        return `дубинщиков +${n}: жалованье +${num(bandWage(ASK_KIND) * n, 1)}, паёк +${num(headRation(s) * n, 1)} в игр. день`;
      },
      apply: (s) => {
        const r = bandOf(s);
        return r ? accept(s, r, r.ask?.men ?? 0) : 'Отряда нет.';
      },
    },
    {
      label: 'Взять, сколько прокормим',
      hint: (s) => `возьмём ${askTake(s)} из ${s.roam?.ask?.men ?? 0} — хлеба в обозе на ${roamStub('askFeed')} игр. дн. всем`,
      block: (s) => (askTake(s) > 0 ? null : 'Хлеба в обозе не хватит и на одного.'),
      apply: (s) => {
        const r = bandOf(s);
        return r ? accept(s, r, askTake(s)) : 'Отряда нет.';
      },
    },
    {
      label: 'Прогнать',
      hint: 'уйдут своей дорогой',
      apply: (s) => {
        if (s.roam) delete s.roam.ask;
        return 'Ушли своей дорогой.';
      },
    },
  ],
};

addEventDef(BAND_ASK_DEF);

/**
 * Приход просящихся между `from` и `now` (настоящие мс) на сетке почты: окно живого шага или отлучка — одно правило. Глубже срока
 * вести окно не заходит (как у почты посёлка). Возвращает, сколько вестей легло.
 */
export function bandMailArrive(s: GameState, from: number, now: number): number {
  const r = bandOf(s);
  if (!r) return 0;
  const start = Math.max(from, now - EVENT_TTL);
  let n = 0;
  for (let k = firstArrival(start); ; k++) {
    const t = awayArrival(s.seed, k);
    if (t > now) break;
    if (t <= start) continue;
    // До прихода — то, что истекло к его минуте, уходит своим молчанием (и прежние просящиеся — тоже).
    mailStep(s, t);
    if (r.ask || s.inbox.some((e) => e.defId === BAND_ASK)) continue;
    r.ask = { k, men: askCount(s.seed, k, askAt(s)) };
    if (!raiseEvent(s, BAND_ASK)) {
      delete r.ask;
      continue;
    }
    s.inbox[s.inbox.length - 1].until = t + EVENT_TTL;
    n++;
  }
  return n;
}
