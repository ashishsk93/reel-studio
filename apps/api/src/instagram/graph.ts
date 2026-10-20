/**
 * Thin client for the Instagram API with Instagram Login (graph.instagram.com).
 * One account, one token; every call is a plain fetch so tests can swap `fetchImpl`.
 */

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
    readonly subcode: number | null,
  ) {
    super(message);
  }

  /** The token is expired, revoked or lacks a permission. */
  get isAuth(): boolean {
    return this.status === 401 || this.code === 190 || this.code === 10 || this.code === 200;
  }
}

export interface GraphComment {
  id: string;
  text: string;
  timestamp: string;
  from?: { id: string; username?: string };
  replies?: { data: GraphComment[] };
}

export interface GraphMedia {
  id: string;
  caption?: string;
  permalink?: string;
  thumbnail_url?: string;
  media_url?: string;
  media_type?: string;
  media_product_type?: string;
  timestamp: string;
}

export interface GraphClientOptions {
  apiUrl: string;
  version: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export class GraphClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GraphClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  me(): Promise<{ id: string; user_id?: string; username: string }> {
    return this.get('/me', { fields: 'user_id,username' });
  }

  /** Long-lived tokens last 60 days; refreshing (allowed once they're a day old) resets that. */
  refreshToken(): Promise<{ access_token: string; expires_in: number }> {
    return this.call('GET', `${this.options.apiUrl}/refresh_access_token`, {
      query: { grant_type: 'ig_refresh_token', access_token: this.options.token },
      auth: false,
    });
  }

  subscribe(fields: string[]): Promise<{ success: boolean }> {
    return this.post('/me/subscribed_apps', undefined, { subscribed_fields: fields.join(',') });
  }

  async recentMedia(limit = 12): Promise<GraphMedia[]> {
    const res = await this.get<{ data: GraphMedia[] }>('/me/media', {
      fields: 'id,caption,permalink,thumbnail_url,media_url,media_type,media_product_type,timestamp',
      limit: String(limit),
    });
    return res.data;
  }

  /** Top-level comments with their replies, newest first. */
  async comments(mediaId: string): Promise<GraphComment[]> {
    const res = await this.get<{ data: GraphComment[] }>(`/${mediaId}/comments`, {
      fields: 'id,text,timestamp,from{id,username},replies{id,text,timestamp,from{id,username}}',
      limit: '50',
    });
    return res.data.flatMap((c) => [c, ...(c.replies?.data ?? [])]);
  }

  /** One DM to the commenter, allowed once per comment within 7 days of it. */
  privateReply(commentId: string, text: string): Promise<{ message_id?: string }> {
    return this.post('/me/messages', { recipient: { comment_id: commentId }, message: { text } });
  }

  replyToComment(commentId: string, text: string): Promise<{ id: string }> {
    return this.post(`/${commentId}/replies`, { message: text });
  }

  comment(mediaId: string, text: string): Promise<{ id: string }> {
    return this.post(`/${mediaId}/comments`, { message: text });
  }

  createReelContainer(igUserId: string, input: { videoUrl: string; caption: string; shareToFeed: boolean; coverUrl?: string }): Promise<{ id: string }> {
    return this.post(`/${igUserId}/media`, {
      media_type: 'REELS',
      video_url: input.videoUrl,
      caption: input.caption,
      share_to_feed: input.shareToFeed,
      ...(input.coverUrl ? { cover_url: input.coverUrl } : {}),
    });
  }

  /** status_code: IN_PROGRESS | FINISHED | ERROR | EXPIRED | PUBLISHED */
  containerStatus(containerId: string): Promise<{ status_code?: string; status?: string }> {
    return this.get(`/${containerId}`, { fields: 'status_code,status' });
  }

  publish(igUserId: string, containerId: string): Promise<{ id: string }> {
    return this.post(`/${igUserId}/media_publish`, { creation_id: containerId });
  }

  media(mediaId: string): Promise<GraphMedia> {
    return this.get(`/${mediaId}`, { fields: 'id,caption,permalink,timestamp' });
  }

  private get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    return this.call('GET', this.url(path), { query });
  }

  private post<T>(path: string, body?: unknown, query: Record<string, string> = {}): Promise<T> {
    return this.call('POST', this.url(path), { query, body });
  }

  private url(path: string): string {
    return `${this.options.apiUrl}/${this.options.version}${path}`;
  }

  private async call<T>(method: string, base: string, opts: { query?: Record<string, string>; body?: unknown; auth?: boolean }): Promise<T> {
    const qs = new URLSearchParams(opts.query ?? {}).toString();
    const headers: Record<string, string> = {};
    if (opts.auth !== false) headers.authorization = `Bearer ${this.options.token}`;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.fetchImpl(qs ? `${base}?${qs}` : base, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: { message: text.slice(0, 200) } };
    }
    const error = (data as { error?: { message?: string; code?: number; error_subcode?: number } }).error;
    if (!res.ok || error) {
      throw new GraphError(
        `Instagram: ${error?.message ?? res.statusText}`,
        res.status,
        error?.code ?? null,
        error?.error_subcode ?? null,
      );
    }
    return data as T;
  }
}
