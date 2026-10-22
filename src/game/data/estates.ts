// Сословия (РТ-2, docs/stability.md, «РТ-2»): имена, которыми о них говорит симуляция, — летопись, отказ указа, усилители и
// специализация города. Чисел здесь нет (они — `estaterules`); пояснения окна, привилегий и даров — своим куском
// (`data/estateWords.ts`): в первую загрузку они не едут.
import type { EstateId, ResourceId } from '../types';
import type { IconName } from '@/ui/icons/alias';

/** Имя значка набора (docs/icons.md) — с проверкой `tsc`. */
const ico = (name: IconName): IconName => name;

export interface EstateMeta {
  /** Имя сословия: «Купечество». */
  name: string;
  /** Кому: «купечеству». */
  to: string;
  /** Чьё: «купечества». */
  of: string;
  /** Герб — значок набора ЗН-1. */
  icon: IconName;
  /** Специализация города, где сословие держит перевес влияния. */
  city: string;
  /** Привилегии по порядку дарования. */
  priv: readonly [string, string];
  /** Чем сословие берёт дар: золото, крестьяне — хлеб. */
  gift: ResourceId | 'gold';
}

export const ESTATE_META: Readonly<Record<EstateId, EstateMeta>> = {
  merchants: {
    name: 'Купечество',
    to: 'купечеству',
    of: 'купечества',
    icon: ico('est-merchants'),
    city: 'Торговый город',
    priv: ['Торговые пошлины', 'Городское право'],
    gift: 'gold',
  },
  guilds: {
    name: 'Цехи',
    to: 'цехам',
    of: 'цехов',
    icon: ico('est-guilds'),
    city: 'Ремесленный центр',
    priv: ['Цеховая грамота', 'Право клейма'],
    gift: 'gold',
  },
  peasants: {
    name: 'Крестьянство',
    to: 'крестьянству',
    of: 'крестьянства',
    icon: ico('est-peasants'),
    city: 'Житница',
    priv: ['Общинные земли', 'Юрьев день'],
    gift: 'food',
  },
  knights: {
    name: 'Рыцарство',
    to: 'рыцарству',
    of: 'рыцарства',
    icon: ico('est-knights'),
    city: 'Военная цитадель',
    priv: ['Право меча', 'Рыцарский суд'],
    gift: 'gold',
  },
  clergy: {
    name: 'Духовенство',
    to: 'духовенству',
    of: 'духовенства',
    icon: ico('est-clergy'),
    city: 'Святой град',
    priv: ['Церковный суд', 'Неприкосновенность храма'],
    gift: 'gold',
  },
};

/** Город без перевеса. */
export const EVEN_CITY = 'Ровный город';

/** Ступень лояльности словами (пороги EU4 — `estaterules.LOYAL`, `DISLOYAL`). */
export const LOYALTY_WORD = { loyal: 'Верны', wait: 'Выжидают', disloyal: 'Ропщут' } as const;

/** Строки летописи сословий (род `stab`). */
export const ESTATE_LOG = {
  granted: (e: EstateId, priv: string): string => `${ESTATE_META[e].name}: дарована привилегия «${priv}».`,
  revoked: (e: EstateId, priv: string): string => `${ESTATE_META[e].name}: отнята привилегия «${priv}». Обида продержится сезон.`,
  gifted: (e: EstateId): string => `Дар ${ESTATE_META[e].to}: лояльность выше на сезон.`,
  lapsed: (e: EstateId, decree: string): string => `${ESTATE_META[e].name} больше не верно — указ «${decree}» снят.`,
};
