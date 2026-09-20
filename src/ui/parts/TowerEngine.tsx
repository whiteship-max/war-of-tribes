import { useGame } from '@/game/store';
import { engineInfo, setEngine } from '@/game/sim/actions';
import { TROOPS_OF_KIND } from '@/game/battle/kinds';
import { useWorld } from '@/world/store';
import { waitLeft } from '@/ui/parts/wait';
import { Cost } from './Cost';
import { plural } from './plural';

/**
 * Башня: места лучников и орудие против осадного лагеря — третий ответ города на осаду,
 * кроме вылазки и удара полководца с тыла.
 *
 * Своих чисел часть не считает: что стоит, чего стоит, сколько ставить и почему нельзя,
 * приходит из `sim/tower.engineInfo`; как сильно башня бьёт по лагерю сейчас — из мира
 * (`SiegeView.fire`), той же дверью, какой лагерь бьётся. Лучников дома часть не
 * считает — говорит правило словами: расчёт на башне тот, кто дома.
 */
export function TowerEngine() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const siege = useWorld((g) => g.siege);
  const info = engineInfo(s);
  const current = info.current;
  const archers = TROOPS_OF_KIND.archer.reduce((n, id) => n + Math.max(0, s.army[id] ?? 0), 0);

  return (
    <>
      <h3>
        Орудие <span className="muted">мест лучников: {info.seats}</span>
      </h3>
      <div className="note">
        Орудие бьёт по осадному лагерю, не выходя за стены. Расчёт — лучники на башне: встают те, кто дома,
        и ушедшие на вылазку или к полководцу своё место оставляют пустым. Неполный расчёт — та же доля силы.
      </div>

      {current ? (
        <div className="card">
          <div className="ico">{current.icon}</div>
          <div className="body">
            <div className="title">
              {current.name}
              {info.left > 0 && <span className="count">~{waitLeft(info.left)}</span>}
            </div>
            <div className="desc">
              {info.left > 0
                ? 'Ставят. Пока не поставят, башня молчит.'
                : !info.ready
                  ? `Башня ниже ${current.level} уровня — орудие молчит, пока её не отстроят.`
                  : `${current.description} Расчёт — ${current.crew} ${plural(current.crew, 'лучник', 'лучника', 'лучников')}; лучников в войске ${archers}.`}
            </div>
          </div>
        </div>
      ) : (
        <div className="note">Орудия нет: балиста ставится с пятого уровня башни, катапульта — с десятого.</div>
      )}

      {siege?.fire && (
        <div className="mod total">
          <span className="ico">🗼</span>
          <span className="name">Бьёт по лагерю «{siege.byName}»</span>
          <span className="val pos">
            выбито {Math.round(siege.fire.thin * 100)}% из {Math.round(siege.fire.cap * 100)}%
          </span>
        </div>
      )}

      {info.options.map((o) => (
        <div className="upgrade" key={o.def.id}>
          <Cost cost={o.cost} work={o.seconds} eta={o.seconds} />
          <button className="btn wide" disabled={o.blocked !== null} onClick={() => act((st) => setEngine(st, o.def.id))}>
            {o.def.icon} {current ? 'Сменить на' : 'Поставить'} {o.def.acc} · расчёт {o.def.crew}
          </button>
          <div className="hint">{o.blocked ?? o.def.description}</div>
        </div>
      ))}
    </>
  );
}
