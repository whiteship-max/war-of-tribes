// Невольники: сколько их, где стоят и как отпустить. Прежде — раздел окна «Жители»; невольники — не жители (число своё,
// `s.bonded`, и окно своё — «Порядок»), поэтому раздел переехал в «Порядок» (UI-5, docs/ui_v2.md, 5.4), а в «Жителях»
// осталась строка-ссылка. Устроены они как жители — числом, а не списком, — и на работы их ставят там же, где вольных: в
// окне двора, вторым рядом шага. Здесь видно, где они стоят, и здесь же их отпускают: одно дело — одно место.
//
// Отпуск необратим — двумя касаниями одной кнопки (О4): первое — «Точно?», второе — дело. Окно двух касаний одно на игру
// (`kit/twotap`); сам набор с его стилем сюда не тянется — «Порядок» едет в первой загрузке.
import { useState } from 'react';
import { useGame } from '@/game/store';
import { BONDED_OUTPUT } from '@/game/constants';
import { JOB_BY_ID } from '@/game/data/jobs';
import { jobsOf } from '@/game/data/buildings';
import { ORDER_TEXT } from '@/game/data/order';
import {
  bondedCount,
  bondedIdle,
  bondedIncoming,
  bondedTotal,
  buildingOfType,
  buildingSlots,
  buildingTitle,
  currentSite,
  deedBonded,
  workerCount,
} from '@/game/derived';
import { releaseBonded } from '@/game/sim/actions';
import { useTwoTap } from '@/ui/kit/twotap';
import { Steps } from './Steps';
import { Icon } from '@/ui/icons/Icon';
import { iconName } from '@/ui/icons/registry';

/** Сколько их и где стоят; пусто — откуда они берутся и дверь на рынок. */
export function BondedPlaces() {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const total = bondedTotal(s);
  const incoming = bondedIncoming(s);
  const market = buildingOfType(s, 'market');

  if (total <= 0 && incoming <= 0) {
    return (
      <>
        <h3>
          {ORDER_TEXT.bondedName} <span className="muted">нет</span>
        </h3>
        <div className="note">{ORDER_TEXT.about(BONDED_OUTPUT)}</div>
        <div className="note">{ORDER_TEXT.whereFrom}</div>
        {market && (
          <button className="btn ghost wide" onClick={() => openBuilding(market.id)}>
            <Icon name="bld-market" /> На рынок
          </button>
        )}
      </>
    );
  }

  const places = s.buildings.filter((b) => bondedCount(s, b.id) > 0);
  const site = currentSite(s);
  return (
    <>
      <h3>
        Где {ORDER_TEXT.bondedName.toLowerCase()} <span className="muted">{total}</span>
      </h3>
      <div className="note">{ORDER_TEXT.about(BONDED_OUTPUT)}</div>
      {incoming > 0 && (
        <div className="mod">
          <span className="ico"><Icon name="bld-market" /></span>
          <span className="name">Ведут торговцы</span>
          <span className="val">{incoming}</span>
        </div>
      )}
      {places.map((b) => {
        const jobs = jobsOf(b.type).filter((j) => deedBonded(s, j) > 0);
        return (
          <button className="card as-row" key={b.id} onClick={() => openBuilding(b.id)}>
            <div className="ico">
              <Icon name={iconName('bld', b.type)} />
            </div>
            <div className="body">
              <div className="title">
                {buildingTitle(s, b.type)}
                <span className="count">{bondedCount(s, b.id)}</span>
              </div>
              <div className="desc">
                {jobs.length ? `${jobs.map((j) => JOB_BY_ID[j].name).join(', ')} · ` : ''}вольных {workerCount(s, b.id)} · мест {buildingSlots(b)}
              </div>
            </div>
          </button>
        );
      })}
      <div className="mod">
        <span className="ico"><Icon name="ui-hammer" /></span>
        <span className="name">
          {site ? 'Без места — на стройке' : 'Без места — не работают'}
          <em className="sub">на работу ставят в окне здания</em>
        </span>
        <span className="val">{bondedIdle(s)}</span>
      </div>
    </>
  );
}

/** Отпустить: шаг по десять и кнопка двумя касаниями. Невольников нет — ничего. */
export function BondedRelease() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const [pick, setPick] = useState(10);
  const [armed, arm, disarm] = useTwoTap();
  const total = bondedTotal(s);
  if (total <= 0) return null;
  const count = Math.max(1, Math.min(pick, total));
  return (
    <>
      <div className="note">{ORDER_TEXT.releaseAbout}</div>
      <Steps
        value={count}
        max={total}
        spare={total - count}
        step={10}
        onChange={(d) => {
          disarm();
          setPick(Math.max(1, Math.min(total, count + d)));
        }}
      />
      <button
        className={`btn wide${armed ? ' armed' : ''}`}
        onClick={() => {
          if (!armed) return arm();
          disarm();
          act((st) => releaseBonded(st, count));
        }}
      >
        {armed ? (
          'Точно?'
        ) : (
          <>
            <Icon name={ORDER_TEXT.bondedIcon} /> Отпустить {count} из {total}
          </>
        )}
      </button>
    </>
  );
}
