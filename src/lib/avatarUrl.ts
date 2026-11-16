import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/**
 * Profile photos live in the private "avatars" bucket. The database still stores the old public-style
 * address; we take the file path from it and ask for a short-lived signed link (staff only, by policy).
 */
const MARK = '/storage/v1/object/public/avatars/';
const cache = new Map<string, { url: string; until: number }>();
const pending = new Map<string, Promise<string | null>>();

export function avatarPath(src: string | null | undefined): string | null {
  if (!src) return null;
  const i = src.indexOf(MARK);
  if (i < 0) return null;
  return decodeURIComponent(src.slice(i + MARK.length).split('?')[0]);
}

async function sign(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  if (!pending.has(path)) {
    pending.set(path, (async () => {
      try {
        const { data, error } = await supabase.storage.from('avatars').createSignedUrl(path, 3600);
        if (error || !data?.signedUrl) return null;
        cache.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60 * 1000 });
        return data.signedUrl;
      } catch { return null; } finally { pending.delete(path); }
    })());
  }
  return pending.get(path)!;
}

/** The address to show for a stored photo: a signed link for our bucket, the value itself otherwise. */
export function useAvatarSrc(src: string | null | undefined): string | null {
  const path = avatarPath(src);
  const [url, setUrl] = useState<string | null>(() => (path ? cache.get(path)?.url ?? null : src || null));
  useEffect(() => {
    if (!path) { setUrl(src || null); return; }
    let alive = true;
    void sign(path).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [path, src]);
  return url;
}
