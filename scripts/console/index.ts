// `npm run console` — оглавление консольных команд (docs/handbook/console.md): что есть и с чего начать.
console.log(`Консоль боёв и сценариев — справочник с рецептами: docs/handbook/console.md. У каждой команды — --help.

  npm run fight -- --a spearman:120,archer:60 --d legionary:80 --runs 40
        бой двух сторон ядром: место, стена, отметки, сиды → исход, потери, ход по фазам, доля побед с разбросом
  npm run gate -- --level 5 --wolves 420          волки или разбойники у ворот посёлка мерки
  npm run raid -- --level 8 --runs 100            набег логова у стены (сухой прогон); --live — настоящий мир до конца
  npm run siege -- --level 8 --power 3000         осада своего города фазами: кость, проломы, машины, кольцо, голод
  npm run camp -- --level 8 --power 3000 --sortie legionary:30   удар по лагерю: вылазка или полководец из поля
  npm run intercept -- --level 8 --power 2000     перехват набега в поле
  npm run march                                    режим марша: правила и таблица по длинам пути (срок, убыль, лагерь, энергия)
  npm run sweep -- garrison --level 5 --wolves 450               перебор таблицей: стая, гарнизон, мощь, ширина
  npm run replay                                   ролик последнего боя или осады в браузере
  npm run derive -- w --write                      вывод W и таблицы у ворот (неподвижная точка, правило 16)
  npm run speed                                    замер скорости прогонов с отпечатком итогов`);
process.exit(0);
