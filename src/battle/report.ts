// Отчёт строится из журнала, а не из чисел. Событие, которого нет в журнале, в
// отчёт не попадёт — поэтому новая механика обязана писать своё событие (раздел 14
// документа). Модуль живёт в `battle/`: он ничего не знает ни про React, ни про
// состояние игры, и сервер сможет собрать тот же отчёт у себя.
import { EVENT_MIN } from './config';
import { SECTOR_NAME } from './log';
import type { BattleEvent, BattleResult, Side, Verdict } from './types';

/** Строка «ключевых событий»: чем объясняется исход. */
export interface ReportLine {
  icon: string;
  text: string;
  /** Хорошо для нас или плохо. */
  good: boolean;
  tick: number;
}

export interface BattleSummary {
  /** Исход глазами стороны `us`: три категории плюс ничья. */
  verdict: Verdict;
  title: string;
  /** Одна фраза о том, чем кончилось. */
  reason: string;
  /** Ключевые события словами, по времени. */
  keys: ReportLine[];
}

export const VERDICT_TITLE: Record<Verdict, string> = {
  victory: 'ПОБЕДА',
  pyrrhic: 'ПОБЕДА НЕПОМЕРНОЙ ЦЕНОЙ',
  defeat: 'ПОРАЖЕНИЕ',
  draw: 'НИЧЬЯ',
};

/** Наша сторона или чужая — отчёт пишется от лица игрока, а не судьи. */
export const ourWord = (side: Side, us: Side): string => (side === us ? 'наши' : 'чужие');

/**
 * Притяжательное по роду слова, к которому оно относится. Без этого выходит
 * «Чужие конница вырубила лучников»: отчёт должен читаться, а не собираться.
 */
type Gender = 'm' | 'f' | 'pl';
const MINE: Record<Gender, string> = { m: 'Наш', f: 'Наша', pl: 'Наши' };
const THEIRS: Record<Gender, string> = { m: 'Чужой', f: 'Чужая', pl: 'Чужие' };
const own = (side: Side, us: Side, g: Gender): string => (side === us ? MINE[g] : THEIRS[g]);

/** Сколько строк ключевых событий держит отчёт: больше десятка никто не читает. */
export const KEYS_MAX = 7;

const line = (e: BattleEvent, icon: string, text: string, good: boolean): ReportLine => ({
  icon,
  text,
  good,
  tick: e.tick,
});

/**
 * Одно событие журнала — одна строка отчёта от лица стороны `us`. null — событие
 * служебное или слишком мелкое, чтобы объяснять им исход.
 */
function keyLine(e: BattleEvent, us: Side): ReportLine | null {
  const mine = 'side' in e && e.side === us;
  switch (e.id) {
    case 'volley':
      if (e.losses < EVENT_MIN) return null;
      return line(e, '🏹', `${own(e.side, us, 'pl')} лучники выбили ${e.losses} до столкновения.`, mine);
    case 'ranged-lost':
      return line(
        e,
        '🎯',
        `${own(e.side, us, 'pl')} проиграли перестрелку: потеряли ${e.losses} против ${e.enemyLosses} — в рукопашную пошли с просевшей моралью.`,
        !mine,
      );
    case 'spears-held':
      return line(
        e,
        '🔱',
        `${own(e.side, us, 'pl')} копейщики (${SECTOR_NAME[e.sector]}) остановили кавалерийский удар: конница потеряла ${e.cavalryLost} против ${e.spearsLost}.`,
        mine,
      );
    case 'cavalry-broke-archers':
      return line(
        e,
        '🐎',
        `${own(e.side, us, 'f')} конница вырубила лучников (${SECTOR_NAME[e.target]}): ${e.archersLost} потерь.`,
        mine,
      );
    case 'cavalry-intercepted':
      return line(
        e,
        '🛑',
        `${mine ? 'Нашу' : 'Чужую'} конницу перехватили на подходе к ${SECTOR_NAME[e.target]}.`,
        !mine,
      );
    case 'flank-turned':
      return line(e, '↩️', `${own(e.side, us, 'm')} ${SECTOR_NAME[e.sector]} обойдён — удар пришёл сбоку.`, !mine);
    case 'rear-reached':
      return line(
        e,
        '⚑',
        mine
          ? `Противник дошёл до нашего тыла (${SECTOR_NAME[e.sector]}).`
          : `Мы дошли до их тыла (${SECTOR_NAME[e.sector]}).`,
        !mine,
      );
    case 'sector-broken':
      return line(e, '💔', `${own(e.side, us, 'm')} ${SECTOR_NAME[e.sector]} сломался — бойцы побежали.`, !mine);
    case 'reserve-committed':
      return line(e, '🚩', `${own(e.side, us, 'm')} резерв (${e.men}) вошёл в ${SECTOR_NAME[e.sector]}.`, mine);
    case 'morale-collapsed':
      return line(
        e,
        '🏳️',
        `${own(e.side, us, 'pl')} сломались: бегущие сектора весили ${Math.round(e.brokenShare * 100)}% армии.`,
        !mine,
      );
    case 'annihilated':
      return line(e, '☠️', `${own(e.side, us, 'pl')} перебиты.`, !mine);
    case 'outfought':
      return line(
        e,
        '⚖️',
        `${own(e.side, us, 'pl')} проиграли размен: сохранили ${e.kept}% против ${e.enemyKept}%.`,
        !mine,
      );
    case 'pursuit':
      return line(e, '🏇', `Преследуя, ${ourWord(e.side, us)} добили ${e.losses}.`, mine);
    default:
      // phase-start, sector-collapsed, panic-spread, infantry-shifted, archers-kiting,
      // retreat, result — они есть в полном журнале, но исход объясняют плохо.
      return null;
  }
}

/** Чем кончилось — одной фразой, из причины и цены. */
function reasonText(r: BattleResult, us: Side, verdict: Verdict): string {
  const our = r.sides[us].total;
  const foe = r.sides[us === 'attacker' ? 'defender' : 'attacker'].total;
  if (verdict === 'draw') return 'Ни одна сторона не сломала другую — разошлись.';
  const won = verdict !== 'defeat';
  const cost = `Потеряно ${our.losses} из ${our.initial}, у противника — ${foe.losses} из ${foe.initial}.`;
  if (verdict === 'pyrrhic') return `Поле осталось за нами, но заплачено дороже, чем взято. ${cost}`;
  switch (r.reason) {
    case 'annihilated':
      return won ? `Противник перебит на месте. ${cost}` : `Отряд перебит. ${cost}`;
    case 'morale':
      return won
        ? `Чужие сектора побежали один за другим, и армия рассыпалась. ${cost}`
        : `Наши сектора побежали один за другим, и строй рассыпался. ${cost}`;
    default:
      return won ? `Размен вышел в нашу пользу. ${cost}` : `Размен вышел не в нашу пользу. ${cost}`;
  }
}

/**
 * Ключевые события: по одному на вид, самое весомое из своего вида, по времени.
 * Отчёт должен объяснять исход, а не пересказывать журнал целиком — полный
 * журнал показывается отдельно, по фазам.
 */
export function summarize(r: BattleResult, us: Side): BattleSummary {
  const weight = (e: BattleEvent): number =>
    e.id === 'volley' ? e.losses : e.id === 'cavalry-broke-archers' ? e.archersLost : e.id === 'pursuit' ? e.losses : 0;

  // Одно событие каждого рода на сторону — иначе в отчёте десять «сектор сломался».
  // У видов с весом остаётся самое крупное событие, у прочих — первое по времени.
  const byKey = new Map<string, { line: ReportLine; w: number }>();
  for (const e of r.log) {
    const l = keyLine(e, us);
    if (!l) continue;
    const key = `${e.id}:${'side' in e ? e.side : ''}`;
    const w = weight(e);
    const prev = byKey.get(key);
    if (!prev || w > prev.w) byKey.set(key, { line: l, w });
  }

  const keys = [...byKey.values()]
    .map((v) => v.line)
    .sort((a, b) => a.tick - b.tick)
    .slice(0, KEYS_MAX);

  const verdict = r.sides[us].verdict;
  return { verdict, title: VERDICT_TITLE[verdict], reason: reasonText(r, us, verdict), keys };
}
