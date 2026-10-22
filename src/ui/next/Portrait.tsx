// Портрет советника в окне (РТ-1): картинку рисует набор персонажа своим куском (`render/chambers/advisor/portrait`), по
// одной за раз и с передышкой — окно не замирает, пока рисуются четыре просителя. Готовые живут в памяти страницы. Пока
// портрета нет (кусок едет, WebGL нет) — силуэт в той же рамке, и раскладка окна не прыгает.
import { useEffect, useState } from 'react';
import type { AdvisorPost } from '@/game/types';

const ready = new Map<string, string>();
const asked = new Map<string, Promise<string | null>>();
let line: Promise<unknown> = Promise.resolve();

const keyOf = (seed: number, age: number, post: AdvisorPost): string => `${post}:${seed >>> 0}:${Math.floor(age)}`;

/** Встать в очередь рисования: следующий портрет — после передышки, чтобы касания окна не ждали. */
function ask(seed: number, age: number, post: AdvisorPost): Promise<string | null> {
  const key = keyOf(seed, age, post);
  const had = asked.get(key);
  if (had) return had;
  const job = line
    .then(() => new Promise<void>((r) => setTimeout(r, 16)))
    .then(() => import('@/render/chambers/advisor/portrait'))
    .then((m) => {
      const url = m.paintPortrait(seed, age, post);
      ready.set(key, url);
      return url;
    })
    .catch(() => null);
  line = job;
  asked.set(key, job);
  return job;
}

export function Portrait({ seed, age, post, big = false }: { seed: number; age: number; post: AdvisorPost; big?: boolean }) {
  const key = keyOf(seed, age, post);
  const [url, setUrl] = useState<string | null>(() => ready.get(key) ?? null);
  useEffect(() => {
    const now = ready.get(key);
    if (now) {
      setUrl(now);
      return;
    }
    setUrl(null);
    let live = true;
    void ask(seed, age, post).then((u) => {
      if (live && u) setUrl(u);
    });
    return () => {
      live = false;
    };
  }, [key, seed, age, post]);
  return (
    <span className={`cn-port ${post}${big ? ' big' : ''}`} aria-hidden="true">
      {url ? <img src={url} alt="" draggable={false} /> : <i className="cn-sil" />}
    </span>
  );
}

/** Пустое место — силуэт в рамке должности. */
export function NoPortrait({ post, big = false }: { post: AdvisorPost; big?: boolean }) {
  return (
    <span className={`cn-port ${post} empty${big ? ' big' : ''}`} aria-hidden="true">
      <i className="cn-sil" />
    </span>
  );
}
