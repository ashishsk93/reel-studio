# Instagram: publishing and keyword auto-replies

Reel Studio talks to **your own** Instagram account through the *Instagram API with Instagram Login* (`graph.instagram.com`). It can:

- **Publish** a render as a Reel from the Export step: caption, cover, first comment.
- **Auto-DM per Reel**: each Reel has its own links, so each Reel gets its own DM. When someone comments the keyword on a Reel that has a DM, they get that DM once. The keywords (default `LINK`; a comma-separated list such as `LINK, PRICE`, any one of which triggers the DM) and an optional public "Sent you a DM 💌" reply are shared by every Reel.

The **Instagram** page lists your Reels; set, edit, pause or remove each one's DM there. Reels without a DM are left alone. That suits **Meesho** Reels: the affiliate link only exists once the Reel is up, and Meesho's app does the replying.

Publishing from the Export step sets the new Reel's DM from the project's DM template. For Meesho projects this is off by default.

## What works where

| | Runs on this computer only | Online (`PUBLIC_URL` set) |
|---|---|---|
| Auto-DMs via polling (every 90 s) | ✅ | ✅ |
| Auto-DMs via webhooks (instant) | ❌ | ✅ once the Meta app is **Live** |
| Publishing Reels | ❌ Instagram has to download the video from a public URL | ✅ |

## 1. Account

The Instagram account must be a **Business** or **Creator** account (Instagram app → Settings → Account type and tools). No Facebook Page is needed.

For the DMs to go out, the Instagram app → Settings → Messages and story replies → Message controls → Connected tools → **Allow access to messages** must be on.

## 2. Meta app

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create app** → use case **Manage messaging & content on Instagram** → type **Business**.
2. In the app, open **Instagram → API setup with Instagram login**.
3. Under **App roles → Roles**, add @slayurbansociety as an **Instagram Tester**, then accept the invite in Instagram (Settings → Apps and websites → Tester invites).
4. Back in **API setup with Instagram login**, under **Generate access tokens**, click **Add account**, log in as @slayurbansociety and accept, then **Generate token**. Copy the token.
5. Under **Set up Instagram business login → Business login settings**, copy the **Instagram app secret** into `.env` as `INSTAGRAM_APP_SECRET`.
6. Make sure these permissions are listed (add `instagram_business_content_publish` under **Permissions and features** if it is missing): `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages`, `instagram_business_content_publish`.

Because the app only serves an account you own and have added to it, **Standard Access is enough and App Review isn't needed**.

## 3. Connect

Open **Instagram** in Reel Studio's sidebar and paste the token. The app:

- swaps it for a fresh 60-day token when it can;
- refreshes the token automatically when fewer than 20 days are left;
- subscribes the account to `comments` webhooks.

The token lives in the database (`InstagramAccount`), not in `.env`.

## 4. Webhooks (once the app is online)

1. Set `PUBLIC_URL=https://studio.velra.tech` and any random `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` in `.env`, then restart the API.
2. In the Meta app, open **Instagram → API setup with Instagram login → Configure webhooks**:
   - **Callback URL:** `https://studio.velra.tech/api/instagram/webhook` (also shown on the Instagram page)
   - **Verify token:** the same string as in `.env`
   - Subscribe to the **comments** field.
3. Meta only sends webhooks to apps in **Live** mode. Switching to Live needs a privacy policy URL (any page on velra.tech will do) and the data-deletion fields filled in. Until then, keep **Check comments every 90 seconds** on.

Polling and webhooks can both stay on: each comment is recorded once, so nobody gets two DMs.

## 5. Keep the public paths open

When the app sits behind a login wall (basic auth, Cloudflare Access), two paths must stay public because Meta calls them:

- `/api/instagram/webhook`: checked against `X-Hub-Signature-256` (HMAC with the app secret); unsigned requests get a 403.
- `/api/instagram/media/…`: signed links that expire after 3 hours, and only for `final.mp4`, `cover.jpg` and `cover_titled.jpg` of a render.

## Rules and limits

- **Private replies:** one per comment, within 7 days of the comment.
- **Comments before the DM:** comments made before you set a Reel's DM are answered too, as long as they're under 7 days old. The link often only exists after the Reel is up.
- **Repeat commenters:** someone who comments the keyword twice on the same Reel gets one DM.
- **Development mode:** while the Meta app isn't Live, Instagram may only allow DMs to accounts with a role on the app. Test from a second account added as an Instagram Tester.
- **Publishing:** Instagram allows 100 API-published posts per 24 hours. A publish is never retried automatically, so a lost response can't post twice. If one fails, check the profile before trying again.
- **Activity:** every reply, skip and failure shows under **Recent replies** on the Instagram page.
