import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { tutorialActive } from '@/game/data/tutorial';
import { SIEGE_FOOD_YIELD, SIEGE_YIELD } from '@/game/constants';
import { bondedTotal } from '@/game/derived';
import { SIEGE_ROUT } from '@/world/data/tuning';
import { useWorld, worldNow } from '@/world/store';
import { formatLeft, secondsLeft } from '@/world/geo';
import { worksShort } from '@/world/works';
import { Icon } from '@/ui/icons/Icon';

/**
 * Осада — единственное, что смотрит на игрока из правого нижнего угла деревни.
 *
 * Место выбрано не по остаточному принципу: слева внизу столбик писем, и класть
 * туда шестую стопку значило бы, что осаду разбирают тем же движением, что и
 * гонца с грамотой. Осаду не разбирают — из-под неё выходят.
 *
 * Числа здесь живые и все до одного считаны не тут: срок идёт по мировым часам
 * (`starvesAt` — их отметка), доля срезанного притока берётся из констант, по
 * которым его режет сама симуляция (`derived.siegeYield`). Своей арифметики у
 * панели нет и быть не должно — иначе она однажды покажет не то, что происходит.
 */
export function SiegeBanner() {
  const s = useGame((g) => g.s);
  const eventResult = useGame((g) => g.eventResult);
  const mapOpen = useGame((g) => g.mapOpen);
  const openSortie = useGame((g) => g.openSortie);
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

  const left = secondsLeft(siege.starvesAt, worldNow());
  const cut = Math.round((1 - SIEGE_YIELD) * 100);
  const rout = Math.round(SIEGE_ROUT * 100);

  return (
    <div className="siege">
      <div className="siege-head">
        <span className="ic">
          <Icon name="letter-siege" glyph="⛺" />
        </span>
        <b>Город в осаде</b>
      </div>
      <div className="siege-who">«{siege.byName}» у ворот</div>
      {/*
        Дебаф одной строкой, а не таблицей: панель обязана быть маленькой —
        слева в том же ярусе стоит столбик писем, и на 375 px на двоих места
        ровно столько. Числа при этом всё равно из констант, которыми режет
        симуляция, а не написаны словами в разметке.
      */}
      <div className="siege-cut">
        Хлеб {SIEGE_FOOD_YIELD === 0 ? 'не идёт' : `×${SIEGE_FOOD_YIELD}`}, прочее −{cut}%
      </div>
      {/*
        Главное число панели — оно же и весь размен: гарнизон, который не дал
        чужим пойти на приступ, ест из того же амбара и приближает эту отметку.
        Поэтому он и стоит здесь, рядом со сроком, а не отдельной строкой.
      */}
      <div className="siege-clock">
        До голода <b>{formatLeft(left)}</b>
      </div>
      <div className="siege-eat">Гарнизон {siege.garrison} — он и ест</div>
      {/*
        Чем кончится голод — сказано здесь и заранее, рядом с часами, потому что
        решение уходить из игры принимают, глядя на эти часы. Осада не начинается
        без игрока: он видел лагерь, видел срок и имел вылазку. А вот кончиться
        она может без него — и это должно быть известно до того, как он закроет
        игру, а не после (см. docs/siege.md, «Падение города»).

        Доля рассеянного гарнизона берётся из той же константы, которой её
        считает мир: своей арифметики у панели нет.
      */}
      {/*
        Невольников победитель уводит тем же правилом, каким уводим их мы из
        павшего чужого города (`world/spoils.lead`), — и об этом сказано здесь
        же, пока падение ещё не наступило. Без невольников строка прежняя.
      */}
      <div className="siege-fall">
        Кончится хлеб — уйдёт {rout}% гарнизона, склад вычистят до тайника
        {bondedTotal(s) > 0 ? ', уведут невольников' : ''}. Случится и без тебя.
      </div>
      {/*
        Рогатки растут, и время работает против города: это видно здесь же, над
        кнопкой, где решают, выходить ли сейчас. Слова и числа — из `world/works`,
        той же меркой, которой их считает бой.
      */}
      <div className="siege-works">{worksShort(siege.since, worldNow())}</div>
      {/*
        Вылазка — единственное, что игрок может сделать из-под осады сам, и
        поэтому кнопка тут одна. Состав выбирается на своём экране: выпускать
        весь гарнизон одним нажатием — не решение, а ловушка.
      */}
      <button className="siege-sortie" onClick={openSortie}>
        ⚔️ Вылазка
      </button>
      <div className="siege-note">Выйти и сбить лагерь, пока рогатки не дозрели.</div>
    </div>
  );
}
