import { createHmac, timingSafeEqual } from 'node:crypto';

/** A comment or DM from a webhook or the poller, in one shape. */
export type IgEvent =
  | { kind: 'comment'; id: string; text: string; mediaId: string | null; fromId: string; fromUsername: string | null; createdAt: Date | null }
  | { kind: 'dm'; id: string; text: string; fromId: string; fromUsername: null; createdAt: Date | null };

/** `X-Hub-Signature-256: sha256=<hex HMAC of the raw body with the app secret>` */
export function verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!appSecret || !header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

interface WebhookBody {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    changes?: Array<{
      field?: string;
      value?: { id?: string; text?: string; media?: { id?: string }; from?: { id?: string; username?: string } };
    }>;
    messaging?: Array<{
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: { mid?: string; text?: string; is_echo?: boolean; is_deleted?: boolean };
    }>;
  }>;
}

/** Comments and incoming text DMs; echoes of our own messages and anything from the account itself are dropped. */
export function parseWebhook(body: unknown, ownIds: ReadonlySet<string>): IgEvent[] {
  const payload = body as WebhookBody;
  if (payload?.object !== 'instagram' || !Array.isArray(payload.entry)) return [];
  const events: IgEvent[] = [];
  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      if (change.field !== 'comments' || !v?.id || !v.text || !v.from?.id || ownIds.has(v.from.id)) continue;
      events.push({
        kind: 'comment',
        id: v.id,
        text: v.text,
        mediaId: v.media?.id ?? null,
        fromId: v.from.id,
        fromUsername: v.from.username ?? null,
        createdAt: entry.time ? new Date(entry.time * 1000) : null,
      });
    }
    for (const m of entry.messaging ?? []) {
      const msg = m.message;
      const from = m.sender?.id;
      if (!msg?.mid || !msg.text || msg.is_echo || msg.is_deleted || !from || ownIds.has(from)) continue;
      events.push({ kind: 'dm', id: msg.mid, text: msg.text, fromId: from, fromUsername: null, createdAt: m.timestamp ? new Date(m.timestamp) : null });
    }
  }
  return events;
}

/** Whole-word, case-insensitive: "link" matches "Link pls 😍" and "LINK!" but not "linked". */
export function matchesKeyword(text: string, keyword: string): boolean {
  const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const needle = norm(keyword);
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, 'u').test(norm(text));
}

/** Pulls the keyword out of a CTA like "Comment LINK and I'll DM you the link". */
export function keywordFromCta(cta: string): string | null {
  const m = /comment\s+["“'‘]?([\p{L}\p{N}_-]{2,40})/iu.exec(cta);
  return m ? m[1]! : null;
}

/** HMAC for a time-limited public link to a render file, so Instagram can fetch final.mp4. */
export function mediaSignature(secret: string, renderId: string, file: string, expires: number): string {
  return createHmac('sha256', secret).update(`${renderId}:${file}:${expires}`).digest('base64url').slice(0, 32);
}

export function verifyMediaSignature(secret: string, renderId: string, file: string, expires: number, sig: string, now = Date.now()): boolean {
  if (!secret || !Number.isFinite(expires) || expires * 1000 < now) return false;
  const expected = Buffer.from(mediaSignature(secret, renderId, file, expires));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
