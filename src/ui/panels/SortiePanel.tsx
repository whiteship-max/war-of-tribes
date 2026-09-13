// Вылазка: кого выпускаем за ворота.
//
// Состав выбирается — не «всё или ничего». Гарнизон, вышедший весь, оставил бы
// стену пустой, и это была бы не ставка, а ловушка: осада не кончится от одной
// неудачи, а обороняться после неё будет нечем.
//
// Расстановки здесь нет нарочно. Вылазка — это внезапный удар из ворот, и
// шесть секторов с планом и резервом на неё не раскладывают: строй в воротах не
// строят. Пресет выберется по сиду боя — тем же, каким его выбирает быстрая
// атака.
//
// Прогноза исхода нет — как и везде в этой игре. Известно ровно то, что можно
// увидеть со стены: сколько людей в лагере и что он встретит вылазку готовым.
import { Fragment, useMemo, useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld, worldNow } from '@/world/store';
import { awayOf, homeOf, standingTroops } from '@/world/muster';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { formatLeft, secondsLeft } from '@/world/geo';
import { SORTIE_CAMP_BONUS } from '@/world/data/tuning';
import type { TroopId } from '@/game/types';
import { Icon } from '@/ui/icons/Icon';

/**
 * Ряд шага, как у рабочих в здании: числом, а не карточкой на человека.
 *
 * Разметка здесь ровно та же, что у `Steps` в `BuildingPanel` — `.stepper
 * wide-steps` на всю ширину, — и это не вкусовщина. Своих классов у ряда шага
 * нет: единственный, кто его красит, — эти два правила в стилях, и ряд,
 * названный по-своему, остаётся без стилей вовсе. Так и вышло в первый раз:
 * пять кнопок `.mini` (каждая `display: flex` шириной в палец) встали друг под
 * друга, строка вида выросла до 211 px, а список из пяти видов — до 1108 px в
 * шторке высотой 413.
 */
function Steps({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  const set = (n: number): void => onChange(Math.max(0, Math.min(max, n)));
  return (
    <div className="stepper wide-steps">
      <button disabled={value <= 0} onClick={() => set(value - 10)} aria-label="Убрать 10">
        −10
      </button>
      <button disabled={value <= 0} onClick={() => set(value - 1)} aria-label="Убрать">
        −1
      </button>
      <span className="n">{value}</span>
      <button disabled={value >= max} onClick={() => set(value + 1)} aria-label="Добавить">
        +1
      </button>
      <button disabled={value >= max} onClick={() => set(value + 10)} aria-label="Добавить 10">
        +10
      </button>
    </div>
  );
}

export function SortiePanel() {
  const s = useGame((g) => g.s);
  const showToast = useGame((g) => g.showToast);
  const openReport = useGame((g) => g.openReport);
  const closeSheet = useGame((g) => g.closeSheet);
  const siege = useWorld((g) => g.siege);
  const marches = useWorld((g) => g.marches);
  const figures = useWorld((g) => g.figures);
  const sortie = useWorld((g) => g.sortie);

  const away = useMemo(() => awayOf(marches, figures), [marches, figures]);
  // Выходят из гарнизона. Дружина, собранная у своих ворот, стену держит, но с
  // вылазкой не выходит: за ворота её ведёт полководец своим приказом.
  const home = useMemo(() => homeOf(s.army, away), [s, away]);
  const standing = useMemo(() => troopTotal(standingTroops(s.army, away)), [s, away]);
  const [picked, setPicked] = useState<TroopStack>({});
  const [busy, setBusy] = useState(false);

  const men = troopTotal(picked);
  const stay = troopTotal(home) - men + standing;

  if (!siege) {
    return (
      <div className="panel">
        <div className="bhead">
          <div className="ico">⚔️</div>
          <div className="body">
            <div className="name">Вылазки не нужно</div>
            <div className="lvl">под стенами никого</div>
          </div>
        </div>
        <p className="note">Осада снята. Выходить не на кого.</p>
      </div>
    );
  }

  const go = async (): Promise<void> => {
    setBusy(true);
    const res = await sortie(picked);
    setBusy(false);
    if (res.error) {
      showToast(res.error);
      return;
    }
    if (res.reportId) openReport(res.reportId);
    else closeSheet();
  };

  return (
    <div className="panel">
      <div className="bhead">
        <div className="ico">
          <Icon name="letter-siege" glyph="⛺" />
        </div>
        <div className="body">
          <div className="name">Вылазка</div>
          <div className="lvl">
            «{siege.byName}» у ворот · до голода {formatLeft(secondsLeft(siege.starvesAt, worldNow()))}
          </div>
        </div>
      </div>

      {/*
        Единственное, что игрок знает о бое заранее, — и знать это он обязан:
        вылазка бьёт в готовый лагерь. Прятать прибавку в число на экране отчёта
        значило бы, что решение принимается вслепую там, где вслепую оно
        приниматься не должно.
      */}
      <div className="card danger">
        <div className="ico">⚠️</div>
        <div className="body">
          <div className="title">Лагерь встретит готовым</div>
          <div className="desc">
            Рогатки выставлены, дозоры стоят: в бою он считается на{' '}
            {Math.round(SORTIE_CAMP_BONUS * 100)}% сильнее, чем тот же отряд в чистом поле.
          </div>
        </div>
      </div>

      <h3>
        Кто выходит <small>{men} из {troopTotal(home)}</small>
      </h3>
      {troopTotal(home) === 0 ? (
        <div className="desc">
          В гарнизоне никого. Вылазку делают бойцами — найми кого-нибудь в казармах, если успеешь.
        </div>
      ) : (
        <div className="mod-list">
          {/*
            Вид и ряд шага — две строки, а не одна. Ряд шага занимает всю
            ширину нарочно (см. `Steps`): пять кнопок в палец шириной — это
            220 px, а на 375 px рядом с именем вида их не поставить.
          */}
          {TROOP_IDS.filter((t) => (home[t] ?? 0) > 0).map((t) => (
            <Fragment key={t}>
              <div className="mod">
                <span className="ico">
                  <Icon name={`troop-${t}`} glyph={TROOP_BY_ID[t].icon} />
                </span>
                <span className="name">{TROOP_BY_ID[t].name}</span>
                <span className={(picked[t] ?? 0) > 0 ? 'val pos' : 'val'}>
                  {picked[t] ?? 0} из {home[t] ?? 0}
                </span>
              </div>
              <Steps
                value={picked[t] ?? 0}
                max={home[t] ?? 0}
                onChange={(n) => setPicked({ ...picked, [t as TroopId]: n })}
              />
            </Fragment>
          ))}
          <div className="mod total">
            <span className="ico">🏠</span>
            <span className="name">{standing > 0 ? `Останется за стеной, с дружиной ${standing}` : 'Останется за стеной'}</span>
            <span className={stay > 0 ? 'val' : 'val neg'}>{stay}</span>
          </div>
        </div>
      )}
      {standing > 0 && (
        <p className="note">
          Дружина полководца у ворот с вылазкой не выходит: она держит стену, а по лагерю бьёт приказом
          полководца.
        </p>
      )}

      <div className="cost">
        <button className="mini text" onClick={() => setPicked({ ...home })}>
          Вывести всех
        </button>
        <button className="mini text" onClick={() => setPicked({})}>
          Никого
        </button>
      </div>

      <button className="btn wide" disabled={busy || men === 0} onClick={() => void go()}>
        ⚔️ Выйти {men > 0 ? `(${men})` : ''}
      </button>

      <p className="note">
        Победа снимает осаду, и город снова ест. Поражение её не снимает — но и лагерю достаётся:
        часы голода после этого считаются заново, от того гарнизона, который остался.
      </p>
    </div>
  );
}
