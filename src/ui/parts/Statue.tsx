import { useGame } from '@/game/store';
import { heroInfo, payGraceDays } from '@/game/derived';
import { setHeroKind } from '@/game/sim/actions';
import { personName, seated } from '@/game/sim/agents';
import { OWN_KINDS } from '@/game/battle/kinds';
import { KIND_META } from '@/battle';
import { atGates, useWorld } from '@/world/store';
import { GarrisonEditor } from './GarrisonEditor';
import { AgentCard } from './AgentCard';
import { Lineage } from './Lineage';
import { waitDaysBoth } from './wait';

/**
 * Статуя Героя — дом военачальников. Морали она не даёт нарочно — их в посёлке уже
 * четыре источника; она даёт племени имя. Здесь сколько терпит войско, которому не
 * заплатили или которое нечем кормить, кто полководец сейчас — та же карточка, что в
 * «Походах», с уровнем, чертами и вещами, — какой род ведёт и кто водил дружину до
 * него. Прогноза «насколько он усилит бой» нет, как и везде.
 *
 * Потолка дружины у Статуи больше нет: войско держит цена (`data/upkeep.ts`). Главное
 * число здания теперь — терпение, верность полководцу: сколько игровых дней у вождя,
 * чтобы заплатить или накормить, прежде чем люди начнут уходить.
 */
export function Statue() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const info = heroInfo(s);
  const name = personName(s, 'general');
  const here = seated(s, 'general');
  const general = useWorld((g) => g.figures).find((f) => f.id === 'general');

  return (
    <>
      <h3>Полководец</h3>
      <div className="mod total">
        <span className="ico">⚔️</span>
        <span className="name">
          Войско терпит неуплату и голод
          <em className="sub">потом начинает уходить; полководец уводит в поле сколько угодно</em>
        </span>
        <span className="val pos">{waitDaysBoth(payGraceDays(s))}</span>
      </div>
      {/* Герой и полководец на карте — один человек. Сколько он уводит и чего стоит
          сам, решает Статуя; уровень, натиск и черты — его, и карточка у него одна:
          та же, что в «Походах», без кнопки возврата и без строк Статуи. */}
      {here ? (
        <AgentCard id="general" embedded />
      ) : (
        <div className="note">Полководца нет: место пустует, и дружина из деревни не выходит. Нанимают его здесь же, ниже.</div>
      )}

      {/* Состав дружины — тот же редактор, что на карточке своего замка: мир один, отказы
          его словами. Показан, пока полководец у ворот; увели его с открытой панелью —
          «Отдать» получит отказ мира, а на следующем пульсе редактор уйдёт сам. */}
      {here && (atGates(general) ? (
        <GarrisonEditor />
      ) : (
        <div className="note">
          Состав дружины меняют, пока полководец стоит у своих ворот. Сейчас его там нет — где он, видно в
          «Походах».
        </div>
      ))}

      <h3>
        Герой <span className="muted">{here ? name : 'места никто не занял'}</span>
      </h3>
      <div className="note">
        {!here
          ? 'Герой и полководец — один человек, и он смертен: погиб или ушёл на покой — вести некому, пока не наймут нового.'
          : info.away
            ? 'Ушёл с походом. Пока он в пути, площадь у статуи пуста.'
            : 'Стоит у своей статуи и уйдёт со следующим набегом — с одним за раз. Смертен, как полководец: это он и есть.'}
      </div>
      <div className="mod">
        <span className="ico">{info.ready ? '🛡️' : info.away ? '🏇' : '🩹'}</span>
        <span className="name">Ведёт за собой</span>
        <span className="val">{info.men} бойцов строя</span>
      </div>

      <h3>Какой род он ведёт</h3>
      <div className="note">
        Смена рода стоит золота по числу ртов: выбор должен что-то значить, иначе
        род подбирался бы под каждый поход.
      </div>
      <div className="totem-row">
        {OWN_KINDS.map((k) => (
          <button
            key={k}
            className={k === info.kind ? 'on' : ''}
            disabled={k !== info.kind && info.blocked !== null}
            onClick={() => act((st) => setHeroKind(st, k))}
          >
            <span className="ico">{KIND_META[k].icon}</span>
            <b>{KIND_META[k].name}</b>
            <span style={{ color: 'var(--muted)' }}>
              {k === info.kind ? 'ведёт сейчас' : `${info.retrainCost} 🪙`}
            </span>
          </button>
        ))}
      </div>
      {info.blocked && info.blocked !== 'Герой в походе.' && <div className="hint">{info.blocked}</div>}

      <Lineage id="general" />
    </>
  );
}
