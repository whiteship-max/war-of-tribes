// Окно осады глазами осаждающего: наш лагерь под чужим городом. Открывается по лагерю —
// из карточки города и из меню полководца, — и собирает в одно место то, что было
// разбросано по ним: чей город и чем держится, сколько ему хлеба, как растут стороны
// лагеря, как делить древесину, какую участь объявить и что приказать.
//
// Своей арифметики у окна нет. Хлеб — мировые часы (`starvesAt`), стороны лагеря — та
// же `throughWorks`, что у боя (`works.campSides`), доли древесины — приказом мира
// (`setWood`), строки участи — дверь участи на тех же числах (`CampView.fates`).
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld, worldNow } from '@/world/store';
import { realLeft, realMinutes } from '@/ui/parts/wait';
import { REST_WHY, restLine } from '@/ui/parts/restWords';
import { hungerLeft } from '@/ui/parts/hunger';
import { sideReady } from '@/ui/parts/campSide';
import { formatEstimate } from '@/world/intel';
import { CAMP_LEAVE, STORM_HOLDS } from '@/world/siege';
import { MACHINE_SHARES, type MachineId } from '@/world/data/machines';
import { SIEGE_PHASE } from '@/world/data/siegeroll';
import { FATE_META } from '@/world/data/fates';
import { CASTLE_ICON, STAGE_BY_ID } from '@/world/data/meta';
import { SIDES, SIDE_NAME, WOOD_SHARES, campSides, playerWood, woodShare, worksRipeAt } from '@/world/works';
import type { CampView, Fate } from '@/world/types';
import { FatePick } from '@/ui/parts/FatePick';
import { plural } from '@/ui/parts/plural';
import { SiegePhases } from '@/ui/parts/SiegePhases';
import { SiegeParley } from '@/ui/parts/SiegeParley';

/**
 * Сроки из подсказки к долям — той же функцией, которой считаются стороны: при
 * другой древесине подсказка поменяется сама, а не станет неправдой.
 */
const WOOD_ALL_FRONT = realMinutes(worksRipeAt(0, 'front', playerWood(1)));
const WOOD_HALVES = realMinutes(worksRipeAt(0, 'front', playerWood(0.5)));

/** Как доля фронту называется на кнопке. */
/** Доля древесины машинам словами на кнопке. */
const MACHINE_SHARE_NAME: Record<number, string> = { 0: 'Ничего', 0.25: 'Четверть', 0.5: 'Половину', 0.75: 'Три четверти', 1: 'Всё' };

/** Состояние машины словами: стоит, строится (через сколько), не строится. */
function machineState(e: NonNullable<CampView['machines']>['list'][number], now: number): string {
  if (e.state === 'ready') return 'готова';
  if (e.state === 'none') return 'не заказана';
  if (e.readyAt === undefined || !Number.isFinite(e.readyAt)) return 'не строится: машинам не отдано леса';
  const left = Math.max(0, e.readyAt - now);
  return `готова через ${realLeft(left / 1000)} (${Math.max(1, Math.ceil(left / SIEGE_PHASE))} ${plural(Math.max(1, Math.ceil(left / SIEGE_PHASE)), 'фаза', 'фазы', 'фаз')})`;
}

const SHARE_NAME: Record<number, string> = {
  1: 'Всё к городу',
  0.75: 'Три четверти',
  0.5: 'Поровну',
  0.25: 'Четверть',
  0: 'Всё в тыл',
};

/** Выручка, идущая на лагерь, словами: кто, сколько и когда ударит. Числа — из мира (`CampView.relief`). */
export function reliefLine(r: NonNullable<CampView['relief']>, now: number): string {
  const left = realLeft(Math.max(0, (r.at - now) / 1000));
  return `На лагерь идёт выручка: «${r.from}», ${r.men} ${plural(r.men, 'боец', 'бойца', 'бойцов')}. Ударит через ${left}${
    r.joint ? ', гарнизон выйдет навстречу' : ''
  }.`;
}

export function CampPanel() {
  const showToast = useGame((g) => g.showToast);
  const closeSheet = useGame((g) => g.closeSheet);
  const camp = useWorld((g) => g.camp);
  const loadCamp = useWorld((g) => g.loadCamp);
  const besiege = useWorld((g) => g.besiege);
  const attack = useWorld((g) => g.attack);
  const retreat = useWorld((g) => g.retreat);
  const setWood = useWorld((g) => g.setWood);
  const setMachineWood = useWorld((g) => g.setMachineWood);
  const orderMachine = useWorld((g) => g.orderMachine);
  const [use, setUse] = useState<MachineId[] | null>(null);
  const campCraft = useWorld((g) => g.campCraft);
  const setOrders = useWorld((g) => g.setOrders);
  const [pick, setPick] = useState<Fate | null>(null);
  const [busy, setBusy] = useState(false);
  const [, retick] = useState(0);

  useEffect(() => {
    void loadCamp();
  }, [loadCamp]);

  useEffect(() => {
    if (!camp) return;
    const t = setInterval(() => retick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [camp]);

  if (!camp) {
    return (
      <div className="panel">
        <div className="bhead">
          <div className="ico">⛺</div>
          <div className="body">
            <div className="name">Лагеря нет</div>
          </div>
        </div>
        <p className="note">Осаду ставит полководец у чужих стен.</p>
      </div>
    );
  }

  const now = worldNow();
  const sides = campSides(camp, now);
  const share = woodShare(camp.wood);
  const chosen = pick ?? camp.fate;
  const option = camp.fates.find((o) => o.id === chosen) ?? null;
  const stage = STAGE_BY_ID[camp.stage];
  const kind = camp.castle ? 'Город соседа' : camp.lair ? 'Логово' : stage.name;
  const walls = camp.castle ? 'держит гарнизон' : 'без стен';

  const order = async (fn: () => Promise<string | null>, done: string, close = false): Promise<void> => {
    setBusy(true);
    const err = await fn();
    setBusy(false);
    showToast(err ?? done);
    if (!err && close) closeSheet();
  };

  const sameFate = chosen === camp.fate;
  const cantFate = option && !option.can ? option.reason : null;

  return (
    <div className="panel">
      <div className="bhead">
        <div className="ico">{camp.castle ? CASTLE_ICON : stage.icon}</div>
        <div className="body">
          <div className="name one-line">{camp.targetName}</div>
          <div className="lvl">
            {kind} · {walls}
          </div>
        </div>
      </div>

      <h3>Цель</h3>
      <div className="mod-list">
        <div className="mod">
          <span className="ico">🛡️</span>
          <span className="name">Мощь гарнизона</span>
          <span className={`val${camp.power.precision === 'unknown' ? ' neg' : ''}`}>{formatEstimate(camp.power)}</span>
        </div>
        <div className="mod total">
          <span className="ico">⏳</span>
          <span className="name">Еды хватит на</span>
          <span className="val pos">{hungerLeft(camp.starvesAt, now)}</span>
        </div>
        {/* Гарнизон — той же точностью, что мощь: точное число знает только разведка (docs/siege_audit.md, 10). */}
        <div className="mod">
          <span className="ico">🍞</span>
          <span className="name">Гарнизон ест вместе с городом</span>
          <span className={`val${camp.garrison.precision === 'unknown' ? ' neg' : ''}`}>{formatEstimate(camp.garrison)}</span>
        </div>
        <div className="mod">
          <span className="ico">⛺</span>
          <span className="name">Лагерь стоит</span>
          <span className="val">{realLeft(Math.max(0, (now - camp.since) / 1000))}</span>
        </div>
      </div>
      {/* Выручка, идущая на лагерь (siege_audit, 6): у логова — отряд соседей по донесению, у города игрока — его полководец. */}
      {camp.relief && <p className="note bad">{reliefLine(camp.relief, now)}</p>}

      <h3>Лагерь</h3>
      <div className="mod-list">
        {SIDES.map((side) => {
          const t = sides[side];
          return (
            <div className="mod" key={side}>
              <span className="ico">{side === 'front' ? '🏘️' : '🌾'}</span>
              <span className="name">{SIDE_NAME[side]}</span>
              <span className="val">{sideReady(t, now)}</span>
            </div>
          );
        })}
      </div>
      {/* Под городом соседа древесину не делят: кнопок, которые только отказывают, нет — есть строка (siege_audit, 3). */}
      {camp.woodFixed ? (
        <p className="note">
          {camp.woodFixed} Сторона города дозреет за {WOOD_ALL_FRONT}.
        </p>
      ) : (
        <>
          <p className="note">
            Всё к городу — сторона города дозреет за {WOOD_ALL_FRONT}. Поровну — обе за {WOOD_HALVES}. Вложенное не
            пропадает.
          </p>
          <div className="fate-shares">
            {WOOD_SHARES.map((sh) => (
              <button
                key={sh}
                className={`mini${share === sh ? ' on' : ''}`}
                disabled={busy || share === sh}
                onClick={() => void order(() => setWood(sh), `Древесина: ${SHARE_NAME[sh].toLowerCase()}.`)}
              >
                {SHARE_NAME[sh]}
              </button>
            ))}
          </div>
        </>
      )}
      {/* Осадные машины из древесины лагеря (world/machines, docs/siege_v2.md, 4.3): доля леса, очередь, отказ — из мира. */}
      {camp.machines && (
        <>
          <h3>Машины</h3>
          <p className="note">Лес машинам: {MACHINE_SHARE_NAME[camp.machines.share] ?? `${Math.round(camp.machines.share * 100)} %`}. Остальное идёт на рогатки.</p>
          <div className="fate-shares">
            {MACHINE_SHARES.map((sh) => (
              <button
                key={sh}
                className={`mini${camp.machines?.share === sh ? ' on' : ''}`}
                disabled={busy || camp.machines?.share === sh}
                onClick={() => void order(() => setMachineWood(sh), `Машинам: ${MACHINE_SHARE_NAME[sh].toLowerCase()}.`)}
              >
                {MACHINE_SHARE_NAME[sh]}
              </button>
            ))}
          </div>
          {camp.machines.list.map((e) => (
            <div key={e.id}>
              <button
                className="btn wide"
                disabled={busy || !e.can}
                onClick={() => void order(() => orderMachine(e.id), `${e.name}: заказано.`)}
              >
                {e.name} · {machineState(e, now)}
              </button>
              <p className={`note${e.can || e.state !== 'none' ? '' : ' bad'}`}>{e.state === 'none' && e.reason ? e.reason : e.use}</p>
            </div>
          ))}
        </>
      )}

      {/* Мораль между боями (14.31): наш лагерь — дружина; после вылазки штурмовать сразу — уставшими. */}
      {camp.campRest && (
        <p className="note warn">
          {restLine(camp.campRest, 'Лагерь дрался', now)} {REST_WHY}
        </p>
      )}

      {/* Ход осады фазами и наказы на отлучку (world/siegeroll): журнал, поправки и проломы — из мира. */}
      {camp.phases && (
        <SiegePhases
          phases={camp.phases}
          now={now}
          busy={busy}
          onOrders={(o) => void order(() => setOrders(o), 'Наказы поставлены.')}
        />
      )}

      {/* Переговоры у стен (docs/siege_v2.md, раздел 7): условия сдачи, дань, наказ брать дань — числа из мира. */}
      {camp.parley && <SiegeParley view={camp.parley} fate={camp.fate} now={now} orders={camp.phases?.orders} busy={busy} />}

      {/* Дела полководца в лагере (world/siegecraft): за энергию, не больше предела за осаду. Числа и отказ — из мира. */}
      {camp.crafts && camp.crafts.length > 0 && (
        <>
          <h3>Дела в лагере</h3>
          {camp.crafts.map((c) => (
            <div key={c.act}>
              <button
                className="btn wide"
                disabled={busy || !c.can}
                onClick={() => void order(() => campCraft(c.act), `${c.name[0].toUpperCase()}${c.name.slice(1)}: сделано.`)}
              >
                {c.name[0].toUpperCase()}
                {c.name.slice(1)} · {c.done} из {c.max} · энергия {c.energy.price}
              </button>
              <p className={`note${c.can ? '' : ' bad'}`}>{c.can ? c.gain : c.reason}</p>
            </div>
          ))}
          {camp.craftNote && <p className="note">{camp.craftNote}</p>}
        </>
      )}

      <h3>Участь</h3>
      <FatePick options={camp.fates} value={chosen} onChange={setPick} />

      <h3>Что делать</h3>
      <button
        className="btn wide"
        disabled={busy || sameFate || cantFate !== null}
        onClick={() => void order(() => besiege(chosen), `Объявлено: ${FATE_META[chosen].name.toLowerCase()}.`)}
      >
        Объявить
      </button>
      {sameFate && <p className="note">Эта участь уже объявлена</p>}
      {/* Способ штурма (docs/siege_v2.md, 4.4): из готовых машин, проёмы складываются; строка — устройство, без прогноза. */}
      {camp.machines?.walls && (
        <>
          <p className="note">
            {camp.machines.breaches > 0
              ? `Проломов ${camp.machines.breaches} из 3: столько стены без лестниц.`
              : 'Проломов нет.'}{' '}
            {camp.machines.methods.length === 0 ? 'Готовых машин нет: лестницы — те, что принесут на себе, на треть стены.' : ''}
          </p>
          {camp.machines.methods.map((m) => {
            const on = (use ?? camp.machines!.methods.map((x) => x.machine)).includes(m.machine);
            return (
              <label key={m.machine} className="note">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy}
                  onChange={() => {
                    const was = use ?? camp.machines!.methods.map((x) => x.machine);
                    setUse(on ? was.filter((x) => x !== m.machine) : [...was, m.machine]);
                  }}
                />{' '}
                {m.words}
              </label>
            );
          })}
        </>
      )}
      <button
        className="btn wide"
        disabled={busy || camp.men === 0 || cantFate !== null || Boolean(camp.storm?.block)}
        onClick={() =>
          void order(() => attack({ fate: chosen, ...(use ? { machines: use } : {}) }), 'Отряд штурмует. Донесение в походах.', true)
        }
      >
        Штурмовать · {camp.men}
        {camp.storm ? ` · энергия ${camp.storm.price}` : ''}
      </button>
      <p className="note">{cantFate ?? camp.storm?.block ?? STORM_HOLDS}</p>
      <button className="btn ghost wide" disabled={busy} onClick={() => void order(retreat, 'Осада снята.', true)}>
        Отступить
      </button>
      <p className="note">{CAMP_LEAVE}</p>
    </div>
  );
}
