// Такты смысла ролика — общий план, сшибка, перелом, развязка (docs/gfx.md, «Такты»). Чистые, без three.
//
// Камера ведёт смысл боя, а не просто держит строи в кадре (слово владельца, задание ГФ-1): что показать и когда —
// решает журнал. Такт — мгновение на часах ролика и место, куда смотреть: сторона и сектор. Где этот сектор стоит на
// поле, знает план места (поле, стена, лагерь); такты его не знают и потому общие для любого места боя.
//
//   общий план — с первой секунды: обе армии строем, залпы, сближение;
//   сшибка     — первая фаза натиска (`clash`), полоса, где в ней потеряли больше всех;
//   перелом    — первое, после чего бой пошёл к исходу: сектор будущего побеждённого побежал, его обошли во фланг или
//                в тыл, конница вырубила его лучников; нет такого события между сшибкой и развязкой — перелома нет;
//   развязка   — сторона сломана (`SideResult.brokenAt`) и бежит, победитель гонит; без слома — конец сечи.
//
// Своего суждения об исходе у тактов нет: победитель — итог ядра (`BattleResult.winner`), события — журнал.
import { laneOf, type Cast, type Mark } from '@/battle/replay';
import { FRONT, type BattleResult, type Lane, type Sector, type Side } from '@/battle/types';
import { castTimeOfTick, castToReel, type ReelTiming } from './clock';

export type BeatId = 'overview' | 'clash' | 'turn' | 'outcome';
export const BEATS: readonly BeatId[] = ['overview', 'clash', 'turn', 'outcome'];

/** Куда смотреть: сектор стороны; полоса — его же (у резерва полосы нет). */
export interface BeatFocus {
  side: Side;
  sector: Sector;
  lane: Lane | null;
}

export interface Beat {
  id: BeatId;
  /** С какой секунды ролика. */
  at: number;
  focus: BeatFocus | null;
  /** Событие журнала, на котором стоит такт (перелом); у прочих — нет. */
  mark: Mark['id'] | null;
}

/** Перелом не ближе этого к сшибке и к развязке: иначе это не отдельный такт, а тот же кадр. */
export const TURN_GAP = 1.5;

const other = (s: Side): Side => (s === 'attacker' ? 'defender' : 'attacker');

/**
 * Побеждённый — сторона, не удержавшая поле по итогу ядра. Ничья — та, что потеряла большую долю себя; поровну —
 * побеждённого нет.
 */
export function loserOf(result: BattleResult): Side | null {
  if (result.winner !== 'draw') return other(result.winner);
  const share = (s: Side): number => result.sides[s].total.losses / Math.max(1, result.sides[s].total.initial);
  const a = share('attacker');
  const d = share('defender');
  return a === d ? null : a > d ? 'attacker' : 'defender';
}

/** Полоса, где в первой фазе натиска потеряли больше всех (обе стороны вместе). Нет потерь — середина. */
function clashLane(cast: Cast): Lane {
  const span = cast.spans.find((s) => s.phase === 'clash');
  const lost: number[] = [0, 0, 0];
  if (span?.bySector) {
    for (const side of ['attacker', 'defender'] as const) {
      for (const lane of [0, 1, 2] as Lane[]) {
        // Полоса `l` наших стоит против полосы `2 − l` чужих (`facing` ядра): считаем по полосе нашей стороны.
        const l = side === cast.us ? lane : ((2 - lane) as Lane);
        lost[l] += span.bySector[side]?.[FRONT[lane]] ?? 0;
      }
    }
  }
  let best: Lane = 1;
  for (const l of [0, 2] as Lane[]) if (lost[l] > lost[best]) best = l;
  return best;
}

/** События, которые ломают бой: побежал сектор, обошли во фланг или в тыл, конница вырубила лучников. */
const TURNS: readonly Mark['id'][] = ['sector-broken', 'flank-turned', 'rear-reached', 'cavalry-broke-archers'];

/** Сторона, которой событие ударило, — та, что от него проиграла. */
function hitSide(m: Mark): Side {
  // У обхода и выхода в тыл `side` — обойдённый; у конницы по лучникам `side` — бившие, а лучники — чужие.
  return m.id === 'cavalry-broke-archers' ? other(m.side) : m.side;
}

/** Такты боя на часах ролика. Тот же журнал — те же такты. */
export function beatsOf(cast: Cast, result: BattleResult, tm: ReelTiming): Beat[] {
  const us = cast.us;
  const loser = loserOf(result);
  const clash = cast.spans.find((s) => s.phase === 'clash');
  const clashAt = castToReel(tm, clash ? clash.t0 : tm.castIntro);
  const lane = clashLane(cast);
  const out: Beat[] = [
    { id: 'overview', at: 0, focus: null, mark: null },
    { id: 'clash', at: clashAt, focus: { side: us, sector: FRONT[lane], lane }, mark: null },
  ];

  // Развязка: слом побеждённого — с того тика, где ядро его сломало; без слома — конец сечи.
  const tick = loser ? result.sides[loser].brokenAt : null;
  const outcomeAt = tick !== null ? castToReel(tm, castTimeOfTick(cast, tick)) : tm.melee[1];
  const outcome: Beat = { id: 'outcome', at: Math.max(outcomeAt, clashAt + TURN_GAP), focus: loser ? { side: loser, sector: 'B', lane: 1 } : null, mark: null };

  // Перелом — первое ломающее событие против побеждённого между сшибкой и развязкой.
  if (loser) {
    const turn = cast.marks.find((m) => {
      if (!TURNS.includes(m.id) || hitSide(m) !== loser || !m.sector) return false;
      const at = castToReel(tm, m.t);
      return at > clashAt + TURN_GAP && at < outcome.at - TURN_GAP;
    });
    if (turn && turn.sector) {
      const side = hitSide(turn);
      out.push({ id: 'turn', at: castToReel(tm, turn.t), focus: { side, sector: turn.sector, lane: laneOf(turn.sector) }, mark: turn.id });
    }
  }
  out.push(outcome);
  return out;
}

/** Такт на секунде ролика: последний начавшийся. */
export function beatAt(beats: readonly Beat[], t: number): Beat {
  let cur = beats[0];
  for (const b of beats) if (b.at <= t) cur = b;
  return cur;
}
