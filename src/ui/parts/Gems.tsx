import { useGame } from '@/game/store';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { buildingTitle, isSite } from '@/game/derived';
import { GEM_REAL_SECONDS, gemsOf, rushPrice } from '@/game/sim/gems';
import { rushUpgrade } from '@/game/sim/gems';
import { Icon } from '@/ui/icons/Icon';
import { realSpanText } from './wait';

/**
 * Вкладка «Алмазы»: счёт и на что они тратятся.
 *
 * Витрины наборов здесь нет: покупка в Telegram Mini App идёт через Telegram Stars (счёт
 * выставляет бот, подтверждает вебхук на сервере), а этого пока нет. Невыпущенное игроку
 * не показывается (docs/ui_audit.md, 4.1); наборы лежат в `data/gems.ts` и вернутся
 * вместе с оплатой.
 */
export function Gems() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const gems = gemsOf(s);
  const sites = s.buildings.filter(isSite);

  return (
    <>
      <div className="mod total">
        <span className="ico gem-ico">
          <Icon name="res-gem" glyph="♦" />
        </span>
        <span className="name">
          Алмазы
          <em className="sub">склад их не держит, набег не уносит</em>
        </span>
        <span className="val pos">{gems}</span>
      </div>

      <h3>Достройка</h3>
      <div className="note">Алмаз снимает около {realSpanText(GEM_REAL_SECONDS)} ожидания.</div>

      {sites.length > 0 ? (
        sites.map((b) => {
          const def = BUILDING_BY_ID[b.type];
          const price = rushPrice(b);
          const pct = Math.floor((b.work / Math.max(1, b.workRequired)) * 100);
          return (
            <div className="card" key={b.id}>
              <div className="ico">{def.icon}</div>
              <div className="body">
                <div className="title">
                  {buildingTitle(s, b.type)} → ур. {b.level + 1}
                  <span className="count">{pct}%</span>
                </div>
                <div className="desc">Запасы уже уплачены.</div>
              </div>
              <button className="btn gem" disabled={gems < price} onClick={() => act((st) => rushUpgrade(st, b.id))}>
                <Icon name="res-gem" glyph="♦" /> {price}
              </button>
            </div>
          );
        })
      ) : (
        <div className="note">Стройки нет.</div>
      )}
    </>
  );
}
