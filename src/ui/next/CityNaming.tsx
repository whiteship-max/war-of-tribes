// «Как назовёшь город?» — шаг стартового экрана при первом входе (docs/ui_audit.md, 13). Стоит, пока у города нет
// имени (`cityName(profile.city) === null`): у новой партии и у старой, где игрок город не называл, — вместо
// «Безымянного города» на карте и в отчётах.
//
// Поле не пустое: в нём уже имя на выбор (`cityNames.suggestCity`) — по вере земли, как имена людей, — и одного
// касания «В путь» хватает. Вера — та, что мир уже поставил, а до его первого ответа — вера клетки замка
// (`world/faith.faithAt`): мир поставит ту же. Узналась вера, пока игрок не трогал поле, — имя в нём сменится на имя этой
// веры; тронутое поле не переписывается. Клавиатуру
// шаг не зовёт сам — только касание по полю. Пустое имя не принимается: кнопка гаснет, и строка под ней говорит
// почему. Имя пишет одна дверь (`profile/stats.setCity` — очистка договора), формат сохранения и договор не
// тронуты: поле `ProfileState.city` есть давно.
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { cityName } from '@/profile/identity';
import { setCity } from '@/profile/stats';
import { CITY_MAX } from '../../../netlify/lib/contract';
import { Icon } from '@/ui/icons/Icon';
import { useWorld } from '@/world/store';
import { faithAt } from '@/world/faith';
import { suggestCity } from './cityNames';

export function CityNaming({ onDone }: { onDone: () => void }) {
  const seed = useGame((g) => g.s.seed);
  const set = useGame((g) => g.s.faith.id);
  const home = useWorld((w) => w.info?.home ?? null);
  const faith = set ?? (home ? faithAt(home.x, home.y) : null);
  const act = useGame((g) => g.act);
  const save = useGame((g) => g.save);
  const [n, setN] = useState(0);
  const [typed, setTyped] = useState(false);
  const [draft, setDraft] = useState(() => suggestCity(seed, 0, faith));
  const clean = cityName(draft);
  // Вера узналась после первого кадра — имя в нетронутом поле берётся из её списка.
  useEffect(() => {
    if (!typed) setDraft(suggestCity(seed, n, faith));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faith]);

  const commit = (): void => {
    if (clean === null) return;
    act((st) => setCity(st, draft));
    save();
    onDone();
  };

  return (
    <div className="nx-cname">
      <p className="nx-cname-ask">Как назовёшь город?</p>
      <div className="nx-cname-row">
        <input
          className="nx-cname-in"
          value={draft}
          maxLength={CITY_MAX}
          enterKeyHint="go"
          aria-label="Имя города"
          onChange={(e) => {
            setTyped(true);
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        <button
          className="nx-cname-dice"
          aria-label="Другое имя"
          onClick={() => {
            setN(n + 1);
            setTyped(false);
            setDraft(suggestCity(seed, n + 1, faith));
          }}
        >
          <Icon name="ui-dice" />
        </button>
      </div>
      <button className="start-go" disabled={clean === null} onClick={commit}>
        В путь
      </button>
      <p className="start-note">{clean === null ? 'Впиши имя или нажми кубик.' : 'Имя увидят соседи на карте. Сменить его — в державе.'}</p>
    </div>
  );
}
