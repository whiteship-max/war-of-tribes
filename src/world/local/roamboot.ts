// Открыть мир бродяги (ПН-3, docs/gdd/path_of_sword.md, 3.5.6; «Решения ПН-3») — своим куском: `world/store` зовёт его только за
// `ROAM_ON` и только в фазе бродяги.
//
// **Мир бродяги не строится, пока сервер не назвал клетку выхода.** В Telegram реестр садит отряд (`net/roster`, `seat`) и ждёт,
// пока сервер не вернёт строку отряда; строку партия кладёт одной дверью хода (`sim/roam.setMove`), и только тогда мир строится —
// вокруг отряда. Без сервера (вне Telegram, стенд, вторая вкладка) место ищет то же правило (`world/roam.placeBand`) по ключу партии,
// как замок без реестра ищет его правилом расселения сам. Мир, уже построенный для этой партии и эпохи, строится на прежнем месте:
// отряд ходит, а земля вокруг места выхода — та же (иначе каждый вход рассыпал бы разведанное).
import { useGame } from '@/game/store';
import { setMove, foodAfter, campGain } from '@/game/sim/roam';
import { ROAM_ON } from '@/game/roamflag';
import { partyNow } from '@/net/clock';
import { bandOrder, castles, rosterReady } from '@/net/roster';
import { tgInitData } from '@/telegram/webapp';
import { leaseHolder } from '@/net/session';
import { settleRandom } from '../settle';
import { placeBand, roamCell, roamSeat } from '../roam';
import { browserStorage, parseWorldSave } from './state';
import type { LocalWorldOptions } from './LocalWorld';
import { RoamWorld, type RoamPort } from './RoamWorld';

/** Дверь мира бродяги к партии и серверу. */
export function roamPort(): RoamPort {
  const s = (): ReturnType<typeof useGame.getState>['s'] => useGame.getState().s;
  // Сервер принимает приказы отряда в Telegram и только у ведущей вкладки — как и строку реестра.
  const online = Boolean(tgInitData()) && leaseHolder() !== 'other';
  return {
    band: () => (ROAM_ON && s().phase === 'roam' ? (s().roam ?? null) : null),
    apply: (m) => useGame.getState().world((st) => void setMove(st, m)),
    foodAfter: (ms, g) => foodAfter(s(), ms, g),
    campGain: (k) => campGain(s(), k),
    partyTime: () => s().time,
    ...(online ? { order: bandOrder } : {}),
  };
}

/** Построить мир бродяги поверх опций мира лорда (`openOpts` — те же реестр, война, эпоха). */
export async function bootRoamWorld(base: LocalWorldOptions): Promise<RoamWorld> {
  // В Telegram ожидание кончается только строкой отряда (`net/roster.seat`): сервер не отвечает — игра ждёт, а не ставит отряд сама.
  await rosterReady();
  const g = useGame.getState();
  if (!g.s.roam?.way) {
    const at = placeBand(settleRandom(`band:${g.s.seed}`), castles().map((c) => ({ x: c.x, y: c.y })), []);
    g.world((st) => void setMove(st, roamSeat(at, partyNow())));
  }
  const way = useGame.getState().s.roam?.way;
  // Мир этой эпохи уже стоит — на прежнем месте; нет — вокруг отряда.
  const stored = parseWorldSave(base.storage === undefined ? browserStorage.read() : (base.storage?.read() ?? null));
  const sameEra = stored && (base.era === undefined || (stored.era ?? 0) === base.era);
  const home = sameEra || !way ? undefined : roamCell(way, partyNow());
  return new RoamWorld({ ...base, ...(home ? { home } : {}) }, roamPort());
}
