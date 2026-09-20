// Карточка вида бойцов. Всё содержимое приходит из `troopCard()` — здесь только
// разметка. Ни одного множителя, ни одной сильной стороны и ни одного условия
// в этом файле руками не написано: правка баланса меняет карточку сама.
import type { TroopId } from '@/game/types';
import { useGame } from '@/game/store';
import { RESOURCE_META } from '@/game/constants';
import { EQUIPMENT_BY_ID } from '@/game/data/equipment';
import { buildingOfType } from '@/game/derived';
import { recruitCheck } from '@/game/sim/army';
import { temperOf, troopCard } from '@/game/battle/describe';
import { weightOf } from '@/game/battle/kinds';
import { GEAR } from '@/battle';
import { Icon } from '@/ui/icons/Icon';
import { waitShort } from './wait';

/** Полоска величины в своём потолке: мощь среди видов, мораль в шкале боя. */
function Bar({
  icon,
  label,
  value,
  max,
  note,
  tone,
}: {
  icon: string;
  label: string;
  value: number;
  max: number;
  note: string;
  tone?: string;
}) {
  return (
    <div className="res-line">
      <span className="ico">{icon}</span>
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
  const { def, meta, morale, cost, stats } = card;
  const have = Math.max(0, s.army[troop] ?? 0);
  // Срок одного бойца — тем же расчётом, что у кнопки найма: с его видом, а у
  // всадника, значит, и с конюшней.
  const eta = recruitCheck(s, troop, 1).eta;
  const barracks = buildingOfType(s, 'barracks');
  const smithy = buildingOfType(s, 'smithy');
  const outs = card.counters.filter((c) => c.dir === 'out');
  const ins = card.counters.filter((c) => c.dir === 'in');

  return (
    <div className="panel">
      <button className="btn ghost back" onClick={onBack}>
        ← К дружине
      </button>

      <div className="bhead">
        <div className="ico">
          <Icon name={`troop-${def.id}`} glyph={def.icon} />
        </div>
        <div className="body">
          <div className="name">{def.name}</div>
          <div className="lvl">
            {meta.icon} {meta.name} · снаряжение {morale.gearLevel} из {GEAR.max} · в деревне {have}
          </div>
        </div>
      </div>
      <p className="season-hint">{def.description}</p>

      <h3>Чего он стоит в бою</h3>
      <Bar icon="⚔️" label="Мощь бойца" value={def.power} max={card.powerMax} note={`из ${card.powerMax} у сильнейшего`} />
      <Bar
        icon="🏳️"
        label="Мораль"
        value={morale.total}
        max={morale.max}
        note={`из ${morale.max}`}
        tone={morale.total >= morale.max * 0.6 ? undefined : 'full'}
      />
      <div className="mod">
        <span className="ico">🏳️</span>
        <span className="name">Мораль рода {meta.name.toLowerCase()}</span>
        <span className="val">{morale.base}</span>
      </div>
      <div className="mod">
        <span className="ico">⚒️</span>
        <span className="name">
          За снаряжение
          <em className="sub">ступень {morale.gearLevel} по +{GEAR.moralePerLevel}</em>
        </span>
        <span className={`val ${morale.gear > 0 ? 'pos' : ''}`}>
          {morale.gear > 0 ? '+' : ''}
          {morale.gear}
        </span>
      </div>
      <div className="mod total">
        <span className="ico">🛡️</span>
        <span className="name">Итого мораль</span>
        <span className="val pos">{morale.total}</span>
      </div>

      {card.nextGear && (
        <>
          <h3>Следующая ступень снаряжения</h3>
          <div className="mod total">
            <span className="ico">⬆️</span>
            <span className="name">
              Ступень {card.nextGear.level} из {GEAR.max}
              <em className="sub">
                {card.nextGear.example
                  ? `в племени это ${card.nextGear.example.name.toLowerCase()}`
                  : 'такого вида в племени пока нет'}
              </em>
            </span>
            <span className="val pos">
              мораль {card.nextGear.morale} (+{card.nextGear.gain})
            </span>
          </div>
        </>
      )}

      <h3>Цена одного бойца</h3>
      <div className="cost">
        {cost.resources.map((r) => (
          <span key={r.id} className={s.resources[r.id] >= r.n ? '' : 'no'}>
            <Icon name={`res-${r.id}`} glyph={RESOURCE_META[r.id].icon} /> {r.n}
          </span>
        ))}
        {cost.gear.map((g) => (
          <span key={g.id} className={(s.equipment[g.id] ?? 0) >= g.n ? '' : 'no'}>
            <Icon name={`gear-${g.id}`} glyph={EQUIPMENT_BY_ID[g.id].icon} /> {g.n}
          </span>
        ))}
        <span>👤 {cost.people}</span>
        <span className="work">⏱ {eta !== null ? `~${waitShort(eta)}` : `${cost.work} работы`}</span>
      </div>
      {cost.gear.length > 0 && smithy && (
        <button className="btn ghost wide" onClick={() => openBuilding(smithy.id)}>
          ⚒️ В кузницу — ковать {cost.gear.map((g) => EQUIPMENT_BY_ID[g.id].one).join(', ')}
        </button>
      )}

      <h3>Против кого</h3>
      <div className="note">
        Превосходство в бою условно: почти каждый множитель работает только при своём условии.
      </div>
      <div className="counters">
        {outs.map((c) => (
          <div className={`counter ${c.good ? 'good' : 'bad'}`} key={c.id}>
            <b>{c.text}</b>
            <small>{c.when}</small>
          </div>
        ))}
      </div>
      <h3>Чем бьют его</h3>
      <div className="counters">
        {ins.map((c) => (
          <div className={`counter ${c.good ? 'good' : 'bad'}`} key={c.id}>
            <b>{c.text}</b>
            <small>{c.when}</small>
          </div>
        ))}
      </div>

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
      <div className="note">Множитель всех потерь морали: меньше — держится дольше.</div>
      <div className="mod-list">
        {temperOf(card.kind).map((t) => (
          <div className="mod" key={t.when}>
            <span className="ico">{t.mult <= 1 ? '🪨' : '💔'}</span>
            <span className="name">{t.when}</span>
            <span className={`val ${t.mult < 1 ? 'pos' : t.mult > 1 ? 'neg' : ''}`}>{t.text}</span>
          </div>
        ))}
      </div>

      <h3>Приказы этому роду</h3>
      <div className="mod-list">
        {card.orders.map((o) => (
          <div className="mod" key={o.id}>
            <span className="ico">📜</span>
            <span className="name">{o.name}</span>
          </div>
        ))}
      </div>

      <h3>Ходовые качества</h3>
      <div className="mod-list">
        <div className="mod">
          <span className="ico">🗡️</span>
          <span className="name">Рукопашная</span>
          <span className="val">{stats.melee.toFixed(1)}</span>
        </div>
        <div className="mod">
          <span className="ico">🏹</span>
          <span className="name">Стрельба</span>
          <span className="val">{stats.ranged.toFixed(1)}</span>
        </div>
        <div className="mod">
          <span className="ico">🛡️</span>
          <span className="name">Сколько урона на одного выбитого</span>
          <span className="val">{stats.toughness.toFixed(1)}</span>
        </div>
        <div className="mod">
          <span className="ico">🐾</span>
          <span className="name">Скорость</span>
          <span className="val">{stats.speed}</span>
        </div>
        <div className="mod">
          <span className="ico">⚖️</span>
          <span className="name">Бойцов строя за одного</span>
          <span className="val">{weightOf(troop).toFixed(1)}</span>
        </div>
      </div>

      {barracks && (
        <button className="btn wide" onClick={() => openBuilding(barracks.id)}>
          ⚔️ В казармы — нанять
        </button>
      )}
    </div>
  );
}
