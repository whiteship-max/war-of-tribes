type StoredOrder={id:string;state:string;at:number;until:number};const KEEP=20;const PAY_LATE_MS=7*24*3600_000;
const open = (o: StoredOrder, now: number): boolean => (o.state === 'created' || o.state === 'waiting') && now <= o.until;
/** Перевод этого заказа ещё ищем в сети. */
const hunted = (o: StoredOrder, now: number): boolean =>
  (o.state === 'created' || o.state === 'waiting' || o.state === 'expired') && now - o.at <= PAY_LATE_MS;

/** Обрезка: открытые и оплаченные-неначисленные остаются, вытесняются старые закрытые. */
function trimmed(orders: StoredOrder[], now: number): StoredOrder[] {
  if (orders.length <= KEEP) return orders;
  const keep = new Set(orders.filter((o) => open(o, now) || o.state === 'paid' || (hunted(o, now) && o.state !== 'expired')).map((o) => o.id));
  const rest = orders.filter((o) => !keep.has(o.id));
  const drop = new Set(rest.slice(0, orders.length - KEEP).map((o) => o.id));
  return orders.filter((o) => !drop.has(o.id));
}
export {trimmed};
