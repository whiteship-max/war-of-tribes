# Опись зоны: правила касания, телефона и замки интерфейса

Рабочая копия `C:/Users/white/Desktop/war-of-tribes-ui` (только чтение). Здесь нет разбора экранов. Описаны правила и замки, которые переделка интерфейса обязана соблюсти или снять решением владельца. Пути даны от корня копии.

> Поправка к заданию: в коде пороги **32 px и 700 мс**, а не 33 и 780: `TAP_SLIP = 32` (`src/gestures.ts:64`), `TAP_MS = 700` (`src/gestures.ts:81`).

---

## Палец: один судья и его числа — `src/gestures.ts:36-304`, `docs/handbook/gestures.md:8-123`

- **Зона.** `src/gestures.ts` входит в **ядро** (`CLAUDE.md:434`: «Один палец — один судья»). Правка допускается только одной сессией за раз.
- **Кто судит.** Класс `Gesture` (`gestures.ts:245`) и `Press` (`:172`). Их делят деревня (`render/Scene.ts:282` `new Gesture()`) и карта (`ui/map/WorldMap.tsx:213`). Предыстория берёт `Press` и `TAP_MOVE` (`prologue/controls.ts:49`). **DOM-кнопки этот класс не судит вовсе:** для них тап — это нативный `click` браузера.
- **Числа** (все в `gestures.ts`):
  - `TAP_MOVE = 10` (`:44`): с этого порога камера идёт за пальцем;
  - `TAP_SLIP = 32` (`:64`): за этим порогом тапа нет. Порог обязан быть меньше `TAP_TARGET`;
  - `TAP_MS = 700` (`:81`): дольше тап не длится. Порог обязан быть больше системных 500 мс;
  - `TAP_TARGET = 44` (`:89`): та же величина, что `--tap`;
  - `TAP_FORGIVE = 26` (`:96`): прощение промаха;
  - `WHEEL_STEP = 1.12` (`:110`);
  - `GHOST_CLICK_MS = 400` (`:120`).
- **Как отличается тап от удержания.** Решает `Press.isTap(now)` (`:222-225`): тап — это сход не дальше `TAP_SLIP` и длительность не больше `TAP_MS`. Сход меряется по пути, точка отпускания не учитывается (`:163-171`). Второй палец отменяет тап у обоих пальцев (`:239-243`, `:281-284`). Прицел берётся при `pointerdown` (`Scene.ts:1038-1044`), панель открывается при `pointerup` (`Scene.ts:1071-1097`).
- **Долгого нажатия нет.** Палец, пролежавший дольше 700 мс, только пишется в журнал меткой `'долгое'` (`Scene.ts:1081-1089`, `gestlog.ts:47`). Никакого действия за этим нет.
- **Призрачный щелчок.** После тапа по холсту `swallowGhostClick()` (`gestures.ts:145-161`) на погружении глотает **первый** `click` на всём `window` в течение 400 мс. Вызывается в `Scene.ts:1095` и в карте.
- **Запреты из справочника.** Нельзя вернуть выдержку `TAP_SETTLE` (`gestures.md:49-59`). Нельзя сравнивать точку нажатия с точкой отпускания (`:38-42`). Нельзя вернуть поворот камеры (`:79-92`). Нельзя заводить второй разбор жеста (`:14-19`). Порог 700 мс не трогать (`:167-172`).
- **Журнал касаний** — `src/gestlog.ts`. На телефоне его видно по пути «Задания» → «Служебное» → «Что было под пальцем» (`ui/parts/TouchDoctor.tsx:41`, кнопка «Скопировать» `:78`). Пороги он печатает из констант (`TouchDoctor.tsx:58`).
- **Тексты.**
  - `gestures.ts:77-79`: «Отдельного жеста «долгое нажатие» в игре нет, и заводить его нельзя — иначе это число придётся делить с ним, и тап снова начнёт теряться».
  - `gestures.md:63-65` повторяет то же правило.
- **Проблемы.**
  - **П1, скрытое действие.** Цель переделки «подробности в подсказке по долгому нажатию» прямо противоречит правилу `gestures.ts:76-79` и `gestures.md:63-65`. Правило к тому же лежит в ядре. По правилу 19 это повод остановиться и спросить владельца (подробно — следующий раздел).

## Можно ли долгое нажатие на DOM-элементах — разбор вопроса

Это вывод из кода и правил; на устройстве ничего не проверялось.

- **Буква правила запрещает такой жест во всей игре.** «В игре нет и заводить нельзя» (`gestures.md:64`). Довод правила — общий предел `TAP_MS` с холстом. Для DOM этот довод слабее: кнопку судит `click`, а у `click` предела длительности нет (`gestures.ts:72-73`). Но остаётся второе правило: «второго судьи пальца быть не должно» (`CLAUDE.md:434`, `gestures.md:14-19`). Таймер удержания на DOM — это и есть второй судья.
- **Технические препятствия.**
  1. После удержания кнопки браузер всё равно пришлёт `click`. Значит, удержание одновременно нажмёт кнопку, если `click` не гасить. Нужен сторож вроде `swallowGhostClick`.
  2. На iOS после 500 мс появится системное меню. В CSS нет `-webkit-touch-callout: none` (grep по `src` пуст). Есть только `user-select: none` на `body` (`styles.css:68-72`).
  3. На Android долгое касание порождает `contextmenu`.
  4. На ПК и в Telegram Desktop долгого нажатия нет. Нужна вторая дверь к той же подсказке.
- **Узаконенная замена уже есть.** «Справочные экраны строки состояния»: тап по ячейке открывает экран с разбором числа (`docs/handbook/ui.md:99-114`). Там же записано: «Полос ресурсов и всплывающих подсказок в игре нет» (`ui.md:101`).
- **Если владелец разрешит:** заводить жест только в `src/gestures.ts` (ядро) — своим числом рядом с `TAP_MS`, тем же `Press` и с тестом в `gestures.test.ts`. Внутри панелей отдельных таймеров быть не должно.

## Стенд следа пальца — `scripts/tap-report.ts:1-795`

- **Что меряет.** Поднимает настоящую игру через `createServer` vite с подделанным WebGL (`:86-160`) в Chrome на 375×812 при DPR 2 (`:62-67`). Касания идут через `Input.dispatchTouchEvent` (`:465-469`). Печатает:
  - таблицу силуэтов и областей попадания (`:726-737`);
  - матрицу «сход × когда» для 9, 11, 21, 31 и 33 px в моменты «сразу», «середина», «сход» (`:555-562`, `:739-747`);
  - сдвиг деревни под пальцем (`:749-755`);
  - длительности 200, 420, 620 и 780 мс (`:567`; отсюда и «780 мс» в задании: `TAP_MS + 80`);
  - ведение на 90 px, щипок, тап в чистое поле, тап по кладке стены (`:761-773`);
  - раздел «МЫШЬ (ПК)» (`:621-693`, `:775-791`).
- **На что опирается (переделка не должна это сломать).**
  - **DOM:** `.start-go` и `.start` (`:430-440`). Без кнопки входа стенд падает с ошибкой «стенд надо чинить». Те же `.start-go` использует `scripts/lib/pinned.ts:82` (map, siege и другие стенды на закреплённом мире). `.canvas-wrap` использует `scripts/revive-report.ts:133`.
  - **Свободна ли точка:** `document.elementFromPoint(x, y) === canvas` (`:273`). Точка — центр области каждой постройки в домашнем кадре камеры. Любой DOM поверх холста (кроме элементов с `pointer-events: none`) превращает след в «под разметкой» (`:717-720`). Отчёт печатает это строкой, и приёмка видит сдвиг вывода.
  - **Сколько ждёт:** освобождения точки ждёт не дольше `CLEAR_WAIT_MS = 800` (`:70`). Шторка уезжает за 0.26 с (`styles.css:327-329`; в `Sheet.tsx:9` стоит `ANIM = 260` с пометкой «должна совпадать с transition»). Анимация закрытия длиннее 800 мс начнёт портить таблицы.
  - **Стор через `?probe=1`** (`scripts/lib/chrome.ts:23`): `window.__game`, `window.__scene`, `getState().sheet.kind === 'building'` (`:308-311`), `openBuilding(null)`, `s.inbox`, `s.winterWarning`, `s.nextEventAt`, `s.tutorialDone` (`:226-264`). Другие отчёты зовут `skipTutorial()` и `openMap()` (`pinned.ts:85-86`, `scene-report.ts:93`, `map-report.ts:422`).
  - **Сцена:** `hitBoxOf`, `screenSpot`, `place`, `buildings`, `groundAt`, `zoom` (`:193-195`, `:299-339`).
- **Замыкание.** Отчёт поднимает vite-сервер, а такой отчёт зависит от `index.html` и всего, что из него достижимо (`scripts/lib/deps.ts:20-23`). Поэтому **любая правка `src/ui/*` выбирает tap и остальные браузерные отчёты** (scene, revive, map).
- **Предыстория.** У стенда предыстории свои селекторы `.pro-*` и `.start-alt` (`scripts/prologue-stand.ts:392-2441`). В приёмку он не входит, без слова владельца не запускается.
- **Проблемы.**
  - **П1, место.** Новая плавающая кнопка, нижний ряд или более высокая шапка накроют центры построек в домашнем кадре. Тогда стенд получит «под разметкой» (`:717-720`), а игрок — неоткрывающееся здание под кнопкой. Канва занимает весь экран (`styles.css:85-95`), поэтому каждый новый непрозрачный для касаний кусок съедает часть деревни.

## Телефон: вьюпорт, вырезы, шапка Telegram — `src/telegram/webapp.ts:123-281`, `src/ui/styles.css:18-51`

- **Когда выставляется.** `initTelegram()` из `src/main.tsx:24` при обычном входе (не на стендах `?replay` и `?showcase`).
- **Что выставляется** (`webapp.ts:132-150`):
  - `--app-h = min(viewportStableHeight, innerHeight)`;
  - `--tg-top`, `--tg-bottom`, `--tg-left`, `--tg-right` — сумма `safeAreaInset` и `contentSafeAreaInset` (Bot API 8.0). Когда клиент не отдаёт ни того ни другого, они не ставятся.
- **Когда пересчитывается:** события `resize`, `orientationchange` (`:232-233`), `viewportChanged`, `safeAreaChanged`, `contentSafeAreaChanged`, `fullscreenChanged`, `activated`, `themeChanged` (`:255-280`), а также при возврате из фона (`ui/GameCanvas.tsx:207-225`).
- **CSS-переменные:**
  - `--safe-* = max(env(safe-area-inset-*), var(--tg-*))` (`styles.css:19-22`): `env()` — запасной путь вне Telegram;
  - `--app-h` по умолчанию `100vh`, при поддержке `100dvh` (`:25`, `:47-51`);
  - `--nav-h: 56px` (`:26`), `--tap: 44px` (`:28`), `--res-h: 28px`, `--res-row` (`:39-40`).
- **Шапка Telegram.** Игра не зовёт `requestFullscreen` (в `webapp.ts:95` метод есть только в типе). Значит, в обычном режиме шапка клиента лежит вне вебвью, а в полноэкранном её закрывает `contentSafeAreaInset`, который входит в `--safe-top`. Отступ сверху: `.topbar` `padding-top: calc(var(--safe-top) + 6px)` (`:110`).
- **Нижняя системная полоса** (`--safe-bottom`):
  - `.bottomnav` `padding-bottom` (`:255`);
  - `.sheet-body` `padding-bottom: nav-h + safe-bottom + 10px` (`:383`);
  - `.toast` (`:820`), `.siege` (`:3844`), `.wm-foot`/`.wm-bottom` на карте (`:2060`, `:2081`).
- **Касания:**
  - `disableVerticalSwipes()` (`webapp.ts:241`): без него свайп по сцене сворачивает аппку;
  - `body { touch-action: none; user-select: none }` (`styles.css:68-72`);
  - `.sheet-body` `touch-action: pan-y` (`:379`);
  - `viewport-fit=cover, user-scalable=no` (`index.html:5`).
- **Правило проекта.** Размеры только из `--app-h`, `--safe-*`, `--nav-h`, `--tap`; не `100vh` и не голый `env()` (`CLAUDE.md:554`).
- **Замок.** `src/ui/start.test.ts:136-143`: стартовый экран не зовёт `disableVerticalSwipes`, `expand(`, `setHeaderColor`, `requestFullscreen`. Настройки клиента ставит только `webapp.ts`.
- **Проблемы.**
  - **П3, непоследовательность.** `.trouble` берёт `var(--tg-top, 0px) + 96px` напрямую (`styles.css:4070`), а не `--safe-top`. Вне Telegram вырез устройства не учитывается.
  - **П3, другое.** Комментарий обещает высоту «без учёта клавиатуры» (`webapp.ts:128`), но `min(stable, innerHeight)` (`:136-140`) возьмёт `innerHeight`, если окно сжалось под клавиатуру. Поля ввода (имя города, `.wm-jump`) могут сжать всё приложение. На устройстве не проверено.

## Слои и раскладка шапки — `src/ui/styles.css`, `docs/handbook/ui.md:8-66`

- **Карта слоёв (z-index):**

  | Слой | z-index | Где |
  | --- | --- | --- |
  | `.start` | 70 | `:4190` |
  | `.replay` | 40 | `:3537` |
  | `.toast` | 30 | `:831` |
  | `.tut-bar` | 24 | `:1510` |
  | `.tut-hole` | 23 | `:1473` |
  | `.tut-catch` | 22 | `:1463` |
  | `.res-bar` | 21 | `:195` |
  | `.modal-backdrop` | 20 | `:728` |
  | `.realm` | 19 | `:3124` |
  | `.alerts` | 15 | `:1135` |
  | `.am-wrap` | 14 | `:3609` |
  | `.bottomnav`, `.cheat` | 12 | `:251`, `:4339` |
  | `.sheet` | 10 | `:318` |
  | `.sheet-backdrop`, `.siege` | 9 | `:305`, `:3845` |
  | `.worldmap` | 8 | `:1847` |
  | `.hud-bar`, `.top-row` | 6 | `:120`, `:1100` |

- **Обязательные свойства** (`ui.md:44-66`, комментарии `styles.css:99-104`, `:172-192`):
  - полоску ресурсов не закрывает ни одно окно (21 выше 20), и она ничего не нажимает (`pointer-events: none`, `:206`);
  - у `.topbar` нет своего z-index, иначе полоску и строки шапки было бы не развести по слоям;
  - слой обучения лежит выше меню державы (`ui.md:138-139`);
  - модалки делят один слой, новая не ложится на другую (guard в `WinterModal`, `CLAUDE.md`, «Правила»).
- **Правила раскладки, которые меняются только словом владельца:**
  - нижняя навигация — ровно «Племя», «Ратуша», «Задания». Раздела «Здания» нет и заводить его нельзя (`ui.md:38-43`);
  - верхняя строка: день, сезон, население, мораль, порядок, дружина. Каждая ячейка, кроме дня, — кнопка справки (`ui.md:44-48`);
  - вторая строка — полоска ресурсов (`ui.md:49-62`);
  - третья строка — герб и карта, оба квадратом в `--tap`, карта — значком без слова (`ui.md:63-66`);
  - панель здания у всех одна по форме: шапка, рабочие, данные, действия (`ui.md:19-20`).
- **Высота шапки зашита числами** в пяти расчётах:
  - `.alerts`: `safe-top + res-row + 6px + tap + 44px` (`:1134`);
  - `.tut-bar.at-top` (`:1537`);
  - `.alerts.with-tut`: `safe-top + 6px + tap + 100px` (`:1563`);
  - `.alerts.on-map` (`:1585`);
  - `.wm-jump` (`:1950`).

  Комментарий в `:root` (`:29-38`) обещает держать эти числа «в одном месте», но переменной есть только у полоски ресурсов.
- **Цели касания.** Переменная `--tap` используется в 40 правилах (`min-height/height/width: var(--tap)`): `.btn` (`:502-503`), `.stepper button` (`:533-534`), `.sheet-grab` и `.sheet-close` (`:346`, `:365-366`), `.map-btn` (`:1119-1120`). Ячейки HUD `.hud-bar .cell.tap` имеют `padding: 3px 4px` без `min-height` (`:2427-2436`).
- **Проблемы.**
  - **П2, мелкая цель касания.** Правило `--tap` держится только соглашением. `gestures.test.ts:203-205` сверяет литерал `TAP_TARGET === 44`, а `styles.css` ни один тест не читает. Ячейки HUD уже меньше 44 px (`:2427-2436`), и тест этого не видит.
  - **П2, место.** Если переделка поменяет высоту шапки и не поправит все пять расчётов, тревоги и строка обучения лягут на кнопки. Тестов на это нет.
  - **П3, непоследовательность.** `ui.md:101` пишет «Полос ресурсов … в игре нет», а `ui.md:49` описывает полоску ресурсов. Фраза устарела, но часть про отсутствие всплывающих подсказок верна.
  - **П3, скрытое действие.** Подсказки `title=` стоят в 24 местах `.tsx`: ячейки `TopBar.tsx:93-145` («Нажми, чтобы увидеть…»), `Cost.tsx:56`, `ResourceBar.tsx:59` и другие. На телефоне их не видно. У полоски ресурсов `title` не покажется нигде: у неё `pointer-events: none` (`styles.css:206`).

## Значки — `src/ui/icons/Icon.tsx:1-50`, `docs/icons.md`, `docs/handbook/graphics.md:94-108`

- **Одна дверь.** `<Icon name glyph />`: есть нарисованный значок — показывается рисунок, нет — эмодзи (`Icon.tsx:27-49`). Размер `1em`, своего размера нет. `title` уходит в `aria-label` и `<title>`. Проверок «нарисован ли значок» по компонентам быть не должно (`icons.md:88-100`).
- **Где значок остаётся эмодзи.** В строках, склеенных через `.map(...).join(' ')`, компонент не вставить. Это осознанная граница (`icons.md:102-104`).
- **Накладная.** `ui/icons/registry.ts:60-122`. Группы выведены из данных игры. Словарь интерфейса объявлен руками:
  - `nav-people`, `nav-quests`;
  - `hud-pop`, `hud-army`, `hud-map`, `hud-order`;
  - `mood-*`, `day-*`, `alert-*`;
  - 25 имён `ui-*` (`:104-121`);
  - ссылки `ALIAS` (`:130-150`), например `nav-townhall` → `bld-town_hall`.
- **Сборка.** `npm run icons:build`: группа считается сданной с первого файла. Недостающее имя в начатой группе роняет сборку, если его нет в `assets-src/icons/RETURNED.md` (`icons.md:47-50`). Имя мимо накладной (сейчас `ui-music`) не проверяет ничто, и на его месте всегда эмодзи (`icons.md:52-54`). Потолок листа — 60 КБ gzip, всего двумерного слоя — 95 КБ (`icons.md:56-57`).
- **Эмодзи.** Только Emoji 12.0. Список `ui/icons/emoji12.ts` руками не правят, его собирает `npm run emoji:build`. Тест `emoji.test.ts:115-137` обходит весь `src` и запрещает склейки ZWJ.
- **Проблемы.**
  - **П1, другое.** Долг `DEBT` в `emoji.test.ts:70-80` сверяется **точно, с номерами строк**:
    - `ui/SyncModal.tsx:27`;
    - `ui/map/ActionMenu.tsx:450`;
    - `ui/panels/ReportPanel.tsx:341`;
    - `ui/parts/Tavern.tsx:22`, `:35`, `:58`;
    - `ui/parts/TroopCardView.tsx:155`.

    Любая правка выше этих строк сдвинет номер и уронит `npm test`. Комментарий к списку говорит: «Дописывать сюда нельзя»; замена символа ждёт решения владельца.
  - **П2, непоследовательность.** Новое имя значка (например, `nav-realm` или новое `ui-*`) в уже начатой группе роняет сверку (`icons.test.ts:104-109`, `:129-134`), пока нет файла или строки в `RETURNED.md`. Имя мимо накладной останется эмодзи навсегда.

## Проводка обучения — `src/game/data/tutorial.ts:80-162`, `src/ui/TutorialOverlay.tsx`

- **Цели шагов.** Подсветка ищет элементы через `document.querySelector` (`TutorialOverlay.tsx:33-39`). Шаги используют ровно 8 меток:

  | Метка | Где стоит |
  | --- | --- |
  | `slot-add` | `parts/Steps.tsx:37`, ставит `BuildingPanel.tsx:259` |
  | `coat` | `realm/Coat.tsx:58` |
  | `forge-spear` | `parts/Smithy.tsx:134` |
  | `nav-townhall` | `BottomNav.tsx:50` |
  | `list-barracks` | `parts/TownBuild.tsx:225`, `:276` |
  | `recruit-spearman` | `parts/Recruit.tsx:129` |
  | `nav-map` | `TopBar.tsx:167` |
  | `scout` | `panels/WorldPanel.tsx:658`, `:759` |

  Здание подсвечивается проекцией `screenSpot` (`TutorialOverlay.tsx:41-47`).
- **Метки без шагов.** Метки `town-build`, `rush-*`, `upgrade-*`, `tech-*`, `survey-start`, `siege-barracks` стоят в разметке, но ни один шаг, тест или скрипт их не читает (grep по `src`, `scripts`, `docs`).
- **Поведение слоя:**
  - цель ниже сгиба докручивается только внутри `.sheet-body` (`TutorialOverlay.tsx:24-31`);
  - строка подсказки уходит вниз, если цель выше 45 % высоты (`:113`);
  - затемнение — это `box-shadow` «дырки» с `pointer-events: none`; слой ничего не перехватывает (`ui.md:149-150`).
- **Тексты шагов** — до ~60 знаков (`tutorial.ts:34`), например `:105`: «Копьё не изучено: герб → «Технологии» → военная ветвь.»
- **Проблемы.**
  - **П2, другое.** Если при переделке пропадёт одна из восьми меток, переедет из `.sheet-body` в другой прокручиваемый контейнер или окажется под слоем выше 24, обучение молча перестанет вести. Тестов на это нет; проверить можно только руками («Задания» → «Служебное» → «Пройти обучение заново», `QuestsPanel.tsx:121`).

## Ручная проверка на телефоне — `docs/PHONE_CHECK.md`

- **Порядок менять нельзя.** Проверка останавливается на первом сломанном пункте (`:7-10`). Проверять из Телеграма; перед началом сверить имена чанков сборки (`:16-19`). Разделы:
  1. Вход (`:25-36`);
  2. Деревня: тапы на ходу и ряды шага −10 −1 [n] +1 +10 «с первого раза», п. 2.10 (`:38-54`);
  3. Сворачивание: «Восстановить» и журнал «Задания» → «Служебное» → «Что было со сценой» (`:56-81`);
  4. Значки: пустые квадраты по всем панелям (`:83-101`);
  5. Карта: «Домой» внизу, «На карте» у агента, «Смотреть бой», строка «Ролика нет…» (`:103-120`);
  6. Осада (`:122-139`);
  7. Звук: «Профиль → Настройки → «Музыка»» (`:141-156`).
- **На эти подписи и пути опирается не только документ, но и игра:**
  - `ui/SceneTrouble.tsx:27` («Восстановить»), `:30` (путь к журналу текстом);
  - `ui/map/WorldMap.tsx:887` («Домой»);
  - `ui/panels/ReportPanel.tsx:195` («Ролика нет…»);
  - `ui/panels/QuestsPanel.tsx:110` («Служебное»);
  - `TouchDoctor.tsx:41`, `SceneDoctor.tsx:40`;
  - справочник: `docs/handbook/gestures.md:116-117`, `:188-189`.
- **Проблемы.**
  - **П2, непоследовательность.** Если переделка переложит «Служебное», «Восстановить», «Домой» или журналы, нужно тем же коммитом править `PHONE_CHECK.md`, текст `SceneTrouble.tsx:30` и `gestures.md`. Иначе проверка на устройстве поведёт в пустое место.
  - **П3, непоследовательность.** Пункт 6.2 «не наехала на письма» (`PHONE_CHECK.md:129`) устарел: столбика писем в деревне больше нет (`docs/handbook/structure.md:175-177`).
  - **П2, скрытое действие.** На карте `onContextMenu` открывает меню приказов (`WorldMap.tsx:651-665`), и фильтра по `pointerType` там нет. На Android долгое касание порождает `contextmenu`, так что на карте де-факто может жить скрытое долгое нажатие. На устройстве не проверено.
  - **П2, скрытое действие.** `swallowGhostClick` глотает первый `click` в течение 400 мс после тапа по холсту (`gestures.ts:145-161`). Кнопка новой панели, которая встанет прямо под пальцем, на этом касании не сработает. Так задумано, и переделке это нужно учитывать.
  - **П3, другое.** В CSS нет `-webkit-touch-callout: none`: на iOS удержание на картинке или ссылке вызывает системное меню. На устройстве не проверено.

## Тесты, которые держат интерфейс чтением исходников или DOM

Почти все эти тесты читают исходник **без комментариев** и ищут в нём буквальные строки или имена функций. Переписывание текстов и разметки их уронит. Тест правится тем же коммитом и по-прежнему должен держать своё правило (правило 11: проверка мутацией).

- **Стартовый экран и общие:**

  | Тест | Что держит |
  | --- | --- |
  | `ui/start.test.ts:22-47` | Кнопка одна: слова только из `START_LABEL` («Продолжить» / «Начать игру»), в разметке `START_LABEL[action]`; нет «Регистрация», «Вход», «Войти», «Зарегистрироваться» |
  | `ui/start.test.ts:50-81` | `{PROLOGUE_LABEL}` и `{PROLOGUE_NOTE}` из `start.ts`, `PROLOGUE_NOTE` содержит «не связана»; нет `import(`, `lazy(`, `prologue/` |
  | `ui/start.test.ts:84-115` | `StartScreen` и `ProfilePanel` показывают один `<Settings />`; в `Settings` есть `useSyncExternalStore(subscribeSound` и `<div className="set-row static">`; нет `<select`, `disabled`, `English`, `Скоро` |
  | `ui/start.test.ts:117-150` | В `StartScreen` нет `await`, `fetch(`, `requestAnimationFrame`, `setTimeout`, `setInterval`, `afterPaint`, `useSync`, `apiGet`, `serverNow`, `/api/`, `requestFullscreen`, «алмаз», «Купить», `Stars`; есть `g.fresh` |
  | `ui/transition.test.ts:45-86` | В `App` стоит `<GameCanvas />` без `mapOpen &&`; в `GameCanvas`: `if (g.mapOpen) scene.pause();`, `useLayoutEffect(() => {` и никакого `useEffect(`; в `BattleReplay` одалживается контекст сцены |
  | `boot/boot.test.ts:151-310` | Экран загрузки в `index.html`: один файл арта, порог показа, тема клиента, кнопка при поломке, стадии |
  | `ui/cityname.test.ts:121-148` | Всякое чтение `.city` идёт через `cityName`/`cityOr` (весь `src` и `netlify`) |
  | `ui/cityname.test.ts:151-191` | `{card.name}`, `{camp.targetName}`, `{report.target.name}`, `{profileCity(…)}` в `.tsx` — только в элементе с классом `one-line` на той же или предыдущей строке; правило `.one-line` в CSS; у `.toast` `overflow-wrap: anywhere` |
  | `ui/cityname.test.ts:194-209` | `starvesAt` превращается в слова только через `hungerLeft` (не меньше 4 мест) |

- **Значки, время, случайность, кадр:**

  | Тест | Что держит |
  | --- | --- |
  | `ui/icons/emoji.test.ts:115-137` | Emoji 12.0 по всему `src`, долг `DEBT` точно и с номерами строк, никаких ZWJ |
  | `ui/icons/icons.test.ts:98-196` | Накладная совпадает с папкой; где значка нет — эмодзи |
  | `game/pace.test.ts:346-356` | Единицу времени после `}` (`с`, `мин`, `ч`, `м`) в `src/ui` печатает только `ui/parts/wait.ts` |
  | `game/pace.test.ts:361-368` | Голого «дн.» нет нигде; есть только «игр. дн.» из `game/span.ts` |
  | `game/pace.test.ts:378-383` | `formatLeft` в интерфейсе берёт только `wait.ts` |
  | `net/clock.test.ts:74-94` | Нет `Date.now()` и `new Date()` в `ui` (а также в `game`, `world`, `profile`, `battle`, `prologue`) |
  | `net/clock.test.ts:116-140` | `serverNow` в `ui` читает только `parts/daily/DailyPage.tsx`, ровно 2 раза |
  | `game/sim/random.test.ts:62-80` | `Math.random` в `ui` запрещён |
  | `render/loop.test.ts:435-458` | Нет `requestAnimationFrame`, `cancelAnimationFrame`, `setAnimationLoop` и `devicePixelRatio` вне `render/loop.ts`. Анимация в интерфейсе — только CSS или `FrameLoop`/`nextFrame` |

- **Жесты, скорость, деньги, сервер:**

  | Тест | Что держит |
  | --- | --- |
  | `gestures.test.ts:202-216` | `TAP_TARGET = 44` (литерал, `styles.css` тест не читает), `TAP_SLIP < TAP_TARGET`, `TAP_MS > 500` |
  | `gestures.test.ts:310-366` | В `WorldMap.tsx` есть `swallowGhostClick()`, `WHEEL_STEP`, `deltaY < 0`; нет `1.12` и `deltaMode` |
  | `game/speed.test.ts:195-205` | `hurry(` зовёт только `SpeedButton.tsx`; `<SpeedButton` стоит только в `TopBar.tsx` и `WorldMap.tsx`, и в той же строке `CHEATS_ON && <SpeedButton` |
  | `game/sim/gems.test.ts:259-306` | Интерфейс не пишет алмазы и не знает ключа сохранения |
  | `game/sim/gems.test.ts:412-415` | В `BuildingPanel` нет `crafterBuildRate`, зовётся `crafterBuildShare(` |
  | `game/data/events.test.ts:98-111` | Подпись варианта события не пишет цену словами: цену показывает `Cost` |
  | `net/sync.test.ts:328-342` | В `SyncModal` нет `Conflict` |
  | `profile/profile.test.ts:312-318` | В `AvatarPicker` нет идентификаторов аватаров, используется `AVATARS.map` |

- **Звук и бой:**

  | Тест | Что держит |
  | --- | --- |
  | `sound/music.test.ts:153-163` | Нет `AudioContext` и `new Audio(` в `BattleReplay` и `ReportPanel` |
  | `sound/music.test.ts:235-267` | `setSoundOn` во всех `ui/*.tsx` есть только в `Settings.tsx`; там же `villageMusic.toggle(next)` и `if (!next) battleMusic.toggle(false)` |
  | `sound/village.test.ts:167-173` | В `App.tsx` `addEventListener('pointerdown'` и `villageMusic.arm()` |
  | `sound/village.test.ts:328-332` | В `BattleReplay` `villageMusic.duck(true/false)` |
  | `battle/replay.test.ts:250-254` | В `BattleReplay` нет подписи `SKIP.label`, кнопки идут через `frame.controls.map` |
  | `ui/panels/reportbeasts.test.ts:11-24` | В `ReportPanel` литерал `'▶️ Смотреть бой'` только в ветке `{rec && !beasts && (`; ветка `{rec && beasts && (` с `<Journal rec={rec} />`; `const beasts = rec?.beasts !== undefined;` |
  | `game/battle/beasts.test.ts:131-139` | В `ReportPanel` журнал и итог через `beastWords(describeEvent(…))` и `beastSummary(summarize(…))`, каждое по одному разу |
  | `world/works.test.ts:392-395` | `SortiePanel` зовёт `sortieForecast(siege, kindsOf(picked), now)`, своей арифметики прохода нет |
  | `world/works.test.ts:937-944` | В `CampStrike` `disabled={busy \|\| !plan?.can}`; `ActionMenu` и `SiegePanel` используют `<CampStrike ` без `strikePlan(` |
  | `world/works.test.ts:1143-1150` | `SiegePanel`, `CampPanel`, `SiegeBanner` без арифметики прохода, голода, участи и чисел настроек |

- **Осада:**

  | Тест | Что держит |
  | --- | --- |
  | `world/siege.test.ts:703-704` | В `ActionMenu` есть `CAMP_LEAVE` |
  | `world/siege.test.ts:988-1015` | В `SiegeBanner`: `siege-fall`, «Объявлено», порядок `siege-clock` < `siege-fall` < `siege-open`. В `SiegePanel`: «Кончится хлеб», «тайник», порядок «Объявлено:» < «Своей еды хватит на» < «Что делать», `siege.fall`; нет «уйдёт 50» |
  | `world/lairgrowth.test.ts:319-330` | В `SiegePanel` `{garrisonMen === 0 && <HireClubmen />}`, «Наймите дубинщиков», `openBuilding(barracks.id)` |
  | `world/gatemorale.test.ts:21-31` | `MoralePanel` называет `GATE_MORALE_WON`/`LOST`, `BATTLE_MORALE` не использует |

- **Слова и общие части:**

  | Тест | Что держит |
  | --- | --- |
  | `game/sim/mutiny.test.ts:755-790` | Тон без похвалы, шуток, насилия, «штук» и «голов» в `OrderPanel`, `PeoplePanel` (от `function Bonded` до `export function PeoplePanel`), `Market` (`function BondedRow`…`function GoodRow`), `BuildingPanel` (`function WorkerSlots`…`function BuildingData`), `FatePick`, `SiegePanel`; на рынке `ORDER_TEXT.market.unit`, нет «за штуку». **Имена функций-границ переименовывать нельзя** |
  | `game/sim/survey.test.ts:124-127` | В `Watch.tsx` нет `.seconds` |
  | `ui/parts/raidWords.test.ts:43-105` | `openRaid(` зовут только `AlertBar` и `parts/Walls`; `useRaidWords()` есть в `AlertBar`, `Walls`, `realm/Mail`; у читателей нет своих слов «не успеет», «сбор ещё», «заперт»; в `Mail` есть `<span>Дружина</span>` и `buildingOfType(s, 'statue')`; строки «полный сбор не успеет» и «сбор ещё\u00a0…» |
  | `ui/parts/restWords.test.ts:12-47` | Точная форма `restLine`; `REST_WHY` содержит «уходит с поля»; `restLine(` в 7 файлах; `.share` и `.fullAt` вне `restWords.ts` не читают |
  | `ui/parts/campSide.test.ts:9-22` | Строки «рогатки дозрели», «40%, дозреют через …», «40%, не растут»; в `CampPanel`/`SiegePanel` своих слов нет |
  | `ui/parts/signed.test.ts:54-58` | В `TownHall` стоит `{signed(q.gold)}` без знака руками |
  | `ui/parts/social.test.ts:21-31` | `{!BOT_IS_PLACEHOLDER && <Invite />}`; в `Social.tsx` нет «алмаз» |
  | `ui/parts/masters.test.ts:18-26` | `Masters.tsx` зовёт `mastersInfo(` и `upkeepInfo(` без констант |
  | `ui/parts/Walls.test.ts:20-41` | `Walls` берёт `defense(s)`, `militiaMen(s)`, `militiaArchers(s)`, `useRaidWords()`; `Provisions` — `foodLeft(s)` и `winterForecast(s)` |
  | `ui/parts/GarrisonEditor.test.ts:52-65` | `.setGarrison` зовёт только `GarrisonEditor`; редактор показан в `WorldPanel` и `Statue`; есть `showToast(err ??` и `atGates(general)` |
  | `ui/parts/upgrade.test.ts:260-277` | В модуле кнопки улучшения нет чтения полей здания |
  | `ui/realm/dispatch.test.ts:58-61` | `leftWords`: «24 ч 00 мин» и «0:45» |
  | `world/traits.test.ts:55-62` | `traitLines.ts` зовёт `musterMs(` и не читает `HANDOVER_*` |

- **Карта:**

  | Тест | Что держит |
  | --- | --- |
  | `ui/map/legend.test.ts:22-40` | В `WorldMap` нет «Тракт», «Владения», «с казной»; точные `SHOWN_RELATIONS` и `SHOWN_FATES` |
  | `ui/map/map.test.ts:958-970` | `MarchesPanel` `{f.name}`, `WorldMap` `FIGURE_BY_ID[picked].name`, `ActionMenu` `def.name` |
  | `ui/map/map.test.ts:872-957` | Кадр карты (`frame.ts`, `figures.ts`, `agent.ts`): имён на полотне нет, `fillText` ровно один |
  | `ui/map/siegemark.test.ts:146-149` | Кадр пишет имя только через `fittedLabel(ctx, s.name)` |

- **Сами отчёты:** `scripts/lib/budget.test.ts:92-98` — страницы отчётов открываются только через `reportPage` с потолком кадров.

- **Проблемы.**
  - **П1, длина подписей.** Переписывание текстов уронит тесты, которые держат буквальные строки:
    - «▶️ Смотреть бой»;
    - «Объявлено» и «Объявлено:», «Своей еды хватит на», «Что делать», «Кончится хлеб», «тайник»;
    - «Наймите дубинщиков», «<span>Дружина</span>»;
    - «полный сбор не успеет», «сбор ещё»;
    - «рогатки дозрели», «дозреют через», «не растут»;
    - формат `restLine` и «уходит с поля»;
    - «Продолжить» и «Начать игру», «не связана»;
    - «за человека»;
    - «24 ч 00 мин».

    Порядок блоков в `SiegeBanner` и `SiegePanel` тоже закреплён. Тесты правятся тем же коммитом, и правило должно остаться под замком.

## Правило 18 и функции-словари: тексты с числом считает мир

Правило: строка, которая называет число, срок или исход, вычисляется теми же функциями, что симуляция и мир (`CLAUDE.md`, правило 18; «Сроки словами», `docs/handbook/time.md:83-102`).

- **Сроки.**
  - `ui/parts/wait.ts:1-106` — единственный модуль, который печатает секунды, минуты и часы:
    - `wait*` принимает `GameSec` (срок племени: стройка, ковка, найм, изучение);
    - `real*` принимает `RealSec` (мир: поход, набег, осада, почта);
    - `waitEta` (`:37-44`, «~2 м 10 с» — укороченная форма для 375 px);
    - `realLeft` («4:07»), `realDue` (срок донесения, `:95-103`), `waitDays` / `waitDaysBoth` / `gameDaysText`.
  - Перепутанные часы — ошибка компиляции (`wait.test.ts`, `@ts-expect-error`).
  - `game/span.ts:13-38` — общая формула для строк симуляции: `realSpan`, `gameSpan`, `daysSpan`, `gameDaysText` («3 игр. дн.»), `daysBoth`.
  - Обязаны идти через эти модули: **любой срок в интерфейсе**, в том числе «станет N дн.» и срок в цене (`Cost` → `waitShort`, `Cost.tsx:68-70`).
- **Набег.** `ui/parts/raidWords.ts:23-59`: `raidWords`/`useRaidWords` → `world/store.raidWindow`. Через них идут строка набега в тревогах (`AlertBar`), раздел «Оборона» (`Walls`) и донесение (`realm/Mail`).
- **Мораль армии между боями.** `ui/parts/restWords.ts:9-21`: `restLine`, `restPercent`, `REST_WHY`. Места показа: `AgentCard`, `ActionMenu`, `SiegePanel`, `SortiePanel`, `CampPanel`, `MarchesPanel`, `ArmyPanel`.
- **Голод.** `ui/parts/hunger.ts:12` `hungerLeft(starvesAt, now)`: `SiegePanel`, `CampPanel`, `SortiePanel`, `WorldPanel`, `SiegeBanner`.
- **Готовность рогаток.** `ui/parts/campSide.ts:13` `sideReady`: `CampPanel`, `SiegePanel`.
- **Еда на складе.** `ui/parts/foodLeft.ts:15` `foodLeft(s)` поверх `derived.netPerDay`: `Provisions.tsx`. Сверяется с шагом симуляции (`foodLeft.test.ts:65-93`).
- **Знак числа.** `ui/parts/signed.ts:7`: налог в ратуше (`TownHall`).
- **Склонение.** `ui/parts/plural.ts:13-25` `plural`/`count`: летопись, лабиринт, схема боя, `CampPanel`, `SiegePanel`, `AgentCard`, `AgentPlaces`, `Chronicle`, `FatePick`, `Lineage`, `TowerEngine`, `Ruler`, `traitLines`, `agentLines`, `upgrade`.
- **Карточка вида бойцов.** `game/battle/describe.ts` (`troopCard`, `statsOf`, `positionsOf`, `moraleOf`, `weightOfTroop`, `temperOf`, `fmt`; `:99-431`). Ни одного числа руками. Использует `TroopCardView`, `ArmyPanel`.
- **Агенты.** `ui/parts/agentLines.ts:38-117` (`pipLines`, `sightLine`, `stealthLine`, `deathLine` поверх `world/agents` и `world/peril`): `AgentCard`. Черты: `ui/parts/traitLines.ts:112-121` (сбор через `musterMs`): `AgentCard`, `Lineage`.
- **Что даст уровень.** `ui/parts/upgrade.ts:415-432`: `upgradeGains`, `gainText`, `NOTHING_GAINED` — замер на двух уровнях. Использует `BuildingPanel`, `TownBuild`.
- **Другие словари:**
  - почта: `ui/realm/dispatch.ts:138` `leftWords = realDue`;
  - невольники и порядок: `game/data/order.ts` `ORDER_TEXT` (тон проверяет `mutiny.test`);
  - содержание войска: `game/data/upkeep.ts`;
  - гибель агента: `world/peril.perilText`;
  - гейт технологий: `sim/tech` (`techBlock`, `placeBlock`, `gearBlock`, `troopBlock`) — одна строка и на ступени, и на погасшей кнопке (`tech.test.ts:113`, `:437`);
  - бой со зверями: `beastWords`/`beastSummary`;
  - имя города: `cityName`, `cityOr`, `profileCity`;
  - участь города: `world/data/fates.ts`.
- **Цена.** `ui/parts/Cost.tsx:45-75` — одна форма «значок, нужно, из скольких есть», красным при нехватке. Второй такой формы заводить нельзя (`ui.md:71-91`). Долг: `Smithy.tsx` и `Recruit.tsx` рисуют цену своей строкой (`ui.md:83-85`).
- **Справки.** Числа справочных экранов берутся из `derived.ts` (`popGrowth`, `moraleBreakdown`, `moraleOutputMult`). Копий формул в JSX быть не должно (`ui.md:116-123`).

## Структура интерфейса — `docs/handbook/structure.md:158-205`, `:292-311`, `:332-334`

- `src/ui/icons/` — значки, `src/ui/` — React.
- Состав `ui/`:
  - `StartScreen` (одна кнопка, `ui/start.ts`), `TopBar`, `SpeedButton` (только под `CHEATS_ON`);
  - `AlertBar` (`.alerts.on-map` на карте);
  - `realm/*` (Ruler, Tech, Mail, dispatch, unread);
  - `SiegeBanner` и окна осады;
  - `TutorialOverlay`, `LegacyModal`, `battle/BattleReplay`;
  - `BottomNav`, `Sheet` (шторка 62 % / 85 %), `panels/*`, `parts/*`.
- Карта — `ui/map/*` (`WorldMap`: полотно, жесты, шапка и нижний ряд). `src/gestures.ts` и `src/gestlog.ts` лежат вне `ui/` нарочно. `src/telegram/webapp.ts` — вьюпорт, вырезы, тема, вибрация.

---

## Сводка зоны

- **Пороги.** Тап судит один класс `Gesture` в ядре `src/gestures.ts`: 10 / 32 px, 700 мс, цель 44 px. Задание называет 33 px и 780 мс — это одна строка из таблицы стенда (`TAP_MS + 80`), а не правило.
- **Долгое нажатие.** Правило запрещает его в игре (`gestures.ts:76-79`, `gestures.md:63-65`), а второй судья пальца недопустим. Для «подсказки по долгому нажатию» нужно решение владельца. Готовая замена — тап по числу открывает справку (`ui.md:99-114`).
- **Стенд tap.** Требует, чтобы центры построек в домашнем кадре оставались свободными от DOM, чтобы на стартовом экране были `.start-go` и `.start`, а API стора (`sheet.kind`, `openBuilding`, `skipTutorial`, `openMap`) остался прежним. Любая правка `src/ui` выбирает в приёмку все браузерные отчёты.
- **Безопасные зоны.** Шапка Telegram и нижняя полоса учтены через `--safe-*` (`max(env(), --tg-*)`); `--tg-*` — это `safeAreaInset` + `contentSafeAreaInset`. Полный экран не запрашивается. Высота шапки зашита числами в пяти расчётах CSS.
- **`--tap`.** Тестом не держится: ячейки HUD уже меньше 44 px.
- **Замки текста.** Около 50 тестов читают исходники интерфейса, и много из них держат буквальные строки и порядок блоков (осада, отчёт о бое, набег, старт). Переписывание текстов правит их тем же коммитом.
- **Значки.** Долг эмодзи сверяется **по номерам строк** в пяти файлах `ui/`. Новые имена значков в начатых группах роняют сборку.
- **Обучение.** Держится на 8 метках `data-tut` и на прокрутке внутри `.sheet-body`. Тестов на метки нет.
- **Правило 18.** Сроки — только `wait.ts` / `span.ts`; набег, мораль армии, голод, рогатки, еда, знак числа, склонение, карточки бойцов и агентов, «что даст уровень» — своими словарями. Цена — только `Cost`.
- **Проблемы:** П1 — 4, П2 — 7, П3 — 6.
