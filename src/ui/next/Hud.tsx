import './next.css';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useGame } from '@/game/store';
import { armySize, bondedTotal, buildingOfType, housingCapacity, netPerDay, orderValue, seasonOf, seasonProgress } from '@/game/derived';
import { ORDER_WARN, RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import type { ResourceId } from '@/game/types';
import { SEASON_META } from '@/game/data/seasons';
import { Icon } from '@/ui/icons/Icon';
import { iconName, moodOf } from '@/ui/icons/registry';
import { CoatButton } from '@/ui/realm/Coat';
import { useRealm } from '@/ui/realm/open';
import { shortNum } from '@/ui/parts/shortNum';
import { tipAt, type TipContent } from './tip';
import { energyNow, useTrades } from '@/ui/trades';
import { energyShown } from '@/game/sim/minigames';
import { MINIGAME_COST } from '@/game/data/minigames';
import { armyTip, energyTip, goldTip, isFull, moraleTip, orderTip, popTip, resTip, seasonTip, trendOf, type TipGo } from './hudTips';
import { GemPlaque } from './Treasury';
import { SiteTags } from './Rush';
import { CityCam } from './CityCam';
import { goTo } from '@/ui/kit/nav';
import { withShow } from './show';
import { useChambers } from '@/ui/chambers/open';

/**
 * Покои правителя (docs/city_v3.md, Г-4) — своим куском: пока они открыты, вместо верха города стоит их слой, и в первую
 * загрузку и в кусок интерфейса покои не едут.
 */
const Chambers = lazy(() => import('@/ui/chambers/Chambers').then((m) => ({ default: m.Chambers })));
/** Пока едет кусок покоев — темнота подъёма по лестнице, а не город под ним. */
const CH_WAIT = { position: 'fixed', inset: 0, zIndex: 7, background: '#0d0906' } as const;

/**
 * Верх нового интерфейса (docs/ui_audit.md, 6.0–6.1): одна строка 44 — герб, золото, жители, мораль,
 * порядок, дружина и сезон справа, как дата в EU4, — и строка запасов 32 с приростом цветом. Числа —
 * ячейки-справки: тап открывает подсказку с расшифровкой и ссылкой к панели (3.7), своих панелей у верха
 * нет. Над затемнением окон он стоит целиком: запасы видны, пока решаешь, отдать ли их.
 *
 * Числа строки, которые растут за тысячу, — золото, жители, жильё и дружина — сокращены, как у запасов («4,0к»,
 * `shortNum`): на 375 px четырёхзначные распёрли бы строку (решение владельца 04.10.2026, docs/ui_audit.md, 14.4,
 * вопрос 3). Мораль, порядок и энергия — до ста, им сокращать нечего.
 */
/** Сколько число запаса бежит к новому, мс; шаг пересчёта — мс (таймер, не кадр: кадр — у двери `render/loop`). */
const SOFT_MS = 600;
const SOFT_STEP = 40;

/**
 * Число запаса, которое не прыгает, а бежит к новому значению (docs/city.md, 14.3): заметная прибавка или трата видна
 * движением. Мелкий шаг выработки (меньше двух) встаёт сразу — строка не дрожит на каждом шаге цикла.
 */
function Soft({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const now = useRef(value);
  useEffect(() => {
    const start = now.current;
    if (Math.abs(value - start) < 2) {
      now.current = value;
      setShown(value);
      return;
    }
    from.current = start;
    let k = 0;
    const steps = Math.ceil(SOFT_MS / SOFT_STEP);
    const id = setInterval(() => {
      k++;
      const u = Math.min(1, k / steps);
      const e = 1 - (1 - u) * (1 - u) * (1 - u);
      now.current = from.current + (value - from.current) * e;
      setShown(now.current);
      if (u >= 1) clearInterval(id);
    }, SOFT_STEP);
    return () => clearInterval(id);
  }, [value]);
  return <b>{shortNum(shown)}</b>;
}

/** Какие запасы сейчас пришли над постройками города (`render/city/pops.ts`, событие `tribe-yield`) — ячейка вспыхивает. */
function useYieldFlash(): ReadonlySet<ResourceId> {
  const [lit, setLit] = useState<ReadonlySet<ResourceId>>(new Set());
  useEffect(() => {
    const timers = new Map<ResourceId, ReturnType<typeof setTimeout>>();
    const on = (e: Event): void => {
      const list = (e as CustomEvent<ResourceId[]>).detail ?? [];
      setLit((was) => new Set([...was, ...list]));
      for (const r of list) {
        clearTimeout(timers.get(r));
        timers.set(
          r,
          setTimeout(() => {
            setLit((was) => new Set([...was].filter((x) => x !== r)));
          }, 700),
        );
      }
    };
    window.addEventListener('tribe-yield', on);
    return () => {
      window.removeEventListener('tribe-yield', on);
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);
  return lit;
}

/** Верх города — или покои правителя, когда игрок в них (`ui/chambers`). */
export function Hud() {
  const inside = useChambers((c) => c.open);
  if (!inside) return <CityHud />;
  return (
    <Suspense fallback={<div style={CH_WAIT} />}>
      <Chambers />
    </Suspense>
  );
}

function CityHud() {
  const s = useGame((g) => g.s);
  const openTab = useGame((g) => g.openTab);
  const openBuilding = useGame((g) => g.openBuilding);
  const showRealm = useRealm((r) => r.show);
  const realmOpen = useRealm((r) => r.open);
  const season = seasonOf(s.time);
  const meta = SEASON_META[season];
  const pop = s.pop;
  const housing = housingCapacity(s);
  const morale = Math.round(s.morale);
  const mood = moodOf(morale);
  const order = bondedTotal(s) > 0 ? Math.round(orderValue(s)) : null;
  const net = netPerDay(s);
  const storage = buildingOfType(s, 'storage');
  // `to` — дверь набора: «Построить» ведёт в «Стройку» ратуши (`kit/nav.goTo`).
  const go: TipGo = { tab: openTab, building: openBuilding, realm: showRealm, to: goTo };
  const showTrades = useTrades((t) => t.show);
  const lit = useYieldFlash();
  // Энергия — сутками игрока (`ui/trades.energyNow`); перерисовывается вместе с партией, раз в шаг цикла.
  const energy = energyShown(s, energyNow());
  // Подсказка считается в миг касания: числа в ней — на эту секунду, а не на последнюю перерисовку. У главных кнопок —
  // «Показать в городе» (ОР-1, `show.withShow`).
  const tip =
    (content: () => TipContent) =>
    (e: { currentTarget: Element }): void =>
      tipAt(e.currentTarget, withShow(content()));

  return (
    <div className="nx-hud">
      {/* Порядок — седьмая ячейка: строка теснее, чтобы с энергией влезть в 375 px (цель касания — та же, 44), а жильё
          уходит из ячейки жителей в её подсказку (`next.css`, `.crowded .nx-pop small`). */}
      <div className={`nx-top${order !== null ? ' crowded' : ''}`}>
        <CoatButton quiet />
        <button className="nx-stat" onClick={tip(() => goldTip(s, go))} aria-label="Золото">
          <Icon name="res-gold" />
          <b>{shortNum(s.gold)}</b>
        </button>
        <button className={`nx-stat nx-pop${pop > housing ? ' warn' : ''}`} onClick={tip(() => popTip(s, go))} aria-label="Жители">
          <Icon name="hud-pop" />
          <b>{shortNum(pop)}</b>
          <small>/{shortNum(housing)}</small>
        </button>
        <button className={`nx-stat${morale < 35 ? ' warn' : ''}`} onClick={tip(() => moraleTip(s, go))} aria-label="Мораль">
          <Icon name={mood.name} />
          <b>{morale}</b>
        </button>
        {order !== null && (
          <button className={`nx-stat${order < ORDER_WARN ? ' warn' : ''}`} onClick={tip(() => orderTip(s, go))} aria-label="Порядок">
            <Icon name="hud-order" />
            <b>{order}</b>
          </button>
        )}
        <button className="nx-stat" onClick={tip(() => armyTip(s, go))} aria-label="Дружина">
          <Icon name="hud-army" />
          <b>{shortNum(armySize(s))}</b>
        </button>
        <button className={`nx-stat nx-hen${energy < MINIGAME_COST ? ' low' : ''}`} onClick={tip(() => energyTip(s, energyNow(), showTrades))} aria-label="Энергия">
          <Icon name="ui-energy" />
          <b>{energy}</b>
        </button>
        <span className="nx-grow" />
        <button className={`nx-stat nx-season season-${season}`} onClick={tip(() => seasonTip(s, go))} aria-label={meta.name}>
          <Icon name={iconName('season', season)} />
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
              className={`nx-cell${full ? ' full' : ''}${lit.has(r) ? ' got' : ''}`}
              onClick={tip(() => resTip(s, r, storage?.id ?? null, go))}
              aria-label={RESOURCE_META[r].name}
            >
              <span className="nx-ri">
                <Icon name={iconName('res', r)} />
                {trend && <i className={`nx-tr ${trend}`} />}
              </span>
              <Soft value={s.resources[r]} />
            </button>
          );
        })}
      </div>
      {/* Сокровищница — слева под строкой запасов (docs/gems.md); ярлыки «Ускорить» у лесов — порталом в сцену. Пока
          открыта держава, плашки нет: она легла бы на шапку раздела («Вести», «Правитель») — снимок 390 и 375,
          docs/voice.md, 12. */}
      {!realmOpen && <GemPlaque />}
      <SiteTags />
      {/* Камера города — «Подписи» и «Домой» столбцом под плашкой (ОР-1, docs/ui_v2.md, 5.9). */}
      <CityCam />
    </div>
  );
}
