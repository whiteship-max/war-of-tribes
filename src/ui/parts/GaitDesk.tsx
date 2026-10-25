// Режим марша в окне отряда (ДР-2, docs/siege_v2.md, 25.1): какой сейчас и что он значит в пути, сколько ушло налегке,
// идёт ли стоянка, и смена — плиткой. Дома — даром одним касанием; в пути и в поле — стоянкой и энергией, двумя касаниями
// (первое говорит цену). Своих чисел нет: цена, стоянка и отказы — мира (`FigureView.march`), слова — дверью `world/gait`.
import './gait.css';
import { useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld, worldNow } from '@/world/store';
import { FIGURE_BY_ID } from '@/world/data/figures';
import { GAIT_META, GAITS, gaitSpeed, siegeBlockOf, type Gait } from '@/world/gait';
import type { FigureView } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';
import { num } from '@/game/num';
import { realLeft } from './wait';
import { GAIT_ICON, gaitPace, lightWasteWords } from './GaitPick';

export function GaitDesk({ f }: { f: FigureView }) {
  const setGait = useWorld((g) => g.setGait);
  const showToast = useGame((g) => g.showToast);
  const [armed, setArmed] = useState<Gait | null>(null);
  const [busy, setBusy] = useState(false);
  const v = f.march;
  if (!v) return null;
  const now = worldNow();
  const speed = FIGURE_BY_ID.general.speed * gaitSpeed(v.gait);
  const pick = async (g: Gait): Promise<void> => {
    setArmed(null);
    setBusy(true);
    const err = await setGait(g);
    setBusy(false);
    showToast(err ?? (v.change.free ? `Режим марша: ${GAIT_META[g].name.toLowerCase()}.` : `Отряд встал: ${GAIT_META[g].name.toLowerCase()} — через ${realLeft(v.change.haltMs / 1000)}.`));
  };
  return (
    <>
      <h3>Режим марша</h3>
      <div className="gait-opts" role="radiogroup" aria-label="Режим марша">
        {GAITS.map((g) => {
          const on = g === v.gait;
          const why = on ? null : (v.change.block[g] ?? null);
          const isArmed = armed === g;
          return (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy || (!on && why !== null)}
              className={`gait-opt${on ? ' on' : ''}${isArmed ? ' armed' : ''}`}
              onClick={() => {
                if (on || why) return;
                // В пути — двумя касаниями: первое называет стоянку и цену; дома — сразу.
                if (!v.change.free && !isArmed) return setArmed(g);
                void pick(g);
              }}
              onBlur={() => setArmed(null)}
            >
              <b>
                <Icon name={GAIT_ICON[g]} /> {GAIT_META[g].name}
              </b>
              <small>
                {on
                  ? 'сейчас'
                  : isArmed
                    ? `Коснись ещё раз: стоянка ${realLeft(v.change.haltMs / 1000)}, ${v.change.price} энергии`
                    : v.change.free
                      ? `${gaitPace(g)}, даром`
                      : `${gaitPace(g)}, стоянка и ${v.change.price} энергии`}
              </small>
            </button>
          );
        })}
      </div>
      <p className="nx-tnote">{GAIT_META[v.gait].about}</p>
      <div className="nx-facts">
        <span className="nx-fact">
          <small>Скорость</small>
          <b>
            {num(speed, 1)} {gaitPace(v.gait)}
          </b>
        </span>
        <span className="nx-fact">
          <small>В пути</small>
          <b className={v.gait === 'light' ? 'bad' : 'good'}>{v.gait === 'light' ? 'тает' : 'не тает'}</b>
        </span>
        <span className="nx-fact">
          <small>Осада</small>
          <b className={siegeBlockOf(v.gait) ? 'bad' : 'good'}>{siegeBlockOf(v.gait) ? 'нельзя' : 'можно'}</b>
        </span>
      </div>
      {v.gait === 'light' && (
        <p className="nx-bwarn">
          Налегке отряд тает {lightWasteWords()} в пути и в поле{v.worn > 0 ? `; за этот поход ушло ${v.worn}` : ''}.
        </p>
      )}
      {v.gait === 'train' && <p className="nx-tnote">Обоз кормит отряд: голод дома его не трогает, лагерь тает меньше — без подвоза из дома.</p>}
      {v.haltUntil > now && <p className="nx-bwarn">Отряд стоит, обоз собирают: ещё {realLeft((v.haltUntil - now) / 1000)}.</p>}
      {Object.values(v.change.block).find((x) => x) && !v.change.free && (
        <p className="nx-tnote">{Object.values(v.change.block).find((x) => x)}</p>
      )}
    </>
  );
}
