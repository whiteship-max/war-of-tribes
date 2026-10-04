// Экран выбора лица. Строится из набора (`AVATARS`), а не из прописанных
// карточек: листов три, персонажей двадцать четыре, и добавить двадцать пятого
// должно быть делом одной перегенерации, а не правки разметки. Имён видов
// здесь поэтому нет ни одного — это проверяется тестом.
import { useState } from 'react';
import type { AvatarId } from '@/data/avatars';
import { AVATARS } from '@/data/avatars';
import { useGame } from '@/game/store';
import { DEFAULT_AVATAR } from '@/profile/identity';
import { clearAvatar, setAvatar } from '@/profile/stats';

export function AvatarPicker({ onBack }: { onBack: () => void }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const save = useGame((g) => g.save);
  const [pick, setPick] = useState<AvatarId>(s.profile.avatarId ?? DEFAULT_AVATAR);
  // Фото Telegram — не карточка набора, и вернуть его можно только отказом от
  // выбора. Показываем эту дорогу, только если фото вообще есть.
  const photo = s.profile.tgPhoto;

  const choose = (): void => {
    act((st) => setAvatar(st, pick));
    save();
    onBack();
  };

  const backToPhoto = (): void => {
    act((st) => clearAvatar(st));
    save();
    onBack();
  };

  return (
    <div className="panel">
      <button className="btn ghost back" onClick={onBack}>
        ← К профилю
      </button>

      <h2>
        Лицо правителя <small>{AVATARS.length} на выбор</small>
      </h2>

      <div className="av-grid">
        {AVATARS.map((a) => (
          <button
            key={a.id}
            className={`av${a.id === pick ? ' on' : ''}`}
            onClick={() => setPick(a.id)}
            title={a.name}
          >
            <img src={a.card} alt={a.name} loading="lazy" draggable={false} />
            <span>{a.name}</span>
          </button>
        ))}
      </div>

      <button className="btn wide" onClick={choose}>
        Сохранить
      </button>
      {photo && s.profile.avatarId && (
        <button className="btn ghost wide" onClick={backToPhoto}>
          Фото из Telegram
        </button>
      )}
    </div>
  );
}
