// Профиль игрока. Правило то же, что и у остальных справочных экранов: числа
// живые, считаются от состояния на каждом кадре стора, а копий формул здесь нет —
// мощь берётся у `power`, итоги у профиля, счёт битв у статистики.
//
// Стены счётчиков здесь нет нарочно. Показано ровно то, на что игрок сам себя
// спрашивает: насколько я силён, как воюю, что у меня утекает и сколько добываю.
// Разбивка по семи ресурсам оставлена в одном разделе — в потерях: на вопрос
// «что утекает» итог не отвечает. В производстве она бы ответила на вопрос,
// который никто не задаёт. Состав дружины не дублируется: он есть в своей панели.
import { useState } from 'react';
import { useGame } from '@/game/store';
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import type { ResourceId } from '@/game/types';
import { NAME_MAX, cardSrc, faceSrc, profileAvatar, profileName } from '@/profile/identity';
import { PROFILE_DAYS, setName } from '@/profile/stats';
import { buildingsPower, power, troopsPower } from '@/profile/power';
import { AvatarPicker } from '../parts/AvatarPicker';
import { SyncStatus } from '../parts/Sync';

/** Число покрупнее словами: 12 400 вместо 12400 — на 390 px это читается. */
const big = (n: number): string => Math.round(n).toLocaleString('ru-RU');

/**
 * Мощь за последний месяц, столбиками. Ради этого и хранятся суточные корзины:
 * одна цифра не отвечает на вопрос «я расту или стою», а тридцать столбиков
 * отвечают, не превращаясь в стену счётчиков.
 */
function PowerTrend({ days }: { days: { day: number; power: number }[] }) {
  const shown = days.filter((d) => d.power > 0);
  if (shown.length < 2) return null;
  const top = Math.max(...shown.map((d) => d.power));
  const first = shown[0];
  const last = shown[shown.length - 1];
  const delta = last.power - first.power;
  return (
    <div className="trend">
      <div className="bars">
        {shown.map((d) => (
          <i key={d.day} style={{ height: `${Math.max(6, (d.power / top) * 100)}%` }} title={`День ${d.day}: ${big(d.power)}`} />
        ))}
      </div>
      <div className="note">
        Мощь за {Math.min(PROFILE_DAYS, last.day - first.day + 1)} дн.:{' '}
        <b className={delta >= 0 ? 'up' : 'down'}>
          {delta >= 0 ? '+' : '−'}
          {big(Math.abs(delta))}
        </b>
      </div>
    </div>
  );
}

export function ProfilePanel() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const save = useGame((g) => g.save);
  const [picking, setPicking] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');

  const p = s.profile;
  const t = p.totals;
  const village = buildingsPower(s);
  const army = troopsPower(s);
  const lost = RESOURCE_IDS.filter((r) => t.raidLoss[r] > 0);
  const lostTotal = lost.reduce((n, r) => n + t.raidLoss[r], 0);

  const startRename = (): void => {
    setDraft(p.name ?? '');
    setRenaming(true);
  };

  const commitRename = (): void => {
    act((st) => setName(st, draft));
    save();
    setRenaming(false);
  };

  // Выбор лица — не отдельный раздел шторки: снаружи на него ничего не ведёт,
  // а возврат к профилю должен быть в один тап (как карточка вида в дружине).
  if (picking) return <AvatarPicker onBack={() => setPicking(false)} />;

  return (
    <div className="panel">
      <div className="profile-head">
        <button className="pic" onClick={() => setPicking(true)} title="Сменить лицо">
          <img
            src={cardSrc(p)}
            alt=""
            draggable={false}
            onError={(e) => {
              const fallback = profileAvatar(p).card;
              if (!e.currentTarget.src.endsWith(fallback)) e.currentTarget.src = fallback;
            }}
          />
          <img
            className="mini"
            src={faceSrc(p)}
            alt=""
            draggable={false}
            onError={(e) => {
              const fallback = profileAvatar(p).face;
              if (!e.currentTarget.src.endsWith(fallback)) e.currentTarget.src = fallback;
            }}
          />
        </button>
        <div className="who">
          {renaming ? (
            <div className="rename">
              <input
                value={draft}
                maxLength={NAME_MAX}
                autoFocus
                placeholder={profileName(p)}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setRenaming(false);
                }}
              />
              <button className="btn" onClick={commitRename}>
                Готово
              </button>
            </div>
          ) : (
            <button className="name" onClick={startRename} title="Сменить имя">
              {profileName(p)} <em>✎</em>
            </button>
          )}
          <div className="power">
            <b>{big(power(s))}</b>
            <i>мощь</i>
          </div>
          <div className="split">
            🏘 посёлок {big(village)} · ⚔ дружина {big(army)}
          </div>
        </div>
      </div>

      {/* Где лежит прогресс — здесь, а не в служебном разделе: это про
          учётную запись, а не про отладку. Неудача синхронизации обязана быть
          видна, но не обязана мешать играть. */}
      <SyncStatus />

      <PowerTrend days={p.days} />

      <h3>Битвы</h3>
      <div className="mod">
        <span className="ico">🏆</span>
        <span className="name">Выиграно</span>
        <span className="val pos">{s.stats.battlesWon}</span>
      </div>
      <div className="mod">
        <span className="ico">💀</span>
        <span className="name">Проиграно</span>
        <span className={`val${s.stats.battlesLost > 0 ? ' neg' : ''}`}>{s.stats.battlesLost}</span>
      </div>
      <div className="mod">
        <span className="ico">🧺</span>
        <span className="name">
          Добыча
          <em className="sub">привезённое из походов и взятых замков</em>
        </span>
        <span className="val">
          {big(t.lootResources)} {t.lootGold > 0 ? `· ${big(t.lootGold)} 💰` : ''}
        </span>
      </div>

      <h3>Потери</h3>
      {lostTotal === 0 && t.troopsLost === 0 ? (
        <div className="note">Пока ничего не потеряно: ни один набег до добра не дошёл.</div>
      ) : (
        <div className="note">
          Набегов с уроном: {t.raids}. Что унесли — по припасам: итог на этот вопрос не отвечает.
        </div>
      )}
      {lost.map((r: ResourceId) => (
        <div className="mod" key={r}>
          <span className="ico">{RESOURCE_META[r].icon}</span>
          <span className="name">{RESOURCE_META[r].name}</span>
          <span className="val neg">−{big(t.raidLoss[r])}</span>
        </div>
      ))}
      {lost.length > 1 && (
        <div className="mod total">
          <span className="ico">📉</span>
          <span className="name">Всего унесено</span>
          <span className="val neg">−{big(lostTotal)}</span>
        </div>
      )}
      <div className="mod">
        <span className="ico">⚔️</span>
        <span className="name">
          Бойцов не вернулось
          <em className="sub">из походов и от своих ворот</em>
        </span>
        <span className={`val${t.troopsLost > 0 ? ' neg' : ''}`}>{big(t.troopsLost)}</span>
      </div>

      <h3>Производство</h3>
      <div className="mod total">
        <span className="ico">📦</span>
        <span className="name">Добыто за партию</span>
        <span className="val pos">{big(t.produced)}</span>
      </div>
      <div className="mod">
        <span className="ico">🔨</span>
        <span className="name">
          Потрачено на дело
          <em className="sub">стройка, ковка, наём</em>
        </span>
        <span className="val">{big(t.spent)}</span>
      </div>
    </div>
  );
}
