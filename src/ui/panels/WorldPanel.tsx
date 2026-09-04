// Карточка клетки карты. Открывается тапом по клетке и живёт в той же нижней шторке,
// что и панели зданий: тап — карточка — действие, без отдельных экранов.
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld } from '@/world/store';
import { defense, soldierPower } from '@/game/derived';
import { sendableUnits } from '@/game/sim/expedition';
import { formatCoord, formatLeft, marchSeconds } from '@/world/geo';
import { formatAge, formatEstimate, PRECISION_NOTE } from '@/world/intel';
import { CASTLE_ICON, MISSIONS, RELATION_META, STAGE_BY_ID } from '@/world/data/meta';
import { TERRAIN_META } from '@/world/data/terrain';
import type { Mission, UnitStack } from '@/world/types';
import { UNITS, UNIT_BY_ID, stackSize } from '@/world/data/units';
import { homeTroops } from '@/world/bridge';
import { troopTotal } from '@/game/battle/kinds';

const fmt = (n: number): string => (Math.abs(n) >= 100 ? String(Math.round(n)) : (Math.round(n * 10) / 10).toString());

/**
 * Какие юниты имеют смысл в этой миссии. Набега здесь нет: он ушёл в подготовку
 * похода — там состав выбирается по видам бойцов, а не одним числом воинов.
 */
const ALLOWED: Record<Mission, ('warrior' | 'scout')[]> = {
  raid: ['warrior', 'scout'],
  scout: ['scout'],
  support: ['warrior'],
};

export function WorldPanel({ x, y }: { x: number; y: number }) {
  const s = useGame((g) => g.s);
  const closeMap = useGame((g) => g.closeMap);
  const showToast = useGame((g) => g.showToast);
  const openBattle = useGame((g) => g.openBattle);
  const openDefense = useGame((g) => g.openDefense);
  const card = useWorld((g) => g.card);
  const terrain = useWorld((g) => g.cardTerrain);
  const loading = useWorld((g) => g.cardLoading);
  const send = useWorld((g) => g.send);
  const [mission, setMission] = useState<Mission | null>(null);
  const [pick, setPick] = useState<UnitStack>({});
  const [busy, setBusy] = useState(false);

  // Новая клетка — новый выбор: состав отряда от прошлой цели тут ни при чём.
  useEffect(() => {
    setMission(null);
    setPick({});
  }, [x, y]);

  const here = { x, y };
  const home = useWorld((g) => g.info?.home ?? null);
  const homeDist = home ? Math.hypot(home.x - x, home.y - y) : 0;

  if (!card) {
    return (
      <div className="panel">
        <h2>
          Пустая земля <small>{formatCoord(here)}</small>
        </h2>
        <div className="desc">
          {loading
            ? 'Смотрим, кто здесь…'
            : `${terrain ? TERRAIN_META[terrain].name : 'Земля'}. Здесь никто не живёт — идти сюда незачем.`}
        </div>
        <div className="mod-list">
          <div className="mod">
            <span className="ico">📏</span>
            <span className="name">От нашей деревни</span>
            <span className="val">{fmt(homeDist)} кл.</span>
          </div>
        </div>
      </div>
    );
  }

  const stage = STAGE_BY_ID[card.stage];
  const relation = RELATION_META[card.relation];
  const have = sendableUnits(s);
  // Вся дружина, что дома, — состав быстрой атаки.
  const army = homeTroops(s);
  const quick = troopTotal(army);
  const strength = soldierPower(s);
  const def = defense(s);
  const picked = { warrior: pick.warrior ?? 0, scout: pick.scout ?? 0 };
  const eta = marchSeconds(card.distance, card.terrainFactor, picked);
  const defAfter = Math.max(0, def - picked.warrior * (strength + 0.25) - picked.scout * 0.25);

  const setUnit = (id: 'warrior' | 'scout', n: number): void => {
    setPick((p) => ({ ...p, [id]: Math.max(0, Math.min(have[id], n)) }));
  };

  const start = (m: Mission): void => {
    setMission(m);
    // Разведку обычно шлют вдвоём — так один потерянный не срывает всё дело.
    setPick(m === 'scout' ? { scout: Math.min(2, have.scout) } : { warrior: have.warrior });
  };

  /**
   * Быстрая атака: вся дружина, что дома, и расстановка по пресету. Пресета
   * четыре, выбирает его сид похода — поэтому шаблон не становится известным
   * и его нечем контрить заранее.
   */
  const quickAttack = async (): Promise<void> => {
    if (!card || quick === 0) return;
    setBusy(true);
    const err = await send({ target: card.id, mission: 'raid', units: { warrior: quick }, troops: army });
    setBusy(false);
    if (err) {
      showToast(err);
      return;
    }
    showToast('Дружина вышла.');
  };

  const doSend = async (): Promise<void> => {
    if (!mission) return;
    setBusy(true);
    const err = await send({ target: card.id, mission, units: picked });
    setBusy(false);
    if (err) {
      showToast(err);
      return;
    }
    setMission(null);
    setPick({});
    showToast('Отряд вышел.');
  };

  return (
    <div className="panel">
      <div className="bhead">
        <div className="ico">{card.castle ? CASTLE_ICON : stage.icon}</div>
        <div className="body">
          <div className="name">{card.name}</div>
          <div className="lvl">
            {card.castle ? 'Замок' : stage.name} ·{' '}
            <span style={{ color: relation.color }}>{relation.name}</span>
          </div>
        </div>
        <span className="wm-coord-tag">{formatCoord(card)}</span>
      </div>

      <div className="mod-list">
        <div className="mod">
          <span className="ico">👤</span>
          <span className="name">Владелец</span>
          <span className="val">{card.owner ?? 'ничей'}</span>
        </div>
        <div className="mod">
          <span className="ico">🏳️</span>
          <span className="name">Племя</span>
          <span className="val" style={{ color: relation.color }}>
            {card.tribeName ?? 'нет'}
          </span>
        </div>
        <div className="mod">
          <span className="ico">📏</span>
          <span className="name">Расстояние</span>
          <span className="val">{fmt(card.distance)} кл.</span>
        </div>
        <div className="mod">
          <span className="ico">🛡️</span>
          <span className="name">Ход воинов</span>
          <span className="val">{formatLeft(marchSeconds(card.distance, card.terrainFactor, { warrior: 1 }))}</span>
        </div>
        <div className="mod">
          <span className="ico">👣</span>
          <span className="name">Ход разведки</span>
          <span className="val">{formatLeft(marchSeconds(card.distance, card.terrainFactor, { scout: 1 }))}</span>
        </div>
      </div>

      <h3>Войско</h3>
      <div className="mod-list">
        <div className="mod">
          <span className="ico">⚔️</span>
          <span className="name">Мощь</span>
          <span className={`val ${card.power.precision === 'unknown' ? 'neg' : ''}`}>
            {formatEstimate(card.power)}
          </span>
        </div>
        <div className="mod">
          <span className="ico">👥</span>
          <span className="name">Население</span>
          <span className="val">{formatEstimate(card.pop)}</span>
        </div>
      </div>
      {card.castle && (
        <p className="note">
          В замке казна: удачный набег приносит золото — тем больше, чем сильнее разбит гарнизон.
          Гарнизон здесь крепче обычного, и слабый отряд вернётся ни с чем.
        </p>
      )}
      {card.mine ? (
        <p className="note">Свои силы видны всегда. Чужие — только после разведки.</p>
      ) : card.intel ? (
        <p className={`note${card.intel.precision === 'exact' ? '' : ' bad'}`}>
          Данные получены {formatAge(card.intel.ageSeconds)} — {PRECISION_NOTE[card.intel.precision]}.
        </p>
      ) : (
        <p className="note bad">Про это место мы ничего не знаем. Сначала разведка.</p>
      )}

      <h3>Что делать</h3>
      <div className="wm-actions">
        {card.can.open && (
          <>
            <button className="btn wide" onClick={closeMap}>
              🏘️ Открыть деревню
            </button>
            <button className="btn ghost wide" onClick={openDefense}>
              🛡️ Оборона деревни
            </button>
          </>
        )}
        {card.can.raid && (
          <>
            {/* Одним тапом, без захода в подготовку: обычный игрок должен
                уложиться в десяток секунд. Расстановку выберет пресет по сиду
                похода — противник не знает, какой из четырёх пришёл. */}
            <button className="btn wide" disabled={quick === 0 || busy} onClick={() => void quickAttack()}>
              ⚔️ Быстрая атака · всей дружиной ({quick})
            </button>
            <button className="btn ghost wide" disabled={quick === 0} onClick={() => openBattle(card.id)}>
              🎯 Настроить тактику
            </button>
            {quick === 0 && <p className="note bad">Бойцов дома нет — воевать некем.</p>}
          </>
        )}
        {MISSIONS.filter((m) => m.id !== 'raid' && card.can[m.id]).map((m) => (
          <button
            key={m.id}
            className={`btn${mission === m.id ? '' : ' ghost'}`}
            // Проводка ведёт к разведке: пока миссия не выбрана — к этой кнопке,
            // потом — к кнопке отправки ниже (см. data-tut там).
            data-tut={m.id === 'scout' && mission !== 'scout' ? 'scout' : undefined}
            onClick={() => (mission === m.id ? setMission(null) : start(m.id))}
          >
            {m.icon} {m.name}
          </button>
        ))}
      </div>
      {card.note && !card.can.support && <p className="note">{card.note}</p>}

      {mission && (
        <>
          <h3>Отряд</h3>
          {ALLOWED[mission].map((id) => {
            const def0 = UNIT_BY_ID[id];
            const max = have[id];
            const n = picked[id];
            return (
              <div className="slot pick" key={id}>
                <span className="ico">{def0.icon}</span>
                <span className="who">
                  {def0.name}
                  <i className="talent">дома {max}</i>
                </span>
                <div className="stepper">
                  <button disabled={n <= 0} onClick={() => setUnit(id, n - 1)}>
                    −
                  </button>
                  <span className="n">{n}</span>
                  <button disabled={n >= max} onClick={() => setUnit(id, n + 1)}>
                    +
                  </button>
                </div>
                <button className="mini text" disabled={max <= 0 || n >= max} onClick={() => setUnit(id, max)}>
                  все
                </button>
              </div>
            );
          })}

          <div className="mod-list">
            <div className="mod">
              <span className="ico">⏱</span>
              <span className="name">Дорога туда</span>
              <span className="val">{stackSize(picked) > 0 ? formatLeft(eta) : '—'}</span>
            </div>
            <div className="mod">
              <span className="ico">↩️</span>
              <span className="name">И столько же обратно</span>
              <span className="val">{stackSize(picked) > 0 ? formatLeft(eta) : '—'}</span>
            </div>
            <div className="mod total">
              <span className="ico">🏠</span>
              <span className="name">Оборона деревни станет</span>
              <span className={`val ${defAfter < def * 0.5 ? 'neg' : ''}`}>
                {fmt(def)} → {fmt(defAfter)}
              </span>
            </div>
          </div>
          <p className={`note${picked.warrior > 0 ? ' bad' : ''}`}>
            {picked.warrior > 0
              ? 'Пока отряд в пути, эти воины деревню не защищают. Отозвать можно в любой момент.'
              : 'Разведчики уходят из строителей: стройка на это время замедлится.'}
          </p>

          <button
            className="btn wide"
            data-tut={mission === 'scout' ? 'scout' : undefined}
            disabled={busy || stackSize(picked) === 0}
            onClick={() => void doSend()}
          >
            {MISSIONS.find((m) => m.id === mission)?.icon} Отправить{' '}
            {UNITS.filter((u) => picked[u.id] > 0)
              .map((u) => `${u.icon}${picked[u.id]}`)
              .join(' ')}
          </button>
        </>
      )}
    </div>
  );
}
