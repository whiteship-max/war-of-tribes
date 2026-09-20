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
import { hungerLeft } from '@/ui/parts/hunger';
import { sideReady } from '@/ui/parts/campSide';
import { formatEstimate } from '@/world/intel';
import { CAMP_LEAVE, STORM_LIFTS } from '@/world/siege';
import { FATE_META } from '@/world/data/fates';
import { CASTLE_ICON, STAGE_BY_ID } from '@/world/data/meta';
import { SIDES, SIDE_NAME, WOOD_SHARES, campSides, playerWood, woodShare, worksRipeAt } from '@/world/works';
import type { Fate } from '@/world/types';
import { FatePick } from '@/ui/parts/FatePick';
import { plural } from '@/ui/parts/plural';

/**
 * Сроки из подсказки к долям — той же функцией, которой считаются стороны: при
 * другой древесине подсказка поменяется сама, а не станет неправдой.
 */
const WOOD_ALL_FRONT = realMinutes(worksRipeAt(0, 'front', playerWood(1)));
const WOOD_HALVES = realMinutes(worksRipeAt(0, 'front', playerWood(0.5)));

/** Как доля фронту называется на кнопке. */
const SHARE_NAME: Record<number, string> = {
  1: 'Всё во фронт',
  0.75: 'Три четверти',
  0.5: 'Поровну',
  0.25: 'Четверть',
  0: 'Всё в тыл',
};

export function CampPanel() {
  const showToast = useGame((g) => g.showToast);
  const closeSheet = useGame((g) => g.closeSheet);
  const camp = useWorld((g) => g.camp);
  const loadCamp = useWorld((g) => g.loadCamp);
  const besiege = useWorld((g) => g.besiege);
  const attack = useWorld((g) => g.attack);
  const retreat = useWorld((g) => g.retreat);
  const setWood = useWorld((g) => g.setWood);
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
            <div className="lvl">полководец осады не держит</div>
          </div>
        </div>
        <p className="note">Осаду ставит полководец у чужих стен: приказ «Осадить» в его меню.</p>
      </div>
    );
  }

  const now = worldNow();
  const sides = campSides(camp, now);
  const share = woodShare(camp.wood);
  const chosen = pick ?? camp.fate;
  const option = camp.fates.find((o) => o.id === chosen) ?? null;
  const stage = STAGE_BY_ID[camp.stage];
  const kind = camp.castle ? 'Замок' : camp.lair ? 'Логово' : stage.name;
  const walls = camp.castle ? 'гарнизон стоит стеной' : 'частокола нет: заслон держат люди';

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

      <h3>Город</h3>
      <div className="mod-list">
        <div className="mod">
          <span className="ico">🛡️</span>
          <span className="name">Мощь заслона</span>
          <span className={`val${camp.power.precision === 'unknown' ? ' neg' : ''}`}>{formatEstimate(camp.power)}</span>
        </div>
        <div className="mod total">
          <span className="ico">⏳</span>
          <span className="name">Еды в городе хватит на</span>
          <span className="val pos">{hungerLeft(camp.starvesAt, now)}</span>
        </div>
        <div className="mod">
          <span className="ico">🍞</span>
          <span className="name">Гарнизон {camp.garrison} — он и ест</span>
          <span className="val">лагерь стоит {realLeft(Math.max(0, (now - camp.since) / 1000))}</span>
        </div>
      </div>

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
      <p className="note">
        Древесину лагерь рубит сам и кладёт, куда скажешь. Всё во фронт — фронт дозреет за {WOOD_ALL_FRONT}, а тыл
        до того открыт; поровну — обе стороны за {WOOD_HALVES}. Вложенное не пропадает: доля меняет только то, как
        стороны растут дальше.
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

      <h3>Участь города</h3>
      <FatePick options={camp.fates} value={chosen} onChange={setPick} />

      <h3>Осадные орудия</h3>
      <p className="note">Осадных орудий у лагеря нет: строить их негде.</p>

      <h3>Что делать</h3>
      <button
        className="btn wide"
        disabled={busy || sameFate || cantFate !== null}
        onClick={() => void order(() => besiege(chosen), `Осада идёт: объявлено «${FATE_META[chosen].name.toLowerCase()}».`)}
      >
        ⛺ Осаждать · {FATE_META[chosen].name.toLowerCase()}
      </button>
      {sameFate && <p className="note">Осада и так идёт с этой участью. Выбери другую строку — и объяви её.</p>}
      <button
        className="btn wide"
        disabled={busy || camp.men === 0 || cantFate !== null}
        onClick={() =>
          void order(() => attack({ setup: null, fate: chosen }), 'Дружина пошла на приступ. Отчёт в походах.', true)
        }
      >
        ⚔️ Штурмовать · {camp.men} {plural(camp.men, 'боец', 'бойца', 'бойцов')}
      </button>
      <p className="note">{cantFate ?? STORM_LIFTS}</p>
      <button className="btn ghost wide" disabled={busy} onClick={() => void order(retreat, 'Осада снята.', true)}>
        ↩️ Отступить
      </button>
      <p className="note">{CAMP_LEAVE}</p>
    </div>
  );
}
