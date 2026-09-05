import { useGame } from '@/game/store';
import { DAY_LENGTH } from '@/game/constants';
import { heroInfo } from '@/game/derived';
import { setHeroKind } from '@/game/sim/actions';
import { OWN_KINDS } from '@/game/battle/kinds';
import { KIND_META } from '@/battle';

/**
 * Статуя Героя. Морали она не даёт нарочно — их в посёлке уже четыре источника;
 * она даёт племени имя. Всё, что здесь есть: кто он, где он и какой род ведёт.
 * Прогноза «насколько он усилит бой» нет, как и везде: показано только число
 * людей, которые за ним идут.
 */
export function Statue() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const info = heroInfo(s);

  return (
    <>
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
