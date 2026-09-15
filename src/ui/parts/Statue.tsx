import { useGame } from '@/game/store';
import { DAY_LENGTH } from '@/game/constants';
import { commandCap, heroInfo } from '@/game/derived';
import { setHeroKind } from '@/game/sim/actions';
import { agentLevel } from '@/game/sim/agents';
import { OWN_KINDS } from '@/game/battle/kinds';
import { KIND_META } from '@/battle';
import { count } from './plural';

/**
 * Статуя Героя. Морали она не даёт нарочно — их в посёлке уже четыре источника;
 * она даёт племени имя. Здесь два числа и одно решение: сколько дружины уводит
 * полководец, кто герой, где он и какой род ведёт. Прогноза «насколько он усилит
 * бой» нет, как и везде: показано только число людей, которые за ним идут.
 *
 * Вместимость полководца стоит первой: это главное число здания — то, во что
 * упирается любой поход, — и прежде его не было ни здесь, ни на кнопке улучшения,
 * а только в редакторе дружины на карте. Единицы у двух чисел разные, и сказано
 * это словами: за героем идут бойцы строя (латник весит восьмерых), а полководец
 * уводит бойцов по головам, любого вида.
 */
export function Statue() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const info = heroInfo(s);

  return (
    <>
      <h3>Полководец</h3>
      <div className="mod total">
        <span className="ico">⚔️</span>
        <span className="name">
          Уводит в поле
          <em className="sub">по головам, любого вида: латник здесь один</em>
        </span>
        <span className="val pos">{count(commandCap(s), 'боец', 'бойца', 'бойцов')}</span>
      </div>
      {/* Герой и полководец на карте — один человек. Сколько он уводит и чего стоит
          сам, решает Статуя; его уровень даёт натиск — это в карточке агента. */}
      <div className="note">
        Это он же водит дружину по карте: {info.name}, уровень {agentLevel(s, 'general')}. Сколько он
        уводит и за скольких стоит сам, решает Статуя, а натиск даёт его опыт — карточка в «Походах».
      </div>

      <h3>
        Герой <span className="muted">{info.name}</span>
      </h3>
      <div className="note">
        {info.away
          ? 'Ушёл с походом. Пока он в пути, площадь у статуи пуста.'
          : info.down > 0
            ? `Ранен и лежит: вернётся в строй через ${Math.ceil(info.down / DAY_LENGTH)} дн. Погибнуть навсегда он не может.`
            : 'Стоит у своей статуи и уйдёт со следующим набегом — с одним за раз.'}
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
    </>
  );
}
