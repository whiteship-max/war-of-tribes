// Файл сгенерирован scripts/slice-avatars.mjs — руками не править.
// Перегенерировать: node scripts/slice-avatars.mjs
//
// Исходные листы лежат в assets-src/avatars/ и в клиент не уходят: в сборку
// попадает только public/assets/avatars/.
//
//   card — карточка целиком, 263×384, для экрана выбора;
//   face — голова и плечи, 128×128, туда, где аватар меньше ~64 px.

export type AvatarId =
  | '01_swordsman'
  | '02_spearman'
  | '03_archer'
  | '04_cavalry_knight'
  | '05_female_archer'
  | '06_female_swordswoman'
  | '07_blacksmith'
  | '08_healer'
  | '09_crossbowman'
  | '10_heavy_knight'
  | '11_halberdier'
  | '12_king'
  | '13_queen'
  | '14_female_cavalry'
  | '15_female_crossbow'
  | '16_monk'
  | '17_duke'
  | '18_duchess'
  | '19_axeman'
  | '20_guard_captain'
  | '21_female_spearman'
  | '22_noblewoman'
  | '23_merchant'
  | '24_innkeeper'

export interface Avatar {
  id: AvatarId
  /** Имя для интерфейса. */
  name: string
  /** Карточка целиком. */
  card: string
  /** Квадрат по голове и плечам. */
  face: string
}

export const AVATARS: readonly Avatar[] = [
  {
    id: '01_swordsman',
    name: 'Мечник',
    card: '/assets/avatars/01_swordsman_card.webp',
    face: '/assets/avatars/01_swordsman_face.webp',
  },
  {
    id: '02_spearman',
    name: 'Копейщик',
    card: '/assets/avatars/02_spearman_card.webp',
    face: '/assets/avatars/02_spearman_face.webp',
  },
  {
    id: '03_archer',
    name: 'Лучник',
    card: '/assets/avatars/03_archer_card.webp',
    face: '/assets/avatars/03_archer_face.webp',
  },
  {
    id: '04_cavalry_knight',
    name: 'Конный рыцарь',
    card: '/assets/avatars/04_cavalry_knight_card.webp',
    face: '/assets/avatars/04_cavalry_knight_face.webp',
  },
  {
    id: '05_female_archer',
    name: 'Лучница',
    card: '/assets/avatars/05_female_archer_card.webp',
    face: '/assets/avatars/05_female_archer_face.webp',
  },
  {
    id: '06_female_swordswoman',
    name: 'Мечница',
    card: '/assets/avatars/06_female_swordswoman_card.webp',
    face: '/assets/avatars/06_female_swordswoman_face.webp',
  },
  {
    id: '07_blacksmith',
    name: 'Кузнец',
    card: '/assets/avatars/07_blacksmith_card.webp',
    face: '/assets/avatars/07_blacksmith_face.webp',
  },
  {
    id: '08_healer',
    name: 'Травница',
    card: '/assets/avatars/08_healer_card.webp',
    face: '/assets/avatars/08_healer_face.webp',
  },
  {
    id: '09_crossbowman',
    name: 'Арбалетчик',
    card: '/assets/avatars/09_crossbowman_card.webp',
    face: '/assets/avatars/09_crossbowman_face.webp',
  },
  {
    id: '10_heavy_knight',
    name: 'Латник',
    card: '/assets/avatars/10_heavy_knight_card.webp',
    face: '/assets/avatars/10_heavy_knight_face.webp',
  },
  {
    id: '11_halberdier',
    name: 'Алебардист',
    card: '/assets/avatars/11_halberdier_card.webp',
    face: '/assets/avatars/11_halberdier_face.webp',
  },
  {
    id: '12_king',
    name: 'Король',
    card: '/assets/avatars/12_king_card.webp',
    face: '/assets/avatars/12_king_face.webp',
  },
  {
    id: '13_queen',
    name: 'Королева',
    card: '/assets/avatars/13_queen_card.webp',
    face: '/assets/avatars/13_queen_face.webp',
  },
  {
    id: '14_female_cavalry',
    name: 'Всадница',
    card: '/assets/avatars/14_female_cavalry_card.webp',
    face: '/assets/avatars/14_female_cavalry_face.webp',
  },
  {
    id: '15_female_crossbow',
    name: 'Арбалетчица',
    card: '/assets/avatars/15_female_crossbow_card.webp',
    face: '/assets/avatars/15_female_crossbow_face.webp',
  },
  {
    id: '16_monk',
    name: 'Монах',
    card: '/assets/avatars/16_monk_card.webp',
    face: '/assets/avatars/16_monk_face.webp',
  },
  {
    id: '17_duke',
    name: 'Герцог',
    card: '/assets/avatars/17_duke_card.webp',
    face: '/assets/avatars/17_duke_face.webp',
  },
  {
    id: '18_duchess',
    name: 'Герцогиня',
    card: '/assets/avatars/18_duchess_card.webp',
    face: '/assets/avatars/18_duchess_face.webp',
  },
  {
    id: '19_axeman',
    name: 'Топорник',
    card: '/assets/avatars/19_axeman_card.webp',
    face: '/assets/avatars/19_axeman_face.webp',
  },
  {
    id: '20_guard_captain',
    name: 'Капитан стражи',
    card: '/assets/avatars/20_guard_captain_card.webp',
    face: '/assets/avatars/20_guard_captain_face.webp',
  },
  {
    id: '21_female_spearman',
    name: 'Копейщица',
    card: '/assets/avatars/21_female_spearman_card.webp',
    face: '/assets/avatars/21_female_spearman_face.webp',
  },
  {
    id: '22_noblewoman',
    name: 'Знатная дама',
    card: '/assets/avatars/22_noblewoman_card.webp',
    face: '/assets/avatars/22_noblewoman_face.webp',
  },
  {
    id: '23_merchant',
    name: 'Торговец',
    card: '/assets/avatars/23_merchant_card.webp',
    face: '/assets/avatars/23_merchant_face.webp',
  },
  {
    id: '24_innkeeper',
    name: 'Трактирщица',
    card: '/assets/avatars/24_innkeeper_card.webp',
    face: '/assets/avatars/24_innkeeper_face.webp',
  },
]
