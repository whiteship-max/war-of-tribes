// Кнопка профиля: **одно круглое лицо и больше ничего**, слева сверху — там,
// где её ищут после кнопки закрытия аппки.
//
// Имени рядом нет нарочно. Игрок знает, как его зовут, и читать это в каждом
// кадре ему незачем; а место у левого края второй строки HUD дороже подписи —
// освободившееся не занято ничем и остаётся сценой. Числа с кнопки не читаются
// по той же причине, по какой и раньше: их место в самой панели.
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
      title={`${profileName(s.profile)} — профиль и настройки`}
      aria-label={`${profileName(s.profile)}: профиль и настройки`}
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
    </button>
  );
}
