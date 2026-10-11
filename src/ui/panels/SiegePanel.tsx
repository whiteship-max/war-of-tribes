// Окно осады глазами обороняющегося: кто стоит у ворот, чем кончится голод и чем
// ответить. Одно окно вместо разбросанных мест — плашки в углу деревни, карточки
// лагеря и меню полководца: те стали входами в него, а экран вылазки — формой одного
// из его действий.
//
// Главная строка — объявленная участь. По ней осаждённый решает, спасать город или
// махнуть рукой, и стоит она первой после шапки.
//
// Своей арифметики у окна нет ни в одном числе. Срок — мировые часы (`starvesAt`),
// потеря при падении — та же дверь участи, что у падения (`SiegeView.fall`), стороны
// лагеря — та же `throughWorks`, что у боя (`works.campSides`, `works.sortieForecast`),
// удар полководца — план мира (`CampStrike`).
import { useEffect, useMemo, useState } from 'react';
import { useGame } from '@/game/store';
import { SIEGE_FOOD_YIELD, SIEGE_YIELD } from '@/game/constants';
import { useWorld, worldNow } from '@/world/store';
import { awayOf, homeOf } from '@/world/muster';
import { troopTotal } from '@/game/battle/kinds';
import { kindsOf } from '@/game/battle/price';
import { realLeft } from '@/ui/parts/wait';
import { REST_WHY, restLine, wearLine } from '@/ui/parts/restWords';
import { hungerLeft } from '@/ui/parts/hunger';
import { sideReady } from '@/ui/parts/campSide';
import { profileCity } from '@/profile/identity';
import { FATE_META } from '@/world/data/fates';
import { SIDES, SIDE_NAME, WEAK_HINT, campSides, gateBusyText, refusedAtGate, sortieForecast, weakSide } from '@/world/works';
import { NO_GARRISON } from '@/world/siege';
import type { FallForecast, Fate } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';
import { CampStrike } from '@/ui/parts/CampStrike';
import { plural } from '@/ui/parts/plural';
import { bondedWord, townsWord } from '@/game/data/order';

const byLevels = (n: number): string => `до ${n} ${plural(n, 'уровня', 'уровней', 'уровней')}`;
const goodsAndGold = (f: FallForecast): string => `${f.goods} запасов${f.gold > 0 ? ` и ${f.gold} золота` : ''}`;

/** Что потеряет город, если хлеб кончится, — словами окна. Числа приходят из мира. */
export function fallWords(fate: Fate, f: FallForecast): string[] {
  const out: string[] = [];
  if (fate === 'burn') {
    out.push(`сгорит ${goodsAndGold(f)}, в тайнике уцелеет ${f.hidden}.`);
    if (f.scatterPop > 0) out.push(`Разойдутся ${f.scatterPop} ${townsWord(f.scatterPop)}.`);
    if (f.scatterBonded > 0) out.push(`Разбегутся ${f.scatterBonded} ${bondedWord(f.scatterBonded)}.`);
    out.push(`Постройки, кроме тайника, потеряют ${byLevels(f.levels)}, начатая стройка сгорит.`);
  } else {
    out.push(`унесут ${goodsAndGold(f)}, в тайнике уцелеет ${f.hidden}.`);
    const people = [
      f.ledBonded > 0 ? `${f.ledBonded} ${bondedWord(f.ledBonded)}` : '',
      f.ledPop > 0 ? `${f.ledPop} ${townsWord(f.ledPop)}` : '',
    ].filter(Boolean);
    if (people.length > 0) out.push(`Уведут ${people.join(' и ')}.`);
    if (f.buildings > 0) {
      out.push(
        `${f.buildings} ${plural(f.buildings, 'постройка потеряет', 'постройки потеряют', 'построек потеряют')} ${byLevels(f.levels)}.`,
      );
    }
  }
  if (f.routed > 0) out.push(`Разойдутся ${f.routed} ${plural(f.routed, 'боец', 'бойца', 'бойцов')} гарнизона.`);
  return out;
}

export function SiegePanel() {
  const s = useGame((g) => g.s);
  const openSortie = useGame((g) => g.openSortie);
  const siege = useWorld((g) => g.siege);
  const homeId = useWorld((g) => g.info?.homeId ?? null);
  const marches = useWorld((g) => g.marches);
  const figures = useWorld((g) => g.figures);
  const home = useMemo(() => homeOf(s.army, awayOf(marches, figures)), [s, marches, figures]);
  const [, retick] = useState(0);

  // Часы голода и рогатки идут сами: замерший отсчёт читается как сломанный экран.
  useEffect(() => {
    if (!siege) return;
    const t = setInterval(() => retick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [siege]);

  if (!siege) {
    return (
      <div className="panel">
        <div className="bhead">
          <div className="ico">⛺</div>
          <div className="body">
            <div className="name">Осады нет</div>
            <div className="lvl">под стенами никого</div>
          </div>
        </div>
        <p className="note">Город снова ест.</p>
      </div>
    );
  }

  const now = worldNow();
  const meta = FATE_META[siege.fate];
  const sides = campSides(siege, now);
  const weak = weakSide(siege.since, now, siege.wood);
  // Весь гарнизон через фронт — сколько пробьётся, если выйти сейчас.
  const all = sortieForecast(siege, kindsOf(home), now).now;
  const garrisonMen = troopTotal(home);
  const sortieBlock =
    garrisonMen === 0 ? 'В гарнизоне никого' : refusedAtGate(all) ? gateBusyText(all.waitMs) : null;

  return (
    <div className="panel">
      <div className="bhead">
        <div className="ico">
          <Icon name="letter-siege" glyph="⛺" />
        </div>
        <div className="body">
          <div className="name one-line">«{profileCity(s.profile)}» в осаде</div>
          <div className="lvl">
            «{siege.byName}» у ворот · в лагере {siege.campMen} {plural(siege.campMen, 'боец', 'бойца', 'бойцов')}
          </div>
        </div>
      </div>

      {/* Главная строка окна: что с городом сделают, если его доедят. */}
      <div className="card danger">
        <div className="ico">{meta.icon}</div>
        <div className="body">
          <div className="title">Объявлено: {meta.name.toLowerCase()}</div>
          <div className="desc">Кончится хлеб — {fallWords(siege.fate, siege.fall).join(' ')} Случится и без тебя.</div>
        </div>
      </div>

      <h3>Хлеб и оборона</h3>
      <div className="mod-list">
        <div className="mod total">
          <span className="ico">⏳</span>
          <span className="name">Своей еды хватит на</span>
          <span className="val neg">{hungerLeft(siege.starvesAt, now)}</span>
        </div>
        <div className="mod">
          <span className="ico">🍞</span>
          <span className="name">Гарнизон {siege.garrison} тоже ест</span>
          <span className="val">
            хлеб {SIEGE_FOOD_YIELD === 0 ? 'не идёт' : `×${SIEGE_FOOD_YIELD}`}, прочее −{Math.round((1 - SIEGE_YIELD) * 100)}%
          </span>
        </div>
        <div className="mod">
          <span className="ico">
            <Icon name="bld-palisade" glyph="🧱" />
          </span>
          <span className="name">Стены</span>
          <span className="val">ур. {siege.palisade}</span>
        </div>
      </div>

      <h3>Лагерь у ворот</h3>
      <div className="mod-list">
        {SIDES.map((side) => {
          const t = sides[side];
          return (
            <div className="mod" key={side}>
              <span className="ico">{side === 'front' ? '🏘️' : '🌾'}</span>
              <span className="name">
                {SIDE_NAME[side]}: {sideReady(t, now)}
              </span>
              <span className="val">
                {t.room >= 1 ? `пройдут ${t.room < Infinity ? t.room : 'все'}` : `свободно через ${realLeft(t.waitMs / 1000)}`}
              </span>
            </div>
          );
        })}
      </div>
      {/* Третий ответ на осаду: башня бьёт по лагерю, не выходя за стены. Числа — из мира. */}
      {siege.fire && (
        <div className="mod-list">
          <div className="mod">
            <span className="ico">🗼</span>
            <span className="name">
              Башня бьёт по лагерю
              {siege.fire.slow > 0 && (
                <em className="sub">рогатки со стороны города растут медленнее на {Math.round(siege.fire.slow * 100)}%</em>
              )}
            </span>
            <span className="val pos">
              выбито {Math.round(siege.fire.thin * 100)}% из {Math.round(siege.fire.cap * 100)}%
            </span>
          </div>
        </div>
      )}
      <p className="note">
        Кто не пройдёт, встанет у рогаток.
        {weak ? ` ${WEAK_HINT[weak]}` : ''}
      </p>
      {/* Дела полководца в лагере (world/siegecraft): лагерь укреплён, город обстреливают — словами мира. */}
      {siege.craftNote && <p className="note warn">{siege.craftNote}</p>}
      {/* Мораль между боями (14.31): уставший лагерь бить лучше сейчас, уставшему гарнизону — дать отдохнуть. */}
      {siege.campRest && (
        <p className="note">{restLine(siege.campRest, 'Лагерь дрался', now)} Бей, пока не отдохнул.</p>
      )}
      {siege.garrisonRest && (
        <p className="note warn">
          {restLine(siege.garrisonRest, 'Гарнизон дрался', now)} {REST_WHY}
        </p>
      )}
      {/* Износ осады (дни под стенами и залпы лагеря) — тем числом, с которым гарнизон идёт в бой у мира и у сервера войны. */}
      {siege.wear !== undefined && <p className="note warn">{wearLine(siege.wear)}</p>}
      {siege.towerIdle && <p className="note">{siege.towerIdle}</p>}

      <h3>Что делать</h3>
      <button className="btn wide" disabled={sortieBlock !== null} onClick={openSortie}>
        Вылазка{garrisonMen > 0 ? ` · ${all.passed} из ${all.went}` : ''}
      </button>
      {sortieBlock && <p className="note bad">{sortieBlock}</p>}
      {/* Пустой гарнизон: в осаде новобранцев не набрать — в казармы окно не зовёт, а говорит, что есть (siege_audit, 1). */}
      {garrisonMen === 0 && <p className="note">{NO_GARRISON}</p>}
      {homeId && <CampStrike target={homeId} />}
      <p className="note">Разбитый лагерь снимает осаду, и город снова ест.</p>
    </div>
  );
}
