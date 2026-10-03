import { useGame } from '@/game/store';
import { tutorialActive } from '@/game/data/tutorial';
import { Icon } from '@/ui/icons/Icon';
import { useAlertItems } from '@/ui/alertItems';

/**
 * Критические состояния всплывают поверх любого экрана: голод, остывший очаг и
 * чужой отряд на подходе. Тап ведёт туда, где это чинят.
 *
 * Набег всегда виден заранее и с таймером: у игрока должно быть время вернуть
 * армию из похода или встретить гостей — внезапных потерь эта игра не делает.
 *
 * Список тревог собирает `alertItems` — один на оба вида интерфейса; здесь —
 * строки прежнего вида.
 */
export function AlertBar() {
  const s = useGame((g) => g.s);
  const mapOpen = useGame((g) => g.mapOpen);
  const items = useAlertItems();
  if (items.length === 0) return null;

  return (
    // На карте строка встаёт вплотную под её шапку, а не туда, где стоит в
    // деревне: там над ней две строки HUD и полоска ресурсов, а здесь — только
    // координаты и кнопка возврата. Посреди пустой земли она читалась меткой на
    // местности, то есть чем-то, что стоит **там**; прижатая к шапке — тем, чем
    // и является: продолжением шапки.
    <div className={`alerts${mapOpen ? ' on-map' : ''}${tutorialActive(s) ? ' with-tut' : ''}`}>
      {items.map((a) => (
        <button key={a.key} className={`alert${a.raid ? ' raid' : ''}`} onClick={() => a.go?.()} disabled={!a.go}>
          <span className="ic">{a.icon ? <Icon name={a.icon} glyph={a.glyph} /> : a.glyph}</span>
          <span className="txt">
            {a.text}
            {/* Цена — второй строкой прямо под сроком: так же, как у голода под осадой. */}
            {a.sub && <small className="alert-sub">{a.sub}</small>}
          </span>
        </button>
      ))}
    </div>
  );
}
