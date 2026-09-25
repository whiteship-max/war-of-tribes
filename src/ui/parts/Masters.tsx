import { useGame } from '@/game/store';
import { upkeepInfo } from '@/game/derived';
import { TROOP_BY_ID } from '@/game/data/troops';
import { hireMasters, mastersInfo, releaseMasters } from '@/game/sim/masters';
import { Icon } from '@/ui/icons/Icon';
import { Steps } from './Steps';

/**
 * Наёмные мастера в Мастерской (docs/admin_branch.md, раздел 4.1): сколько их, сколько стоят,
 * что дают. **Своих чисел здесь нет ни одного** — всё берётся у `sim/masters.mastersInfo` и
 * `derived.upkeepInfo`; держит это тест по исходнику (`ui/parts/masters.test.ts`).
 *
 * Строка про копейщика стоит здесь нарочно: ценность мастеров — не прибавка к стройке, а спор за
 * золото. Одна казна платит либо ему, либо им, и игрок обязан видеть это там, где нанимает.
 */
export function Masters() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const m = mastersInfo(s);
  const up = upkeepInfo(s);
  const spearman = TROOP_BY_ID.spearman.one;

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
            <span className="count">можно взять: {m.room}</span>
          </div>
          <div className="desc">
            Встают на места Мастерской и строят как ремесленник. Жителями не считаются: налога, жилья и
            обороны у них нет. Платят им из той же казны, что войску, и уходят они той же дверью — если
            нечем платить или кормить.
          </div>
        </div>
      </div>
      <div className="mod">
        <span className="ico">
          <Icon name="res-gold" glyph="💰" />
        </span>
        <span className="name">Жалованье мастеру</span>
        <span className="val">{m.wage.toFixed(2)} в игровой день</span>
      </div>
      <div className="mod">
        <span className="ico">⚔️</span>
        <span className="name">
          Один {spearman} в жалованье — это
          <em className="sub">одна казна платит либо ему, либо мастерам</em>
        </span>
        <span className="val">{m.perSpearman.toFixed(1)} мастера</span>
      </div>
      <div className="mod">
        <span className="ico">🔨</span>
        <span className="name">
          Дают стройке
          <em className="sub">каждый — как ремесленник: +{m.each.toFixed(1)}/с</em>
        </span>
        <span className="val">+{m.gain.toFixed(1)}/с</span>
      </div>
      <div className="mod">
        <span className="ico">📜</span>
        <span className="name">
          Ведомость в день — войско и мастера
          <em className="sub">
            войско {up.armyWages.toFixed(1)}, мастера {up.mastersWages.toFixed(1)}, казна даёт {up.income.toFixed(1)}
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
