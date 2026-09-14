import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { tutorialActive } from '@/game/data/tutorial';
import { useWorld, worldNow } from '@/world/store';
import { hungerLeft } from '@/ui/parts/hunger';
import { FATE_META } from '@/world/data/fates';
import { Icon } from '@/ui/icons/Icon';

/**
 * Осада — единственное, что смотрит на игрока из правого нижнего угла деревни.
 *
 * Место выбрано не по остаточному принципу: слева внизу столбик писем, и класть
 * туда шестую стопку значило бы, что осаду разбирают тем же движением, что и
 * гонца с грамотой. Осаду не разбирают — из-под неё выходят.
 *
 * Плашка — вход в окно осады (`panels/SiegePanel`), а не второе окно: всё, что
 * про осаду можно знать и сделать, собрано там. Здесь остаётся ровно то, что
 * решает, закрыть ли игру: сколько осталось и чем кончится. Числа живые и
 * посчитаны не тут — срок идёт по мировым часам (`starvesAt`), участь приезжает
 * из мира уже проверенной.
 */
export function SiegeBanner() {
  const s = useGame((g) => g.s);
  const eventResult = useGame((g) => g.eventResult);
  const mapOpen = useGame((g) => g.mapOpen);
  const openSiege = useGame((g) => g.openSiege);
  const siege = useWorld((g) => g.siege);
  const [, retick] = useState(0);

  // Пока лагерь стоит, отсчёт до голода обязан идти сам: замерший счётчик
  // читается как сломанный экран, а не как «время ещё есть».
  useEffect(() => {
    if (!siege) return;
    const t = setInterval(() => retick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [siege]);

  // Те же правила видимости, что у писем: обучение ведёт новичка своим путём,
  // а модалка события делит слой с чем угодно поверх неё.
  if (!siege || mapOpen || tutorialActive(s) || s.activeEvent || eventResult) return null;

  const meta = FATE_META[siege.fate];

  return (
    <div className="siege">
      <div className="siege-head">
        <span className="ic">
          <Icon name="letter-siege" glyph="⛺" />
        </span>
        <b>Город в осаде</b>
      </div>
      <div className="siege-who">«{siege.byName}» у ворот</div>
      <div className="siege-clock">
        До голода <b>{hungerLeft(siege.starvesAt, worldNow())}</b>
      </div>
      {/*
        Чем кончится голод — сказано рядом с часами, потому что решение уходить из
        игры принимают, глядя на эти часы. Враг подходит и осаждает, в игре хозяин
        или нет, и кончиться осада может без него — это должно быть известно до
        того, как он закроет игру, а не после. Подробно — в окне осады.
      */}
      <div className="siege-fall">
        {meta.icon} Объявлено: {meta.name.toLowerCase()}. Случится и без тебя.
      </div>
      <button className="siege-open" onClick={openSiege}>
        ⛺ Окно осады
      </button>
    </div>
  );
}
