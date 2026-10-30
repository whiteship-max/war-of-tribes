// Окно договоров отряда бродяги (ПН-7, docs/gdd/path_of_sword.md, 3.8 и 5.4: «Доска договоров — строка: вид, плата, аванс, срок, тир,
// риск»). Доску у стоящего отряда называет мир бродяги (`WorldApi.roamBoards`: город по привозу, кастелян раз в сутки, село при угрозе);
// условия — `sim/contracts.termsOf` → `contractrules.contractTerms`, строка — `contractrules.dealRow` (правило 18: своей арифметики у окна
// нет). Взять, отказаться, уплатить долг — двери `sim/contracts`. Своим куском карты бродяги.
import { useEffect, useState } from 'react';
import type { RoamDeal } from '@/game/types';
import { useGame } from '@/game/store';
import { roamDoor } from '@/game/roamlazy';
import { CONTRACTS_MAX, DEAL_DEFS } from '@/game/data/contracts';
import { GOOD_BY_ID } from '@/game/data/market';
import { dealRow, riskWords, settlePay, tierWord } from '@/game/contractrules';
import { debtBlock, debtTo, payDebt, refuseDeal, takeBlock, takeDeal, termsOf } from '@/game/sim/contracts';
import { realSpan, gameSpan } from '@/game/span';
import { worldApi } from '@/world/api';
import { worldNow } from '@/world/store';
import type { DealBoard, DealOffer } from '@/world/dealboard';
import { Icon } from '@/ui/icons/Icon';

type Tab = 'board' | 'held';

const WHO: Record<DealBoard['from']['who'], string> = { town: 'доска города', castellan: 'кастелян замка', village: 'староста села' };

/** Когда доска сменится — словами. */
const nextWords = (b: DealBoard, now: number): string =>
  b.from.who === 'castellan' ? `новые поручения через ${realSpan(Math.max(60, Math.ceil((b.next - now) / 1000)))}` : `новая доска через ${realSpan(Math.max(60, Math.ceil((b.next - now) / 1000)))}`;

export function RoamDeals({ onClose }: { onClose: () => void }) {
  const [boards, setBoards] = useState<DealBoard[] | null>(null);
  const [tab, setTab] = useState<Tab>('board');
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const showToast = useGame((g) => g.showToast);
  const r = s.roam;
  const held = r?.deals ?? [];
  useEffect(() => {
    void worldApi()
      .roamBoards?.()
      .then((b) => setBoards(b));
  }, [s.prestige, held.length]);
  const run = (fn: Parameters<typeof act>[0]): void => {
    if (act(fn)) void roamDoor()?.flushBook();
  };
  const now = worldNow();
  const tabs: [Tab, string][] = [
    ['board', 'Доска'],
    ['held', `Взятые · ${held.length} из ${CONTRACTS_MAX}`],
  ];
  return (
    <div className="am-wrap" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel nx-bpanel nx-am">
        <div className="nx-bhead">
          <span className="nx-bico">
            <Icon name="ui-charter" />
          </span>
          <div className="nx-btitle">
            <b className="one-line">Договоры</b>
            <span className="nx-blvl">кошель {Math.floor(r?.purse ?? 0)} · престиж {Math.round(s.prestige)}</span>
          </div>
          <button className="nx-bclose" onClick={onClose} aria-label="Закрыть">
            <Icon name="ui-close" />
          </button>
        </div>
        <div className="nx-am-body er-confirm">
          <div className="roam-legs roam-tabs">
            {tabs.map(([id, name]) => (
              <button key={id} className={`roam-leg${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>
                <b>{name}</b>
                <span />
              </button>
            ))}
          </div>
          {tab === 'board' && <Boards boards={boards} now={now} run={run} />}
          {tab === 'held' && <Held deals={held} now={now} run={run} toast={showToast} />}
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

/** Доски заказчиков у отряда: шапка заказчика (и долг — доска закрыта до уплаты), карточки предложений. */
function Boards({ boards, now, run }: { boards: DealBoard[] | null; now: number; run: Run }) {
  const s = useGame((g) => g.s);
  if (boards === null) return <p className="nx-tnote">Смотрим, кто рядом даёт договоры…</p>;
  if (boards.length === 0)
    return (
      <p className="nx-tnote">
        Договоры дают вольные города (доска — каждые 3 часа), кастеляны замков (раз в сутки) и сёла, которым грозит ватага. Встань отрядом в
        клетке заказчика или рядом.
      </p>
    );
  return (
    <div className="roam-legs">
      {boards.map((b) => {
        const debt = s.roam ? debtTo(s.roam, b.from.id) : 0;
        const why = debt > 0 ? debtBlock(s, b.from, now) : null;
        return (
          <section key={b.from.id} className="roam-deal-board">
            <header className="roam-deal-from">
              <b>{b.from.name}</b>
              <small>
                {WHO[b.from.who]} · {nextWords(b, now)}
              </small>
            </header>
            {debt > 0 && (
              <div className="roam-deal-debt">
                <span>Долг неустойки {debt} — доска закрыта до уплаты.</span>
                <button className="nx-go" disabled={why !== null} onClick={() => run((st) => payDebt(st, b.from, worldNow()))}>
                  Уплатить {debt}
                </button>
                {why && <small className="muted">{why}</small>}
              </div>
            )}
            {b.offers.length === 0 && <p className="nx-tnote">Сейчас поручений нет.</p>}
            {debt === 0 && b.offers.map((o) => <Offer key={o.id} o={o} now={now} run={run} />)}
          </section>
        );
      })}
    </div>
  );
}

/** Карточка предложения: вид и тир, цель, плата · аванс · срок · риск (`dealRow`), груз; «Взять» или причина. */
function Offer({ o, now, run }: { o: DealOffer; now: number; run: Run }) {
  const s = useGame((g) => g.s);
  const row = dealRow(termsOf(o));
  const why = takeBlock(s, o, now);
  return (
    <article className="roam-deal">
      <div className="roam-deal-top">
        <b>{row.name}</b>
        <span className="roam-deal-tier">{row.tier}</span>
      </div>
      <small className="roam-deal-aim">{aimWords(o)}</small>
      <dl className="roam-deal-facts">
        <div>
          <dt>
            <Icon name="res-gold" />
          </dt>
          <dd>{row.pay}</dd>
        </div>
        <div>
          <dt>
            <Icon name="ui-pouch" />
          </dt>
          <dd>{row.advance}</dd>
        </div>
        <div>
          <dt>
            <Icon name="ui-candle" />
          </dt>
          <dd>{row.term}</dd>
        </div>
        <div>
          <dt>
            <Icon name="ui-dagger" />
          </dt>
          <dd>{row.risk}</dd>
        </div>
      </dl>
      <button className="nx-go" disabled={why !== null} onClick={() => run((st) => takeDeal(st, o, worldNow()))}>
        Взять договор
      </button>
      {why && <small className="muted">{why}</small>}
    </article>
  );
}

/** Что сделать — словами по виду договора. */
function aimWords(o: Pick<DealOffer, 'kind' | 'target' | 'goods'>): string {
  switch (o.kind) {
    case 'lair':
      return `Сжечь логово «${o.target.name}» — исполнен победой.`;
    case 'vataga':
      return `Разбить ватагу «${o.target.name}» — исполнен победой.`;
    case 'head':
      return `Атаман ватаги «${o.target.name}» — исполнен победой над его ватагой.`;
    case 'defend':
      return `Стоять у села ${o.target.name}, когда придёт набег, и отбить его.`;
    case 'cargo':
      return `Довезти ${o.goods ? `${GOOD_BY_ID[o.goods.id].name.toLowerCase()}, ${o.goods.n}` : 'груз'} в ${o.target.name} — груз ляжет в обоз.`;
    case 'garrison':
      return `Стоять гарнизоном у замка ${o.target.name} весь срок.`;
    case 'scout':
      return `Встать у замка ${o.target.name} и сосчитать гарнизон.`;
  }
}

/** Взятые договоры: что осталось сделать и до какого срока, что получим при сдаче; «Отказаться» — половина неустойки. Долги. */
function Held({ deals, now, run, toast }: { deals: RoamDeal[]; now: number; run: Run; toast: (t: string) => void }) {
  const owed = useGame((g) => g.s.roam?.debts);
  const debts = owed ?? [];
  if (deals.length === 0 && debts.length === 0) return <p className="nx-tnote">Договоров нет. Возьми их на доске у заказчика.</p>;
  return (
    <div className="roam-legs">
      {deals.map((d) => (
        <article key={d.id} className="roam-deal">
          <div className="roam-deal-top">
            <b>{DEAL_DEFS[d.kind].name}</b>
            <span className="roam-deal-tier">тир {tierWord(d.tier)}</span>
          </div>
          <small className="roam-deal-aim">
            {d.from.name} — {progressWords(d, now)}
          </small>
          <small className="roam-deal-aim">
            Срок — {now < d.until ? `ещё ${realSpan(Math.ceil((d.until - now) / 1000))}` : 'вышел'}. Аванс {d.advance} получен, при сдаче — {settlePay(d)} и престиж +
            {d.fame}; {riskWords(d)}.
          </small>
          <button
            className="nx-go nx-go-ghost"
            onClick={() =>
              run((st) => {
                const why = refuseDeal(st, d.id);
                if (!why) toast(`Отказ: неустойка ${d.refuse} — долг ${d.from.name}.`);
                return why;
              })
            }
          >
            Отказаться — неустойка {d.refuse}
          </button>
        </article>
      ))}
      {debts.map((x) => (
        <div key={x.id} className="roam-deal-debt">
          <span>
            Долг {x.name}: {x.gold} — доска закрыта до уплаты у заказчика.
          </span>
        </div>
      ))}
    </div>
  );
}

/** Ход исполнения взятого договора. */
function progressWords(d: RoamDeal, now: number): string {
  if (d.kind === 'defend' && d.due !== undefined) return now < d.due ? `набег на село через ${realSpan(Math.ceil((d.due - now) / 1000))} — стой у села` : 'набег пришёл';
  if (d.kind === 'garrison') return `отстояно ${gameSpan(d.stood ?? 0)} из ${gameSpan(d.need ?? 0)} — стой у замка ${d.target.name}`;
  if (d.kind === 'cargo' && d.goods) return `довезти ${GOOD_BY_ID[d.goods.id].name.toLowerCase()}, ${d.goods.n}, в ${d.target.name}`;
  if (d.kind === 'scout') return `встать у замка ${d.target.name}`;
  return `напасть: ${d.target.name}`;
}
