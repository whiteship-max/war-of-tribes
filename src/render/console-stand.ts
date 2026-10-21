// Стенд ролика из записи консоли (`npm run replay`, docs/handbook/console.md, «Ролик»): `?replay=file&file=/snaps/console/x.json`.
// Запись кладут консольные команды (`scripts/console/lib.saveRecord`): бой — запись боя мира (`BattleRecord`), её играет
// ролик боя (ГФ-1, `TwReplay`); осада — запись осады донесения (`Report.siege`), её играет ролик осады (ГФ-2,
// `SiegeReplay`). Свой кусок, в игру не едет — как и прочие стенды `?replay=`.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { BattleRecord, Report } from '@/world/types';
import type { SiegeRecord } from '@/world/siegerecord';

type FileRecord = { kind: 'battle'; title: string; rec: BattleRecord } | { kind: 'siege'; title: string; rec: SiegeRecord; report: Report };

export async function mountFileStand(p: URLSearchParams): Promise<void> {
  const root = document.getElementById('root') ?? document.body;
  const file = p.get('file') ?? '/snaps/console/last.json';
  const say = (text: string): void => {
    root.textContent = text;
    root.style.cssText = 'padding:16px;font:14px/1.4 ui-monospace,monospace;color:#f4efe4;background:#1c1914;min-height:100vh';
  };
  let data: FileRecord;
  try {
    const res = await fetch(file, { cache: 'no-store' });
    if (!res.ok) return say(`Записи ${file} нет (${res.status}). Её кладут консольные команды: npm run fight -- … --watch.`);
    data = (await res.json()) as FileRecord;
  } catch (e) {
    return say(`Запись ${file} не прочиталась: ${(e as Error).message}`);
  }
  document.title = data.title;
  // Ролик кончился и закрыт — тот же ролик заново: стенд показывает одну запись.
  const again = (): void => location.reload();
  if (data.kind === 'siege') {
    const { SiegeReplay } = await import('@/ui/battle/SiegeReplay');
    createRoot(root).render(createElement(SiegeReplay, { rec: data.rec, report: data.report, clip: null, onDone: again }));
  } else {
    const { TwReplay } = await import('@/ui/battle/TwReplay');
    createRoot(root).render(createElement(TwReplay, { rec: data.rec, onDone: again }));
  }
  const ready = (): void => {
    if (!document.querySelector('.replay-tw canvas, .replay-siege canvas, .canvas-wrap canvas')) return void setTimeout(ready, 200);
    document.body.dataset.replay = JSON.stringify({ file, kind: data.kind });
  };
  setTimeout(ready, 600);
}
