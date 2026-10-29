// «Поднять раненых сейчас» за алмазы (ПН-6, docs/gdd/path_of_sword.md, 3.3.1, решение В11): строка на группу раненых — сколько встанет
// и когда встали бы сами, кнопка с ценой. Цена — от оставшегося срока той же кривой, что ускорение стройки (`gemrules.healPriceOfLeft`,
// её же спишет сервер), последние пять минут — даром и без связи. Доступно всегда, в осаде тоже. Одна кнопка на лазарет города
// (окно постройки) и на раненых отряда бродяги (окно отряда): поднимает всех, кто встал бы не позже этой группы.
import type { WoundGroup } from '@/game/types';
import { useGame } from '@/game/store';
import { troopTotal } from '@/game/battle/kinds';
import { GEM_CONFIRM, healLeft, healNow, healPriceOfLeft } from '@/game/sim/gems';
import { asGame } from '@/game/pace';
import { gemsOffline, useGems } from '@/net/gems';
import { orderHeal } from '@/net/gemorder';
import { useTwoTap } from '@/ui/kit/twotap';
import { waitMinSec } from '@/ui/parts/wait';
import { Icon } from '@/ui/icons/Icon';
import { GemIcon } from './Rush';

/** Группы со сроком, ещё лежащие при часах партии `time`, по сроку. */
export const lyingGroups = (groups: readonly WoundGroup[], time: number): { until: number; heads: number }[] =>
  groups
    .filter((g): g is WoundGroup & { until: number } => g.until !== null && g.until > time)
    .sort((a, b) => a.until - b.until)
    .map((g) => ({ until: g.until, heads: troopTotal(g.troops) }));

/** Строки лечения: по группе раненых со сроком. Нет таких — ничего. */
export function HealRows({ groups }: { groups: readonly WoundGroup[] }) {
  const time = useGame((g) => g.s.time);
  const rows = lyingGroups(groups, time);
  if (rows.length === 0) return null;
  // Встанут все, кто встал бы не позже этой группы, — столько и покажем.
  let up = 0;
  return (
    <div className="nx-heal">
      {rows.map((r) => {
        up += r.heads;
        return <HealRow key={r.until} until={r.until} heads={up} time={time} />;
      })}
    </div>
  );
}

function HealRow({ until, heads, time }: { until: number; heads: number; time: number }) {
  const act = useGame((g) => g.act);
  const toast = useGame((g) => g.showToast);
  const balance = useGems((g) => g.balance);
  const at = useGems((g) => g.at);
  const why = useGems((g) => g.why);
  const busy = useGems((g) => g.busy) === `heal:${until}`;
  const [armed, arm, disarm] = useTwoTap();
  const left = healLeft(until, time);
  const price = healPriceOfLeft(left);
  const free = price === 0;
  const off = free ? null : (gemsOffline({ balance, at, why }) ?? ((balance ?? 0) < price ? `Не хватает алмазов: нужно ${price}.` : null));

  const go = async (): Promise<void> => {
    if (free) {
      act((st) => {
        healNow(st, until);
        return null;
      });
      return;
    }
    if (off) {
      toast(off);
      return;
    }
    if (price > GEM_CONFIRM && !armed) {
      arm();
      return;
    }
    disarm();
    const err = await orderHeal(until, left, price);
    if (err) toast(err);
  };

  return (
    <div className="nx-heal-row">
      <span>
        <Icon name="ui-bandage" /> {heads} · встанут через {waitMinSec(asGame(until - time))}
      </span>
      <span className="nx-rush">
        <button className={`nx-rush-go${armed ? ' armed' : ''}${off ? ' off' : ''}`} disabled={busy} onClick={() => void go()} aria-label={free ? 'Поднять даром' : `Поднять за ${price} алмазов`}>
          <span>{busy ? 'Поднимаем…' : armed ? 'Точно?' : free ? 'Поднять даром' : 'Поднять сейчас'}</span>
          {!free && !busy && (
            <b>
              <GemIcon />
              {price}
            </b>
          )}
        </button>
      </span>
    </div>
  );
}
