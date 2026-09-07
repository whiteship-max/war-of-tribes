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
import { useMemo, useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld, worldNow } from '@/world/store';
import { awayTroops, homeTroops } from '@/world/bridge';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { formatLeft, secondsLeft } from '@/world/geo';
import { SORTIE_CAMP_BONUS } from '@/world/data/tuning';
import type { TroopId } from '@/game/types';
import { Icon } from '@/ui/icons/Icon';

/** Ряд шага, как у рабочих в здании: числом, а не карточкой на человека. */
function Steps({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  const set = (n: number): void => onChange(Math.max(0, Math.min(max, n)));
  return (
    <span className="steps">
      <button className="mini" disabled={value <= 0} onClick={() => set(value - 10)}>
        −10
      </button>
      <button className="mini" disabled={value <= 0} onClick={() => set(value - 1)}>
        −1
      </button>
      <b>{value}</b>
      <button className="mini" disabled={value >= max} onClick={() => set(value + 1)}>
        +1
      </button>
      <button className="mini" disabled={value >= max} onClick={() => set(value + 10)}>
        +10
      </button>
    </span>
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

  const away = useMemo(() => awayTroops(marches, figures), [marches, figures]);
  const home = useMemo(() => homeTroops(s, away), [s, away]);
  const [picked, setPicked] = useState<TroopStack>({});
  const [busy, setBusy] = useState(false);

  const men = troopTotal(picked);
  const stay = troopTotal(home) - men;

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
        <div className="ico">🪤</div>
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
          {TROOP_IDS.filter((t) => (home[t] ?? 0) > 0).map((t) => (
            <div className="mod" key={t}>
              <span className="ico">
                <Icon name={`troop-${t}`} glyph={TROOP_BY_ID[t].icon} />
              </span>
              <span className="name">{TROOP_BY_ID[t].name}</span>
              <Steps
                value={picked[t] ?? 0}
                max={home[t] ?? 0}
                onChange={(n) => setPicked({ ...picked, [t as TroopId]: n })}
              />
            </div>
          ))}
          <div className="mod total">
            <span className="ico">🏠</span>
            <span className="name">Останется за стеной</span>
            <span className={stay > 0 ? 'val' : 'val neg'}>{stay}</span>
          </div>
        </div>
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
