# Исходные листы аватаров

**В игре их больше нет** (П-2, docs/polish.md): лицо правителя в профиле заменил герб державы. Листы оставлены как
исходники; нарезка (`scripts/slice-avatars.mjs`), набор `src/data/avatars.ts` и `public/assets/avatars/` удалены коммитом
П-2 — вернуть их можно из истории git.

Три листа, сетка 4×2, порядок чтения — слева направо, сверху вниз.
Каждый лист 1448×1086, то есть одна ячейка ≈ 362×543.

| Файл | Персонажи |
| --- | --- |
| `sheet1.png` | 01_swordsman, 02_spearman, 03_archer, 04_cavalry_knight, 05_female_archer, 06_female_swordswoman, 07_blacksmith, 08_healer |
| `sheet2.png` | 09_crossbowman, 10_heavy_knight, 11_halberdier, 12_king, 13_queen, 14_female_cavalry, 15_female_crossbow, 16_monk |
| `sheet3.png` | 17_duke, 18_duchess, 19_axeman, 20_guard_captain, 21_female_spearman, 22_noblewoman, 23_merchant, 24_innkeeper |

Инструкция заказчика — `avatars_integration_for_claude.docx`.

## Замечание по разрешению

Ячейка ≈ 362×543 px. Голова занимает примерно шестую часть высоты, то есть
исходный «лицевой» фрагмент около 90–110 px. Поэтому:

- карточка (`card`) — 384 px по длинной стороне, это уменьшение, качество нормальное;
- лицевой кроп (`face`) — **128×128**, не больше. 192 будет апскейлом и мылом.

Апскейлить нельзя ни в каком виде: маленький аватар лучше резкий и мелкий,
чем крупный и мыльный.
