import { useState } from 'react';
import type { GoodId } from '@/game/types';
import { useGame } from '@/game/store';
import { GOOD_BY_ID } from '@/game/data/market';
import {
  caravanProgress,
  caravanSeconds,
  marketLeft,
  marketOffer,
  marketPrice,
  marketStock,
} from '@/game/derived';
import { marketCheck } from '@/game/sim/market';
import { buyGoods, cancelCaravan } from '@/game/sim/actions';

/**
 * Рынок: за золото сюда привозят чужое добро.
 *
 * Две вкладки. Первая — закупка у проезжих торговцев, единственное, что работает
 * сегодня. Вторая оставлена под торг между игроками: он появится вместе с
 * сервером, и место под него занято сразу, чтобы потом не переезжать.
 *
 * Тупика без объяснения быть не должно: у каждой строки написано, почём, сколько
 * осталось на сегодня и почему кнопка не нажимается.
 */
type Tab = 'buy' | 'tribes';

export function Market() {
  const s = useGame((g) => g.s);
  const [tab, setTab] = useState<Tab>('buy');

  return (
    <>
      <h3>
        Казна <span className="muted">караван идёт ~{Math.round(caravanSeconds(s))} с</span>
      </h3>
      <div className="mod total">
        <span className="ico">💰</span>
        <span className="name">Золото</span>
        <span className="val pos">{Math.floor(s.gold)}</span>
      </div>
      <div className="note">
        Купленное везёт телега: она выезжает из ворот и возвращается с грузом. Пока она в пути,
        товара на складе нет. Отменишь — золото вернётся целиком.
      </div>

      <div className="tabs">
        <button className={tab === 'buy' ? 'active' : ''} onClick={() => setTab('buy')}>
          Закупка
        </button>
        <button className={tab === 'tribes' ? 'active' : ''} onClick={() => setTab('tribes')}>
          Торг с племенами
        </button>
      </div>

      {tab === 'buy' ? <BuyTab /> : <TribesTab />}
    </>
  );
}

function Caravans() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  if (s.caravans.length === 0) return null;
  return (
    <>
      <h3>
        В пути <span className="muted">телег: {s.caravans.length}</span>
      </h3>
      {s.caravans.map((c) => {
        const def = GOOD_BY_ID[c.good];
        const pct = Math.round(caravanProgress(s, c) * 100);
        const left = Math.max(0, Math.ceil(c.arriveAt - s.time));
        return (
          <div className="card" key={c.id}>
            <div className="ico">{def?.icon ?? '📦'}</div>
            <div className="body">
              <div className="title">
                {def?.name ?? 'Товар'} — {c.count}
                <span className="count">~{left} с</span>
              </div>
              <div className="desc">Уплачено {c.gold} золота. Груза на складе ещё нет.</div>
              <div className="progress">
                <div style={{ width: `${pct}%` }} />
              </div>
            </div>
            <button
              className="btn ghost"
              onClick={() => act((st) => cancelCaravan(st, c.id))}
              aria-label="Отозвать караван"
            >
              ✕
            </button>
          </div>
        );
      })}
    </>
  );
}

function BuyTab() {
  const s = useGame((g) => g.s);
  const offer = marketOffer(s);

  return (
    <>
      <Caravans />
      <h3>
        Сегодня на прилавке <span className="muted">товаров: {offer.length}</span>
      </h3>
      <div className="note">
        Ассортимент и запас меняются каждый день, а уровень рынка добавляет и то, и другое.
        Чем больше берёшь одного товара за день, тем он дороже. Купить всегда дороже, чем
        сделать самим: рынок нужен, чтобы срочно закрыть дыру, а не вместо лесопилки и кузницы.
      </div>
      {offer.length === 0 ? (
        <div className="note bad">Прилавок пуст — рынок ещё не работает.</div>
      ) : (
        offer.map((g) => <GoodRow key={g.id} good={g.id} />)
      )}
    </>
  );
}

function GoodRow({ good }: { good: GoodId }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const [count, setCount] = useState(1);
  const def = GOOD_BY_ID[good];
  const left = marketLeft(s, def);
  const n = Math.max(1, Math.min(count, Math.max(1, left)));
  const check = marketCheck(s, good, n);
  const price = marketPrice(s, def);
  const own = def.resource ? Math.floor(s.resources[def.resource]) : s.equipment[def.equipment!] ?? 0;

  return (
    <div className="card">
      <div className="ico">{def.icon}</div>
      <div className="body">
        <div className="title">
          {def.name}
          <span className="count">на складе: {own}</span>
        </div>
        <div className="desc">
          {price} 💰 за штуку · осталось сегодня {left} из {marketStock(s, def)}
        </div>
        <div className="cost">
          <span className={s.gold >= check.cost ? '' : 'no'}>
            💰 {check.cost} за {n}
          </span>
        </div>
        {check.blocked && <div className="hint">{check.blocked}</div>}
      </div>
      <div className="stepper">
        <button disabled={n <= 1} onClick={() => setCount(n - 1)}>
          −
        </button>
        <span className="n">{n}</span>
        <button disabled={n >= left} onClick={() => setCount(n + 1)}>
          +
        </button>
      </div>
      <button
        className="btn"
        disabled={check.blocked !== null}
        onClick={() => act((st) => buyGoods(st, good, n))}
      >
        Купить
      </button>
    </div>
  );
}

function TribesTab() {
  return (
    <div className="note">
      Торг между племенами появится вместе с общим сервером: соседи будут выставлять своё и
      просить чужое. Пока рынок работает только с проезжими торговцами.
    </div>
  );
}
