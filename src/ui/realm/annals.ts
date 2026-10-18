// Летопись «Вестей» (ВС-2, docs/ui_v2.md, 5.8): строки партии (`s.log`) событиями по дням, род каждого события и его
// донесение. Своих данных у летописи нет: строки пишет партия (`sim/log`), донесения — мир (`useWorld.reports`), а здесь —
// только как их свести.
//
// Событие — строки одного последствия мира (`LogEntry.ref`, метит их `sim/log.tagSince`): «Волки порвали заслон», «Не
// вернулись: 17 бойцов», «Раненые: 1» — одно событие с одним донесением, а не три строки вперемешку с указами. Строка без
// ключа — событие из одной строки.
import type { LogEntry } from '@/game/types';
import type { Report } from '@/world/types';

/** Род события летописи: фильтры над днями. `town` — всё прочее (сезон, задания, жители, вести города). */
export type ChronTopic = 'battle' | 'raid' | 'siege' | 'build' | 'decree' | 'rival' | 'trade' | 'town';

/** Рода по порядку фильтров: война — первой, она и открывается донесением. */
export const TOPICS: readonly { id: ChronTopic; label: string; icon: { name: string; glyph: string } }[] = [
  { id: 'battle', label: 'Бои', icon: { name: 'ui-banner', glyph: '⚔️' } },
  { id: 'raid', label: 'Набеги', icon: { name: 'ui-home', glyph: '🏠' } },
  { id: 'siege', label: 'Осады', icon: { name: 'ui-warning', glyph: '🔥' } },
  { id: 'build', label: 'Стройка', icon: { name: 'ui-hammer', glyph: '🔨' } },
  { id: 'decree', label: 'Указы', icon: { name: 'ui-scroll', glyph: '📜' } },
  { id: 'rival', label: 'Соседи', icon: { name: 'deal-alliance', glyph: '🤝' } },
  { id: 'trade', label: 'Торговля', icon: { name: 'ui-wagon', glyph: '🛒' } },
  { id: 'town', label: 'Город', icon: { name: 'ui-book', glyph: '📖' } },
];

export const TOPIC_BY_ID = Object.fromEntries(TOPICS.map((t) => [t.id, t])) as Record<ChronTopic, (typeof TOPICS)[number]>;

/**
 * Донесение последствия. Мир даёт последствию ключ донесения или тот же ключ с припиской (`-eff`, `-battle`), донесению
 * приказа — приписку `-r`, донесению о гибели агента — `-died-` перед минутой (`LocalWorld.addEffect`, `addReport`; пары
 * держит `annals.test.ts` чтением исходника). Нет такого — у события донесения нет (агент вернулся, фаза осады, договор).
 */
export function reportOf(ref: string, reports: readonly Report[]): Report | null {
  const ids = new Set([ref, ref.replace(/-(eff|battle)$/, ''), `${ref}-r`, ref.replace(/^fig-([a-z]+)-(\d+)$/, 'fig-$1-died-$2')]);
  return reports.find((r) => ids.has(r.id)) ?? null;
}

/** Осада по ключу мира: окно осады, лагерь, выкуп, выручка, вылазка, дань и падение. */
const SIEGE = /^(siege|camp|ransom|relief|sortie)|-(siege|tribute|fell|fall)(-eff)?$/;

/** Род донесения: осада — по записи осады или ключу; набег — бой у своих стен; соседи — помощь, сделки, лазутчики. */
export function reportTopic(r: Report): ChronTopic {
  if (r.siege || SIEGE.test(r.id)) return 'siege';
  if (r.kind === 'defense') return 'raid';
  if (r.kind === 'support' || /^(deal|order|spy)-/.test(r.id)) return 'rival';
  return 'battle';
}

/** Род последствия без донесения — по ключу мира. */
export function refTopic(ref: string): ChronTopic {
  if (/^pact-.*-trade-/.test(ref)) return 'trade';
  if (/^(pact|deal|order|spy|letter)-|^fig-scout-deed-/.test(ref)) return 'rival';
  if (SIEGE.test(ref)) return 'siege';
  if (/-gate$|-defense$/.test(ref)) return 'raid';
  if (/^(war|atk|chase|strike|assault|muster)|-(home|scout)$/.test(ref)) return 'battle';
  return 'town';
}

export interface ChronEvent {
  key: string;
  at: number;
  topic: ChronTopic;
  /** Первая строка события — та, что легла первой: «Набег отбит», а не «Раненые: 3». */
  head: LogEntry;
  /** Остальные строки события — потери, добыча, раненые, — по порядку записи. */
  rest: LogEntry[];
  report: Report | null;
}

/**
 * Строки летописи (новые вперёд) — событиями: подряд идущие строки одного последствия сводятся в одно. Род — по
 * донесению, иначе по ключу, иначе тот, что записала партия; донесение — по ключу последствия.
 */
export function chronEvents(log: readonly LogEntry[], reports: readonly Report[]): ChronEvent[] {
  const out: ChronEvent[] = [];
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    const last = out[out.length - 1];
    if (e.ref && last && last.head.ref === e.ref) {
      // Летопись — новыми вперёд: строка ниже легла раньше, она и голова события.
      last.rest.unshift(last.head);
      last.head = e;
      last.at = e.at;
      continue;
    }
    const report = e.ref ? reportOf(e.ref, reports) : null;
    const topic: ChronTopic = report ? reportTopic(report) : e.ref ? refTopic(e.ref) : (e.topic ?? 'town');
    out.push({ key: `${e.at}:${i}`, at: e.at, topic, head: e, rest: [], report });
  }
  return out;
}

/** События по дням: день — ключ `dayOf`, внутри дня — новые вперёд, как в летописи. */
export function byDay<T extends { at: number }>(items: readonly T[], dayOf: (at: number) => number): { day: number; at: number; items: T[] }[] {
  const days: { day: number; at: number; items: T[] }[] = [];
  for (const it of items) {
    const d = dayOf(it.at);
    const last = days[days.length - 1];
    if (last && last.day === d) last.items.push(it);
    else days.push({ day: d, at: it.at, items: [it] });
  }
  return days;
}
