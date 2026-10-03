// «Как назовёшь город?» — шаг стартового экрана при первом входе (docs/ui_audit.md, 13). Стоит, пока у города нет
// имени (`cityName(profile.city) === null`): у новой партии и у старой, где игрок город не называл, — вместо
// «Безымянного города» на карте и в отчётах.
//
// Поле не пустое: в нём уже имя на выбор (`cityNames.suggestCity`), и одного касания «В путь» хватает. Клавиатуру
// шаг не зовёт сам — только касание по полю. Пустое имя не принимается: кнопка гаснет, и строка под ней говорит
// почему. Имя пишет одна дверь (`profile/stats.setCity` — очистка договора), формат сохранения и договор не
// тронуты: поле `ProfileState.city` есть давно.
import { useState } from 'react';
import { useGame } from '@/game/store';
import { cityName } from '@/profile/identity';
import { setCity } from '@/profile/stats';
import { CITY_MAX } from '../../../netlify/lib/contract';
import { Icon } from '@/ui/icons/Icon';
import { suggestCity } from './cityNames';

export function CityNaming({ onDone }: { onDone: () => void }) {
  const seed = useGame((g) => g.s.seed);
  const act = useGame((g) => g.act);
  const save = useGame((g) => g.save);
  const [n, setN] = useState(0);
  const [draft, setDraft] = useState(() => suggestCity(seed, 0));
  const clean = cityName(draft);

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
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        <button
          className="nx-cname-dice"
          aria-label="Другое имя"
          onClick={() => {
            setN(n + 1);
            setDraft(suggestCity(seed, n + 1));
          }}
        >
          <Icon name="ui-dice" glyph="🎲" />
        </button>
      </div>
      <button className="start-go" disabled={clean === null} onClick={commit}>
        В путь
      </button>
      <p className="start-note">{clean === null ? 'Впиши имя или нажми кубик.' : 'Имя увидят соседи на карте. Сменить его — в державе.'}</p>
    </div>
  );
}
