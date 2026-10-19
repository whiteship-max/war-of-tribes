// Выбор участи взятого города — тремя строками, у каждой сказано, что победитель
// ПОЛУЧИТ, а не что потеряет другой. Одна часть на все места, где участь объявляется
// приказом: удар и осада в меню полководца и в карточке города, настроенный бой и
// окно своего лагеря.
//
// Чисел здесь не считают: люди и добро, уступленное людям, приходят из мира
// (`FateOption`), и посчитаны они той же дверью участи, что и взятие города.
import type { Fate, FateOption } from '@/world/types';
import { FATE_META } from '@/world/data/fates';
import { plural } from './plural';
import { Icon } from '@/ui/icons/Icon';

const span = (r: { min: number; max: number }): string => (r.min === r.max ? `${r.max}` : `${r.min}–${r.max}`);

/** Что получит победитель — хвост строки выбора. */
export function fateGets(o: FateOption): string {
  if (o.id === 'captives') {
    return `${span(o.led)} ${plural(o.led.max, 'человек', 'человека', 'человек')}, добычи меньше на ${span(o.less)}`;
  }
  return o.id === 'plunder' ? 'открытые запасы и золото' : 'ничего';
}

export function FatePick({
  options,
  value,
  onChange,
}: {
  options: FateOption[];
  value: Fate;
  onChange: (fate: Fate) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="fate-pick" role="radiogroup" aria-label="Участь города">
      {options.map((o) => {
        const meta = FATE_META[o.id];
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={value === o.id}
            className={`am-row fate-row${value === o.id ? ' on' : ''}${o.can ? '' : ' off'}`}
            disabled={!o.can}
            onClick={() => onChange(o.id)}
          >
            <span className="ico"><Icon name={meta.icon} /></span>
            <span className="body">
              <b>
                {meta.name}
                {o.can ? ` · ${fateGets(o)}` : ''}
              </b>
              {!o.can && <i>{o.reason}</i>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
