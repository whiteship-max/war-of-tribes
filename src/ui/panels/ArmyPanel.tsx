// Справка по дружине из строки состояния: состав, кольцо контрров и карточка
// каждого вида. Карточка живёт здесь же, а не отдельным разделом шторки, —
// это чтение про то же самое войско, и возврат должен быть в один тап.
import { useState } from 'react';
import type { TroopId } from '@/game/types';
import { useGame } from '@/game/store';
import { TROOPS } from '@/game/data/troops';
import { armyPower, armySize, buildingOfType, defense, homeArmy, recruitsQueued } from '@/game/derived';
import { KIND_META } from '@/battle';
import { KIND_OF, troopTotal } from '@/game/battle/kinds';
import { useWorld, worldNow } from '@/world/store';
import { postureOf } from '@/world/muster';
import { moraleOf } from '@/game/battle/describe';
import { WOUND_DAYS } from '@/game/constants';
import { CounterRing } from '../parts/CounterRing';
import { restLine } from '../parts/restWords';
import { waitDaysBoth } from '../parts/wait';
import { TroopCardView } from '../parts/TroopCardView';
import { Icon } from '@/ui/icons/Icon';

export function ArmyPanel() {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const [open, setOpen] = useState<TroopId | null>(null);
  const barracks = buildingOfType(s, 'barracks');
  const home = homeArmy(s);
  const away = armySize(s) - home;
  const training = recruitsQueued(s);
  // Где дружина — три состояния, и за разницу между ними игрок платит.
  const general = useWorld((g) => g.figures.find((f) => f.id === 'general'));
  const druzhina = troopTotal(general?.troops ?? {});
  const posture = general ? postureOf(general) : 'none';

  if (open) return <TroopCardView troop={open} onBack={() => setOpen(null)} />;

  return (
    <div className="panel">
      <h2>
        ⚔️ Дружина <small>бойцов {armySize(s)} · мощь {Math.round(armyPower(s))}</small>
      </h2>

      <div className="mod total">
        <span className="ico">🛡️</span>
        <span className="name">
          Защита поселения
          <em className="sub">частокол, башня, жители, гарнизон и дружина, собранная дома</em>
        </span>
        <span className="val pos">{defense(s).toFixed(0)}</span>
      </div>
      <div className="mod">
        <span className="ico"><Icon name="ui-home" glyph="🏠" /></span>
        <span className="name">Дома, в обороне</span>
        <span className="val">{home}</span>
      </div>
      {druzhina > 0 && (
        <div className="mod">
          <span className="ico">🎖️</span>
          <span className="name">
            Дружина полководца
            <em className="sub">
              {posture === 'stands'
                ? 'собрана и дома — в гарнизоне'
                : posture === 'gathering'
                  ? 'идёт сбор — не защищает никого'
                  : 'в пути или в поле — деревню не защищает'}
            </em>
          </span>
          <span className={`val${posture === 'stands' ? '' : ' neg'}`}>{druzhina}</span>
        </div>
      )}
      <div className="mod">
        <span className="ico"><Icon name="ui-banner" glyph="🚩" /></span>
        <span className="name">Не в обороне: сбор, поле, походы</span>
        <span className={`val${away > 0 ? ' neg' : ''}`}>{away}</span>
      </div>
      {training > 0 && (
        <div className="mod">
          <span className="ico"><Icon name="ui-target" glyph="🎯" /></span>
          <span className="name">На учениях</span>
          <span className="val">{training}</span>
        </div>
      )}

      <h3>Мораль между боями</h3>
      <div className="note">
        После боя армия уставшая: мораль тех, кто уцелел, просела и возвращается к полной по прямой за срок лазарета —{' '}
        {waitDaysBoth(WOUND_DAYS)}, в пути и стоя. Брошенная в бой сразу, армия бежит раньше: сектор, у которого
        кончилась мораль, уходит с поля. Так же устаёт и противник — лагерь после вылазки, отряд после перехвата.
      </div>
      {general?.rest && <div className="note warn">{restLine(general.rest, 'Дружина дралась', worldNow())}</div>}

      <h3>Кольцо контрров</h3>
      <div className="note">
        Превосходство работает только при своём условии — какое у кого, написано на карточке вида.
      </div>
      <CounterRing />

      <h3>Состав гарнизона</h3>
      <div className="note">Тап по виду — карточка: против кого он хорош, чем его бьют и что он стоит.</div>
      {TROOPS.map((def) => {
        const n = Math.max(0, s.army[def.id] ?? 0);
        const kind = KIND_OF[def.id];
        const m = moraleOf(def.id);
        return (
          <button className={`card as-row${n === 0 ? ' none' : ''}`} key={def.id} onClick={() => setOpen(def.id)}>
            <div className="ico">
              <Icon name={`troop-${def.id}`} glyph={def.icon} />
            </div>
            <div className="body">
              <div className="title">
                {def.name}
                <span className="count">
                  {n} · мощь {def.power * n}
                </span>
              </div>
              <div className="desc">
                {KIND_META[kind].icon} {KIND_META[kind].name} · мораль {m.total} · снаряжение {m.gearLevel}
              </div>
            </div>
            <div className="chev">›</div>
          </button>
        );
      })}

      {barracks && (
        <button className="btn wide" onClick={() => openBuilding(barracks.id)}>
          ⚔️ В казармы — нанять
        </button>
      )}
    </div>
  );
}
