"""Вшивает лист значков проекта в макеты: public/assets/icons/sprite.svg -> docs/ui_mockups/assets/sprite.js.

Макеты открываются с диска, а страница, открытая как файл, не получает внешний SVG через <use href="file.svg#id">.
Поэтому лист кладётся в документ скриптом, и <use href="#i-<имя>"/> работает как в игре.
Запуск из корня репозитория: python docs/ui_mockups/assets/build_sprite.py
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[3]
src = (ROOT / "public/assets/icons/sprite.svg").read_text(encoding="utf-8")
inner = re.sub(r"^<svg[^>]*>", "", src).rsplit("</svg>", 1)[0]
js = (
    "// Лист значков проекта (public/assets/icons/sprite.svg), вшитый для макетов: <use href=\"#i-<имя>\"/>.\n"
    "// Пересобрать: python docs/ui_mockups/assets/build_sprite.py\n"
    "(function(){var d=document.createElement('div');d.style.display='none';"
    "d.innerHTML='<svg xmlns=\"http://www.w3.org/2000/svg\">'+" + json.dumps(inner, ensure_ascii=False) + "+'</svg>';"
    "(document.body||document.documentElement).prepend(d);})();\n"
)
out = ROOT / "docs/ui_mockups/assets/sprite.js"
out.write_text(js, encoding="utf-8", newline="\n")
print(out, len(js), "bytes,", len(re.findall(r"<symbol ", inner)), "icons")
