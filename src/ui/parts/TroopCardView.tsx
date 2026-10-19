// Карточка вида бойцов. Всё содержимое приходит из `troopCard()` — здесь только
// разметка. Ни одного множителя, ни одной сильной стороны и ни одного условия
// в этом файле руками не написано: правка баланса меняет карточку сама.
import type { TroopId } from '@/game/types';
import { useGame } from '@/game/store';
import { EQUIPMENT_BY_ID } from '@/game/data/equipment';
import { buildingOfType } from '@/game/derived';
import { hiredAt, recruitCheck } from '@/game/sim/army';
import { askRecruit } from '@/ui/next/recruitAsk';
import { temperOf, troopCard } from '@/game/battle/describe';
import { Icon } from '@/ui/icons/Icon';
import { waitShort } from './wait';
import { dec } from '@/game/num';
import { iconName } from '@/ui/icons/registry';
import type { IconName } from '@/ui/icons/alias';

/** Полоска величины в своём потолке: вес среди видов, мораль в шкале боя. */
function Bar({
  icon,
  label,
  value,
  max,
  note,
  tone,
}: {
  icon: IconName;
  label: string;
  value: number;
  max: number;
  note: string;
  tone?: string;
}) {
  return (
    <div className="res-line">
      <span className="ico"><Icon name={icon} /></span>
      <span className="name">{label}</span>
      <span className="val">{Math.round(value * 10) / 10}</span>
      <span className="delta">{note}</span>
      <span className="bar">
        <i className={tone} style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
      </span>
    </div>
  );
}

export function TroopCardView({ troop, onBack }: { troop: TroopId; onBack: () => void }) {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const card = troopCard(troop);
  const { def, meta, morale, weight, cost, stats } = card;
  const have = Math.max(0, s.army[troop] ?? 0);
  // Срок одного бойца — тем же расчётом, что у кнопки найма: с его видом, а у
  // всадника, значит, и с конюшней.
  const eta = recruitCheck(s, troop, 1).eta;
  // Нанимают там, где учат этот вид (`army.hiredAt`): конницу — в конюшне. Прежде кнопка вела в казармы всегда.
  const hall = buildingOfType(s, hiredAt(troop));
  const smithy = buildingOfType(s, 'smithy');

  return (
    <div className="panel">
      <button className="btn ghost back" onClick={onBack}>
        ← К дружине
      </button>

      <div className="bhead">
        <div className="ico">
          <Icon name={iconName('troop', def.id)} />
        </div>
        <div className="body">
          <div className="name">{def.name}</div>
          <div className="lvl">
            {meta.icon} {meta.name} · мощь {dec(weight.power, 1)} · в городе {have}
          </div>
        </div>
      </div>
      <p className="season-hint">
        <em>{def.flavor}</em>
      </p>
      <p className="season-hint">{def.description}</p>

      <h3>В бою</h3>
      <Bar icon="ui-scales" label="Мощь" value={weight.power} max={weight.powerMax} note={`из ${dec(weight.powerMax, 1)} у сильнейшего`} />
      <p className="season-hint">{weight.what}</p>
      <Bar
        icon="ui-whiteflag"
        label="Мораль"
        value={morale.total}
        max={morale.max}
        note={`из ${morale.max}`}
        tone={morale.total >= morale.max * 0.6 ? undefined : 'full'}
      />

      <h3>Цена бойца</h3>
      <div className="cost">
        {cost.resources.map((r) => (
          <span key={r.id} className={s.resources[r.id] >= r.n ? '' : 'no'}>
            <Icon name={iconName('res', r.id)} /> {r.n}
          </span>
        ))}
        {cost.gear.map((g) => (
          <span key={g.id} className={(s.equipment[g.id] ?? 0) >= g.n ? '' : 'no'}>
            <Icon name={iconName('gear', g.id)} /> {g.n}
          </span>
        ))}
        <span>
            <Icon name="ui-person" /> {cost.people}
          </span>
        <span className="work">
            <Icon name="ui-time" /> {eta !== null ? `~${waitShort(eta)}` : `${cost.work} работы`}</span>
      </div>
      {cost.gear.length > 0 && smithy && (
        <button className="btn ghost wide" onClick={() => openBuilding(smithy.id)}>
          <Icon name="bld-smithy" /> Ковать {cost.gear.map((g) => EQUIPMENT_BY_ID[g.id].one).join(', ')}
        </button>
      )}

      <h3>Показатели в бою</h3>
      <div className="note">Нападение бьющего против защиты цели. Зависят от рода и снаряжения.</div>
      <div className="mod-list">
        {card.pips.map((p) => (
          <div className="mod" key={p.stat}>
            <span className="ico"><Icon name={p.stat.startsWith('fire') ? 'gear-bow' : p.stat.startsWith('shock') ? 'hud-army' : 'ui-whiteflag'} /></span>
            <span className="name">
              {p.name}
              <em className="sub">{p.what}</em>
            </span>
            <span className={`val ${p.value > 0 ? 'pos' : ''}`}>{p.value}</span>
          </div>
        ))}
      </div>
      {card.positions.length > 0 && (
        <div className="counters">
          {card.positions.map((c) => (
            <div className={`counter ${c.good ? 'good' : 'bad'}`} key={c.when}>
              <b>{c.text}</b>
              <small>{c.when}</small>
            </div>
          ))}
        </div>
      )}

      <h3>Сильные стороны</h3>
      <ul className="bullets good">
        {card.strengths.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <h3>Слабые стороны</h3>
      <ul className="bullets bad">
        {card.weaknesses.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <h3>Характер в бою</h3>
      <div className="note">Множитель потерь морали, чем меньше, тем стойче.</div>
      <div className="mod-list">
        {temperOf(card.kind).map((t) => (
          <div className="mod" key={t.when}>
            <span className="ico">{t.mult <= 1 ? 'res-stone' : 'ui-heartbreak'}</span>
            <span className="name">{t.when}</span>
            <span className={`val ${t.mult < 1 ? 'pos' : t.mult > 1 ? 'neg' : ''}`}>{t.text}</span>
          </div>
        ))}
      </div>

      <h3>Ходовые качества</h3>
      <div className="mod-list">
        <div className="mod">
          <span className="ico"><Icon name="ui-dagger" /></span>
          <span className="name">Натиск</span>
          <span className="val">{dec(stats.melee, 1)}</span>
        </div>
        <div className="mod">
          <span className="ico"><Icon name="gear-bow" /></span>
          <span className="name">Стрельба</span>
          <span className="val">{dec(stats.ranged, 1)}</span>
        </div>
        <div className="mod">
          <span className="ico"><Icon name="ui-tracks" /></span>
          <span className="name">Скорость</span>
          <span className="val">{stats.speed}</span>
        </div>
      </div>

      {hall && (
        <button
          className="btn wide"
          onClick={() => {
            // Найм откроется с этим видом, а не с верхней строкой (отзыв тестеров 11.10).
            askRecruit(troop);
            openBuilding(hall.id);
          }}
        >
          <Icon name="bld-barracks" /> Нанять
        </button>
      )}
    </div>
  );
}
