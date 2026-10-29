// Окно города или села у отряда бродяги (ПН-6, docs/gdd/path_of_sword.md, 3.3.4, 3.4.3, 3.7.1, 3.7.7, 4.2): в вольном городе — постой,
// рынок с ключом города (привоз, цена и нажим — правила рынка лорда, `sim/market`), найм по ценам Казарм с учениями, заработки
// промыслами во дворах; у села — хлеб по цене села и найм. Числа — функциями дверей (правило 18): цена партии — `marketLot`, найм —
// `sim/roamtown.hireBill`, заработки — `sim/bandearn`. Точку называет мир бродяги (`WorldApi.roamHere`). Своим куском карты бродяги.
import { useEffect, useState } from 'react';
import type { GoodId, TroopId } from '@/game/types';
import { useGame } from '@/game/store';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { MINIGAMES } from '@/game/data/minigames';
import { buyGoods, marketLot, marketOffer, ownOf, sellGoods } from '@/game/sim/market';
import { boardedAt, boardPerDay, buyVillageFood, hireAt, hireBill, villageBlock, villageCost, villageLeftAt, type TownPoint } from '@/game/sim/roamtown';
import { earnBlock, earnGold, earnHaul, settleEarn } from '@/game/sim/bandearn';
import { villageFoodPrice, townKeyOf } from '@/game/townrules';
import { roamDoor } from '@/game/roamlazy';
import { num } from '@/game/num';
import { worldApi } from '@/world/api';
import { worldNow } from '@/world/store';
import { pointKindWords } from '@/world/roampoints';
import { realSpan } from '@/game/span';
import { useTrades } from '@/ui/trades';
import { Icon } from '@/ui/icons/Icon';

type Tab = 'market' | 'hire' | 'earn';

export function RoamTown({ onClose }: { onClose: () => void }) {
  const [p, setP] = useState<TownPoint | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('market');
  useEffect(() => {
    void worldApi()
      .roamHere?.()
      .then((pt) => setP(pt && pt.kind !== 'vataga' ? { id: pt.id, kind: pt.kind, x: pt.x, y: pt.y, name: pt.name, tier: pt.tier } : null));
  }, []);
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const run = (fn: Parameters<typeof act>[0]): void => {
    if (act(fn)) void roamDoor()?.flushBook();
  };
  const r = s.roam;
  const now = worldNow();
  const town = p?.kind === 'town';
  const board = r ? boardedAt(r, now) : null;
  const tabs: [Tab, string][] = town ? [['market', 'Рынок'], ['hire', 'Найм'], ['earn', 'Заработки']] : [['market', 'Хлеб'], ['hire', 'Найм']];
  return (
    <div className="am-wrap" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel nx-bpanel nx-am">
        <div className="nx-bhead">
          <span className="nx-bico">
            <Icon name="ui-scales" />
          </span>
          <div className="nx-btitle">
            <b className="one-line">{p ? p.name : 'Город'}</b>
            <span className="nx-blvl">{p ? `${pointKindWords(p)} · кошель ${Math.floor(r?.purse ?? 0)}` : ''}</span>
          </div>
          <button className="nx-bclose" onClick={onClose} aria-label="Закрыть">
            <Icon name="ui-close" />
          </button>
        </div>
        <div className="nx-am-body er-confirm">
          {p === undefined && <p className="nx-tnote">Смотрим, что рядом…</p>}
          {p === null && <p className="nx-tnote">Рядом нет ни вольного города, ни села: встань в их клетке или у стен.</p>}
          {p && r && (
            <>
              {town && (
                <p className="nx-tnote">
                  {board ? `На постое: ${num(boardPerDay(r), 1)} золота в игр. день за отряд.` : 'Лагерем у стен — постоя нет; рынок и найм — те же.'}
                </p>
              )}
              <div className="roam-legs roam-tabs">
                {tabs.map(([id, name]) => (
                  <button key={id} className={`roam-leg${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>
                    <b>{name}</b>
                    <span />
                  </button>
                ))}
              </div>
              {tab === 'market' && town && <Market p={p} now={now} run={run} />}
              {tab === 'market' && !town && <Bread p={p} now={now} run={run} />}
              {tab === 'hire' && <Hire p={p} now={now} run={run} />}
              {tab === 'earn' && town && <Earn p={p} now={now} />}
            </>
          )}
        </div>
        <div className="nx-am-foot">
          <button className="nx-go nx-go-ghost" onClick={onClose}>
            Назад
          </button>
        </div>
      </div>
    </div>
  );
}

type Run = (fn: (s: ReturnType<typeof useGame.getState>['s']) => string | null) => void;

/** Рынок вольного города: что привезли, почём, сколько у отряда; купить и продать по одной и по десять. */
function Market({ p, now, run }: { p: TownPoint; now: number; run: Run }) {
  const s = useGame((g) => g.s);
  const key = townKeyOf(p.x, p.y);
  const goods = marketOffer(s, now, key);
  if (goods.length === 0) return <p className="nx-tnote">Рынок пуст до нового привоза.</p>;
  return (
    <div className="roam-legs">
      {goods.map((g) => {
        const have = ownOf(s, g, key);
        const buy = marketLot(s, g, 1, now, key);
        const sell = marketLot(s, g, -1, now, key);
        return (
          <div key={g.id} className="roam-leg roam-row">
            <b>{g.name}</b>
            <span className="roam-qty">
              {[1, 10].map((n) => (
                <button key={`b${n}`} className="nx-mbtn" onClick={() => run((st) => buyGoods(st, g.id as GoodId, n, worldNow(), key))} aria-label={`Купить ${n}`}>
                  +{n}
                </button>
              ))}
              {have > 0 &&
                [1, 10].map((n) => (
                  <button key={`s${n}`} className="nx-mbtn" onClick={() => run((st) => sellGoods(st, g.id as GoodId, Math.min(n, have), worldNow(), key))} aria-label={`Продать ${n}`}>
                    −{n}
                  </button>
                ))}
            </span>
            <small className="muted">
              купить {buy.gold}, продать {sell.gold} · в обозе {have}
            </small>
          </div>
        );
      })}
    </div>
  );
}

/** Хлеб села: цена села, сколько осталось из запаса дня. */
function Bread({ p, now, run }: { p: TownPoint; now: number; run: Run }) {
  const s = useGame((g) => g.s);
  const left = Math.floor(villageLeftAt(s.roam!, p.id, now));
  return (
    <div className="roam-legs">
      <p className="nx-tnote">
        Хлеб по {num(villageFoodPrice(), 2)} золота, у села сегодня {left}; в обозе {Math.floor(s.roam!.cargo.food ?? 0)}.
      </p>
      {[10, 50].map((n) => {
        const why = villageBlock(s, p, n, now);
        return (
          <button key={n} className="roam-leg" disabled={why !== null} onClick={() => run((st) => buyVillageFood(st, p, n, worldNow()))}>
            <b>Купить {n}</b>
            <span>
              <Icon name="res-gold" />
              {villageCost(n)}
            </span>
            {why && <small className="muted">{why}</small>}
          </button>
        );
      })}
    </div>
  );
}

/** Найм по ценам Казарм: припас и снаряжение из обоза, недостающее — у точки; учения, пока отряд стоит у неё. */
function Hire({ p, now, run }: { p: TownPoint; now: number; run: Run }) {
  const s = useGame((g) => g.s);
  const drill = s.roam?.drill ?? [];
  return (
    <div className="roam-legs">
      {drill.length > 0 && (
        <p className="nx-tnote">
          На учениях: {drill.map((d) => `${TROOP_BY_ID[d.kind].name.toLowerCase()} ${d.n}`).join(', ')} — идут, пока отряд стоит у точки найма.
        </p>
      )}
      {TROOP_IDS.map((id: TroopId) => {
        const bill = hireBill(s, p, id, 1, now);
        return (
          <button key={id} className="roam-leg" disabled={bill.block !== null} onClick={() => run((st) => hireAt(st, p, id, 1, worldNow()))}>
            <b>Нанять: {TROOP_BY_ID[id].name.toLowerCase()}</b>
            <span>
              <Icon name="res-gold" />
              {bill.gold}
            </span>
            <small className="muted">{bill.block ?? `учения ${realSpan(Math.ceil(bill.ms / 1000))}`}</small>
          </button>
        );
      })}
    </div>
  );
}

/** Заработки: промыслы во дворах города — золото себе, хозяина не касается. Энергия — та же, что у промыслов. */
function Earn({ p, now }: { p: TownPoint; now: number }) {
  const s = useGame((g) => g.s);
  const play = useTrades((t) => t.play);
  const why = earnBlock(s, p, now);
  return (
    <div className="roam-legs">
      {MINIGAMES.map((g) => {
        const top = earnGold(earnHaul(p.tier as 1 | 2 | 3, g.id, 1));
        return (
          <button
            key={g.id}
            className="roam-leg"
            disabled={why !== null}
            onClick={() => play(g.id, { name: p.name, top, settle: (st, outing, at, score) => settleEarn(st, outing, p, at, score) })}
          >
            <b>{g.name}</b>
            <span>
              <Icon name="res-gold" />
              до {top}
            </span>
            <small className="muted">{why ?? g.goal}</small>
          </button>
        );
      })}
    </div>
  );
}
