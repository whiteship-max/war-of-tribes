// Настройки игры. **Один компонент, показанный в двух местах**: разделом внутри
// профиля (шестерёнка в меню державы) и окном на стартовом экране, до входа в
// партию. Копии здесь нет и быть не может — ни разметки, ни состояния: два
// похожих экрана настроек расходятся ровно в тот день, когда правят один из
// них, и расходятся молча.
//
// Отсюда же следует, что содержимое у обоих показов одинаковое. Соблазн
// «на стартовом экране покажем только звук» — это и есть начало второй копии.
//
// Строк здесь шесть — звук (с громкостью музыки и звуков под ним, пока он включён), графика, подсказки, вести в Telegram (только в Telegram), «Сообщить об ошибке» (тоже
// только в Telegram), язык, — и это не заготовка под список.
// Свалкой раздел становится с той строки, которую добавили «раз уж всё равно
// открыли»: игрок перестаёт читать и начинает пролистывать. Новая строка
// появляется тогда, когда без неё что-то нельзя сделать, а не тогда, когда её
// удобно сюда положить. Графика — такая: без неё телефону, который не тянет,
// уровень не опустить (docs/graphics_world.md, 9.6; docs/city.md, «Город — единственный вид»). Интерфейс,
// карта и ролик — тоже: с 03.10.2026 у всех трёх по умолчанию новый вид (`ui/device.ts`), прежний — запасной
// (решение владельца, docs/ui_audit.md, 12.8), и другого пути к нему в Телеграме нет: адрес игры там не поправишь.
// Цена кадра новых карты и ролика на настоящем телефоне не измерена (docs/map_tw.md, docs/battle_tw.md): телефону,
// который их не потянет, вернуться к прежнему нужно тем же пальцем, каким опускают графику.
//
// Вести в Telegram — тоже такая (05.10.2026, docs/NOTIFY.md, раздел 12): кнопка под сообщением бота выключает их, а
// включить снова, когда сообщения уже не приходят, можно только отсюда; и здесь же — жест, в котором Telegram
// спрашивает разрешения писать. Вне Telegram строки нет: писать некому.
//
// «Сообщить об ошибке» — такая же (решение владельца 06.10.2026, docs/admin.md): без неё игрок теста не может сказать о
// поломке из игры. Окно одно на все входы (`BugReport`): здесь, в шапке меню державы и на плашке заморозки.
//
// Подсказки — такая же (решение владельца 06.10.2026, docs/rating.md): игроку, которому они мешают, выключить их больше
// негде.
//
// Чего здесь нет и быть не может: ничего про алмазы. Премиальная валюта живёт в
// ратуше, где ею платят, и настройкой не является ни в каком виде.
import { useSyncExternalStore } from 'react';
import { setSoundLevel, setSoundOn, soundLevel, soundOn, subscribeSound, type SoundKind } from '@/sound/settings';
import { GFX_QUALITIES, gfx, levelNow, setGfx, subscribeGfx } from '@/render/gfx';
import { battleMusicDoor } from '@/sound/door';
import { cityAudio } from '@/sound/city';
import { Icon } from '@/ui/icons/Icon';
import { NOTIFY_ON, notifyState, setNotifyOn, subscribeNotify } from '@/net/notify';
import { inTelegram } from '@/telegram/webapp';
import { useBugReport } from './bugOpen';
import { useGame } from '@/game/store';
import { hintsOff, setHintsOff } from '@/game/sim/hints';

/**
 * Переключатель звука — **единственный рычаг на весь звук игры**: город, карта, музыка эпохи, бой, промыслы, вой.
 * Выключен — «Без звука»: не звучит и не открывается ничего. Раньше он стоял в ролике о бое, рядом с «Пропустить», и
 * был там единственным местом, откуда музыку вообще включали.
 *
 * Под ним, пока звук включён, — две громкости: музыки и звуков (docs/audio.md, решение 3). Это не второй рычаг, а
 * доля: выключить ими звук нельзя, только сделать тише, — ноль громкости и «Без звука» различаются тем, что первый
 * держит контекст открытым.
 *
 * Состояние берётся у самой настройки через подписку, а не заводится здесь
 * своим `useState`: показов теперь два, и «одно состояние» должно держаться
 * устройством, а не тем, что два показа не встречаются на экране.
 *
 * Нажатие — это и есть тот жест, которым открывается звуковой контекст: в вебвью
 * Telegram он сам не откроется, а `cityAudio.toggle(true)` открывает его
 * прямо здесь, в обработчике. Через `await` его проносить нельзя — активация
 * теряется, — поэтому в этом обработчике нет ни одного.
 *
 * Боевую музыку включение **не заводит**: у неё свой жест — «Смотреть бой», — и
 * начинать качать `battle.mp3` из настроек значило бы платить мегабайтом за
 * нажатие, которое о бое не просило. А вот выключение гасит всё: игрок выключает
 * звук, а не дорожку.
 */
const musicLevel = (): number => soundLevel('music');
const fxLevel = (): number => soundLevel('fx');
const ambLevel = (): number => soundLevel('amb');

export function Settings() {
  const on = useSyncExternalStore(subscribeSound, soundOn, soundOn);
  const chosen = useSyncExternalStore(subscribeGfx, gfx, gfx);

  const flip = (): void => {
    const next = !on;
    setSoundOn(next);
    cityAudio.toggle(next);
    if (!next) battleMusicDoor.off();
  };
  // Громкости — тоже подпиской: снимок `soundOn` от них не меняется, и без своих снимков полоса не двигалась бы.
  const levels: Record<SoundKind, number> = {
    music: useSyncExternalStore(subscribeSound, musicLevel, musicLevel),
    fx: useSyncExternalStore(subscribeSound, fxLevel, fxLevel),
    amb: useSyncExternalStore(subscribeSound, ambLevel, ambLevel),
  };
  const level = (kind: SoundKind): number => Math.round(levels[kind] * 100);

  // Рычаг уведомлений — один на игрока и лежит на сервере (`prefs.on`): его же переключает кнопка под сообщением бота.
  const news = useSyncExternalStore(subscribeNotify, notifyState, notifyState);
  const newsOn = news?.on ?? true;
  // Telegram отказал боту писать: нажатие не выключает, а просит разрешения снова.
  const shut = newsOn && news?.chan === 'closed';
  const report = useBugReport((b) => b.show);
  // Подсказки новичку — поле партии (`sim/hints`), как и то, какие уже показаны (docs/rating.md).
  const hintsOn = useGame((g) => !hintsOff(g.s));
  const flipHints = (): void => useGame.getState().world((s) => setHintsOff(s, hintsOn));

  return (
    <>
      <h3>Настройки</h3>
      {/* Строки лежат столбиком с зазором. Пока строка была одна, зазора не
          требовалось, и без обёртки вторая села бы на первую вплотную —
          в обоих местах показа сразу. */}
      <div className="set-list">
        <button className={`set-row${on ? ' on' : ''}`} onClick={flip} aria-pressed={on}>
          <span className="ico">
            {/* Значка `ui-music` в наборе пока нет, и в накладную он не вписан
                нарочно: накладная — это заказ художнику, и вписанное в неё без
                файла роняет сборку. Пока стоит эмодзи, а появится рисунок —
                появится сам, без правки этой строки. */}
            <Icon name="ui-music" glyph="🎵" />
          </span>
          <span className="name">
            Звук
            <em className="sub">{on ? 'Город, музыка эпохи, бой' : 'Без звука'}</em>
          </span>
          <span className="sw">
            <i />
          </span>
        </button>

        {/* Громкость — пока звук включён: у выключенного громкости нет. Подписка та же (`subscribeSound`). */}
        {on && (
          <div className="set-row vol">
            <span className="ico">
              <Icon name="ui-volume" glyph="🔊" />
            </span>
            <span className="name">
              Громкость
              <em className="sub">Своя для музыки, эффектов и окружения</em>
            </span>
            <div className="set-vol">
              {(
                [
                  ['music', 'Музыка'],
                  ['fx', 'Эффекты'],
                  ['amb', 'Окружение'],
                ] as const
              ).map(([kind, label]) => (
                <label key={kind}>
                  <span>{label}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={level(kind)}
                    aria-label={`Громкость: ${label.toLowerCase()}`}
                    onChange={(e) => setSoundLevel(kind, Number(e.target.value) / 100)}
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        {/*
          Графика — рычаг уровня, единственный (`render/gfx.ts`, тест «рычаг один»). Вид у игры
          один — город (слово владельца 02.10.2026); прежний «Простой вид» убран вместе с посёлком,
          его место для слабых устройств — «Низкая». Четыре кнопки, а не выпадающий список: выбор
          виден целиком. Сцена слушает запись сама и пересобирается на новой канве (`GameCanvas`):
          сменить уровень на живой сцене нельзя.
        */}
        <div className="set-row pick">
          <span className="ico">
            <Icon name="ui-gfx" glyph="🎨" />
          </span>
          <span className="name">
            Графика
            {/* У «Авто» — на чём игра стоит сейчас (`gfx.levelNow`): по устройству или опущенная сторожем. Без этой
                строки на телефоне не проверить, что слабый телефон получил «Низкую» (docs/perf.md). */}
            <em className="sub">
              {chosen.quality === 'auto' ? `Авто: сейчас ${(GFX_QUALITIES.find(([q]) => q === levelNow(location.search))?.[1] ?? '').toLowerCase()}` : 'Авто подстроится под телефон'}
            </em>
          </span>
          <div className="set-seg" role="group" aria-label="Уровень графики">
            {GFX_QUALITIES.map(([q, label]) => (
              <button key={q} className={chosen.quality === q ? 'on' : ''} aria-pressed={chosen.quality === q} onClick={() => setGfx({ quality: q })}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <button className={`set-row${hintsOn ? ' on' : ''}`} onClick={flipHints} aria-pressed={hintsOn}>
          <span className="ico">
            <Icon name="ui-info" glyph="💡" />
          </span>
          <span className="name">
            Подсказки
            <em className="sub">Коротко о главном, по ходу игры</em>
          </span>
          <span className="sw">
            <i />
          </span>
        </button>

        {NOTIFY_ON && inTelegram() && (
          <button className={`set-row${newsOn ? ' on' : ''}`} onClick={() => setNotifyOn(shut ? true : !newsOn)} aria-pressed={newsOn}>
            <span className="ico">
              <Icon name="ui-news" glyph="🔔" />
            </span>
            <span className="name">
              Вести в Telegram
              <em className="sub">{shut ? 'Нажми, чтобы разрешить боту' : 'О набеге и о бое'}</em>
            </span>
            <span className="sw">
              <i />
            </span>
          </button>
        )}

        {inTelegram() && (
          <button className="set-row" onClick={report}>
            <span className="ico">
              <Icon name="ui-bug" glyph="🐞" />
            </span>
            <span className="name">
              Сообщить об ошибке
              <em className="sub">Письмо мастерам игры</em>
            </span>
          </button>
        )}

        {/*
          Язык. Это **не** настройка, а сообщение, и потому не кнопка: нажимать
          нечего, выбирать не из чего. Выключенный выпадающий список или второй
          язык серым — это обещание, которого мы не держим; игрок такое обещание
          читает как «скоро будет», а «скоро» здесь никем не назначено.

          Флаг нарисован полосками, а не поставлен эмодзи (🇷🇺). Причина та же,
          по которой в проекте вообще проверяют, рисуется ли символ: флаги — это
          пара региональных индикаторов, и Windows их не рисует вовсе, подставляя
          буквы «RU». Три полоски рисуются одинаково везде.
        */}
        <div className="set-row static">
          <span className="ico">
            <span className="flag flag-ru" role="img" aria-label="Флаг России" />
          </span>
          <span className="name">
            Язык
            <em className="sub">Русский</em>
          </span>
        </div>
      </div>
    </>
  );
}
