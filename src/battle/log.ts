// Слова для журнала. Отчёт на экране — следующий шаг; здесь только то, что
// нужно тестам и отладке: одно событие — одна строка по-русски.
import type { BattleEvent, PhaseId, Sector, Side } from './types';

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
  clash: 'первое столкновение',
  lines: 'бой линий',
  flanking: 'обходы',
  reserve: 'ввод резерва',
  morale: 'падение морали',
  retreat: 'отступление',
  pursuit: 'преследование',
};

export const SIDE_NAME: Record<Side, string> = { attacker: 'нападающие', defender: 'обороняющиеся' };

export function describeEvent(e: BattleEvent): string {
  const who = 'side' in e ? SIDE_NAME[e.side] : '';
  switch (e.id) {
    case 'phase-start':
      return `— ${PHASE_NAME[e.phase]}`;
    case 'volley':
      return `${who}: лучники нанесли ${e.losses} потерь до столкновения`;
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
    case 'rear-reached':
      return `${who}: противник дошёл до тыла (${SECTOR_NAME[e.sector]})`;
    case 'reserve-committed':
      return `${who}: резерв (${e.men}) вошёл в ${SECTOR_NAME[e.sector]}`;
    case 'infantry-shifted':
      return `${who}: пехота (${e.men}) сдвинулась на ${SECTOR_NAME[e.to]}`;
    case 'archers-kiting':
      return `${who}: лучники (${SECTOR_NAME[e.sector]}) держат дистанцию`;
    case 'morale-collapsed':
      return `${who}: мораль рухнула (${e.morale})`;
    case 'annihilated':
      return `${who}: перебиты`;
    case 'outfought':
      return `${who}: проиграли размен — сохранили ${e.kept}% против ${e.enemyKept}%`;
    case 'retreat':
      return `${who}: ${e.orderly ? 'отходят' : 'бегут'}`;
    case 'pursuit':
      return `${who}: преследование добило ${e.losses}`;
    case 'result':
      return e.winner === 'draw' ? 'ничья: стороны разошлись' : `победа: ${SIDE_NAME[e.winner]} (${e.reason})`;
  }
}
