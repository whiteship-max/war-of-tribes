// Кнопка профиля: круглое лицо и имя, слева сверху — там, где её ищут после
// кнопки закрытия аппки. Числа с неё не читаются: их место в самой панели, а
// в строке состояния и без того пять ячеек.
import { useGame } from '@/game/store';
import { faceSrc, profileAvatar, profileName } from '@/profile/identity';

export function ProfileButton() {
  const s = useGame((g) => g.s);
  const sheet = useGame((g) => g.sheet);
  const openTab = useGame((g) => g.openTab);
  const active = sheet?.kind === 'tab' && sheet.tab === 'profile';

  return (
    <button
      className={`profile-btn${active ? ' active' : ''}`}
      data-tut="nav-profile"
      onClick={() => openTab('profile')}
      title="Профиль: мощь, битвы, потери"
    >
      <img
        className="face"
        src={faceSrc(s.profile)}
        alt=""
        draggable={false}
        // Фото Telegram может не загрузиться — у закрытого профиля его нет вовсе.
        // Тогда на его место встаёт лицо из набора, а не пустой квадрат.
        onError={(e) => {
          // Сравнение по хвосту: в `src` лежит уже разрешённый адрес, а в наборе
          // путь от корня. Без этого подстановка зациклилась бы сама на себе.
          const fallback = profileAvatar(s.profile).face;
          if (!e.currentTarget.src.endsWith(fallback)) e.currentTarget.src = fallback;
        }}
      />
      <span className="who">{profileName(s.profile)}</span>
    </button>
  );
}
