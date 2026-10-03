import './next.css';
import { useGame } from '@/game/store';
import {
  armyPower,
  armySize,
  bondedTotal,
  buildingOfType,
  dayOf,
  housingCapacity,
  moraleBreakdown,
  netPerDay,
  orderValue,
  seasonAfter,
  seasonOf,
  seasonProgress,
  storageCap,
  upkeepInfo,
} from '@/game/derived';
import { ORDER_WARN, RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { SEASON_META, SEASON_SECONDS } from '@/game/data/seasons';
import { popGrowth } from '@/game/sim/population';
import { asGame } from '@/game/pace';
import type { ResourceId } from '@/game/types';
import { Icon } from '@/ui/icons/Icon';
import { iconName, moodOf } from '@/ui/icons/registry';
import { CoatButton } from '@/ui/realm/Coat';
import { useRealm } from '@/ui/realm/open';
import { shortNum } from '@/ui/ResourceBar';
import { signed } from '@/ui/parts/signed';
import { waitSpan } from '@/ui/parts/wait';
import { tipAt, type TipContent } from './tip';

/**
 * Прирост запаса меньше этого за игровой день — «стоит на месте»: стрелки нет. Иначе стрелка дрожала бы
 * от десятых долей расхода на очаг.
 */
export const TREND_DEAD = 0.5;

/** Куда идёт запас: вверх, вниз или стоит. Полный склад не растёт — стрелки у него нет, число охрой. */
export function trendOf(perDay: number, full: boolean): 'up' | 'down' | null {
  if (full && perDay >= 0) return null;
  if (perDay > TREND_DEAD) return 'up';
  if (perDay < -TREND_DEAD) return 'down';
  return null;
}

/** Число в подсказке: до сотни — с десятой, дальше — целое. */
const num = (n: number): string => (Math.abs(n) >= 100 ? String(Math.round(n)) : n.toFixed(1).replace('.', ','));
const perDay = (n: number): string => `${signed(n).replace('.', ',')} в день`;

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
  const season = seasonOf(s.time);
  const meta = SEASON_META[season];
  const pop = s.pop;
  const housing = housingCapacity(s);
  const morale = Math.round(s.morale);
  const mood = moodOf(morale);
  const army = armySize(s);
  const order = bondedTotal(s) > 0 ? Math.round(orderValue(s)) : null;
  const cap = storageCap(s);
  const net = netPerDay(s);
  const storage = buildingOfType(s, 'storage');
  const tip =
    (content: () => TipContent) =>
    (e: { currentTarget: Element }): void =>
      tipAt(e.currentTarget, content());

  const goldTip = (): TipContent => {
    const up = upkeepInfo(s);
    return {
      title: `Золото · ${Math.floor(s.gold)}`,
      body: `Сбор ${num(up.income)} в день, жалованье ${num(up.wages)} в день.`,
      link: { label: 'Указы', go: () => useRealm.getState().show('government') },
    };
  };
  const popTip = (): TipContent => {
    const g = popGrowth(s);
    return {
      title: `Жители · ${pop} из ${housing}`,
      body: g.blocked ?? `Прирост ${perDay(g.perDay)}.`,
      link: { label: 'Прирост', go: () => openTab('pop') },
    };
  };
  const moraleTip = (): TipContent => {
    const lines = moraleBreakdown(s).lines;
    const worst = lines.filter((l) => l.value < 0).sort((a, b) => a.value - b.value)[0];
    const best = lines.filter((l) => l.value > 0).sort((a, b) => b.value - a.value)[0];
    const top = worst ?? best;
    return {
      title: `Мораль · ${morale}`,
      body: top ? `${worst ? 'Тянет вниз' : 'Держит'}: ${top.name.toLowerCase()} ${signed(top.value, 0)}.` : undefined,
      link: { label: 'Мораль', go: () => openTab('morale') },
    };
  };
  const orderTip = (): TipContent => ({
    title: `Порядок · ${order}`,
    body: order !== null && order < ORDER_WARN ? 'Невольники ропщут.' : 'Невольники под надзором.',
    link: { label: 'Порядок', go: () => openTab('order') },
  });
  const armyTip = (): TipContent => {
    const up = upkeepInfo(s);
    return {
      title: `Дружина · ${army}`,
      body: `Мощь ${Math.round(armyPower(s))}. Жалованье ${num(up.armyWages)} в день.`,
      link: { label: 'Дружина', go: () => openTab('army') },
    };
  };
  const seasonTip = (): TipContent => {
    const left = asGame(SEASON_SECONDS * (1 - seasonProgress(s.time)));
    return {
      title: `${meta.name} · день ${dayOf(s.time)}`,
      body: `${SEASON_META[seasonAfter(season)].name} через ${waitSpan(left)}.`,
      link: { label: 'Сезон', go: () => openTab('season') },
    };
  };
  const resTip = (r: ResourceId) => (): TipContent => {
    const have = Math.floor(s.resources[r]);
    const full = s.resources[r] >= cap - 1;
    return {
      title: `${RESOURCE_META[r].name} · ${have} из ${cap}`,
      body: full ? 'Склад полон: новое пропадает.' : perDay(net[r]),
      link: storage ? { label: 'Склад', go: () => openBuilding(storage.id) } : undefined,
    };
  };

  return (
    <div className="nx-hud">
      <div className="nx-top">
        <CoatButton quiet />
        <button className="nx-stat" onClick={tip(goldTip)} aria-label="Золото">
          <Icon name="res-gold" glyph="💰" />
          <b>{shortNum(s.gold)}</b>
        </button>
        <button className={`nx-stat${pop > housing ? ' warn' : ''}`} onClick={tip(popTip)} aria-label="Жители">
          <Icon name="hud-pop" glyph="👥" />
          <b>{pop}</b>
          <small>/{housing}</small>
        </button>
        <button className={`nx-stat${morale < 35 ? ' warn' : ''}`} onClick={tip(moraleTip)} aria-label="Мораль">
          <Icon name={mood.name} glyph={mood.glyph} />
          <b>{morale}</b>
        </button>
        {order !== null && (
          <button className={`nx-stat${order < ORDER_WARN ? ' warn' : ''}`} onClick={tip(orderTip)} aria-label="Порядок">
            <Icon name="hud-order" glyph="🗝️" />
            <b>{order}</b>
          </button>
        )}
        <button className="nx-stat" onClick={tip(armyTip)} aria-label="Дружина">
          <Icon name="hud-army" glyph="⚔️" />
          <b>{army}</b>
        </button>
        <span className="nx-grow" />
        <button className={`nx-stat nx-season season-${season}`} onClick={tip(seasonTip)} aria-label={meta.name}>
          <Icon name={iconName('season', season)} glyph={meta.icon} />
          <span className="nx-prog">
            <i style={{ width: `${Math.round(seasonProgress(s.time) * 100)}%` }} />
          </span>
        </button>
      </div>
      <div className="nx-res">
        {RESOURCE_IDS.map((r) => {
          const full = s.resources[r] >= cap - 1;
          const trend = trendOf(net[r], full);
          return (
            <button key={r} className={`nx-cell${full ? ' full' : ''}`} onClick={tip(resTip(r))} aria-label={RESOURCE_META[r].name}>
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
