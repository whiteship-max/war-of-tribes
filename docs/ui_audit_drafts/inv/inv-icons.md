# Опись: значки (лист, подстановка, эмодзи без рисунка)

Рабочая копия `C:/Users/white/Desktop/war-of-tribes-ui`, коммит 8ae4967. Пути от корня. Только чтение кода.

## Лист значков: стиль — `assets-src/icons/*.svg`, правила `docs/ART_HANDOFF.md:599-966`
- 184 файла `<группа>-<id>.svg` плоским списком; собираются `npm run icons:build` в `public/assets/icons/sprite.svg` (184 `<symbol id="i-…">`, 64.8 КБ на диске, 12.8 КБ gzip — `src/ui/icons/generated.ts:8`; потолок 60 КБ gzip).
- Сетка `viewBox="0 0 32 32"`, `width/height=32` на корне; рисунок в поле 30×30 (1 ед. поля с каждой стороны). Элементы только `polygon/path/rect/circle/g`, **только `fill`**: обводок нет вовсе, «толщины линии» нет — тонкая линия рисуется узким многоугольником не тоньше 2 ед. (1/16). Без градиентов, прозрачности, текста, `id`, анимации. ≤24 заливок, ≤1000 байт, ≤6 цветов на значок (`ART_HANDOFF.md:873-912`).
- Свет сверху-слева («11 часов»), тень вправо-вниз; тень — тот же цвет ×(0.73, 0.75, 0.80), контакт ×(0.62, 0.63, 0.72) (`ART_HANDOFF.md:772-818`). Плоские плашки, low-poly, как мир.
- Палитра: в листе 69 разных цветов, все из `render/palette.ts`, `ui/styles.css` и цветов отношений (проверка сборки). Чаще всего: `#60432a` тёмное дерево (90 заливок), `#9d6d42` wood (75), `#a8a49b` светлый камень (65), `#d4a544` золото (54), `#5c5e64` metal (48), `#c9b48c` (47), `#6f4f34` (45), `#8c6238` (44), `#8f8b84` stone (38), `#cfa85e` thatch (34), `#d9a77a` кожа (32), `#2b2733` почти чёрный (31), `#7a818c` armor (28), `#e8a43c` accent (27), `#e4dcc6` пергамент (25). Акценты редкие: `#e0524f` алмаз, `#e06b5a`/`#b6432f` красное, `#6bb6e8` союзник, `#4a8a48` зелень. Общий тон — тёплый коричнево-охристый, приглушённый; фон — панель `rgba(28,22,17,.94)`.
- Значки многоцветные, `currentColor` не берут (`Icon.tsx:25`) — перекрасить состоянием (активная/погасшая кнопка) нельзя.
- Второй, отдельный набор — `src/prologue/icons.tsx:15-120`: 11 одноцветных значков на 24-сетке, `fill="currentColor"` (сердце, мороз, мясо, сырое, топор, лук, стрелы, поленья, шкура, плащ, мешок). Только в предыстории.

## Накладная и подстановка — `src/ui/icons/registry.ts:60`, `Icon.tsx:27`, `sheet.ts:40`
- Накладная `ICON_GROUPS` собирается из данных игры (BUILDINGS, TROOPS, EVENTS…) + словарь интерфейса руками (`nav`, `hud`, `mood`, `day`, `alert`, `ui`; `registry.ts:104-121`). 193 имени, нарисовано 184, 9 ждут файла (`assets-src/icons/RETURNED.md:13-43`).
- Ссылки `ALIAS` (`registry.ts:130-150`): `season-summer`/`day-day`→`season-sun`; `attn-order`, `alert-forge-idle`, `ach-first_gear`→`job-smith`; `alert-food`→`res-food`; `alert-wood`→`res-wood`; `nav-townhall`→`bld-town_hall`; `ui-handful`→`res-gem`; `ui-chest`→`ui-crate`; `ach-first_scout`→`fig-scout`; `ach-first_raid`→`hud-army`; `ach-first_hunt`→`gear-bow`; `ach-pop_200`→`bld-houses`; `ach-survivor`→`day-night`.
- Пороги выбора: мораль `MOOD_STEPS` 70/40 (`registry.ts:184`), время суток `DAY_PARTS` по фазе солнца (`registry.ts:197`).
- `Icon({name, glyph, className, title})`: нет листа или нет файла → `<span>{glyph}</span>`; есть → `<svg viewBox 0 0 32 32 width=1em height=1em style=vertical-align:-0.15em><use href="#i-name">`. Размер задаёт кегль контейнера. `title` превращается в `<title>`/`aria-label`, но **ни один из 117 вызовов его не передаёт**.
- Лист грузится `fetch` при первом импорте (`sheet.ts:40-59`); пока не пришёл — везде эмодзи (первый кадр мигает эмодзи → рисунок). Ошибка загрузки молча оставляет эмодзи.
- Кегли, в которых значок живёт (CSS): `.hud-bar .cell .ic` 13 (`styles.css:141`), `.res-bar .res` 13 (`:210`), `.mod .ico` 15 (`:970`), `.wm-btn` 15/13 (`:1875,1891`), `.alert .ic` 16 (`:1161`), `.slot .ico` 18 (`:1293`), `.choice-opt .ico` 20 (`:2226`), `.mail-row .ic` 20 (`:1635`), `.map-btn` 20 (`:1114`), `.wm-leg-flag` 20×20 (`:2010`), `.bottomnav .ico` 21 (`:277`), `.am-head .ico` 22 (`:3636`), `.card .ico` 23 (`:442`), `.bhead .ico` 30 (`:1180`), `.dispatch-ico` 38 (`:1702`), `.modal .m-ico` 38 (`:745`). Шкалы нет — 14 кеглей.
- Маркеры над крышами в 3D-сцене — **эмодзи в текстуру**, лист туда не идёт: `render/Scene.ts:104` `MARKER_GLYPH = { idle: '💤', order: '⚒️', slot: '👤', upgrade: '⬆️' }`.
- Значок, переданный мимо накладной, не проверяется ничем: `ui-music` (`ui/parts/Settings.tsx:64`) — всегда 🎵.

## Опись нарисованного: имя → что изображено → где стоит
(«→ alias» — сюда ведёт ссылка; размеры — из CSS выше.)

**res — ресурсы и валюты (9).** `res-wood` штабель тёсаных брусьев; `res-stone` серая глыба-куб; `res-food` сноп колосьев с перевязью; `res-hides` растянутая шкура; `res-bones` кость; `res-copper` рыжий самородок; `res-iron` стопка серых слитков; `res-gold` горка золотых слитков/монет; `res-gem` красный огранённый камень.
Где: полоска ресурсов `ResourceBar.tsx:60`; цена `parts/Cost.tsx:57`; склад `panels/BuildingPanel.tsx:484`; найм/ковка `parts/Recruit.tsx:104`, `parts/Smithy.tsx:118`, `parts/TroopCardView.tsx:90`; `res-gold` — `Cost.tsx:64`, `Barracks.tsx:151`, `Masters.tsx:49`, `TownHall.tsx:128`; `res-food`/`res-wood` → тревоги (`AlertBar.tsx:124`); `res-gem` только как «Горсть» на витрине (`Gems.tsx:87`), в ценах алмазов не стоит.

**bld — здания (24).** `campfire` костёр на скрещённых поленьях; `town_hall` каменная ратуша с башней и воротами; `houses` три дома с цоколем; `storage` ящики ступенями; `gathering` корзина с зеленью; `sawmill` бревно на козлах; `quarry` глыба с киркой; `hunter_hut` рога/шкура над чурбаком; `mine` устье штольни с породой; `workshop` верстак с инструментом; `farm` амбар с колосьями; `pen` загон-изгородь; `church` церковь с крестом; `statue` фигура на постаменте; `infirmary` серый купол-палатка с дверью; `watch` вышка на ногах с флажком; `stable` два обращённых друг к другу стойла; `cache` сундук-тайник; `tavern` кружка; `palisade` частокол кольев; `tower` каменная башня; `smithy` наковальня; `market` весы на столбе; `barracks` шлем с наносником.
Где: шапка панели здания `BuildingPanel.tsx:123` (30 px); ратуша — список построек `parts/TownBuild.tsx:190,228,279` (21–23 px); «Племя» `panels/PeoplePanel.tsx:63,137`; `bld-palisade` — `SiegePanel.tsx:168`, `Walls.tsx:42`; `bld-houses`, `bld-storage` — строки «Что даёт посёлку» `BuildingPanel.tsx:539,541`; `bld-town_hall` — кнопка «Ратуша» навигации (`BottomNav.tsx:55`).

**gear — снаряжение (6).** `spear` копьё; `bow` лук; `axe` топор; `shield` каплевидный щит; `sword` меч; `armor` кольчуга. Где: `Smithy.tsx:67,107`, `Recruit.tsx:111`, `TroopCardView.tsx:95`, склад `BuildingPanel.tsx:511`, оборона `Walls.tsx:35,51`, «К защите» `BuildingPanel.tsx:543`.

**troop — войска (9).** Фигуры в рубахах своего цвета с оружием за контуром: `clubman` дубина, `spearman` копьё, `archer` лук, `axeman` топор, `swordsman` меч, `shieldman` каплевидный щит, `rider` всадник, `legionary` латник с гребнем, `horse` конь без всадника. Где: `ArmyPanel.tsx:106`, `Barracks.tsx:83`, `Recruit.tsx:54,91`, `GarrisonEditor.tsx:116`, `SortiePanel.tsx:188`, `TroopCardView.tsx:63`, `SiegePanel.tsx:81` (кнопка «В казармы»); `troop-horse` — только конюшня `BuildingPanel.tsx:575,576`.

**job — профессии (11), инструментом.** `idle` раскрытая ладонь; `gatherer` корзина с ягодой; `hunter` лук со стрелой; `woodcutter` топор в колоде; `stonecutter` кирка; `miner` кайло с рудой; `farmer` серп со снопом; `herder` посох и коза; `crafter` пила и рубанок; `smith` молот на наковальне; `priest` свеча. Где: `BuildingPanel.tsx:237,244,445,624`, `PeoplePanel.tsx:261` (18 px); `job-smith` ещё → маркер «кузнецы без заказа», тревога forge-idle, достижение.

**season (4) / day (3) / mood (3) — строка состояния.** `season-spring` росток; `season-sun` солнце (лето и день); `season-autumn` оранжевый лист; `season-winter` ель под снегом. `day-morning` солнце встаёт над холмом; `day-evening` садится за холм; `day-night` полумесяц со звездой. `mood-good` полный рог стоймя; `mood-mid` полупустой наклонённый рог; `mood-bad` опрокинутый рог с пролитым. Где: `TopBar.tsx:84,96,122` (13 px), `SeasonPanel.tsx:112,147`, `BuildingPanel.tsx:416,545`.

**hud (3) / nav (2).** `hud-pop` дома под крышами; `hud-army` скрещённое оружие (побайтово = `alert-raid`); `hud-map` сложенная карта. `nav-people` три фигуры; `nav-quests` развёрнутый лист на валиках. Где: `TopBar.tsx:110,148,172`, `BottomNav.tsx:55` (21 px); `hud-army` — ещё `BuildingPanel.tsx:595,597`; `hud-pop` — `:596`; `hud-map` — `:568`.

**attn (3) / alert (3).** `attn-idle` колпак с помпоном (сон); `attn-slot` человек с плюсом; `attn-upgrade` стрелка вверх над домом. `alert-starving` череп; `alert-freezing` поленница со снежинкой; `alert-raid` скрещённое оружие. Где: `TownBuild.tsx:237` (17 px); `AlertBar.tsx:87,124` (16 px).

**bat — журнал боя (13).** `volley` летящая стрела; `ranged-lost` сломанные древки со стрелой; `spears-held` три копья остриём вверх; `cavalry-broke` подкова; `cavalry-stopped` перечёркнутая подкова; `flank` стрелка с изломом; `rear` красная стрелка в стену; `sector-broken` расколотый щит; `reserve` жёлтое знамя; `morale` древко с красным наконечником; `annihilated` меч в земле; `outfought` перекошенные весы; `pursuit` двойной шеврон. Где: `panels/ReportPanel.tsx:301` (кегль строки ≈12–13).

**Карта: stage (5) / rel (5) / state (3) / temper (5).** `stage-camp` два шатра; `stage-village` два дома; `stage-stronghold` дома за частоколом; `stage-town` дома за каменной стеной; `stage-castle` серый замок. `rel-self` рыжий флаг; `rel-ally` синий вымпел; `rel-neutral` круглый щит на древке; `rel-enemy` красный треугольный флаг; `rel-barbarian` коричневый рваный вымпел. `state-neutral` закрытые ворота; `state-pact` печать на ленте; `state-war` разломанная красная печать. `temper-proud` павлин; `temper-greedy` серая птичья голова с монетой; `temper-fierce` кабан; `temper-wary` лиса; `temper-steady` голова тура. Где: стадия — только шапка карточки клетки `WorldPanel.tsx:266`; `rel-*` — только легенда `map/WorldMap.tsx:802` (20 px); `state-*` — `WorldPanel.tsx:530`; `temper-*` — `ActionMenu.tsx:162`, `WorldPanel.tsx:547`.

**fig (4) / deal (4) / dip (5) / spy (2) / letter (5).** `fig-scout` фигура в зелёном капюшоне с посохом; `fig-diplomat` в шапке с грамотой; `fig-spy` тёмный капюшон; `fig-general` в шлеме с жезлом. `deal-truce` два воткнутых копья; `deal-trade` монета → слитки; `deal-tribute` мешок с монетой; `deal-alliance` два щита-сердца (рыжий+синий). `dip-gift` кубок; `dip-pact` свиток с синей лентой; `dip-peace` зелёная ветвь; `dip-insult` брошенная латная перчатка; `dip-war` разорванная грамота. `spy-probe` лупа на щите; `spy-revolt` факел. `letter-pact`/`-tribute`/`-alliance`/`-ransom`/`-raid` — конверт с лентой / монетой / флажками / цепью / красный конверт. Где: фигуры — `ActionMenu.tsx:123,501,538`, `MarchesPanel.tsx:145`, `WorldPanel.tsx:107,125`, `parts/AgentPlaces.tsx:33,59,89`; договоры — `WorldPanel.tsx:596`; приказы — `ActionMenu.tsx:258`; письма — почта `realm/Mail.tsx:116` (20 px), `:163` (38 px).

**decree / ration / tax (по 3), evt (11).** Указ — свиток пустой / с красной печатью / с лентой; рацион — пустая миска / с похлёбкой / с горкой; налог — пустой сундук / с монетой / через край. События: `refugees` группа людей, `wanderers` мешок с инструментом, `wolves` волчья голова, `berries` ягодный куст, `storm` туча с молнией, `trade` обмен, `sickness` лежачий больной, `raiders` фигура в капюшоне с топором, `festival` венок, `good_hunt` рогатая голова, `fire` огонь над крышей. Где: `TownHall.tsx:99,116,154` (20 px); события — `Mail.tsx:116,163`.

**daily (3) / maze (3) / soc (3) / ach (1).** `daily-archery` колчан со стрелами; `daily-maze` квадратный лабиринт; `daily-quiz` два скрещённых флажка; `maze-key` ключ; `maze-door` арочная дверь; `maze-chest` сундук с золотом; `soc-chat` облачка речи; `soc-group` люди с флажком; `soc-youtube` рупор; `ach-first_win` кубок с красной лентой. Где: `daily/DailyPage.tsx:108`, `daily/Maze.tsx:170-174`, `parts/Social.tsx:48`, `QuestsPanel.tsx:102`.

**ui — общий инвентарь (23).** `warning` треугольник «!»; `site` строительные леса; `time` песочные часы; `loot` перевязанный тюк; `person` бюст человека; `hammer` молоток; `scroll` свиток поперёк с печатью; `book` раскрытая книга; `pouch` кошель; `crate` окованный сундук; `wagon` повозка; `ruler` линейка ↔; `eye` глаз; `eye-off` перечёркнутый глаз; `pin` красная метка; `home` дом с красной крышей; `banner` красное знамя; `grave` надгробие; `bandage` бинт; `spyglass` подзорная труба; `bolt` молния; `target` мишень; `star` золотая звезда (Telegram Stars).
Где: `time` — `AlertBar.tsx:87`, `Cost.tsx:70`, `BuildingPanel.tsx:559,566`; `site` — `BuildingPanel.tsx:157`; `loot` — `BuildingPanel.tsx:588,607`, `ReportPanel.tsx:354`, `WorldPanel.tsx:354`; `crate` — `BuildingPanel.tsx:591`, «Сундук» `Gems.tsx:87`; `person` — `WorldPanel.tsx:283`, `TownBuild.tsx:80`; `hammer` — `PeoplePanel.tsx:212`, `TownBuild.tsx:113`, `BuildingPanel.tsx:594`; `scroll` — `QuestsPanel.tsx:41,66`, `WorldPanel.tsx:564`; `book` — `Chronicle.tsx:54`; `pouch`, `wagon` — `Gems.tsx:87`; `ruler` — `WorldPanel.tsx:151,186,295`; `eye`/`eye-off` — `ActionMenu.tsx:450`, ещё `eye` в `SceneDoctor.tsx:40`, `TouchDoctor.tsx:41`; `home` — `ArmyPanel.tsx:52`, `WorldPanel.tsx:744`, `GarrisonEditor.tsx:151,165`; `banner` — `ArmyPanel.tsx:73`, `WorldPanel.tsx:362`; `target` — `ArmyPanel.tsx:79`, `QuestsPanel.tsx:44`; `grave` — `ReportPanel.tsx:341`; `bolt` — `ReportPanel.tsx:210`; `bandage` — `BuildingPanel.tsx:555-560`; `spyglass` — `BuildingPanel.tsx:563`; `star` — `Gems.tsx:80,95`. **`ui-warning` и `ui-pin` не стоят нигде.**

**Ждут файла (на их месте эмодзи):** `letter-siege` ⛺, `evt-rome_letter` 📜, `evt-rome_relief` 🕊️, `evt-heresy_split` 🔥, `evt-relic_offer` 📿, `evt-mutiny` ⚠️, `hud-order` 🗝️, `troop-knight` 🏇, `bat-dice` ⛰️ (`RETURNED.md:13-43`). Вне накладной: `ui-music` 🎵.

## Эмодзи без нарисованного значка — `src/ui/**`, `src/render/Scene.ts`
Голые эмодзи в JSX и строках интерфейса (без `<Icon>`; комментарии не считаны) — 315 строк. Плюс эмодзи из данных, выведенные `{x.icon}` мимо `Icon`. «Рисунок есть» — значит, нарисованный значок того же смысла лежит в листе, но здесь не подключён.

| Эмодзи | Мест | Где (выборка) | Что значит | Рисунок есть? |
|---|---|---|---|---|
| ⚔️ | 31 | `WorldMap.tsx:890`, `ArmyPanel.tsx:40,127`, `CampPanel.tsx:189`, `SiegePanel.tsx:225`, `SortiePanel.tsx:97,234`, `WorldPanel.tsx:338,631`, `MarchesPanel.tsx:32`, `OrderPanel.tsx:79,133`, `PopPanel.tsx:205`, `ProfilePanel.tsx:255`, `Masters.tsx:55`, `Statue.tsx:31`, `TownHall.tsx:133`, `realm/tabs.ts:35`, `TroopCardView.tsx:183` | дружина, мощь, набег, штурм, вылазка, поход, вкладка «Армия», кнопка «В казармы» | `hud-army` |
| ⏳ ⌛ ⏱ 📅 | 16+2+2+1 | `ActionMenu.tsx:220,265`, `CampPanel.tsx:119`, `PopPanel.tsx:91`, `SiegePanel.tsx:155`, `WorldPanel.tsx:191,448,509,557,734`, `AgentPlaces.tsx:73`, `GarrisonEditor.tsx:143`, `Recruit.tsx:116`, `Smithy.tsx:121`, `Tavern.tsx:48`, `AgentCard.tsx:171`, `TroopCardView.tsx:99`, `MoralePanel.tsx:196`, `PaceModal.tsx:26` | срок, ожидание, время пути, работа | `ui-time` |
| ⛺ | 15 | `SiegeBanner.tsx:64`, `ActionMenu.tsx:304,337,394`, `CampPanel.tsx:68,179`, `ReportPanel.tsx:324,333`, `SiegePanel.tsx:108`, `SortiePanel.tsx:148`, `WorldPanel.tsx:432,456,649`, `CampStrike.tsx:49`, `Walls.tsx:76` | лагерь осаждающих, окно осады, «Осадить» | `stage-camp` (шатры); `letter-siege` нет |
| 🔨 | 13 | `BuildingPanel.tsx:633`, `PeoplePanel.tsx:153`, `PopPanel.tsx:200`, `ProfilePanel.tsx:270`, `SeasonPanel.tsx:62`, `Barracks.tsx:59,136`, `Masters.tsx:34,67`, `TownHall.tsx:37,73`, `realm/tabs.ts:30` | стройка, мастера, свободные, скорость | `ui-hammer` |
| 💰 🪙 | 12+3 | `Market.tsx:46,178,186,217,234,261,265`, `Recruit.tsx:97`, `ReportPanel.tsx:42`, `MarchesPanel.tsx:55`, `ProfilePanel.tsx:228`, `Temple.tsx:246`; 🪙 `Tavern.tsx:22,35,58` | золото, казна, цена | `res-gold` |
| 🛡️ | 10 | `ArmyPanel.tsx:44`, `CampPanel.tsx:114`, `OrderPanel.tsx:140`, `ReportPanel.tsx:269`, `Barracks.tsx:47,55`, `Temple.tsx:270`, `Walls.tsx:64`, `Maze.tsx:214` | защита, оборона, «наши», фишка лабиринта | `gear-shield` |
| 😊 😟 | 10+4 | `MoralePanel.tsx:90`, `PeoplePanel.tsx:236`, `PopPanel.tsx:105,160,168`, `SeasonPanel.tsx:67`, `Tavern.tsx:30`, `Temple.tsx:254`, `TownHall.tsx:79` | мораль, её знак | `mood-*` (3 рога) |
| ✕ | 9 | `Sheet.tsx:153`, `realm/RealmMenu.tsx:104`, `ActionMenu.tsx:132`, `BuildingPanel.tsx:170`, `Market.tsx:104`, `Recruit.tsx:72`, `Smithy.tsx:85`, `Watch.tsx:61`, `CheatPanel.tsx:93` | закрыть | нет |
| ← → ↩️ | 4+12+2 | `WorldMap.tsx:723`, `AgentCard.tsx:147`, `AvatarPicker.tsx:36`, `TroopCardView.tsx:58`; → в «было → стало» `ReportPanel.tsx:272,279`, `GarrisonEditor.tsx:146`, `WorldPanel.tsx:747`; ↩️ `CampPanel.tsx:193`, `WorldPanel.tsx:739` | назад, переход, отступить | нет |
| 🔥 | 8 | `ActionMenu.tsx:238`, `WorldPanel.tsx:177,486,504`, `Temple.tsx:114`, `Walls.tsx:81`, `ProfilePanel.tsx:214`, `SeasonPanel.tsx:74` | бунт, сожжено, раскол, донесение о набеге, отопление | частично (`spy-revolt` факел, `evt-fire`) |
| 👥 | 7 | `PopPanel.tsx:74,195`, `MoralePanel.tsx:120`, `WorldPanel.tsx:345`, `Temple.tsx:286` | население, люди | `hud-pop`, `nav-people` |
| 👣 | 6 | `AlertBar.tsx:101`, `ActionMenu.tsx:416`, `MarchesPanel.tsx:33`, `ReportPanel.tsx:311`, `WorldPanel.tsx:300,671` | разведчик, разведка, пустое место | `fig-scout` |
| 📜 | 6 | `TownHall.tsx:40`, `AgentCard.tsx:215`, `Barracks.tsx:144,157`, `Masters.tsx:75` | вкладка «Управление», условия, жалованье | `ui-scroll` |
| ♦ / ◆ | 6 / 4 | ♦ `Gems.tsx:30,67,92`, `TownBuild.tsx:169`, `TownHall.tsx:43`; ◆ `realm/Ruler.tsx:71`, `realm/Tech.tsx:49,95,107` | алмазы / очки правителя | `res-gem` / нет |
| 🎖️ | 5 | `AlertBar.tsx:101,111`, `ArmyPanel.tsx:58`, `MarchesPanel.tsx:237`, `GarrisonEditor.tsx:158` | полководец | `fig-general` |
| 🛏️ 🍖 🌲 | 5+5+4 | `PeoplePanel.tsx:241,242`, `PopPanel.tsx:112,119`, `TownHall.tsx:85`, `WinterModal.tsx:60,61`, `SeasonPanel.tsx:64,130`, `Provisions.tsx:57,64` | жильё, еда, дрова | `bld-houses`, `res-food`, `res-wood` |
| 🐎 🏇 | 5+2 | `Watch.tsx:43,92`, `realm/RealmMenu.tsx:208`, `ActionMenu.tsx:205` | конница, гонец | `troop-horse`, `troop-rider` |
| 🏘️ | 5 | `CampPanel.tsx:136`, `PopPanel.tsx:215`, `ProfilePanel.tsx:184`, `SiegePanel.tsx:181`, `WorldPanel.tsx:620` | посёлок, дворы | `hud-pop`, `stage-village` |
| ⚖️ | 5 | `ReportPanel.tsx:283`, `SeasonPanel.tsx:80`, `Temple.tsx:238`, `TroopCardView.tsx:75`, `realm/tabs.ts:33` | соотношение, «обычный ход», вес в бою, «Стабильность» | нет (`bat-outfought` — перекос) |
| 🏛️ | 4 | `MoralePanel.tsx:131,214`, `realm/tabs.ts:29` | ратуша, «Правительство» | `bld-town_hall` |
| 🩹 | 4 | `realm/RealmMenu.tsx:217` (+ запасные `BuildingPanel.tsx:555-560`) | лазарет | `ui-bandage` |
| 🍺 🕯️ | 4+3 | `MoralePanel.tsx:71,80,156,163`, `OrderPanel.tsx:145`, `Tavern.tsx:41`, `Lineage.tsx:30` | пир, служба | `bld-tavern`, `job-priest` |
| 🏠 | 3 | `WorldMap.tsx:887`, `MarchesPanel.tsx:35`, `SortiePanel.tsx:203` | домой, оборона дома | `ui-home` |
| ⚠️ | 3 | `BuildingPanel.tsx:149`, `MarchesPanel.tsx:215`, `Walls.tsx:64` (+ мятеж `AlertBar.tsx:72`) | предупреждение | `ui-warning` (не подключён нигде) |
| 📈 📉 | 2+3 | `PopPanel.tsx:83`, `MoralePanel.tsx:110`, `ProfilePanel.tsx:249` | прирост / убыль | нет |
| 🔒 ✓ ✅ ▢ | 3+1+1+1 | `AgentCard.tsx:284`, `Watch.tsx:92`, `realm/Tech.tsx:95` | закрыто / сделано | нет |
| 📚 | 3 | `Recruit.tsx:140`, `Smithy.tsx:145`, `realm/tabs.ts:31` | «Технологии» | нет (`ui-book` близко) |
| ⚒️ | 3 | `Recruit.tsx:145`, `Smithy.tsx:44`, `TroopCardView.tsx:103` | «В кузницу» | `bld-smithy`, `job-smith` |
| 🛒 | 3 | `OrderPanel.tsx:128`, `PeoplePanel.tsx:104,127` | рынок | `bld-market` |
| 👑 🌳 | 2+2 | `realm/Ruler.tsx:32,92`, `realm/tabs.ts:28,36` | правитель, родословная, «Сословия» | нет |
| ✉️ | 2 | `realm/Mail.tsx:99`, `realm/tabs.ts:32` | донесения, «Решения» | нет общего (`letter-*` по поводам) |
| 🔍 🔭 | 2+2 | `WorldMap.tsx:894`, `realm/Mail.tsx:228` | масштаб карты, «показать на карте» | `ui-spyglass` (труба); лупы нет |
| ⚙️ | 1 | `realm/RealmMenu.tsx:101` | профиль и настройки | нет (он же запасной у `res-iron`, `constants.ts:362`) |
| ℹ️ | 1 | `WorldMap.tsx:748` | легенда карты | нет |
| 📍 | 1 | `ActionMenu.tsx:218` | точка назначения | `ui-pin` (не подключён) |
| ✦ ✧ | 3+1 | `AgentCard.tsx:94,189`, `realm/Ruler.tsx:46` | черта агента/правителя хорошая/плохая | нет |
| ✎ | 2 | `ProfilePanel.tsx:152,176` | править имя/город | нет |
| ▶️ | 1 | `ReportPanel.tsx:224` | смотреть бой | нет |
| 🗼 🗿 🏅 🏆 💀 🧺 📦 🧰 | по 1–2 | `SiegePanel.tsx:196`, `TowerEngine.tsx:59`, `Barracks.tsx:163`, `BuildingPanel.tsx:422`, `ProfilePanel.tsx:204,209,222,265`, `Market.tsx:84`, `ReportPanel.tsx:347` | башня, статуя, слава, победы, потери, добыча | `bld-tower`, `bld-statue`, `ach-first_win`, `alert-starving`, `bld-storage`, `ui-loot`, `bld-cache` |
| 🍞 🌾 🌱 📊 🙏 🎯 🚧 ➕ 🥾 💔 🗡️ 🐾 🎁 📿 📖 🏚️ ⚰️ 🏳️ 🥣 | по 1–3 | `CampPanel.tsx:124,136`, `SiegePanel.tsx:160,181`, `PopPanel.tsx:133,173,185,210`, `MoralePanel.tsx:136,142,169`, `AgentCard.tsx:234`, `TroopCardView.tsx:78,115,155,165,170,175`, `Temple.tsx:159,231,278`, `ReportPanel.tsx:365`, `Lineage.tsx:30`, `WorldPanel.tsx:288` | припасы лагеря, поля, вера, план, контрры, дар, павший правитель | частично (`res-food`, `job-farmer`, `gear-sword`, `gear-bow`, `dip-gift`) |
| 🪟 🪨 | 1+1 | `SyncModal.tsx:27`, `TroopCardView.tsx:155` | игра открыта дважды; слабый контрр | нет; **Emoji 13 — квадрат** |
| модалки 🏰 🌙 ❄️ | по 1 | `LegacyModal.tsx:15`, `OfflineModal.tsx:14`, `WinterModal.tsx:52,79` | старая партия, отлучка, зима | `stage-castle`, `day-night`, `season-winter` |
| маркеры крыши 💤 ⚒️ 👤 ⬆️ | 4 | `render/Scene.ts:104` | маркеры внимания над зданием | `attn-*`, `job-smith` |

Эмодзи из данных мимо `Icon` (рисунок той же группы есть, но здесь эмодзи): ресурсы `RESOURCE_META[r].icon` — `BuildingPanel.tsx:438,611` (выработка строкой), `ProfilePanel.tsx:242`, `QuestsPanel.tsx:81`, `DailyPage.tsx:117`, `ReportPanel.tsx:40`, `MarchesPanel.tsx:53`, `upgrade.ts:275`; товары рынка `Market.tsx:84,168,254`; состояние отношений `ActionMenu.tsx:155`; договоры `WorldPanel.tsx:683`; налог/указ/рацион `MoralePanel.tsx:149,176,186`, `PopPanel.tsx:180`, `Provisions.tsx:31`; здания `Gems.tsx:58`; стадия `CampPanel.tsx:102`; фигура `WorldPanel.tsx:615`; войска `daily/Quiz.tsx:84`. Без рисунка вовсе: роды войск `KIND_META` 🔱⚔️🏹🐎🏇 (`ArmyPanel.tsx:116`, `WorldPanel.tsx:410`, `TroopCardView.tsx:68`), миссии ⚔️👣🤝 (`WorldPanel.tsx:661,763`, `MarchesPanel.tsx:261`), отряды мира 👣🛡️ (`WorldPanel.tsx:711,765`), участь города 💰⛓️🔥 (`WorldPanel.tsx:439,471`, `SiegePanel.tsx:145`, `FatePick.tsx:45`, `SiegeBanner.tsx:61`), порядок 🗝️⚠️🏘️👥 (`OrderPanel.tsx:50,62,100,110`, `PeoplePanel.tsx:180`, `TownBuild.tsx:50`), содержание 💰 (`Barracks.tsx:126`), вера ✝️☦️☪️🌳 и праздники (`Temple.tsx:43,94,140,208,313,338`, `PopPanel.tsx:133`), орудия башни 🎯☄️ (`TowerEngine.tsx:38,71`), вкладки державы (`RealmMenu.tsx:114`), событие в почте крупно (`RealmMenu.tsx:161`).

## Значки, нужные для переделки: есть ли в листе
| Нужно | Есть? | Что сейчас |
|---|---|---|
| Прирост / убыль (стрелка вверх-вниз у числа) | **нет** | 📈/📉 (`PopPanel.tsx:83`, `MoralePanel.tsx:110`, `ProfilePanel.tsx:249`), знак `+`/`−` и цвет `.delta.pos/.neg` (`BuildingPanel.tsx:91,488`). `attn-upgrade` (стрелка над домом) занят смыслом «улучшить» — путать нельзя |
| Срок / ожидание | **есть** `ui-time` (песочные часы) | рядом живут ⏳ ⌛ ⏱ 📅 голыми; отдельного «день/календарь» нет (есть `day-*` фазы суток) |
| Тревога: голод / мороз / набег | есть `alert-starving`, `alert-freezing`, `alert-raid` | подключены |
| Тревога: мало еды / дров / кузня стоит | ссылкой `res-food`, `res-wood`, `job-smith` | подключены |
| Тревога: набег не успеваем собрать | ссылкой `ui-time` | `AlertBar.tsx:87` |
| Тревога: жалованье, уход войска, казна (4 вида) | **нет** своего; `res-gold` годится | 💰 на всех четырёх (`derived.ts:1896-1913`) |
| Тревога: ропот/мятеж невольников | `ui-warning` нарисован, не подключён; `evt-mutiny` ждёт файла | ⚠️ (`AlertBar.tsx:72`, `derived.ts:1924`) |
| Тревога: порядок шаток | **нет** (`hud-order` ждёт файла) | 🗝️ (`derived.ts:1930`) |
| Тревога: ересь | **нет** (`evt-heresy_split` ждёт) | 🔥 (`derived.ts:1941`) |
| Тревога: пустое место агента / полководец без дружины | есть `fig-scout`, `fig-general` и др., не подключены | 🎖️/👣 (`AlertBar.tsx:101,111`) |
| Тревога: осада | **нет** (`letter-siege` ждёт) | ⛺ (`SiegeBanner.tsx:46,64`) |
| Вкладки державы: Родословная | нет | 🌳 |
| — Правительство | есть `bld-town_hall` | 🏛️ |
| — Строительство | есть `ui-hammer` | 🔨 |
| — Технологии | нет (`ui-book` близко) | 📚 |
| — Решения (почта) | нет общего конверта; `letter-*` по поводам | ✉️ |
| — Стабильность | нет | ⚖️ |
| — Религия | есть `bld-church` (крест — только одна вера) | ⛪ |
| — Армия | есть `hud-army` | ⚔️ |
| — Сословия | нет | 👑 |
| Очки правителя трёх ветвей | **нет** | ◆ один на все три |
| Карта: домой | есть `ui-home` | 🏠 голым (`WorldMap.tsx:887`) |
| Карта: походы | есть `hud-army`; своего «поход» нет | ⚔️ (`WorldMap.tsx:890`) |
| Карта: разведка | есть `fig-scout`, `ui-spyglass`, `spy-probe` | 👣 / 🔭 |
| Карта: масштаб | `ui-spyglass` (труба); лупы нет | 🔍/🔭 (`WorldMap.tsx:894`) |
| Карта: точка/место | есть `ui-pin`, не подключён | 📍 (`ActionMenu.tsx:218`) |
| Настройки | **нет**; приставка `gear-` занята снаряжением → имя `ui-settings` | ⚙️ (`RealmMenu.tsx:101`) |
| Подсказка «i» | **нет** | ℹ️ (`WorldMap.tsx:748`) |
| Закрыть | **нет** | ✕ текстом, 9 мест |
| Назад | **нет** | ← текстом, 4 места |
| Замок «закрыто» / галочка «сделано» | **нет** (`alert-locked` из ТЗ убран) | 🔒 ✓ ✅ |
| Алмаз в цене | есть `res-gem` | ♦ текстом |
| Музыка | **нет** (вне накладной) | 🎵 |

## Проблемы
- **П1 · другое** — Эмодзи новее 12.0 стоят голыми и на части телефонов рисуются квадратом: 🪙 `ui/parts/Tavern.tsx:22,35,58` (казна и кнопка пира), 🪟 `ui/SyncModal.tsx:27` (значок окна 38 px), 🪨 `ui/parts/TroopCardView.tsx:155`, 🪃 дубинщика через `TROOP_BY_ID.icon` в `ui/parts/daily/Quiz.tsx:84`. Записаны долгом (`ui/icons/emoji.test.ts:70-80`), замены нет.
- **П1 · непоследовательность** — ⚔️ значит больше десяти разных вещей: дружина (`TopBar.tsx:148`), набег (`AlertBar.tsx:87`), штурм (`CampPanel.tsx:189`), вылазка (`SiegePanel.tsx:225`), походы (`WorldMap.tsx:890`), «Армия» (`realm/tabs.ts:35`), мощь и защита (`BuildingPanel.tsx:595,597`), стража порядка (`game/data/order.ts:63`), пехота (`battle/names.ts:27`), война (`diplomacy.ts:145,203`). 31 голое место. Нарисованные `hud-army` и `alert-raid` — один рисунок побайтово (`OBJECTS.md:107`).
- **П1 · скрытое действие** — Подсказки по долгому нажатию нет: `Icon` умеет `title`, но 0 из 117 вызовов его передают; объяснение ячеек HUD висит в `title=` (`TopBar.tsx:82,93,107,119,132,145`), а на телефоне `title` не показывается; полоска ресурсов `pointer-events: none` (`styles.css:206`) — название ресурса узнать нельзя. Переход на «значки без подписей» объяснять пока нечем.
- **П1 · непоследовательность** — В строке тревог (видна поверх всего) своих рисунков у 6 видов из ~14; 💰 стоит на четырёх разных тревогах ухода и жалованья (`game/derived.ts:1896,1904,1911,1913`), ⚠️ — на мятеже (`AlertBar.tsx:72`), 🗝️ — на порядке, 🔥 — на ереси, 🎖️/👣 — на пустом месте агента (`AlertBar.tsx:101,111`), хотя `ui-warning`, `fig-general`, `fig-scout`, `res-gold` нарисованы.
- **П1 · непоследовательность** — Две валюты почти одним знаком: алмазы ♦ (`Gems.tsx:30,67,92`, `TownBuild.tsx:169`, `TownHall.tsx:43`) и очки правителя ◆ (`realm/Ruler.tsx:71`, `realm/Tech.tsx:49,95,107`); на 12 px не различить. ◆ один на три ветви очков. Нарисованный `res-gem` в ценах не стоит.
- **П1 · место** — Постоянные кнопки карты — голые эмодзи и текст: 🏠 «Домой» (`WorldMap.tsx:887`, а `ui-home` есть), ⚔️ «Походы» (`:890`, `hud-army` есть), 🔍/🔭 (`:894`), ← (`:723`), ℹ️ (`:748`). Для двух последних значков в листе нет. Ряд, который игрок трогает чаще всего на карте, нарисован не в стиле игры.
- **П2 · непоследовательность** — Одна вещь: в одном месте рисунок, рядом эмодзи. Договоры — `WorldPanel.tsx:596` рисунком, `:683` эмодзи, на одной панели. Состояние отношений — `WorldPanel.tsx:530` против `ActionMenu.tsx:155`. Указ, рацион и налог — `TownHall.tsx:99,116,154` против `MoralePanel.tsx:149,176,186`, `PopPanel.tsx:180`, `Provisions.tsx:31`. Ресурсы — `ResourceBar`/`Cost` против `ProfilePanel.tsx:242`, `QuestsPanel.tsx:81`, `DailyPage.tsx:117`, `Market.tsx:84,168,254`. Здания — `TownBuild` против `Gems.tsx:58`. Стадия — `WorldPanel.tsx:266` против `CampPanel.tsx:102`.
- **П2 · другое** — Числа со значком склеиваются строкой `.join` и потому всегда идут эмодзи (`docs/icons.md:102`): выработка `BuildingPanel.tsx:438,611`, потери и добыча `ReportPanel.tsx:34,40`, `MarchesPanel.tsx:46,53`, отряд `WorldPanel.tsx:765`, `parts/upgrade.ts:275`. Чтобы получить «число рядом со значком», эти места придётся переписать компонентами.
- **П2 · непоследовательность** — Срок обозначают четыре разных знака: ⏳ (16 мест), ⌛ (`WorldPanel.tsx:191`, `AgentCard.tsx:171`), ⏱ (`WorldPanel.tsx:734`, `TroopCardView.tsx:99`), 📅 (`MoralePanel.tsx:196`). Нарисованный `ui-time` стоит только в `Cost.tsx:70`, `AlertBar.tsx:87` и `BuildingPanel.tsx:559,566`.
- **П2 · непоследовательность** — Золото показано тремя способами: `res-gold` (Cost, Barracks, TownHall, Masters), 💰 голым в 12 местах (Market ×7, `Recruit.tsx:97` и др.) и 🪙 (Tavern). Тот же 💰 стоит запасным у `tax-high`, `letter-tribute`, `maze-chest`, у «Ограбить» (`fates.ts:20`) и у тревог жалованья.
- **П2 · непоследовательность** — Мораль показывают смайлы 😊/😟 голыми в 14 местах, с двумя ступенями (≥0/<0), а нарисованных рогов `mood-*` три, с порогами 70/40 (`registry.ts:184`). Техзадание прямо называет смайл чужеродным (`ART_HANDOFF.md:248`).
- **П2 · непоследовательность** — Маркер над крышей рисуется эмодзи (`render/Scene.ts:104`), а тот же маркер в списке построек — нарисованным `attn-*` (`TownBuild.tsx:237`): у одного состояния две картинки.
- **П2 · непоследовательность** — Девять имён накладной ещё не нарисованы и смешивают стиль внутри одного списка: 🏇 латников среди рисованных фигур в казармах и найме, пять событий-эмодзи в почте среди рисованных, 🗝️ в строке состояния рядом с рисунками, ⛺ осады (`SiegeBanner.tsx:46`, `SiegePanel.tsx:133`, `SortiePanel.tsx:131`), ⛰️ кости фазы (`battle/report.ts:103`) — тот же знак, что у камня.
- **П2 · непоследовательность** — Наковальня нарисована дважды: `bld-smithy` — наковальня (вопреки правилу «здание — постройка, а не предмет», `ART_HANDOFF.md:138`) и `job-smith` — молот на наковальне. Они встречаются: строка кузницы и маркер «кузнецы без заказа» (`TownBuild.tsx:228,237`), шапка кузницы и строка рабочих (`BuildingPanel.tsx:123,624`). В `OBJECTS.md` этой пары нет.
- **П2 · непоследовательность** — 🔨 стоит голым в 13 местах и значит четыре вещи: стройку, мастеров, свободные руки и скорость улучшений; он же запасной у `job-idle`. Нарисованный `ui-hammer` подключён только в трёх местах. ⛺ (15 мест) смешивает «лагерь у наших стен» и «чужой лагерь»; `stage-camp` есть, но не подключён.
- **П2 · длина подписей** — Вкладки державы — эмодзи плюс слово до 13 букв («Правительство», «Строительство») в капсулах с прокруткой вбок (`realm/RealmMenu.tsx:114`, `tabs.ts:28-36`). Из девяти смыслов нарисованы только четыре, и они не подключены.
- **П2 · мелкая цель касания** — Значки HUD — 13 px в кнопках с `padding: 3px 4px` (`styles.css:141,2427`); высота цели около 20 px при `--tap` 44. Самая тонкая деталь рисунка (2 ед. из 32) на 13 px — 0,8 px.
- **П3 · непоследовательность** — `ui-warning` и `ui-pin` нарисованы, но не стоят нигде; на их месте ⚠️ (3 места) и 📍 (`ActionMenu.tsx:218`).
- **П3 · другое** — `ui-music` передаётся в `Icon` мимо накладной — всегда 🎵 (`Settings.tsx:64`).
- **П3 · непоследовательность** — «Закрыть» и «назад» — текстовые ✕ (9 мест) и ← (4 места) разного кегля (16–18). Своего рисунка у них нет.
- **П3 · непоследовательность** — Запасной эмодзи не совпадает с рисунком. `ui-eye` идёт с 🔎 и с 👆 (`SceneDoctor.tsx:40`, `TouchDoctor.tsx:41`). `ui-loot` идёт с 🧰, а `ui-crate` — с 📦 (`BuildingPanel.tsx:588,591`), наоборот против ТЗ. `maze-door` одна на открытую и запертую дверь: после загрузки листа разница 🔓/🚪 пропадает (`Maze.tsx:173`).
- **П3 · другое** — У `Icon` нет размера: 14 кеглей в CSS от 12 до 38 px без шкалы. Многоцветный значок не перекрашивается: у активной кнопки навигации меняется только цвет подписи (`styles.css:282`).
- **П3 · непоследовательность** — Второй набор значков в предыстории (`src/prologue/icons.tsx`): 24-сетка, одноцветный `currentColor`. Это другой стиль, чем у многоцветного листа на 32-сетке.
- **П3 · непоследовательность** — 👣 значит и разведчика, и разведку, и отряд мира (`world/data/units.ts:32`), и пустое место агента. ⚙️ — и настройки (`RealmMenu.tsx:101`), и запасной у железа (`constants.ts:362`).
- **П3 · другое** — Приставка `gear-` занята снаряжением (`registry.ts:65`): значок настроек придётся назвать `ui-settings`.
- **П3 · другое** — `assets-src/icons/REVIEW.md:6` устарел: там «84 значка из 84», а в листе 184.

Итого: П1 — 6, П2 — 11, П3 — 9.

## Сводка зоны
- Лист готов и в одном стиле: 184 многоцветных плоских значка на 32-сетке, только `fill`, без обводок, тёплая коричнево-охристая палитра, свет с 11 часов. Весит 12.8 КБ по сети.
- Подключён он наполовину. Рисунок стоит в 117 вызовах `Icon`, а голых эмодзи в интерфейсе 315 строк. Ещё около 40 мест выводят `{x.icon}` из данных мимо `Icon`. Часто это вещь, у которой рисунок уже есть: договоры, налоги, ресурсы, золото, мораль, дом, поход.
- Главная путаница смысла — ⚔️ (больше десяти значений). За ним идут 💰 (золото, налог, дань, грабёж, жалованье), 🔨 и ⛺. Знаки ♦ алмазов и ◆ очков правителя почти одинаковы.
- В строке тревог и в кнопках карты, то есть в постоянных частях экрана, рисунков меньше всего. Для «закрыть», «назад», «i», настроек, прироста и убыли, замка и галочки, очков трёх ветвей и пяти вкладок державы значков нет вовсе.
- Четыре голых эмодзи версии 13.0 (🪙 🪟 🪨 🪃) на части телефонов рисуются квадратом.
- Подсказки по долгому нажатию нет: `title` есть только на десктопе, и `Icon` его ни разу не получает. Без этого переход на «значки без подписей» объяснять нечем.
- Перед переделкой нужно: подключить нарисованные пары; дорисовать 9 ждущих имён и ~15 новых (закрыть, назад, инфо, настройки, прирост, убыль, замок, сделано, три вида очков, вкладки державы, лупа, поход); строки-склейки `.join` перевести на компоненты; завести шкалу размеров значков.
