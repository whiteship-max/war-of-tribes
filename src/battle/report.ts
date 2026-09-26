// Отчёт строится из журнала, а не из чисел. Событие, которого нет в журнале, в
// отчёт не попадёт — поэтому новая механика обязана писать своё событие (раздел 14
// документа). Модуль живёт в `battle/`: он ничего не знает ни про React, ни про
// состояние игры, и сервер сможет собрать тот же отчёт у себя.
import { DICE, EVENT_MIN } from './config';
import { PHASE_NAME, SECTOR_NAME } from './log';
import type { BattleEvent, BattleResult, Side, Verdict } from './types';

/** Строка «ключевых событий»: чем объясняется исход. */
export interface ReportLine {
  /**
   * Имя нарисованного значка. Стоит рядом с эмодзи, а не вместо него: значков
   * меньше, чем мест, и пока файла нет, показывается `icon`. Ядро от этого ни от
   * чего не зависит — это такая же строка данных, как и сам эмодзи.
   */
  art: string;
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

/** Насколько кость фазы легла в пользу `us`: бросок с отметками против чужого. */
const diceGap = (e: Extract<BattleEvent, { id: 'dice' }>, us: Side): number => {
  const foe: Side = us === 'attacker' ? 'defender' : 'attacker';
  return e.rolls[us] + e.pips[us] - (e.rolls[foe] + e.pips[foe]);
};

const line = (e: BattleEvent, art: string, icon: string, text: string, good: boolean): ReportLine => ({
  art,
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
    case 'dice': {
      // Удача называется, только когда разошлась хотя бы на полкости: меньшую разницу бой
      // перемалывает сам, и строка о ней объясняла бы исход тем, чем он не решался.
      const gap = diceGap(e, us);
      if (Math.abs(gap) < DICE.faces / 2) return null;
      const foe: Side = us === 'attacker' ? 'defender' : 'attacker';
      const ours = e.rolls[us] + e.pips[us];
      const theirs = e.rolls[foe] + e.pips[foe];
      return line(
        e,
        'bat-dice',
        '🎲',
        gap > 0
          ? `Удача за нами: ${PHASE_NAME[e.phase]} — кость ${ours} против ${theirs}.`
          : `Удача против нас: ${PHASE_NAME[e.phase]} — кость ${ours} против ${theirs}.`,
        gap > 0,
      );
    }
    case 'volley':
      if (e.losses < EVENT_MIN) return null;
      return line(e, 'bat-volley', '🏹', `${own(e.side, us, 'pl')} лучники выбили ${e.losses} до столкновения.`, mine);
    case 'ranged-lost':
      return line(
        e,
        'bat-ranged-lost',
        '🎯',
        `${own(e.side, us, 'pl')} проиграли перестрелку: потеряли ${e.losses} против ${e.enemyLosses} — в рукопашную пошли с просевшей моралью.`,
        !mine,
      );
    case 'spears-held':
      return line(
        e,
        'bat-spears-held',
        '🔱',
        `${own(e.side, us, 'pl')} копейщики (${SECTOR_NAME[e.sector]}) остановили кавалерийский удар: конница потеряла ${e.cavalryLost} против ${e.spearsLost}.`,
        mine,
      );
    case 'cavalry-broke-archers':
      return line(
        e,
        'bat-cavalry-broke',
        '🐎',
        `${own(e.side, us, 'f')} конница вырубила лучников (${SECTOR_NAME[e.target]}): ${e.archersLost} потерь.`,
        mine,
      );
    case 'cavalry-intercepted':
      return line(
        e,
        'bat-cavalry-stopped',
        '🛑',
        `${mine ? 'Нашу' : 'Чужую'} конницу перехватили на подходе к ${SECTOR_NAME[e.target]}.`,
        !mine,
      );
    case 'flank-turned':
      return line(e, 'bat-flank', '↩️', `${own(e.side, us, 'm')} ${SECTOR_NAME[e.sector]} обойдён — удар пришёл сбоку.`, !mine);
    case 'rear-reached':
      return line(
        e,
        'bat-rear',
        '⚑',
        mine
          ? `Противник дошёл до нашего тыла (${SECTOR_NAME[e.sector]}).`
          : `Мы дошли до их тыла (${SECTOR_NAME[e.sector]}).`,
        !mine,
      );
    case 'sector-broken':
      return line(e, 'bat-sector-broken', '💔', `${own(e.side, us, 'm')} ${SECTOR_NAME[e.sector]} сломался — бойцы побежали.`, !mine);
    case 'reserve-committed':
      return line(e, 'bat-reserve', '🚩', `${own(e.side, us, 'm')} резерв (${e.men}) вошёл в ${SECTOR_NAME[e.sector]}.`, mine);
    case 'morale-collapsed':
      return line(
        e,
        'bat-morale',
        '🏳️',
        `${own(e.side, us, 'pl')} сломались: бегущие сектора весили ${Math.round(e.brokenShare * 100)}% армии.`,
        !mine,
      );
    case 'annihilated':
      return line(e, 'bat-annihilated', '☠️', `${own(e.side, us, 'pl')} перебиты.`, !mine);
    case 'outfought':
      return line(
        e,
        'bat-outfought',
        '⚖️',
        `${own(e.side, us, 'pl')} проиграли размен: сохранили ${e.kept}% против ${e.enemyKept}%.`,
        !mine,
      );
    case 'pursuit':
      return line(e, 'bat-pursuit', '🏇', `Преследуя, ${ourWord(e.side, us)} добили ${e.losses}.`, mine);
    default:
      // phase-start, sector-collapsed, panic-spread, infantry-shifted, archers-kiting,
      // retreat, result — они есть в полном журнале, но исход объясняют плохо.
      return null;
  }
}

/**
 * Все значки отчёта, по порядку событий. Отсюда их берёт накладная арта: список
 * не переписывается вторым местом, и новое событие обязано появиться здесь же.
 */
export const BATTLE_ART: readonly string[] = [
  'bat-volley', 'bat-ranged-lost', 'bat-spears-held', 'bat-cavalry-broke', 'bat-cavalry-stopped',
  'bat-flank', 'bat-rear', 'bat-sector-broken', 'bat-reserve', 'bat-morale',
  'bat-annihilated', 'bat-outfought', 'bat-pursuit', 'bat-dice',
];

/** Чем кончилось — одной фразой, из причины и цены. */
function reasonText(r: BattleResult, us: Side, verdict: Verdict): string {
  const our = r.sides[us].total;
  const foe = r.sides[us === 'attacker' ? 'defender' : 'attacker'].total;
  const cost = `Потеряно ${our.losses} из ${our.initial}, у противника — ${foe.losses} из ${foe.initial}.`;
  // Цена стоит у всех четырёх исходов, а не у трёх. У ничьей она важна не
  // меньше: именно по ней и видно, чем кончилось перемалывание, — а «ничего
  // решающего не случилось» без чисел звучит так, будто и не было ничего.
  if (verdict === 'draw') return `Ни одна сторона не сломала другую — разошлись. ${cost}`;
  const won = verdict !== 'defeat';
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
  // У кости вес — насколько она разошлась: из всех фаз в отчёт идёт та, где удача решала сильнее всего.
  const weight = (e: BattleEvent): number =>
    e.id === 'volley'
      ? e.losses
      : e.id === 'cavalry-broke-archers'
        ? e.archersLost
        : e.id === 'pursuit'
          ? e.losses
          : e.id === 'dice'
            ? Math.abs(diceGap(e, us))
            : 0;

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
