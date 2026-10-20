import { describe, expect, it } from 'vitest';
import { GraphClient, GraphError } from './graph';

function fake(response: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(response), { status });
  }) as unknown as typeof fetch;
  const client = new GraphClient({ apiUrl: 'https://graph.instagram.com', version: 'v26.0', token: 'TOKEN', fetchImpl });
  return { client, calls };
}

describe('GraphClient', () => {
  it('sends a private reply to the comment with the bearer token', async () => {
    const { client, calls } = fake({ recipient_id: 'u1', message_id: 'mid' });
    await client.privateReply('c1', 'Here you go');
    expect(calls[0]!.url).toBe('https://graph.instagram.com/v26.0/me/messages');
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer TOKEN');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ recipient: { comment_id: 'c1' }, message: { text: 'Here you go' } });
  });

  it('creates a Reel container from a public video URL', async () => {
    const { client, calls } = fake({ id: 'container' });
    await client.createReelContainer('17841', { videoUrl: 'https://x/final.mp4', caption: 'hi', shareToFeed: true, coverUrl: 'https://x/cover.jpg' });
    expect(calls[0]!.url).toBe('https://graph.instagram.com/v26.0/17841/media');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      media_type: 'REELS',
      video_url: 'https://x/final.mp4',
      caption: 'hi',
      share_to_feed: true,
      cover_url: 'https://x/cover.jpg',
    });
  });

  it('refreshes the token without a version or auth header', async () => {
    const { client, calls } = fake({ access_token: 'NEW', expires_in: 5_184_000 });
    await expect(client.refreshToken()).resolves.toEqual({ access_token: 'NEW', expires_in: 5_184_000 });
    expect(calls[0]!.url).toBe('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=TOKEN');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('flattens replies into the comment list', async () => {
    const { client } = fake({
      data: [{ id: 'c1', text: 'a', timestamp: 't', replies: { data: [{ id: 'c2', text: 'b', timestamp: 't' }] } }, { id: 'c3', text: 'c', timestamp: 't' }],
    });
    expect((await client.comments('m1')).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('turns Graph errors into GraphError and spots auth problems', async () => {
    const { client } = fake({ error: { message: 'Error validating access token', code: 190 } }, 400);
    const error = await client.me().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GraphError);
    expect((error as GraphError).isAuth).toBe(true);
    expect((error as GraphError).message).toBe('Instagram: Error validating access token');
  });
});
