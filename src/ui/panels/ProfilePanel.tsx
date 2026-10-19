// Профиль игрока — и заодно единственное место, где живут настройки игры.
//
// Отдельной панели настроек нет нарочно: профиль открывается шестерёнкой в меню
// державы (герб в шапке), и заводить рядом вторую дверь незачем. Настройки — раздел здесь
// (`parts/Settings.tsx`), между строкой синхронизации и числами партии.
//
// Правило то же, что и у остальных справочных экранов: числа
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
import { NAME_MAX, profileArms, profileName } from '@/profile/identity';
import { PROFILE_DAYS, setName } from '@/profile/stats';
import { buildingsPower, power, troopsPower } from '@/profile/power';
import { ArmsArt } from '../parts/Arms';
import { ArmsMaker } from '../parts/ArmsMaker';
import { Icon } from '@/ui/icons/Icon';
import { Settings } from '../parts/Settings';
import { SyncStatus } from '../parts/Sync';
import { waitDays } from '../parts/wait';
import { Table } from '@/ui/kit/Table';
import { Num } from '@/ui/kit/Num';
import { breakdown } from '@/ui/kit/breakdown';
import type { TipContent } from '@/ui/next/tip';
import type { GameState } from '@/game/types';
import type { IconName } from '@/ui/icons/alias';
import { iconName } from '@/ui/icons/registry';

/** Число покрупнее словами: 12 400 вместо 12400 — на 390 px это читается. */
const big = (n: number): string => Math.round(n).toLocaleString('ru-RU');

/** Мощь с разбором: город (уровни построек) и дружина (бойцы по весу вида) — `profile/power`, итог — `power`. */
export function powerTip(s: GameState): TipContent {
  return breakdown({
    title: `Мощь · ${big(power(s))}`,
    body: 'Её видят соседи в рейтинге. Растёт со стройкой и наймом.',
    total: power(s),
    parts: [
      { label: 'Город', value: buildingsPower(s) },
      { label: 'Дружина', value: troopsPower(s) },
    ],
    fmt: big,
    // Итог округлён (`power`): дробь слагаемых — запись, а не дыра в разборе.
    eps: 0.5,
  });
}

interface PartyRow {
  key: string;
  icon: IconName;
  name: string;
  v: string;
  tone?: 'good' | 'bad';
  body?: string;
}

/**
 * Числа партии таблицами (UI-7, docs/ui_v2.md, 5.6): битвы, потери, хозяйство — строкой на число, а не карточкой `.mod`;
 * пояснение — касанием строки. Числа — счётчики профиля (`profile.totals`) и партии (`stats`), своей арифметики нет.
 */
export function partyTables(s: GameState): { title: string; rows: PartyRow[]; empty?: string }[] {
  const t = s.profile.totals;
  const lost = RESOURCE_IDS.filter((r) => t.raidLoss[r] > 0);
  const lostTotal = lost.reduce((n, r) => n + t.raidLoss[r], 0);
  const loot = `${big(t.lootResources)}${t.lootGold > 0 ? ` · золота ${big(t.lootGold)}` : ''}`;
  const losses: PartyRow[] = [
    ...lost.map((r) => ({ key: r, icon: iconName('res', r), name: RESOURCE_META[r].name, v: `−${big(t.raidLoss[r])}`, tone: 'bad' as const })),
    ...(lost.length > 1 ? [{ key: 'all', icon: 'ui-down' as const, name: 'Всего унесено', v: `−${big(lostTotal)}`, tone: 'bad' as const }] : []),
    ...(t.raids > 0 ? [{ key: 'raids', icon: 'ui-flame' as const, name: 'Набегов с уроном', v: big(t.raids) }] : []),
    ...(t.troopsLost > 0
      ? [{ key: 'men', icon: 'hud-army' as const, name: 'Бойцов не вернулось', v: big(t.troopsLost), tone: 'bad' as const, body: 'Из походов и от своих ворот.' }]
      : []),
  ];
  return [
    {
      title: 'Битвы',
      rows: [
        { key: 'won', icon: 'ui-trophy', name: 'Выиграно', v: big(s.stats.battlesWon), tone: 'good' },
        { key: 'lost', icon: 'ui-skull', name: 'Проиграно', v: big(s.stats.battlesLost), tone: s.stats.battlesLost > 0 ? 'bad' : undefined },
        { key: 'lairs', icon: 'ui-flame', name: 'Сожжено логов', v: big(s.stats.lairs ?? 0) },
        { key: 'loot', icon: 'ui-loot', name: 'Добыча', v: loot, body: 'Из походов и взятых городов: припасы и золото.' },
      ],
    },
    { title: 'Потери', rows: losses, empty: 'Потерь нет.' },
    {
      title: 'Хозяйство',
      rows: [
        { key: 'made', icon: 'ui-crate', name: 'Добыто всего', v: big(t.produced), tone: 'good' },
        { key: 'spent', icon: 'ui-hammer', name: 'Потрачено', v: big(t.spent), body: 'На стройку, ковку и найм.' },
      ],
    },
  ];
}

/**
 * Мощь за последние `PROFILE_DAYS`, столбиками. Ради этого и хранятся суточные корзины:
 * одна цифра не отвечает на вопрос «я расту или стою», а столбик на каждый день
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
          <i key={d.day} style={{ height: `${Math.max(6, (d.power / top) * 100)}%` }} />
        ))}
      </div>
      <div className="note">
        Мощь за {waitDays(Math.min(PROFILE_DAYS, last.day - first.day + 1))}:{' '}
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

  const startRename = (): void => {
    setDraft(p.name ?? '');
    setRenaming(true);
  };

  const commitRename = (): void => {
    act((st) => setName(st, draft));
    save();
    setRenaming(false);
  };

  // Конструктор герба — не отдельный раздел шторки: снаружи на него ничего не ведёт,
  // а возврат к профилю должен быть в один тап (как карточка вида в дружине).
  if (picking) return <ArmsMaker onBack={() => setPicking(false)} />;

  return (
    <div className="panel">
      <div className="profile-head">
        <button className="pic arms" onClick={() => setPicking(true)} aria-label="Сменить герб">
          <ArmsArt arms={profileArms(p)} size={72} />
          <span>Герб</span>
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
            <button className="name" onClick={startRename} aria-label="Сменить имя">
              {profileName(p)}{' '}
              <em>
                <Icon name="ui-edit" />
              </em>
            </button>
          )}
          {/* Имя города правят в шапке державы — она стоит и над профилем (находка Д14: прежде здесь была вторая дверь
              к тому же имени, UI-7, docs/ui_v2.md, 5.6). */}
          <div className="power">
            <Num tip={() => powerTip(s)} label="Мощь">
              {big(power(s))}
            </Num>
            <i>мощь</i>
          </div>
        </div>
      </div>

      {/* Где лежит прогресс — здесь, а не в служебном разделе: это про
          учётную запись, а не про отладку. Неудача синхронизации обязана быть
          видна, но не обязана мешать играть. */}
      <SyncStatus />

      {/* Настройки стоят вторым блоком, а не в хвосте панели, и это не вкус:
          шестерёнка меню державы ведёт сюда, и половина заходов — за музыкой. Строка,
          до которой надо доскроллить мимо битв и потерь, считалась бы
          пропавшей. Ниже начинаются числа партии — там им и место. */}
      <Settings />

      <PowerTrend days={p.days} />

      {partyTables(s).map((tb) => (
        // Имя раздела — шапкой таблицы: отдельный заголовок над ней повторял бы его.
        <section key={tb.title} className="pf-table">
          <Table
            label={tb.title}
            cols={[
              { key: 'name', title: tb.title },
              { key: 'v', title: 'Всего', align: 'right', w: '96px' },
            ]}
            empty={tb.empty}
            rows={tb.rows.map((r) => ({
              key: r.key,
              tip: r.body ? () => ({ title: `${r.name} · ${r.v}`, body: r.body }) : undefined,
              cells: {
                name: (
                  <span className="kit-name">
                    <span className="ic"><Icon name={r.icon} /></span>
                    <span className="one-line">{r.name}</span>
                  </span>
                ),
                v: <span className={r.tone ?? ''}>{r.v}</span>,
              },
            }))}
          />
        </section>
      ))}
    </div>
  );
}
