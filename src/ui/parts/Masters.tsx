import { useGame } from '@/game/store';
import { upkeepInfo } from '@/game/derived';
import { TROOP_BY_ID } from '@/game/data/troops';
import { MASTER_PAID_AS } from '@/game/data/upkeep';
import { hireMasters, mastersInfo, releaseMasters } from '@/game/sim/masters';
import { Icon } from '@/ui/icons/Icon';
import { Steps } from './Steps';

/**
 * Наёмные мастера в Мастерской (docs/admin_branch.md, раздел 4.1): сколько их, сколько стоят,
 * что дают. **Своих чисел здесь нет ни одного** — всё берётся у `sim/masters.mastersInfo` и
 * `derived.upkeepInfo`; держит это тест по исходнику (`ui/parts/masters.test.ts`).
 *
 * Строка про копейщика стоит здесь нарочно: ценность мастеров — не прибавка к стройке, а спор за
 * золото. Мастер платится как отнятые руки — столько копейщиков, сколько рук он даёт стройке, — и
 * игрок обязан видеть это там, где нанимает.
 */
export function Masters() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const m = mastersInfo(s);
  const up = upkeepInfo(s);
  const soldier = TROOP_BY_ID[MASTER_PAID_AS];

  return (
    <>
      <h3>
        Наёмные мастера
        <span className="muted">
          {m.have}/{m.cap}
        </span>
      </h3>
      <div className="card">
        <div className="ico">🔨</div>
        <div className="body">
          <div className="title">
            Мастера со стороны
            <span className="count">ещё {m.room}</span>
          </div>
          <div className="desc">
            Строят как ремесленник. Жителями не считаются. Без жалованья или еды уходят, как дружина.
          </div>
        </div>
      </div>
      <div className="mod">
        <span className="ico">
          <Icon name="res-gold" glyph="💰" />
        </span>
        <span className="name">Жалованье мастеру</span>
        <span className="val">{m.wage.toFixed(2)} в день</span>
      </div>
      <div className="mod">
        <span className="ico">⚔️</span>
        <span className="name">
          Цена мастера
          <em className="sub">{m.hands.toFixed(2)} рук стройке, платят как бойцам</em>
        </span>
        <span className="val">
          {m.inSoldiers.toFixed(2)} × {soldier.one}
        </span>
      </div>
      <div className="mod">
        <span className="ico">🔨</span>
        <span className="name">
          Дают стройке
          <em className="sub">каждый +{m.each.toFixed(1)}</em>
        </span>
        <span className="val">+{m.gain.toFixed(1)}</span>
      </div>
      <div className="mod">
        <span className="ico">📜</span>
        <span className="name">
          Жалованье в день
          <em className="sub">
            дружина {up.armyWages.toFixed(1)}, мастера {up.mastersWages.toFixed(1)}, доход {up.income.toFixed(1)}
          </em>
        </span>
        <span className={`val${up.wages > up.income ? ' neg' : ''}`}>{up.wages.toFixed(1)}</span>
      </div>
      <Steps
        value={m.have}
        max={m.have + m.room}
        spare={m.room}
        step={10}
        onChange={(d) =>
          act((st) =>
            d > 0 ? hireMasters(st, Math.min(d, mastersInfo(st).room)) : releaseMasters(st, Math.min(-d, mastersInfo(st).have)),
          )
        }
      />
      {m.blocked && <div className="hint">{m.blocked}</div>}
    </>
  );
}
