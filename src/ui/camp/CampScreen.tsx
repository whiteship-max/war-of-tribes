// Лагерь бродяги — главный экран отряда (ПН-12л, docs/gdd/path_of_sword.md, 5.2 и «Решения ПН-12л»): 3D-лагерь на земле клетки под
// небом этой минуты (`render/camp/scene`), полоса отряда сверху («скрыт / виден», место и погода) и предметы-кнопки поверх сцены —
// шатёр (герой, состав), костёр (дух, жалованье; «Погасить костры» — скрытый лагерь), обоз (провиант, добыча). Внизу — «Отряд»,
// «Город и село», «Карта», «Лагерь» (окно «Встать лагерем»), «Вести». Своим куском: `App` открывает его только за `roamOn` и в фазе
// бродяги, вместо диорамы города; игроку он не грузится.
//
// Вид лагеря — дверь `world/campsite` (`bandPlace`, `campLook`): то же место и та же погода, что считает шаг отряда; своей арифметики
// у экрана нет.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame } from '@/game/store';
import { worldNow } from '@/world/store';
import { CAMP_NAME } from '@/world/roam';
import { bandPlace, campLook, siteWords, skyLine, type CampLook } from '@/world/campsite';
import { townAt } from '@/world/roampoints';
import { energyShown } from '@/world/energy';
import { ownSight, seenWords, useBandSight } from '@/world/bandsight';
import { dayFraction, dayPartAt, seasonOf, solarPhase } from '@/game/derived';
import { troopTotal } from '@/game/battle/kinds';
import { num } from '@/game/num';
import { sideColor } from '@/side';
import { levelNow } from '@/render/gfx';
import { bootDone } from '@/boot/stage';
import { castlePainted } from '@/boot/warm';
import { Icon } from '@/ui/icons/Icon';
import type { CampScene, CampScreenAnchors } from '@/render/camp/scene';
import { CampCargo, CampFire, CampTent } from './CampPanels';
import { RoamBand } from '@/ui/map/roam/RoamBand';
import { RoamCamp } from '@/ui/map/roam/RoamCamp';
import { RoamMail } from '@/ui/map/roam/RoamMail';
import { RoamTown } from '@/ui/map/roam/RoamTown';
import '@/ui/map/roam/roam.css';
import './camp.css';

type Pane = 'tent' | 'fire' | 'cargo' | 'band' | 'town' | 'mail' | 'camp' | null;

/** Сцена докачкой — отдельно от экрана: three.js и модель приходят следом за полосой отряда. */
const sceneModule = (): Promise<typeof import('@/render/camp/scene')> => import('@/render/camp/scene');

/** Вид лагеря отряда сейчас — дверью `world/campsite`; места выхода нет — `null`. */
export function useCampLook(): { look: CampLook; solar: number; moving: boolean; roof: boolean } | null {
  const way = useGame((g) => g.s.roam?.way ?? null);
  const kind = useGame((g) => g.s.roam?.camp?.kind ?? null);
  const men = useGame((g) => troopTotal(g.s.roam?.band ?? {}));
  // Вид перечитывается раз в игровую минуту шага (сутки, погода), а не каждым шагом.
  const tick = useGame((g) => Math.floor(g.s.time / 10));
  const time = useGame.getState().s.time;
  return useMemo(() => {
    if (!way) return null;
    const now = worldNow();
    const p = bandPlace({ way }, now, time);
    const season = seasonOf(time);
    const solar = solarPhase(dayFraction(time), season);
    return { look: campLook(p.site, p.sky, p.moving ? null : kind, men), solar, moving: p.moving, roof: !p.moving && townAt(p.site.at.x, p.site.at.y) !== null };
    // `tick` — минута шага: вид живёт часами партии и мира.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [way, kind, men, tick]);
}

/** Холст сцены лагеря: сцена докачкой, размер — по коробке, кнопки предметов — по точкам модели. */
function CampCanvas({ look, solar, arms, onAnchors }: { look: CampLook; solar: number; arms: string | null; onAnchors: (a: CampScreenAnchors) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const scene = useRef<CampScene | null>(null);
  const shown = useRef({ look, solar, arms });
  shown.current = { look, solar, arms };
  useEffect(() => {
    const host = wrap.current;
    if (!host) return;
    let dead = false;
    let ro: ResizeObserver | null = null;
    const canvas = document.createElement('canvas');
    canvas.className = 'camp-canvas';
    host.appendChild(canvas);
    void sceneModule().then(({ CampScene }) => {
      if (dead) return;
      const sc = new CampScene(canvas, levelNow(location.search));
      scene.current = sc;
      sc.onAnchors = onAnchors;
      const fit = (): void => sc.resize(host.clientWidth, host.clientHeight);
      fit();
      ro = new ResizeObserver(fit);
      ro.observe(host);
      sc.show(shown.current.look, shown.current.arms, shown.current.solar);
      // Экран загрузки снимает первая сцена партии — у бродяги это лагерь, а не город (`GameCanvas`).
      bootDone();
      castlePainted();
    });
    return () => {
      dead = true;
      ro?.disconnect();
      scene.current?.dispose();
      scene.current = null;
      canvas.remove();
    };
    // Сцена одна на экран; вид ставит эффект ниже.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    scene.current?.show(look, arms, solar);
  }, [look, arms, solar]);
  return <div className="camp-stage" ref={wrap} />;
}

/** Кнопка предмета поверх сцены — там, где предмет на экране; за кадром — у края. */
function Prop({ at, icon, label, onClick, fallback }: { at: { x: number; y: number } | null; icon: Parameters<typeof Icon>[0]['name']; label: string; onClick: () => void; fallback: { left: string; top: string } }) {
  const style = at ? { left: `${at.x}px`, top: `${at.y}px` } : fallback;
  return (
    <button className="camp-prop" style={style} onClick={onClick} aria-label={label}>
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}

export default function CampScreen() {
  const r = useGame((g) => g.s.roam);
  const arms = useGame((g) => g.s.profile.arms ?? null);
  const food = useGame((g) => Math.floor(g.s.roam?.cargo.food ?? 0));
  const openMap = useGame((g) => g.openMap);
  const mail = useGame((g) => g.s.inbox.length);
  const seenServer = useBandSight((v) => v.seen);
  const view = useCampLook();
  const [anchors, setAnchors] = useState<CampScreenAnchors>({ tent: null, fire: null, cargo: null });
  const [pane, setPane] = useState<Pane>(null);
  // Места выхода ещё нет — сцены нет, и снимать экран загрузки некому, кроме полосы отряда.
  useEffect(() => {
    if (!view) bootDone();
  }, [view]);
  if (!r) return null;
  const now = worldNow();
  const s = useGame.getState().s;
  const men = troopTotal(r.band);
  const camp = r.camp && !view?.moving ? r.camp : null;
  const state = view?.roof ? 'на постое' : camp ? CAMP_NAME[camp.kind] : view?.moving ? 'в пути' : 'стоит в поле';
  const sight = ownSight(s, now, seenServer);
  const p = r.way ? bandPlace({ way: r.way }, now, s.time) : null;
  const place = p ? `${siteWords(p.site)} · ${view?.roof ? 'под крышей постоя' : skyLine(p.sky, dayPartAt(s.time) === 'night').toLowerCase()}` : '';
  const close = (): void => setPane(null);
  return (
    <div className="camp-screen">
      {view && <CampCanvas look={view.look} solar={view.solar} arms={arms} onAnchors={setAnchors} />}
      <div className="camp-top">
        <b className="one-line">
          {r.hero.name} · {men} чел. · {state}
        </b>
        <span className="one-line">
          энергия {energyShown(r.energy, now)} · хлеба {food} · кошель {Math.floor(r.purse)}
        </span>
        {sight && (
          <em className={`roam-sight${sight.seen.count > 0 ? ' seen' : ''}`} style={sight.seen.count > 0 ? { color: sideColor(false) } : undefined}>
            <Icon name={sight.seen.count > 0 ? 'ui-eye' : 'ui-eye-off'} />
            {sight.seen.count > 0 ? seenWords(sight.seen) : `Скрыт · замок видит нас за ${num(sight.range, 0)} кл.`}
          </em>
        )}
        {place && <span className="camp-place one-line">{place}</span>}
      </div>
      {view && !view.moving && (
        <>
          <Prop at={anchors.tent} icon="ui-banner" label={camp ? 'Шатёр' : 'Отряд'} onClick={() => setPane(camp ? 'tent' : 'band')} fallback={{ left: '30%', top: '45%' }} />
          {camp && <Prop at={anchors.fire} icon="ui-flame" label="Костёр" onClick={() => setPane('fire')} fallback={{ left: '50%', top: '60%' }} />}
          <Prop at={anchors.cargo} icon="ui-wagon" label="Обоз" onClick={() => setPane('cargo')} fallback={{ left: '70%', top: '55%' }} />
        </>
      )}
      <nav className="nx-nav camp-nav">
        <button onClick={() => setPane('band')}>
          <span className="nx-ib">
            <Icon name="nav-people" />
          </span>
          Отряд
        </button>
        <button onClick={() => setPane('town')} disabled={!r.way || view?.moving}>
          <span className="nx-ib">
            <Icon name="ui-scales" />
          </span>
          Город и село
        </button>
        <button className="nx-main" onClick={openMap} aria-label="Карта">
          <span className="nx-ib">
            <Icon name="hud-map" />
          </span>
          Карта
        </button>
        <button onClick={() => setPane('camp')} disabled={!r.way}>
          <span className="nx-ib">
            <Icon name="stage-camp" />
          </span>
          Лагерь
        </button>
        <button onClick={() => setPane('mail')}>
          <span className="nx-ib">
            <Icon name="ui-mail" />
            {mail > 0 && <em className="nx-badge">{mail}</em>}
          </span>
          Вести
        </button>
      </nav>
      {pane === 'tent' && <CampTent onClose={close} onBand={() => setPane('band')} />}
      {pane === 'fire' && <CampFire onClose={close} />}
      {pane === 'cargo' && <CampCargo onClose={close} />}
      {pane === 'band' && <RoamBand onClose={close} />}
      {pane === 'town' && <RoamTown onClose={close} />}
      {pane === 'mail' && <RoamMail onClose={close} />}
      {pane === 'camp' && <RoamCamp onClose={close} />}
    </div>
  );
}
