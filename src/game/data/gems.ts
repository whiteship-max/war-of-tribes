/**
 * Наборы алмазов для «Сокровищницы» (docs/gems.md). Решение владельца 09.10.2026: оплата — **USDT в сети TON**, через
 * кошелёк TON (TON Connect); никаких Telegram Stars. Оплаты пока нет: окно показывает наборы и кнопки «Подключить
 * кошелёк» и «Купить», а по нажатию говорит «Покупка скоро». Библиотеку кошелька не подключаем до настоящей оплаты.
 *
 * Когда оплата появится: счёт на `usdt` уходит в кошелёк игрока, сервер проверяет перевод в сети TON и начисляет набор
 * одной дверью — `netlify/lib/gems.creditGems` с источником `purchase` и номером перевода как ключом. Ни одна кнопка
 * интерфейса алмазы не начисляет и начислять не сможет.
 *
 * Числа — данные дизайна (решение 4 docs/gems.md): сотня алмазов за доллар — опорная цена; крупные наборы дают сверху
 * десятую и пятую часть. Выгода считается от первого набора, руками не пишется.
 */
export interface GemPack {
  id: string;
  name: string;
  icon: string;
  /** Сколько алмазов в наборе. */
  amount: number;
  /** Цена в USDT (сеть TON). */
  usdt: number;
}

export const GEM_PACKS: readonly GemPack[] = [
  { id: 'handful', name: 'Горсть', icon: '♦️', amount: 100, usdt: 1 },
  { id: 'pouch', name: 'Кошель', icon: '👝', amount: 550, usdt: 5 },
  { id: 'chest', name: 'Сундук', icon: '🧰', amount: 1200, usdt: 10 },
];

/** Алмазов за доллар — по нему видно, что выгоднее. */
export const packRate = (p: GemPack): number => p.amount / p.usdt;

/** Сколько процентов сверху против первого набора: 0, 10, 20. */
export const packBonus = (p: GemPack): number => Math.round((packRate(p) / packRate(GEM_PACKS[0]) - 1) * 100);

/** Сеть и монета оплаты — одной строкой для окна. */
export const PAY_WITH = 'USDT · TON';
