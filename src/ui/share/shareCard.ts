// Карточка «Поделиться» (docs/feed.md, раздел 3): итог боя, взятый город, место в рейтинге — заголовок, строки карточки
// и текст сообщения. Числа — те же, что на экране, из тех же функций: итог боя — `summarize`/`beastSummary`, как в
// донесении (`ReportNew`); очки и мощь — строка рейтинга сервера (правило 18). Имена пишут игроки, поэтому склонять их
// нельзя: в тексте они стоят в кавычках после слова, к которому относятся.
import { summarize } from '@/battle';
import { beastSummary } from '@/game/battle/beasts';
import { num } from '@/game/num';
import type { Report } from '@/world/types';
import type { RatingRow } from '@/net/rating';
import { cityOr } from '../../../netlify/lib/contract';
import { plural } from '@/ui/parts/plural';

export type ShareKind = 'battle' | 'city' | 'rating';

export interface ShareCard {
  kind: ShareKind;
  /** Крупно: исход, «Город взят», место. */
  head: string;
  /** Кто и с кем. */
  title: string;
  rows: { label: string; value: string }[];
  /** Текст сообщения и подпись истории. */
  text: string;
}

const other = (side: 'attacker' | 'defender'): 'attacker' | 'defender' => (side === 'attacker' ? 'defender' : 'attacker');

/** Место словами: «1-е место». */
export const placeText = (place: number): string => `${place}-е место`;

/** Взят ли город этим донесением: отчёт о падении в войне между игроками (`LocalWorld.warFall`). */
export const isTakenCity = (r: Report): boolean => r.won && /^war-.+-fall$/.test(r.id);

/**
 * Итог боя. Боя с журналом нет (разведка, поддержка, падение голодом) — карточки нет: делиться нечем, кроме взятого
 * города (`cityCard`).
 */
export function battleCard(report: Report, myCity: string): ShareCard | null {
  const rec = report.battle;
  if (!rec) return null;
  const sum = beastSummary(summarize(rec.result, rec.us), rec.beasts, rec.us);
  const ours = rec.result.sides[rec.us].total;
  const foes = rec.result.sides[other(rec.us)].total;
  const head = sum.title.charAt(0) + sum.title.slice(1).toLowerCase();
  const me = cityOr(myCity);
  return {
    kind: 'battle',
    head,
    title: `«${me}» и «${report.target.name}»`,
    rows: [
      { label: 'Наши потери', value: `${num(ours.losses)} из ${num(ours.initial)}` },
      { label: 'Потери врага', value: `${num(foes.losses)} из ${num(foes.initial)}` },
    ],
    text: `Сошлись в бою «${me}» и «${report.target.name}». ${head}. Наши потери ${num(ours.losses)}, у врага ${num(foes.losses)}.`,
  };
}

/** Взятый город: чей и кто взял. */
export function cityCard(report: Report, myCity: string, ruler: string): ShareCard | null {
  if (!isTakenCity(report)) return null;
  const me = cityOr(myCity);
  const rows = [{ label: 'Взял', value: `«${me}», правитель ${ruler}` }];
  if (report.led) rows.push({ label: 'Уведено', value: num(report.led) });
  return {
    kind: 'city',
    head: 'Город взят',
    title: `«${report.target.name}»`,
    rows,
    text: `Пал город «${report.target.name}». Взял его «${me}», правитель ${ruler}.`,
  };
}

/** Своё место в рейтинге. */
export function ratingCard(row: RatingRow): ShareCard {
  const city = cityOr(row.city);
  return {
    kind: 'rating',
    head: placeText(row.place),
    title: `«${city}»`,
    rows: [
      { label: 'Очки', value: num(row.points) },
      { label: 'Мощь', value: num(row.power) },
      { label: 'Победы', value: num(row.won) },
      { label: 'Взято городов', value: num(row.taken) },
    ],
    text: `«${city}» на ${row.place}-м месте в рейтинге TRIBE: ${num(row.points)} ${plural(row.points, 'очко', 'очка', 'очков')}.`,
  };
}

/** Карточка донесения: взятый город важнее боя, которым его взяли. */
export const reportCard = (report: Report, myCity: string, ruler: string): ShareCard | null =>
  cityCard(report, myCity, ruler) ?? battleCard(report, myCity);
