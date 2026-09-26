// Слова для журнала. Отчёт на экране — следующий шаг; здесь только то, что
// нужно тестам и отладке: одно событие — одна строка по-русски.
import { PHASE_PIP } from './config';
import { PHASES, type BattleEvent, type PhaseId, type PipId, type ResultReason, type Sector, type Side } from './types';

export const SECTOR_NAME: Record<Sector, string> = {
  A: 'левый фланг',
  B: 'центр',
  C: 'правый фланг',
  D: 'левый тыл',
  E: 'тыл центра',
  F: 'правый тыл',
  R: 'резерв',
};

export const PHASE_NAME: Record<PhaseId, string> = {
  ranged: 'стрелковая фаза',
  approach: 'сближение',
  clash: 'сшибка',
  lines: 'бой линий',
  flanking: 'обходы',
  reserve: 'ввод резерва',
  morale: 'падение морали',
  retreat: 'отступление',
  pursuit: 'преследование',
};

export const SIDE_NAME: Record<Side, string> = { attacker: 'нападающие', defender: 'обороняющиеся' };

/** В каких фазах работает отметка — словами, из `PHASE_PIP`: «стрелковая фаза и сближение». */
export const pipPhases = (pip: PipId): string => {
  const names = PHASES.filter((p) => PHASE_PIP[p] === pip).map((p) => PHASE_NAME[p]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}` : (names[0] ?? '');
};

/** Бросок с отметками словами: «7» или «4+2». */
const dieText = (roll: number, pips: number): string => (pips > 0 ? `${roll}+${pips}` : `${roll}`);

/** Чем кончился бой — словами, а не идентификатором. */
export const REASON_NAME: Record<ResultReason, string> = {
  morale: 'мораль рухнула',
  annihilated: 'перебиты на месте',
  losses: 'размен',
  draw: 'разошлись',
};

/**
 * Строка журнала. `us` — сторона игрока: тогда стороны называются «наши» и
 * «чужие», а не «нападающие» и «обороняющиеся». Игрок читает журнал про себя,
 * а не про абстрактные стороны; тестам и отладке `us` не нужен.
 */
export function describeEvent(e: BattleEvent, us?: Side): string {
  const name = (side: Side): string => (us ? (side === us ? 'наши' : 'чужие') : SIDE_NAME[side]);
  const who = 'side' in e ? name(e.side) : '';
  switch (e.id) {
    case 'phase-start':
      return `— ${PHASE_NAME[e.phase]}`;
    case 'dice': {
      const [a, b] = us === 'defender' ? (['defender', 'attacker'] as const) : (['attacker', 'defender'] as const);
      return `кость: ${name(a)} ${dieText(e.rolls[a], e.pips[a])}, ${name(b)} ${dieText(e.rolls[b], e.pips[b])}`;
    }
    case 'volley':
      return `${who}: лучники выбили ${e.losses} до столкновения`;
    case 'spears-held':
      return `${who}: копейщики (${SECTOR_NAME[e.sector]}) остановили кавалерийский удар: конница потеряла ${e.cavalryLost}, копья — ${e.spearsLost}`;
    case 'cavalry-broke-archers':
      return `${who}: конница вырубила лучников (${SECTOR_NAME[e.target]}): ${e.archersLost} потерь`;
    case 'cavalry-intercepted':
      return `${who}: конницу перехватили на подходе к ${SECTOR_NAME[e.target]}`;
    case 'flank-turned':
      return `${who}: ${SECTOR_NAME[e.sector]} обойдён`;
    case 'sector-collapsed':
      return `${who}: ${SECTOR_NAME[e.sector]} смят`;
    case 'sector-broken':
      return `${who}: ${SECTOR_NAME[e.sector]} сломался — бегут`;
    case 'panic-spread':
      return `${who}: паника перекинулась — ${SECTOR_NAME[e.from]} → ${SECTOR_NAME[e.to]}`;
    case 'ranged-lost':
      return `${who}: проиграли перестрелку — потеряли ${e.losses} против ${e.enemyLosses}`;
    case 'rear-reached':
      return `${who}: тыл вскрыт (${SECTOR_NAME[e.sector]})`;
    case 'reserve-committed':
      return `${who}: резерв (${e.men}) вошёл в ${SECTOR_NAME[e.sector]}`;
    case 'infantry-shifted':
      return `${who}: пехота (${e.men}) сдвинулась на ${SECTOR_NAME[e.to]}`;
    case 'archers-kiting':
      return `${who}: лучники (${SECTOR_NAME[e.sector]}) держат дистанцию`;
    case 'depth':
      return `${who}: ${e.row === 'strike' ? `обход у ${SECTOR_NAME[e.sector]}` : SECTOR_NAME[e.sector]} шире фронта — в строю ${e.width} из ${e.men}, остальные встают на место павших`;
    case 'round':
      return `никто не дрогнул — бой идёт новым кругом, круг ${e.round}`;
    case 'rounds-out':
      return `бой шёл ${e.rounds} кругами, и не дрогнул никто — стороны расходятся`;
    case 'morale-collapsed':
      return `${who}: армия сломалась — бегут сектора весом ${Math.round(e.brokenShare * 100)}% (мораль ${e.morale})`;
    case 'annihilated':
      return `${who}: перебиты`;
    case 'outfought':
      return `${who}: проиграли размен — сохранили ${e.kept}% против ${e.enemyKept}%`;
    case 'retreat':
      return `${who}: ${e.orderly ? 'отходят' : 'бегут'}`;
    case 'pursuit':
      return `${who}: преследование добило ${e.losses}`;
    case 'result':
      if (e.winner === 'draw') return 'ничья: стороны разошлись';
      return e.pyrrhic
        ? `победа с непомерными потерями: ${name(e.winner)} удержали поле, но потеряли больше противника (${REASON_NAME[e.reason]})`
        : `победа: ${name(e.winner)} — ${REASON_NAME[e.reason]}`;
  }
}
