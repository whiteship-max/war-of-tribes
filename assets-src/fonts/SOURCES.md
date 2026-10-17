# Шрифты: откуда и по какой лицензии

Собирает `npm run fonts:build` (`scripts/build-fonts.py`) в `public/fonts/`; разбор — docs/polish.md, П-1.

| Файл | Гарнитура | Откуда | Лицензия |
| --- | --- | --- | --- |
| `GolosText[wght].ttf` | Golos Text, переменный вес 400…900 | https://github.com/google/fonts/tree/main/ofl/golostext (авторы — The Golos Text Project, Paratype) | SIL Open Font License 1.1 — `OFL-GolosText.txt` |
| `AlegreyaSC-Bold.ttf` | Alegreya SC Bold | https://github.com/google/fonts/tree/main/ofl/alegreyasc (авторы — The Alegreya Project, Huerta Tipográfica) | SIL Open Font License 1.1 — `OFL-AlegreyaSC.txt` |

Взяты 16.10.2026. OFL разрешает вшивать шрифт в игру и распространять вместе с ней; условия — текст лицензии едет рядом
(сборка кладёт его в `public/fonts/`, а права и ссылку на лицензию — в сами файлы) и шрифт не продаётся отдельно.
Зарезервированных имён (Reserved Font Name) у обеих нет — первая строка лицензии называет только правообладателя, —
поэтому подмножество знаков сохраняет своё внутреннее имя; в CSS игры гарнитуры зовутся «Tribe Sans» и «Tribe Title».
