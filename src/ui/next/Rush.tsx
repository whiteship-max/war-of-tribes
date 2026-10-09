// Ускорение стройки за алмазы (docs/gems.md, «Ускорение»): одна кнопка на окно постройки, на очередь стройки в ратуше и
// на ярлык у лесов в городе (`SiteTags`). Цена — от оставшегося времени, той же функцией, что спишет сервер
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
import { CONFIRM_MS } from './Confirm';
import { useTreasury } from '@/ui/treasury';
import { useTrades } from '@/ui/trades';

/** Значок алмаза — один на все места показа (словарь: значок `res-gem`, docs/ui_audit.md). */
export const GemIcon = () => <Icon name="res-gem" glyph="♦️" />;

/**
 * Кнопка «Ускорить 💎N». `tag` — вид ярлыка у лесов: короче и без строки причины (причина — во всплывающей строке).
 */
export function RushButton({ b, tag = false }: { b: Building; tag?: boolean }) {
  const act = useGame((g) => g.act);
  const toast = useGame((g) => g.showToast);
  const balance = useGems((g) => g.balance);
  const at = useGems((g) => g.at);
  const why = useGems((g) => g.why);
  const busy = useGems((g) => g.busy);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [armed]);
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
      setArmed(true);
      return;
    }
    setArmed(false);
    const err = await orderRush(b.id, b.type, b.level + 1, rushWork(b), price);
    if (err) toast(err);
  };

  const label = waiting ? 'Ускоряем…' : armed ? 'Точно?' : free ? 'Ускорить даром' : 'Ускорить';
  return (
    <span className={`nx-rush${tag ? ' tag' : ''}`}>
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
      {!tag && blocked && !free && <small className="nx-why">{blocked}</small>}
    </span>
  );
}

/**
 * Ярлыки у лесов: кнопка «Ускорить» над каждой стройкой в городе. Места ставит сцена (`render/city/tags.ts`) — здесь
 * только содержимое, порталом в её элементы. Нет сцены или стройки — ничего.
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
        .map((b) => createPortal(<RushButton b={b} tag />, hosts.get(b.type)!, `tag-${b.id}`))}
    </>
  );
}
