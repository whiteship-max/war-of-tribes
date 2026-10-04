import './next.css';
import { useGame } from '@/game/store';
import { armySize, bondedTotal, buildingOfType, housingCapacity, netPerDay, orderValue, seasonOf, seasonProgress } from '@/game/derived';
import { ORDER_WARN, RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { SEASON_META } from '@/game/data/seasons';
import { Icon } from '@/ui/icons/Icon';
import { iconName, moodOf } from '@/ui/icons/registry';
import { CoatButton } from '@/ui/realm/Coat';
import { useRealm } from '@/ui/realm/open';
import { shortNum } from '@/ui/ResourceBar';
import { tipAt, type TipContent } from './tip';
import { energyNow, useTrades } from '@/ui/trades';
import { energyShown } from '@/game/sim/minigames';
import { MINIGAME_COST } from '@/game/data/minigames';
import { armyTip, energyTip, goldTip, isFull, moraleTip, orderTip, popTip, resTip, seasonTip, trendOf, type TipGo } from './hudTips';

/**
 * Верх нового интерфейса (docs/ui_audit.md, 6.0–6.1): одна строка 44 — герб, золото, жители, мораль,
 * порядок, дружина и сезон справа, как дата в EU4, — и строка запасов 32 с приростом цветом. Числа —
 * ячейки-справки: тап открывает подсказку с расшифровкой и ссылкой к панели (3.7), своих панелей у верха
 * нет. Над затемнением окон он стоит целиком: запасы видны, пока решаешь, отдать ли их.
 */
export function Hud() {
  const s = useGame((g) => g.s);
  const openTab = useGame((g) => g.openTab);
  const openBuilding = useGame((g) => g.openBuilding);
  const showRealm = useRealm((r) => r.show);
  const season = seasonOf(s.time);
  const meta = SEASON_META[season];
  const pop = s.pop;
  const housing = housingCapacity(s);
  const morale = Math.round(s.morale);
  const mood = moodOf(morale);
  const order = bondedTotal(s) > 0 ? Math.round(orderValue(s)) : null;
  const net = netPerDay(s);
  const storage = buildingOfType(s, 'storage');
  const go: TipGo = { tab: openTab, building: openBuilding, realm: showRealm };
  const showTrades = useTrades((t) => t.show);
  // Энергия — сутками игрока (`ui/trades.energyNow`); перерисовывается вместе с партией, раз в шаг цикла.
  const energy = energyShown(s, energyNow());
  // Подсказка считается в миг касания: числа в ней — на эту секунду, а не на последнюю перерисовку.
  const tip =
    (content: () => TipContent) =>
    (e: { currentTarget: Element }): void =>
      tipAt(e.currentTarget, content());

  return (
    <div className="nx-hud">
      {/* Порядок — седьмая ячейка: строка теснее, чтобы с энергией влезть в 375 px (цель касания — та же, 44). */}
      <div className={`nx-top${order !== null ? ' crowded' : ''}`}>
        <CoatButton quiet />
        <button className="nx-stat" onClick={tip(() => goldTip(s, go))} aria-label="Золото">
          <Icon name="res-gold" glyph="💰" />
          <b>{shortNum(s.gold)}</b>
        </button>
        <button className={`nx-stat${pop > housing ? ' warn' : ''}`} onClick={tip(() => popTip(s, go))} aria-label="Жители">
          <Icon name="hud-pop" glyph="👥" />
          <b>{pop}</b>
          <small>/{housing}</small>
        </button>
        <button className={`nx-stat${morale < 35 ? ' warn' : ''}`} onClick={tip(() => moraleTip(s, go))} aria-label="Мораль">
          <Icon name={mood.name} glyph={mood.glyph} />
          <b>{morale}</b>
        </button>
        {order !== null && (
          <button className={`nx-stat${order < ORDER_WARN ? ' warn' : ''}`} onClick={tip(() => orderTip(s, go))} aria-label="Порядок">
            <Icon name="hud-order" glyph="🗝️" />
            <b>{order}</b>
          </button>
        )}
        <button className="nx-stat" onClick={tip(() => armyTip(s, go))} aria-label="Дружина">
          <Icon name="hud-army" glyph="⚔️" />
          <b>{armySize(s)}</b>
        </button>
        <button className={`nx-stat nx-energy${energy < MINIGAME_COST ? ' low' : ''}`} onClick={tip(() => energyTip(s, energyNow(), showTrades))} aria-label="Энергия">
          <Icon name="ui-energy" glyph="✋" />
          <b>{energy}</b>
        </button>
        <span className="nx-grow" />
        <button className={`nx-stat nx-season season-${season}`} onClick={tip(() => seasonTip(s, go))} aria-label={meta.name}>
          <Icon name={iconName('season', season)} glyph={meta.icon} />
          <span className="nx-prog">
            <i style={{ width: `${Math.round(seasonProgress(s.time) * 100)}%` }} />
          </span>
        </button>
      </div>
      <div className="nx-res">
        {RESOURCE_IDS.map((r) => {
          const full = isFull(s, r);
          const trend = trendOf(net[r], full);
          return (
            <button
              key={r}
              className={`nx-cell${full ? ' full' : ''}`}
              onClick={tip(() => resTip(s, r, storage?.id ?? null, go))}
              aria-label={RESOURCE_META[r].name}
            >
              <span className="nx-ri">
                <Icon name={`res-${r}`} glyph={RESOURCE_META[r].icon} />
                {trend && <i className={`nx-tr ${trend}`} />}
              </span>
              <b>{shortNum(s.resources[r])}</b>
            </button>
          );
        })}
      </div>
    </div>
  );
}
