// Карта бродяги (ПН-3, docs/gdd/path_of_sword.md, 5.2, 5.4): тот же экран карты, что у лорда, с отрядом посредине. Своим куском —
// карта открывает его только за `roamOn` и в фазе бродяги (`WorldMap`), и вешает на крючок карты (`roamhook`): знаки отряда,
// лагеря и руин поверх кадра (`paint.ts`) и касание клетки. Отряд берут в руку касанием его знака или кнопкой полосы; с отрядом в
// руке касание любой клетки открывает окно хода (`RoamSend`) — свобода хода есть только у отряда (П1). Лагерь — кнопкой полосы
// (`RoamCamp`). Строка «скрыт / виден» (ПН-4у) — под строкой отряда: кто нас видит (слово сервера; без сервера — те же правила по
// замкам реестра) и на сколько клеток нас видит круг замка — дверью `world/sight` (`world/bandsight.ownSight`). Чужие отряды и их
// следы рисует свой кусок (`BandsLayer`) — у лорда и у бродяги.
import { useEffect, useRef, useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld, worldNow } from '@/world/store';
import { worldApi } from '@/world/api';
import type { Coord, RoamPlanView } from '@/world/types';
import type { RoamCampRec, RoamWay } from '@/world/roammove';
import { CAMP_NAME, roamCell, roamMoving } from '@/world/roam';
import { energyShown } from '@/world/energy';
import { troopTotal } from '@/game/battle/kinds';
import { Icon } from '@/ui/icons/Icon';
import { num } from '@/game/num';
import { ownSight, seenWords, useBandSight } from '@/world/bandsight';
import { sideColor } from '@/side';
import { setRoamHook } from '../roamhook';
import { paintRoam } from './paint';
import { RoamSend } from './RoamSend';
import { RoamCamp } from './RoamCamp';
import './roam.css';

/** Что сказать, взяв отряд в руку. */
export const HAND_WORDS = 'Отряд в руке: нажми клетку — куда идти.';

export default function RoamLayer() {
  const way = useGame((g) => g.s.roam?.way ?? null);
  const camp = useGame((g) => g.s.roam?.camp ?? null);
  const energy = useGame((g) => g.s.roam?.energy);
  const men = useGame((g) => troopTotal(g.s.roam?.band ?? {}));
  const food = useGame((g) => Math.floor(g.s.roam?.cargo.food ?? 0));
  const showToast = useGame((g) => g.showToast);
  // Строка «скрыт / виден» живёт часами партии (ночь, сезон) — перечитывается раз в игровую минуту шага, а не каждым шагом.
  useGame((g) => Math.floor(g.s.time / 10));
  const seenServer = useBandSight((v) => v.seen);
  const [hand, setHand] = useState(false);
  const [plan, setPlan] = useState<RoamPlanView | null>(null);
  const [campOpen, setCampOpen] = useState(false);
  // Крючок карты читает последнее — без перевешивания на каждую перемену.
  const live = useRef<{ way: RoamWay | null; camp: RoamCampRec | null; hand: boolean }>({ way, camp, hand });
  live.current = { way, camp, hand };

  useEffect(() => {
    const ask = (c: Coord): void => {
      void worldApi()
        .roamPlan?.(c)
        .then((p) => (typeof p === 'string' ? showToast(p) : setPlan(p)));
    };
    setRoamHook({
      paint: (ctx, cam, vp, dpr, now) => paintRoam(ctx, cam, vp, dpr, now, live.current.way, live.current.camp),
      tap: (c) => {
        if (live.current.hand) {
          ask(c);
          return true;
        }
        const w = live.current.way;
        const at = w ? roamCell(w, worldNow()) : null;
        if (at && at.x === c.x && at.y === c.y) {
          setHand(true);
          showToast(HAND_WORDS);
          return true;
        }
        // Без отряда в руке — карточка клетки, как у всех: колец дел четырёх людей у бродяги нет (агенты — ПН-9).
        void useWorld.getState().select(c);
        return true;
      },
    });
    return () => setRoamHook(null);
  }, [showToast]);

  const now = worldNow();
  const moving = way ? roamMoving(way, now) : false;
  const state = camp && !moving ? CAMP_NAME[camp.kind] : moving ? 'в пути' : 'стоит в поле';
  const sight = ownSight(useGame.getState().s, now, seenServer);
  return (
    <>
      <div className="roam-bar">
        {hand ? (
          <>
            <Icon name="ui-banner" />
            <span className="roam-what">{HAND_WORDS}</span>
            <button className="nx-mbtn" onClick={() => setHand(false)} aria-label="Отпустить">
              <Icon name="ui-close" />
            </button>
          </>
        ) : (
          <>
            <button className="nx-mbtn" onClick={() => (setHand(true), showToast(HAND_WORDS))} aria-label="Взять отряд" disabled={!way}>
              <Icon name="ui-banner" />
            </button>
            <span className="roam-what">
              <b>
                Отряд · {men} чел. · {state}
              </b>
              энергия {energyShown(energy, now)} · хлеба {food}
              {sight && (
                <em className={`roam-sight${sight.seen.count > 0 ? ' seen' : ''}`} style={sight.seen.count > 0 ? { color: sideColor(false) } : undefined}>
                  {sight.seen.count > 0 ? seenWords(sight.seen) : `Скрыт · замок видит нас за ${num(sight.range, 0)} кл.`}
                </em>
              )}
            </span>
            <button className="nx-mbtn" onClick={() => setCampOpen(true)} aria-label="Встать лагерем" disabled={!way}>
              <Icon name="stage-camp" />
            </button>
          </>
        )}
      </div>
      {plan && (
        <RoamSend
          plan={plan}
          onClose={() => setPlan(null)}
          onSent={() => {
            setPlan(null);
            setHand(false);
          }}
        />
      )}
      {campOpen && <RoamCamp onClose={() => setCampOpen(false)} />}
    </>
  );
}
