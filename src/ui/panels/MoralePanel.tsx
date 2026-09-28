// Справка по счастью из строки состояния. Все слагаемые берутся из `moraleBreakdown` —
// оттуда же, откуда их берёт симуляция: расходиться панели и расчёту негде.
import { useGame } from '@/game/store';
import { MORALE_GROWTH_ZERO } from '@/game/constants';
import { GATE_MORALE_LOST, GATE_MORALE_WON } from '@/world/data/tuning';
import {
  buildingOfType,
  decreeOf,
  moraleBreakdown,
  moraleOutputMult,
  policyMoralePerDay,
  rationOf,
  taxOf,
  type MoraleLine,
} from '@/game/derived';
import { moraleGrowthFactor } from '@/game/sim/population';

const sign = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n * 10) / 10)}`;

function Lines({ lines }: { lines: MoraleLine[] }) {
  if (lines.length === 0) return <div className="note">Ничего.</div>;
  return (
    <div className="mod-list">
      {lines.map((l) => (
        <div className="mod" key={l.id}>
          <span className="ico">{l.icon}</span>
          <span className="name">
            {l.name}
            <em className="sub">{l.hint}</em>
          </span>
          <span className={`val ${l.value > 0 ? 'pos' : l.value < 0 ? 'neg' : ''}`}>{sign(l.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function MoralePanel() {
  const s = useGame((g) => g.s);
  const openTownHall = useGame((g) => g.openTownHall);
  const openTab = useGame((g) => g.openTab);
  const b = moraleBreakdown(s);
  const morale = Math.round(s.morale);
  const output = moraleOutputMult(s.morale);
  const growth = moraleGrowthFactor(s.morale);
  const tax = taxOf(s);
  const decree = decreeOf(s);
  const ration = rationOf(s);
  const drift = policyMoralePerDay(s);
  const hall = buildingOfType(s, 'town_hall');

  // Ноль тоже показываем сверху: это рычаг, которым игрок пока не воспользовался.
  const up = b.lines.filter((l) => l.value >= 0).sort((a, c) => c.value - a.value);
  const down = b.lines.filter((l) => l.value < 0).sort((a, c) => a.value - c.value);
  if (b.tax > 0) {
    down.push({
      id: 'tax',
      icon: tax.icon,
      name: `Налог: ${tax.name.toLowerCase()}`,
      value: -b.tax,
      hint: 'вычитается уже после потолка шкалы',
    });
  }
  // Пир и обряд ложатся туда же, где вычитается налог, — после потолка шкалы. В
  // общий список они не попадают по той же причине: слагаемыми до потолка они не
  // являются. Строк две, а не одна: это два здания и два решения, и обряд без
  // пира, подписанный «Пиром в трактире», отправлял игрока не в то здание.
  if (b.rite > 0) {
    up.unshift({
      id: 'rite',
      icon: '🕯️',
      name: 'Обряд в приходе',
      value: b.rite,
      hint: 'прибавляется уже после потолка шкалы',
    });
  }
  if (b.feast > 0) {
    up.unshift({
      id: 'feast',
      icon: '🍺',
      name: 'Пир в трактире',
      value: b.feast,
      hint: 'прибавляется уже после потолка шкалы',
    });
  }

  return (
    <div className="panel">
      <h2>
        😊 Счастье <small>сейчас {morale} из 100</small>
      </h2>
      <div className="progress good" style={{ marginBottom: 10 }}>
        <div style={{ width: `${Math.max(0, Math.min(100, morale))}%` }} />
      </div>
      <p className="season-hint">
        Мораль — не украшение: она разом двигает и выработку, и прирост населения. Племя
        подтягивается к цели {Math.round(b.target)}, а не прыгает к ней сразу.
      </p>

      <h3>На что влияет прямо сейчас</h3>
      <div className="mod total">
        <span className="ico">⛏️</span>
        <span className="name">
          Выработка всех профессий
          <em className="sub">множитель к добыче каждого рабочего</em>
        </span>
        <span className={`val ${output >= 1 ? 'pos' : 'neg'}`}>×{output.toFixed(2)}</span>
      </div>
      <div className="mod total">
        <span className="ico">{growth >= 0 ? '📈' : '📉'}</span>
        <span className="name">
          Прирост населения
          <em className="sub">
            {growth < 0 ? `ниже ${MORALE_GROWTH_ZERO} — люди уходят` : 'множитель к приросту за день'}
          </em>
        </span>
        <span className={`val ${growth >= 0 ? 'pos' : 'neg'}`}>×{growth.toFixed(2)}</span>
      </div>
      <button className="btn ghost wide" onClick={() => openTab('pop')}>
        👥 Как считается прирост
      </button>

      <h3>Что добавляет</h3>
      <Lines lines={up} />

      <h3>Что отнимает</h3>
      <Lines lines={down} />

      <h3>Как складывается цель</h3>
      <div className="mod">
        <span className="ico">🏛️</span>
        <span className="name">Мораль устоявшегося племени</span>
        <span className="val">{b.base}</span>
      </div>
      <div className="mod">
        <span className="ico">➕</span>
        <span className="name">Со всеми слагаемыми</span>
        <span className="val">{Math.round(b.raw)}</span>
      </div>
      {b.raw > b.clamped && (
        <div className="mod">
          <span className="ico">🚧</span>
          <span className="name">Потолок шкалы</span>
          <span className="val">{b.clamped}</span>
        </div>
      )}
      {b.tax > 0 && (
        <div className="mod">
          <span className="ico">{tax.icon}</span>
          <span className="name">Минус налог</span>
          <span className="val neg">−{b.tax}</span>
        </div>
      )}
      {b.feast > 0 && (
        <div className="mod">
          <span className="ico">🍺</span>
          <span className="name">Плюс пир в трактире</span>
          <span className="val pos">+{b.feast}</span>
        </div>
      )}
      {b.rite > 0 && (
        <div className="mod">
          <span className="ico">🕯️</span>
          <span className="name">Плюс обряд</span>
          <span className="val pos">+{b.rite}</span>
        </div>
      )}
      <div className="mod total">
        <span className="ico">🎯</span>
        <span className="name">Цель, к которой идёт мораль</span>
        <span className="val pos">{Math.round(b.target)}</span>
      </div>

      <h3>Что двигает мораль изо дня в день</h3>
      <div className="mod">
        <span className="ico">{decree.icon}</span>
        <span className="name">
          Указ: {decree.name.toLowerCase()}
          <em className="sub">{decree.effect}</em>
        </span>
        <span className={`val ${decree.moralePerDay >= 0 ? 'pos' : 'neg'}`}>
          {sign(decree.moralePerDay)} в день
        </span>
      </div>
      <div className="mod">
        <span className="ico">{ration.icon}</span>
        <span className="name">
          Рацион: {ration.name.toLowerCase()}
          <em className="sub">{ration.effect}</em>
        </span>
        <span className={`val ${ration.moralePerDay >= 0 ? 'pos' : 'neg'}`}>
          {sign(ration.moralePerDay)} в день
        </span>
      </div>
      <div className="mod total">
        <span className="ico">📅</span>
        <span className="name">Итого сдвиг за игровой день</span>
        <span className={`val ${drift >= 0 ? 'pos' : 'neg'}`}>{sign(drift)}</span>
      </div>
      <div className="mod">
        <span className="ico">⚔️</span>
        <span className="name">
          Бои у стен посёлка
          <em className="sub">
            отбитый набег +{GATE_MORALE_WON}, проигранный −{GATE_MORALE_LOST} сразу
          </em>
        </span>
        <span className="val">
          {s.stats.battlesWon} : {s.stats.battlesLost}
        </span>
      </div>
      {hall && (
        <button className="btn ghost wide" onClick={() => openTownHall('manage')}>
          🏛️ В ратушу — указ, рацион и налог
        </button>
      )}
    </div>
  );
}
