# Свои шрифты игры: подмножества знаков в WOFF2 (docs/polish.md, П-1).
#
# Гарнитур две, обе — SIL Open Font License 1.1 (assets-src/fonts/SOURCES.md):
#   - «Tribe Sans» — Golos Text, переменный вес 400…900: основной текст, числа, кнопки. Рисован под кириллицу
#     и экран, цифры одной ширины (`tnum`) есть — столбцы таблиц ровные;
#   - «Tribe Title» — Alegreya SC Bold: заголовки окон и имя игры, капитель с пером эпохи, но без готики —
#     читается и в 15 px.
#
# Знаки — то, что пишет игра: латиница и Latin-1 (кавычки «», точка ·, знак ×, градус), кириллица с ё и
# украинскими і ї є ґ (имена игроков из Telegram), тире, многоточие, стрелки, минус, ≈ ≤ ≥, №, ударение.
# Эмодзи в шрифт не идут — их рисует система (CLAUDE.md, «Правила»: эмодзи — иконки).
#
# Кроме двух .woff2 скрипт пишет `src/ui/fonts/glyphs.ts` — какие кодовые точки в каждом шрифте есть на самом
# деле: по нему тест `fonts.test.ts` проверяет, что буквы и знаки из текстов игры не уходят в системную подмену.
# Руками тот файл не правят.
#
# Запуск: `npm run fonts:build` (нужны Python 3 и `pip install fonttools brotli`).
import os
import shutil
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets-src', 'fonts')
OUT = os.path.join(ROOT, 'public', 'fonts')
GLYPHS = os.path.join(ROOT, 'src', 'ui', 'fonts', 'glyphs.ts')
CSS = os.path.join(ROOT, 'src', 'ui', 'fonts', 'fonts.css')

# Диапазоны знаков (включительно).
RANGES = [
    (0x0020, 0x007E),  # ASCII
    (0x00A0, 0x00FF),  # Latin-1: неразрывный пробел, « » · × ° ± ² ½ и буквы с надстрочными
    (0x0301, 0x0301),  # ударение
    (0x0400, 0x045F),  # кириллица целиком, с ё, і, ї, є, ў
    (0x0490, 0x0491),  # Ґ ґ
    (0x2009, 0x200A),  # тонкие пробелы
    (0x2010, 0x2027),  # дефисы, тире, кавычки „“ ‘’, многоточие, точка-маркер
    (0x202F, 0x202F),  # узкий неразрывный пробел (разряды Intl)
    (0x2030, 0x2030),  # ‰
    (0x2032, 0x2033),  # ′ ″
    (0x2039, 0x203A),  # ‹ ›
    (0x20AC, 0x20AC),  # €
    (0x20BD, 0x20BD),  # ₽
    (0x2116, 0x2116),  # №
    (0x2190, 0x2195),  # стрелки
    (0x2212, 0x2212),  # минус
    (0x2248, 0x2248),  # ≈
    (0x2260, 0x2260),  # ≠
    (0x2264, 0x2265),  # ≤ ≥
]

# Ядро — то, что пишет почти каждый экран: ASCII, русская кириллица, кавычки, тире, многоточие, стрелка, минус.
# Остальное (буквы Latin-1 с надстрочными, украинские и белорусские буквы, редкие знаки) — вторым файлом:
# браузер берёт его по `unicode-range`, только когда такой знак правда есть на экране.
CORE = sorted(set(
    list(range(0x0020, 0x007F))
    + [0x00A0, 0x00A9, 0x00AB, 0x00B0, 0x00B1, 0x00B2, 0x00B7, 0x00BB, 0x00BC, 0x00BD, 0x00BE, 0x00D7]
    + [0x0401, 0x0451] + list(range(0x0410, 0x0450))
    + [0x2009, 0x202F, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x201E, 0x2022, 0x2026, 0x2039, 0x203A]
    + [0x2116, 0x2190, 0x2192, 0x2212, 0x2248, 0x2264, 0x2265]
))

# Признаки раскладки: все, что есть в шрифте (kern, liga, calt, locl, tnum — цифры одной ширины, case…).
FEATURES = ['*']

# Основной текст — статичными начертаниями, по файлу на вес: браузер качает только те веса, что на экране,
# и каждое начертание ядра — около 11 КБ, а переменный шрифт целиком — 37 (замер — docs/polish.md, П-1).
SANS_SRC = 'GolosText[wght].ttf'
SANS_WEIGHTS = [400, 500, 600, 700, 800]
TITLE_SRC = 'AlegreyaSC-Bold.ttf'
# Что ждёт первая загрузка (`<link rel=preload>` в index.html): обычный текст и полужирный кнопок и чисел.
PRELOAD = ['sans-400.woff2', 'sans-600.woff2']


def wanted():
    out = []
    for a, b in RANGES:
        out.extend(range(a, b + 1))
    return out


def options():
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = FEATURES
    opts.hinting = False
    opts.desubroutinize = True
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]  # права и лицензия остаются в файле (OFL, пункт 2)
    opts.notdef_outline = True
    return opts


def load(src, weight=None):
    font = TTFont(os.path.join(SRC, src), lazy=False)
    if weight is not None and 'fvar' in font:
        font = instancer.instantiateVariableFont(font, {'wght': weight})
    return font


def write(font, uni, dst):
    opts = options()
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=uni)
    sub.subset(font)
    subset.save_font(font, os.path.join(OUT, dst), opts)
    have = sorted(TTFont(os.path.join(OUT, dst)).getBestCmap().keys())
    print(f'{dst}: {len(have)} знаков, {os.path.getsize(os.path.join(OUT, dst))} байт')
    return have


def ranges_of(points):
    out = []
    for p in points:
        if out and out[-1][1] == p - 1:
            out[-1][1] = p
        else:
            out.append([p, p])
    return out


def unicode_range(points):
    parts = []
    for a, b in ranges_of(points):
        parts.append(f'U+{a:04X}' if a == b else f'U+{a:04X}-{b:04X}')
    return ', '.join(parts)


def face(family, weight, url, points):
    return '\n'.join([
        '@font-face {',
        f"  font-family: '{family}';",
        '  font-style: normal;',
        f'  font-weight: {weight};',
        '  font-display: swap;',
        f"  src: url('/fonts/{url}') format('woff2');",
        f'  unicode-range: {unicode_range(points)};',
        '}',
    ])


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.dirname(GLYPHS), exist_ok=True)
    every = wanted()
    ext_wanted = [p for p in every if p not in set(CORE)]
    faces = []
    cover = {}
    jobs = [('Tribe Sans', SANS_SRC, w, f'sans-{w}') for w in SANS_WEIGHTS] + [('Tribe Title', TITLE_SRC, 700, 'title')]
    for family, src, weight, stem in jobs:
        core = write(load(src, weight), CORE, f'{stem}.woff2')
        ext = write(load(src, weight), ext_wanted, f'{stem}-ext.woff2')
        ext = [p for p in ext if p not in set(core)]
        faces.append(face(family, weight, f'{stem}.woff2', core))
        if ext:
            faces.append(face(family, weight, f'{stem}-ext.woff2', ext))
        cover.setdefault(family, set()).update(core, ext)

    css = [
        '/*',
        ' * Свои шрифты игры — собрано `npm run fonts:build` (scripts/build-fonts.py), руками не править.',
        ' * Ядро и редкие знаки — разными файлами: второй качается, только когда его знак есть на экране.',
        ' */',
        '',
        '\n\n'.join(faces),
        '',
    ]
    with open(CSS, 'w', encoding='utf8') as f:
        f.write('\n'.join(css))

    names = {'Tribe Sans': 'SANS', 'Tribe Title': 'TITLE'}
    lines = [
        '// Собрано `npm run fonts:build` (scripts/build-fonts.py) — руками не править.',
        '// Кодовые точки, которые есть в своих шрифтах игры: [от, до] включительно.',
        '',
    ]
    for family, points in cover.items():
        body = ', '.join(f'[0x{a:04x}, 0x{b:04x}]' for a, b in ranges_of(sorted(points)))
        lines.append(f'/** «{family}». */')
        lines.append(f'export const {names[family]}: ReadonlyArray<readonly [number, number]> = [{body}];')
        lines.append('')
    lines.append('/** Файлы, которые ждёт первая загрузка (`<link rel=preload>` в index.html). */')
    lines.append('export const PRELOAD: readonly string[] = [' + ', '.join(f"'/fonts/{p}'" for p in PRELOAD) + '];')
    lines.append('')
    with open(GLYPHS, 'w', encoding='utf8') as f:
        f.write('\n'.join(lines))

    # Для сравнения (docs/polish.md, П-1, «Решения», 5): ядро тем же набором знаков, но переменным шрифтом одним файлом.
    var = load(SANS_SRC)
    opts = options()
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=CORE)
    sub.subset(var)
    probe = os.path.join(OUT, '.variable-probe.woff2')
    subset.save_font(var, probe, opts)
    print(f'для сравнения: ядро переменным шрифтом — {os.path.getsize(probe)} байт (не выкладывается)')
    os.remove(probe)

    # Лицензия едет рядом со шрифтом (OFL, пункт 2).
    for lic in ('OFL-GolosText.txt', 'OFL-AlegreyaSC.txt'):
        shutil.copyfile(os.path.join(SRC, lic), os.path.join(OUT, lic))
    return 0


if __name__ == '__main__':
    sys.exit(main())
