// Упаковка разметки регионов тем же способом, что и атлас (`world/atlas/atlas.ts`): прогоны «значение,
// длина» — длина байтом до 253, иначе 254 и два байта, — и base64. Подпись — FNV-1a по распакованному:
// разметка, распаковавшаяся не в ту сторону, дала бы не сбой, а чужие регионы под теми же клетками.

export function pack(cells: Uint8Array): string {
  const out: number[] = [];
  let i = 0;
  while (i < cells.length) {
    const v = cells[i];
    let run = 1;
    while (i + run < cells.length && cells[i + run] === v && run < 65535) run++;
    out.push(v);
    if (run <= 253) out.push(run);
    else out.push(254, run & 255, run >> 8);
    i += run;
  }
  let bin = '';
  for (const b of out) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function unpack(text: string, total: number): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(total);
  let read = 0;
  let write = 0;
  while (write < total && read < bin.length) {
    const value = bin.charCodeAt(read++);
    let run = bin.charCodeAt(read++);
    if (run === 254) {
      run = bin.charCodeAt(read) | (bin.charCodeAt(read + 1) << 8);
      read += 2;
    }
    const end = Math.min(total, write + run);
    out.fill(value, write, end);
    write = end;
  }
  if (write !== total) throw new Error(`Регионы: распаковалось ${write} клеток из ${total}.`);
  return out;
}

export function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
