// Справка по дружине из строки состояния: состав, показатели каждого вида и его
// карточка. Карточка живёт здесь же, а не отдельным разделом шторки, — это чтение
// про то же самое войско, и возврат должен быть в один тап. Кольца контрров нет
// (слово владельца по 14.35, docs/battle_eu4.md): кто кого бьёт, решают показатели.
import { useState } from 'react';
import type { TroopId } from '@/game/types';
import { useGame } from '@/game/store';
import { TROOPS } from '@/game/data/troops';
import { armyPower, armySize, buildingOfType, defense, homeArmy, recruitsQueued } from '@/game/derived';
import { KIND_META } from '@/battle';
import { KIND_OF, profileOfTroop, troopTotal } from '@/game/battle/kinds';
import { troopPower } from '@/game/battle/price';
import { useWorld, worldNow } from '@/world/store';
import { postureOf } from '@/world/muster';
import { moraleOf } from '@/game/battle/describe';
import { WOUND_DAYS } from '@/game/constants';
import { REST_WHY, restLine } from '../parts/restWords';
import { waitDays } from '../parts/wait';
import { count } from '../parts/plural';
import { tipAt } from '@/ui/next/tip';
import { TroopCardView } from '../parts/TroopCardView';
import { Icon } from '@/ui/icons/Icon';
import { dec } from '@/game/num';

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
        ⚔️ Дружина <small>{count(armySize(s), 'боец', 'бойца', 'бойцов')} · мощь {Math.round(armyPower(s))}</small>
      </h2>

      <div
        className="mod total"
        role="button"
        tabIndex={0}
        onClick={(e) =>
          tipAt(e.currentTarget, { title: 'Оборона', body: 'Частокол, башня, жители, гарнизон и собранный дома отряд.' })
        }
      >
        <span className="ico">🛡️</span>
        <span className="name">Оборона</span>
        <span className="val pos">{dec(defense(s), 0)}</span>
      </div>
      <div className="mod">
        <span className="ico"><Icon name="ui-home" glyph="🏠" /></span>
        <span className="name">Гарнизон</span>
        <span className="val">{home}</span>
      </div>
      {druzhina > 0 && (
        <div className="mod">
          <span className="ico">🎖️</span>
          <span className="name">
            Отряд полководца
            <em className="sub">
              {posture === 'stands'
                ? 'собран, стоит в гарнизоне'
                : posture === 'gathering'
                  ? 'идёт сбор, город не защищает'
                  : 'в походе, город не защищает'}
            </em>
          </span>
          <span className={`val${posture === 'stands' ? '' : ' neg'}`}>{druzhina}</span>
        </div>
      )}
      <div className="mod">
        <span className="ico"><Icon name="ui-banner" glyph="🚩" /></span>
        <span className="name">Не в обороне</span>
        <span className={`val${away > 0 ? ' neg' : ''}`}>{away}</span>
      </div>
      {training > 0 && (
        <div className="mod">
          <span className="ico"><Icon name="ui-target" glyph="🎯" /></span>
          <span className="name">Новобранцы</span>
          <span className="val">{training}</span>
        </div>
      )}

      <h3>Мораль между боями</h3>
      <div className="note">
        После боя мораль уцелевших проседает и за {waitDays(WOUND_DAYS)} возвращается к полной. {REST_WHY}
      </div>
      {general?.rest && <div className="note warn">{restLine(general.rest, 'Отряд дрался', worldNow())}</div>}

      <h3>Состав дружины</h3>
      {TROOPS.map((def) => {
        const n = Math.max(0, s.army[def.id] ?? 0);
        const kind = KIND_OF[def.id];
        const m = moraleOf(def.id);
        const p = profileOfTroop(def.id);
        return (
          <button className={`card as-row${n === 0 ? ' none' : ''}`} key={def.id} onClick={() => setOpen(def.id)}>
            <div className="ico">
              <Icon name={`troop-${def.id}`} glyph={def.icon} />
            </div>
            <div className="body">
              <div className="title">
                {def.name}
                <span className="count">
                  {n} · мощь {Math.round(troopPower({ [def.id]: n }))}
                </span>
              </div>
              <div className="desc">
                {KIND_META[kind].icon} {KIND_META[kind].name} · огонь {p.fireAtk}/{p.fireDef} · натиск {p.shockAtk}/{p.shockDef}
                {' · '}мораль {m.total}
              </div>
            </div>
            <div className="chev">›</div>
          </button>
        );
      })}

      {barracks && (
        <button className="btn wide" onClick={() => openBuilding(barracks.id)}>
          ⚔️ Нанять
        </button>
      )}
    </div>
  );
}
