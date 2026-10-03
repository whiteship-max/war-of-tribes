// Меню державы нового интерфейса (docs/ui_audit.md, 6.4). Каркас — шторка между верхом и низом: верх, тревоги
// и низ видны и работают. Шапка — герб, город и правитель, профиль и «закрыть» значками; под ней строка очков
// трёх ветвей; пять вкладок значком и словом, все на экране: Правитель · Указы · Технологии · Вера · Задания.
// «Вести» — свой экран из нижней навигации, без вкладок: счётчик стоит там, куда ведёт.
//
// Разделы — те же компоненты, что у прежнего меню (`Section`), кроме технологий: здесь они тремя столбцами
// ветвей, ступень — ячейкой, а изучение — закреплённой полосой внизу. Своих чисел нет: очки, цена, уровень,
// ожидание — `sim/points`, `sim/tech` (правило 18).
import './realm-new.css';
import { useEffect, useRef, useState } from 'react';
import { useGame } from '@/game/store';
import { POINTS_CAP, REALM_BRANCHES, levelPrice, levelsOf } from '@/game/data/realm';
import { pointsOf, rulerRate } from '@/game/sim/points';
import { levelName, study, studyInfo, techGains, techLevel } from '@/game/sim/tech';
import type { RealmBranch } from '@/game/types';
import { cityName, profileCity, profileName } from '@/profile/identity';
import { setCity } from '@/profile/stats';
import { CITY_MAX } from '../../../netlify/lib/contract';
import { Icon } from '@/ui/icons/Icon';
import { waitLeft } from '@/ui/parts/wait';
import { tipAt } from '@/ui/next/tip';
import { CoatArt } from './Coat';
import { useRealm, type RealmView } from './open';
import { Section, useRealmYield } from './RealmMenu';

/** Ветви словами словаря (4.4): управление · дипломатия · война. */
export const BRANCH_WORD: Record<RealmBranch, string> = { admin: 'Управление', diplo: 'Дипломатия', war: 'Война' };
export const BRANCH_ICON: Record<RealmBranch, { name: string; glyph: string }> = {
  admin: { name: 'pts-adm', glyph: '📜' },
  diplo: { name: 'pts-dip', glyph: '🕊️' },
  war: { name: 'pts-mil', glyph: '⚔️' },
};

/** Вкладки нового меню: пять, значком и словом. Остальные разделы — внизу экрана или в профиле. */
export const NEW_TABS: readonly { id: RealmView; word: string; icon: string; glyph: string }[] = [
  { id: 'lineage', word: 'Правитель', icon: 'ui-crown', glyph: '👑' },
  { id: 'government', word: 'Указы', icon: 'ui-scroll', glyph: '📜' },
  { id: 'tech', word: 'Технологии', icon: 'ui-tech', glyph: '📚' },
  { id: 'faith', word: 'Вера', icon: 'ui-faith', glyph: '⛪' },
  { id: 'quests', word: 'Задания', icon: 'nav-quests', glyph: '📜' },
];

export function RealmNew() {
  const view = useRealm((r) => r.view);
  const go = useRealm((r) => r.go);
  const hide = useRealm((r) => r.hide);
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const save = useGame((g) => g.save);
  const [top, setTop] = useState(0);
  // Имя города правится в шапке (docs/ui_audit.md, 13): черновик — сырой ввод, очищает одна дверь `setCity`.
  const [draft, setDraft] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  useRealmYield();

  const commitCity = (): void => {
    if (draft !== null && cityName(draft) !== null) {
      act((st) => setCity(st, draft));
      save();
    }
    setDraft(null);
  };

  // Меню стоит под верхом, а не поверх него: запасы не закрывает ни одно окно.
  useEffect(() => {
    const bar = document.querySelector('.nx-res');
    setTop(bar ? Math.ceil(bar.getBoundingClientRect().bottom) + 2 : 0);
  }, []);

  useEffect(() => {
    body.current?.scrollTo(0, 0);
  }, [view]);

  const mail = view === 'decisions';
  return (
    <div className="realm nx-realm" style={{ top }} role="dialog" aria-label={mail ? 'Вести' : 'Держава'}>
      {mail ? (
        <div className="nx-rhead">
          <span className="nx-rico">
            <Icon name="ui-mail" glyph="✉️" />
          </span>
          <div className="nx-rtitle">
            <b>Вести</b>
          </div>
          <button className="nx-ibtn" onClick={hide} aria-label="Закрыть">
            <Icon name="ui-close" glyph="✕" />
          </button>
        </div>
      ) : (
        <>
          {draft !== null ? (
            <div className="nx-rhead">
              <CoatArt size={28} />
              <form
                className="nx-rtitle nx-rform"
                onSubmit={(e) => {
                  e.preventDefault();
                  commitCity();
                }}
              >
                <input
                  className="nx-rin"
                  value={draft}
                  maxLength={CITY_MAX}
                  autoFocus
                  enterKeyHint="done"
                  aria-label="Имя города"
                  placeholder={profileCity(s.profile)}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </form>
              <button className="nx-ibtn" onClick={commitCity} aria-label="Готово">
                <Icon name="ui-check" glyph="✔️" />
              </button>
              <button className="nx-ibtn" onClick={() => setDraft(null)} aria-label="Отмена">
                <Icon name="ui-close" glyph="✕" />
              </button>
            </div>
          ) : (
            <div className="nx-rhead">
              <CoatArt size={28} />
              <button className="nx-rtitle nx-rname" onClick={() => setDraft(cityName(s.profile.city) ?? '')} aria-label="Сменить имя города">
                <span className="nx-rcity">
                  <b className="one-line">{profileCity(s.profile)}</b>
                  <Icon name="ui-edit" glyph="✏️" />
                </span>
                <i className="one-line">{profileName(s.profile)}</i>
              </button>
              <button className={`nx-ibtn${view === 'settings' ? ' on' : ''}`} onClick={() => go('settings')} aria-label="Профиль и настройки">
                <Icon name="ui-person" glyph="👤" />
              </button>
              <button className="nx-ibtn" onClick={hide} aria-label="Закрыть">
                <Icon name="ui-close" glyph="✕" />
              </button>
            </div>
          )}
          <PointsRow />
          <div className="nx-rtabs" role="tablist">
            {NEW_TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={view === t.id} className={view === t.id ? 'on' : ''} onClick={() => go(t.id)}>
                <Icon name={t.icon} glyph={t.glyph} />
                <span>{t.word}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="realm-body nx-rbody" ref={body}>
        {view === 'tech' ? <TechGrid /> : <Section view={view} />}
      </div>
    </div>
  );
}

/** Строка очков правителя: три ячейки-справки, тап — приток и потолок. */
function PointsRow() {
  const s = useGame((g) => g.s);
  return (
    <div className="nx-points">
      {REALM_BRANCHES.map((b) => {
        const have = Math.floor(pointsOf(s, b));
        return (
          <button
            key={b}
            className={`nx-pcell${have >= POINTS_CAP ? ' full' : ''}`}
            aria-label={`Очки: ${BRANCH_WORD[b].toLowerCase()}`}
            onClick={(e) => tipAt(e.currentTarget, pointsTip(b, have, rulerRate(s, b)))}
          >
            <Icon name={BRANCH_ICON[b].name} glyph={BRANCH_ICON[b].glyph} />
            <b>{have}</b>
            <small>/{POINTS_CAP}</small>
          </button>
        );
      })}
    </div>
  );
}

/** Подсказка ячейки очков — функциями `sim/points` (правило 18). */
export function pointsTip(b: RealmBranch, have: number, rate: number): { title: string; body: string } {
  const flow = rate > 0 ? `+${rate} в игровой день.` : 'Приток нулевой.';
  return {
    title: `${BRANCH_WORD[b]} · ${have} из ${POINTS_CAP}`,
    body: have >= POINTS_CAP ? `${flow} Потолок: новые очки не копятся.` : flow,
  };
}

/**
 * Короткая подпись ступени для ячейки — из имени, которое даёт дверь гейта (`levelName`): лестницу ветви здесь
 * не читают (`tech.test.ts`, «лестницу ветви читает только дверь гейта»). У управления имя — «Мест для наёмных
 * мастеров: 6», в ячейку идёт его число: «6 мест»; не нашлось числа — имя целиком, ячейка его обрежет.
 */
export function cellName(b: RealmBranch, level: number): string {
  if (level <= 1) return 'Начало';
  const name = levelName(b, level);
  const seats = b === 'admin' ? /:\s*(\d+)$/.exec(name) : null;
  return seats ? `${seats[1]} мест` : name;
}

/**
 * Технологии тремя столбцами: изучено — галочка, следующая — рамка, дальше — замок. Выбрана ступень, которую
 * можно изучить первой, — у военной ветви, если она не изучена целиком (по ней открывается снаряжение);
 * тап по ячейке выбирает другую. Внизу закреплена полоса: что даст, цена очками и «Изучить».
 */
function TechGrid() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const start = (): { b: RealmBranch; l: number } => {
    const order: RealmBranch[] = ['war', 'admin', 'diplo'];
    const b = order.find((x) => studyInfo(s, x).next > 0) ?? 'war';
    return { b, l: studyInfo(s, b).next || techLevel(s, b) };
  };
  const [sel, setSel] = useState(start);
  const info = studyInfo(s, sel.b);
  const done = sel.l <= info.level;
  const isNext = sel.l === info.next;
  const gains = techGains(sel.b, sel.l - 1);
  const price = levelPrice(sel.b, sel.l);

  return (
    <div className="nx-tech">
      <div className="nx-tcols">
        {REALM_BRANCHES.map((b) => {
          const level = techLevel(s, b);
          const last = levelsOf(b);
          return (
            <div key={b} className="nx-tcol">
              <div className="nx-thead">
                <span>{BRANCH_WORD[b]}</span>
                <small>
                  {level}/{last}
                </small>
              </div>
              {Array.from({ length: last }, (_, i) => i + 1).map((l) => {
                const state = l <= level ? 'done' : l === level + 1 ? 'next' : 'lock';
                const on = sel.b === b && sel.l === l;
                return (
                  <button key={l} className={`nx-tcell ${state}${on ? ' sel' : ''}`} onClick={() => setSel({ b, l })}>
                    <span className="nx-tico">
                      {state === 'done' ? (
                        <Icon name="ui-check" glyph="✔️" />
                      ) : state === 'next' ? (
                        <Icon name={BRANCH_ICON[b].name} glyph={BRANCH_ICON[b].glyph} />
                      ) : (
                        <Icon name="ui-lock" glyph="🔒" />
                      )}
                    </span>
                    <b>{l}</b>
                    <span className="nx-tname">{cellName(b, l)}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="nx-tbar">
        <div className="nx-tsel">
          <b>{levelName(sel.b, sel.l)}</b>
          {gains.length > 0 && <small>{gains.join(' · ')}</small>}
          {!done && (
            <span className={`nx-tprice${isNext && info.have < price ? ' no' : ''}`}>
              <Icon name={BRANCH_ICON[sel.b].name} glyph={BRANCH_ICON[sel.b].glyph} />
              {price}
              <i>из {Math.floor(info.have)}</i>
            </span>
          )}
          {isNext && info.blocked && info.wait > 0 && <small className="nx-twait">Накопится через {waitLeft(info.wait)}</small>}
          {!done && !isNext && <small className="nx-twait">Сначала ур. {info.next || info.level}</small>}
        </div>
        {done ? (
          <span className="nx-tdone">
            <Icon name="ui-check" glyph="✔️" /> Изучено
          </span>
        ) : (
          <button
            className="nx-go"
            data-tut={`tech-${sel.b}`}
            disabled={!isNext || info.blocked !== null}
            onClick={() => {
              act((g) => study(g, sel.b));
              // Изученная ступень уступает выбор следующей той же ветви: её и спросят дальше.
              if (sel.l < levelsOf(sel.b)) setSel({ b: sel.b, l: sel.l + 1 });
            }}
          >
            Изучить
          </button>
        )}
      </div>
    </div>
  );
}
