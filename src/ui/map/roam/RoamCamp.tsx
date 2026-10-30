// Окно «Встать лагерем» (ПН-3, docs/gdd/path_of_sword.md, 3.5.3, 5.4): открытый, скрытый, в руинах — что каждый даёт числами
// дверей партии (фураж, строка духа «Лагерь», раненые) и почему нельзя; рогатки стоящего лагеря; «Снять лагерь». Заметность
// лагеря (ПН-4у) — на сколько клеток его видит круг замка здесь и сейчас (`world/sight`). Место и погода (ПН-12л) — до выбора:
// что за земля и небо и что они дают стоянке (еда, оборона, скрытность, отдых, непогода) — теми же дверями, что шаг отряда
// (`world/campsite`, `sim/roam.campGain`). Числа — `WorldApi.roamCampView`.
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { worldApi } from '@/world/api';
import type { RoamCampGain, RoamCampView } from '@/world/types';
import type { CampKind } from '@/world/roammove';
import { formatCoord } from '@/world/geo';
import { num, signedWhole } from '@/game/num';
import { Icon } from '@/ui/icons/Icon';

const pct = (x: number): string => `${Math.round(x * 100)} %`;

/** Что даёт стоянка — одной строкой: еда, дух, отдых, оборона, скрытность (ПН-12л: все пять — всегда, числами дверей). */
export function gainText(r: RoamCampGain): string {
  const parts = [`фураж ${pct(r.forage)} пайка`, `дух ${signedWhole(r.morale + r.weather)}`];
  if (r.ration > 1.005) parts.push(`паёк ×${num(r.ration, 2)}`);
  parts.push(`отдых раненых ×${num(r.heal, 1)}`);
  parts.push(r.faces > 0 ? `нападающему −${r.faces} ${r.faces === 1 ? 'грань' : 'грани'} кости` : 'обороны нет');
  parts.push(`замок видит за ${num(r.range, 0)} кл`);
  return parts.join(' · ');
}

export function RoamCamp({ onClose }: { onClose: () => void }) {
  const showToast = useGame((g) => g.showToast);
  const [view, setView] = useState<RoamCampView | string | null>(null);
  const load = (): void => void worldApi().roamCampView?.().then(setView);
  useEffect(load, []);
  const pick = async (kind: CampKind | null): Promise<void> => {
    const err = await worldApi().roamCamp?.(kind);
    showToast(err ?? (kind ? 'Отряд встал лагерем.' : 'Лагерь снят: отряд стоит в поле.'));
    if (!err) onClose();
    else load();
  };
  return (
    <div className="am-wrap" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel nx-bpanel nx-am">
        <div className="nx-bhead">
          <span className="nx-bico">
            <Icon name="stage-camp" />
          </span>
          <div className="nx-btitle">
            <b className="one-line">Встать лагерем</b>
            <span className="nx-blvl">{view && typeof view !== 'string' ? formatCoord(view.at) : ''}</span>
          </div>
          <button className="nx-bclose" onClick={onClose} aria-label="Закрыть">
            <Icon name="ui-close" />
          </button>
        </div>
        <div className="nx-am-body er-confirm">
          {view === null && <p className="nx-tnote">Смотрим место…</p>}
          {typeof view === 'string' && <p className="nx-bwarn">{view}</p>}
          {view && typeof view !== 'string' && (
            <>
              <p className="nx-tnote">
                Место: {view.place}. Погода: {view.sky.toLowerCase()}.
              </p>
              {view.ruin && <p className="nx-tnote">Здесь руины: {view.ruin.toLowerCase()}.</p>}
              <p className="nx-tnote">Стоять в поле: {gainText(view.field)}.</p>
              {(view.field.weather < 0 || view.rows.some((r) => r.weather < 0)) && (
                <p className="nx-tnote">Непогода: дух {signedWhole(view.field.weather)} — в любом лагере под открытым небом.</p>
              )}
              {view.camp && <p className="nx-tnote">Рогатки лагеря: {pct(view.works)}.</p>}
              <div className="roam-legs">
                {view.rows.map((r) => (
                  <button key={r.kind} className={`roam-leg${view.camp === r.kind ? ' on' : ''}`} disabled={r.block !== null} onClick={() => void pick(r.kind)}>
                    <b>{r.name}</b>
                    <span />
                    <small className="muted">{view.camp === r.kind ? `стоит: ${gainText(r)}` : (r.block ?? gainText(r))}</small>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="nx-am-foot">
          <button className="nx-go nx-go-ghost" onClick={onClose}>
            Назад
          </button>
          {view && typeof view !== 'string' && view.camp && (
            <button className="nx-go" onClick={() => void pick(null)}>
              Снять лагерь
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
