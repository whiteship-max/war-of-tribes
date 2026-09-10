import { useGame } from '@/game/store';
import { TEST_GEMS } from '@/game/constants';
import { GEM_PACKS, packRate } from '@/game/data/gems';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { buildingTitle, isSite } from '@/game/derived';
import { GEM_SECONDS, gemsOf, rushPrice } from '@/game/sim/gems';
import { rushUpgrade } from '@/game/sim/gems';
import { Icon } from '@/ui/icons/Icon';
import { iconName } from '@/ui/icons/registry';

/**
 * Вкладка «Алмазы»: счёт, на что они тратятся и витрина наборов.
 *
 * Витрина — честная заглушка. Покупка в Telegram Mini App идёт через Telegram
 * Stars: счёт выставляет бот, подтверждает вебхук на сервере. Сервера нет,
 * поэтому кнопки не нажимаются, и об этом написано словами, а не спрятано в
 * серый цвет кнопки.
 */
export function Gems() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const gems = gemsOf(s);
  const sites = s.buildings.filter(isSite);
  const base = packRate(GEM_PACKS[0]);

  return (
    <>
      <h3>Казна алмазов</h3>
      <div className="mod total">
        <span className="ico gem-ico">♦</span>
        <span className="name">
          Красные алмазы
          <em className="sub">склад их не держит, набег не уносит</em>
        </span>
        <span className="val pos">{gems}</span>
      </div>
      <div className="note warn">
        Тестовый запас: новая партия начинается с {TEST_GEMS} ♦, чтобы трату было на чём
        проверить. Начислять их себе игра не умеет — это делает только сервер.
      </div>

      <h3>На что тратятся</h3>
      <div className="note">
        Алмаз покупает время и ничего больше: мгновенная достройка снимает ожидание, а
        ресурсы за уровень списываются как за обычную стройку. Ни еды, ни камня, ни зимы
        алмазом не отменить — иначе платящий игрок играл бы в другую игру.
        Цена достройки зависит от того, сколько работы осталось: один алмаз — примерно{' '}
        {GEM_SECONDS} секунд ожидания, и к концу стройки цена падает до одного.
      </div>

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
                  {buildingTitle(s, b.type)} → {b.level + 1} ур.
                  <span className="count">{pct}%</span>
                </div>
                <div className="desc">Достроить сейчас — ресурсы уже уплачены.</div>
              </div>
              <button className="btn gem" disabled={gems < price} onClick={() => act((st) => rushUpgrade(st, b.id))}>
                ♦ {price}
              </button>
            </div>
          );
        })
      ) : (
        <div className="note">Сейчас ничего не строится. Начни улучшение во вкладке «Стройка».</div>
      )}

      <h3>
        Купить <span className="muted">пока нельзя</span>
      </h3>
      <div className="note warn">
        Покупка появится вместе с сервером: в Telegram за неё платят звёздами (<Icon name="ui-star" glyph="⭐" /> Telegram
        Stars), счёт выставляет бот, а подтверждает оплату вебхук. Пока этого нет, витрина
        показывает наборы, но не берёт денег.
      </div>
      {GEM_PACKS.map((p) => (
        <div className="card gem-pack" key={p.id}>
          <div className="ico">
            <Icon name={iconName('ui', p.id)} glyph={p.icon} />
          </div>
          <div className="body">
            <div className="title">
              {p.name}
              <span className="count">♦ {p.gems}</span>
            </div>
            <div className="desc">
              {p.stars} <Icon name="ui-star" glyph="⭐" />
              {packRate(p) > base && ` · выгоднее на ${Math.round((packRate(p) / base - 1) * 100)}%`}
              {p.best && ' · берут чаще всего'}
            </div>
          </div>
          <button className="btn" disabled title="Покупка появится вместе с сервером">
            Скоро
          </button>
        </div>
      ))}
    </>
  );
}
