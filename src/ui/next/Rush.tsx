// Ускорение стройки за алмазы (docs/gems.md, «Ускорение»): кнопка одна — в окне постройки (Д5, docs/ui_v2.md, 5.7). Ярлык у
// лесов в городе (`SiteTags`) — дверь в это окно с ценой на ней, лист ратуши — дверью «Открыть ›»; прежде кнопка стояла
// в трёх местах. Цена — от оставшегося времени, той же функцией, что спишет сервер
// (`game/gemrules`); последние пять минут — даром и без связи. Трата больше `GEM_CONFIRM` — вторым касанием той же
// кнопки («Точно?», docs/ui_audit.md, 3.10). Без связи кнопка гаснет с причиной; всё остальное в городе работает.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Building } from '@/game/types';
import { useGame } from '@/game/store';
import { isSite } from '@/game/derived';
import { GEM_CONFIRM, rushBlocked, rushFree, rushPrice, rushWork } from '@/game/sim/gems';
import { gemsOffline, orderRush, useGems } from '@/net/gems';
import { SITE_TAGS_EVENT, siteTagHosts } from '@/render/sitetags';
import { Icon } from '@/ui/icons/Icon';
import { useTwoTap } from '@/ui/kit/twotap';
import { useTreasury } from '@/ui/treasury';
import { useTrades } from '@/ui/trades';

/** Значок алмаза — один на все места показа (словарь: значок `res-gem`, docs/ui_audit.md). */
export const GemIcon = () => <Icon name="res-gem" />;

/** Кнопка «Ускорить 💎N» — в окне постройки; причина погасшей — строкой под ней. */
export function RushButton({ b }: { b: Building }) {
  const act = useGame((g) => g.act);
  const toast = useGame((g) => g.showToast);
  const balance = useGems((g) => g.balance);
  const at = useGems((g) => g.at);
  const why = useGems((g) => g.why);
  const busy = useGems((g) => g.busy);
  const [armed, arm, disarm] = useTwoTap();
  if (!isSite(b)) return null;

  const price = rushPrice(b);
  const free = price === 0;
  const blocked = rushBlocked(b, balance, free ? null : gemsOffline({ balance, at, why }));
  const waiting = busy === `rush:${b.id}`;

  const go = async (): Promise<void> => {
    if (free) {
      act((st) => rushFree(st, b.id));
      return;
    }
    if (blocked) {
      toast(blocked);
      return;
    }
    if (price > GEM_CONFIRM && !armed) {
      arm();
      return;
    }
    disarm();
    const err = await orderRush(b.id, b.type, b.level + 1, rushWork(b), price);
    if (err) toast(err);
  };

  const label = waiting ? 'Ускоряем…' : armed ? 'Точно?' : free ? 'Ускорить даром' : 'Ускорить';
  return (
    <span className="nx-rush">
      <button
        className={`nx-rush-go${armed ? ' armed' : ''}${blocked && !free ? ' off' : ''}`}
        disabled={waiting}
        onClick={() => void go()}
        aria-label={free ? 'Ускорить даром' : `Ускорить за ${price} алмазов`}
        data-tut={`rush-${b.type}`}
      >
        <span>{label}</span>
        {!free && !waiting && (
          <b>
            <GemIcon />
            {price}
          </b>
        )}
      </button>
      {blocked && !free && <small className="nx-why">{blocked}</small>}
    </span>
  );
}

/**
 * Ярлык у лесов — дверь к ускорению: «Ускорить» с ценой, касание открывает окно постройки, где стоит сама кнопка (Д5).
 * Одна копия кнопки — в окне: там видно и стройку, и отмену, и почему ускорить нельзя.
 */
function SiteTag({ b }: { b: Building }) {
  const openBuilding = useGame((g) => g.openBuilding);
  const price = rushPrice(b);
  return (
    <span className="nx-rush tag">
      <button className="nx-rush-go" onClick={() => openBuilding(b.id)} aria-label={price === 0 ? 'Ускорить даром: окно постройки' : `Ускорить за ${price} алмазов: окно постройки`}>
        <span>{price === 0 ? 'Ускорить даром' : 'Ускорить'}</span>
        {price > 0 && (
          <b>
            <GemIcon />
            {price}
          </b>
        )}
      </button>
    </span>
  );
}

/**
 * Ярлыки у лесов: дверь «Ускорить» над каждой стройкой в городе (`SiteTag`). Места ставит сцена (`render/city/tags.ts`) —
 * здесь только содержимое, порталом в её элементы. Нет сцены или стройки — ничего.
 */
export function SiteTags() {
  const s = useGame((g) => g.s);
  // Открыто окно — ярлыков над городом нет: под полупрозрачной шторкой они просвечивали бы второй кнопкой.
  const covered = useGame((g) => g.sheet !== null);
  const treasury = useTreasury((t) => t.open);
  const trades = useTrades((t) => t.open);
  const [, bump] = useState(0);
  useEffect(() => {
    const on = (): void => bump((n) => n + 1);
    window.addEventListener(SITE_TAGS_EVENT, on);
    return () => window.removeEventListener(SITE_TAGS_EVENT, on);
  }, []);
  const hosts = siteTagHosts();
  if (covered || treasury || trades) return null;
  return (
    <>
      {s.buildings
        .filter((b) => isSite(b) && hosts.has(b.type))
        .map((b) => createPortal(<SiteTag b={b} />, hosts.get(b.type)!, `tag-${b.id}`))}
    </>
  );
}
