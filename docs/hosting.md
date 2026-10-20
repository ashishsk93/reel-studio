# Hosting Reel Studio on the VPS

Reel Studio runs on the same Hostinger VPS as velra.tech, at **https://studio.velra.tech**, behind its own sign-in page. velra.tech and carromino.velra.tech are untouched: the new site is a separate nginx server block, separate system user, separate folder and separate ports.

| | |
|---|---|
| Address | `https://studio.velra.tech`, sign-in page in the app's own style (one user, 30-day session cookie) |
| Code | `/srv/reel-studio`, owned by the `reelstudio` system user |
| Data | `/srv/reel-studio/data`: database, uploads, renders, logs. **Back this up.** |
| Processes | `reel-studio-api` (Nest, `127.0.0.1:4100`) and `reel-studio-web` (Next, `127.0.0.1:3100`), both systemd |
| How it's enforced | nginx checks the session on every request before it reaches the app (`auth_request`); no session → `/login` |
| Open without signing in | the sign-in page and its scripts; `/api/instagram/webhook` (signature-checked) and `/api/instagram/media/…` (signed, 3-hour links), because Meta calls them |
| Password guessing | 5 sign-in attempts a minute per address; fail2ban blocks an address after 5 wrong passwords in 10 minutes, for 10 minutes, doubling with every repeat ban up to a week |

velra.tech keeps `127.0.0.1:3000`. Nothing here listens on a public port; nginx is the only way in.

Commands marked **(PC)** run in PowerShell on your computer in `D:\Projects\reel-studio`. Everything else runs over SSH on the VPS. Replace `YOU@VPS` with your SSH login (e.g. `root@1.2.3.4`).

---

## 1. DNS (GoDaddy)

velra.tech's DNS is at GoDaddy (nameservers `ns39/ns40.domaincontrol.com`); the server is at Hostinger. In GoDaddy → My Products → velra.tech → **DNS** → **Add New Record**:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `studio` | the same IP as the `@` record (`72.60.205.125` as of Oct 2026) | 1 hour |

Wait until it resolves:

```bash
dig +short studio.velra.tech
```

## 2. Packages

Node 22 and certbot are already on the box. Add FFmpeg (renders) and fail2ban (blocks password guessing):

```bash
sudo apt update
sudo apt install -y ffmpeg fail2ban
command -v node && node --version          # needs v22.12+; the units assume /usr/bin/node
command -v corepack                        # ships with Node 22; runs the pinned pnpm
```

If `node` is not at `/usr/bin/node`, change `ExecStart` in both `deploy/*.service` files to match before step 7.

## 3. User, folder and code

A system user of its own, so Reel Studio can't touch velra.tech's files and the reverse:

```bash
sudo useradd --system --create-home --home-dir /var/lib/reelstudio --shell /usr/sbin/nologin reelstudio
sudo mkdir -p /srv/reel-studio && sudo chown reelstudio:reelstudio /srv/reel-studio
```

The repository is private, so give the server a read-only **deploy key**:

```bash
sudo -u reelstudio -H mkdir -p -m 700 /var/lib/reelstudio/.ssh
sudo -u reelstudio -H ssh-keygen -t ed25519 -N "" -C "reel-studio@vps" -f /var/lib/reelstudio/.ssh/id_ed25519
sudo -u reelstudio -H sh -c 'ssh-keyscan github.com >> /var/lib/reelstudio/.ssh/known_hosts'
sudo cat /var/lib/reelstudio/.ssh/id_ed25519.pub
```

Copy that line into GitHub → `ashishsk93/reel-studio` → Settings → Deploy keys → **Add deploy key** (leave *Allow write access* off). Then clone:

```bash
sudo -u reelstudio -H git clone git@github.com:ashishsk93/reel-studio.git /srv/reel-studio
```

## 4. `.env`

Start from your local `.env` (API keys, Instagram app secret), and change or add the server lines:

```bash
sudo -u reelstudio -H nano /srv/reel-studio/.env
```

```ini
# ...your existing keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, INSTAGRAM_APP_SECRET, ...)
PUBLIC_URL=https://studio.velra.tech
HOST=127.0.0.1
PORT_API=4100
PORT_WEB=3100
DATA_DIR=./data
FFMPEG_PATH=/usr/bin/ffmpeg
FFPROBE_PATH=/usr/bin/ffprobe
# Any long random string; the same value goes into Meta's webhook settings (step 10).
INSTAGRAM_WEBHOOK_VERIFY_TOKEN=
# Sign-in (step 6)
AUTH_USERNAME=ashish
AUTH_PASSWORD_HASH=
AUTH_SECRET=
```

Generate the verify token with `openssl rand -hex 24`. Then lock the file down:

```bash
sudo chmod 600 /srv/reel-studio/.env
```

## 5. Fonts and your data

Both are git-ignored, so copy them from your computer.

**Stop Reel Studio on your computer first**: close `pnpm dev`, so the database isn't mid-write. From now on the server is the only copy that should run. If both run, both would DM the same commenters, because each keeps its own reply log.

**(PC)** Pack and upload:

```powershell
tar -czf reel-data.tgz --exclude=data/tmp data
scp reel-data.tgz apps/api/assets/fonts/Poppins-ExtraBold.ttf apps/api/assets/fonts/NotoColorEmoji-Regular.ttf YOU@VPS:/tmp/
```

On the server, unpack into place:

```bash
sudo -u reelstudio mkdir -p /srv/reel-studio/apps/api/assets/fonts
sudo mv /tmp/*.ttf /srv/reel-studio/apps/api/assets/fonts/
sudo tar -xzf /tmp/reel-data.tgz -C /srv/reel-studio
sudo chown -R reelstudio:reelstudio /srv/reel-studio/data /srv/reel-studio/apps/api/assets/fonts
sudo rm /tmp/reel-data.tgz
```

## 6. Certificate and password

```bash
sudo certbot certonly --nginx -d studio.velra.tech
```

Make the password hash on **your computer (PC)**, so the password never touches the server, even in shell history:

```powershell
pnpm --filter @reel/api auth:hash
```

It asks for the password twice (at least 12 characters, not shown as you type) and prints two lines. Paste both into the server's `.env`, replacing the empty `AUTH_PASSWORD_HASH=` and `AUTH_SECRET=`. The hash is scrypt, so the `.env` never holds the password itself.

To change the password later, run it again, replace both lines and restart the API (`sudo systemctl restart reel-studio-api`). A new `AUTH_SECRET` also signs out every browser.

## 7. Services and first deploy

```bash
cd /srv/reel-studio
sudo cp deploy/reel-studio-api.service deploy/reel-studio-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable reel-studio-api reel-studio-web
sudo ./scripts/deploy.sh
```

`deploy.sh` installs dependencies, fetches the MediaPipe models the first time, builds with `PUBLIC_URL` baked into the web app, stops the API for the few seconds the database migrations take (SQLite has a single writer), then starts both services. It waits until both answer on loopback.

## 8. nginx

```bash
sudo cp /srv/reel-studio/deploy/nginx/studio.velra.tech.conf /etc/nginx/sites-available/studio.velra.tech
sudo ln -sf /etc/nginx/sites-available/studio.velra.tech /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` checks every site before the reload, so a mistake can't take velra.tech down.

## 8b. Block password guessing

nginx already lets each address try to sign in only 5 times a minute, and the API pauses before answering a wrong password. fail2ban adds the lockout: it watches the API's log for failed sign-ins, and after **5 wrong passwords within 10 minutes** it blocks that address at the firewall for 10 minutes. Each later ban of the same address doubles (20 min, 40, 80 …) up to **one week**, and fail2ban remembers past bans across restarts.

```bash
sudo cp /srv/reel-studio/deploy/fail2ban/reel-studio-auth.conf /etc/fail2ban/filter.d/
sudo cp /srv/reel-studio/deploy/fail2ban/reel-studio.local /etc/fail2ban/jail.d/
sudo systemctl enable --now fail2ban
sudo fail2ban-client reload
sudo fail2ban-client status reel-studio-auth        # "Currently banned: 0"
```

Test it from your phone on mobile data, so a ban doesn't lock out your computer: open the site and enter a wrong password 5 times. The site then stops loading on the phone, and `sudo fail2ban-client status reel-studio-auth` lists its address. Each failure also shows in `journalctl -u reel-studio-api | grep AUTH-FAIL`. Lift the ban with:

```bash
sudo fail2ban-client set reel-studio-auth unbanip PHONE.IP
```

Only wrong passwords and unknown usernames count; opening the sign-in page does not, so normal use never trips it. A ban covers ports 80 and 443 for that address, which includes velra.tech.

## 9. Check

```bash
curl -sI https://studio.velra.tech/projects | grep -iE '^(HTTP|location)'       # 302 → /login?next=/projects
curl -s -o /dev/null -w "%{http_code}\n" https://studio.velra.tech/api/health      # 401 without a session
curl -s https://studio.velra.tech/api/auth/status; echo                          # {"enabled":true,"signedIn":false}
curl -s "https://studio.velra.tech/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=1" -o /dev/null -w "%{http_code}\n"   # 403
curl -sI https://velra.tech | head -1 && curl -sI https://carromino.velra.tech | head -1                       # unchanged: 200
```

Then open https://studio.velra.tech, sign in, and check that your projects, influencers and the Instagram page are all there. **Sign out** is at the bottom of the sidebar.

## 10. Instagram webhooks

Meta → your app → Use cases → Instagram API → **API setup with Instagram login → 3. Configure webhooks**:

- **Callback URL:** `https://studio.velra.tech/api/instagram/webhook`
- **Verify token:** the `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` from step 4

Click **Verify and save**, then subscribe to the **comments** field. Keyword comments are now answered within seconds. Keep **Check comments every 90 seconds** on as a safety net: each comment is handled once, so the two never double up.

Posting from the Export step also works now: Instagram downloads the video from a signed `studio.velra.tech` link.

---

## Switching an existing server from the password box to the sign-in page

For a server set up with the earlier HTTP basic auth (the browser's grey username/password box):

1. **(PC)** `pnpm --filter @reel/api auth:hash`, then add `AUTH_USERNAME`, `AUTH_PASSWORD_HASH` and `AUTH_SECRET` to `/srv/reel-studio/.env` (step 4).
2. Deploy the new code, and update the API service (it now logs plainly for fail2ban):
   ```bash
   sudo cp /srv/reel-studio/deploy/reel-studio-api.service /etc/systemd/system/ && sudo systemctl daemon-reload
   sudo /srv/reel-studio/scripts/deploy.sh
   ```
3. Swap nginx over to the sign-in page:
   ```bash
   nginx -V 2>&1 | grep -o auth_request          # must print auth_request
   sudo cp /srv/reel-studio/deploy/nginx/studio.velra.tech.conf /etc/nginx/sites-available/studio.velra.tech
   sudo nginx -t && sudo systemctl reload nginx
   ```
4. Point fail2ban at the new log lines:
   ```bash
   sudo cp /srv/reel-studio/deploy/fail2ban/reel-studio-auth.conf /etc/fail2ban/filter.d/
   sudo cp /srv/reel-studio/deploy/fail2ban/reel-studio.local /etc/fail2ban/jail.d/
   sudo fail2ban-client reload && sudo fail2ban-client status reel-studio-auth
   ```
5. Remove the old password file: `sudo rm /etc/nginx/reel-studio.htpasswd`.
6. Run the checks in step 9.

## Updating

After pushing to `main`:

```bash
sudo /srv/reel-studio/scripts/deploy.sh             # pull, install, build, migrate, restart
sudo /srv/reel-studio/scripts/deploy.sh --rollback  # back to the previous commit
```

## Logs and restarts

```bash
journalctl -u reel-studio-api -f          # API, jobs, renders, Instagram poller
journalctl -u reel-studio-web -f
sudo systemctl restart reel-studio-api reel-studio-web
sudo fail2ban-client status reel-studio-auth                 # who is banned right now
sudo fail2ban-client set reel-studio-auth unbanip YOUR.IP     # if you lock yourself out
```

## Backups

Everything you'd lose lives in `/srv/reel-studio/data`. A nightly copy kept for a week:

```bash
sudo mkdir -p /var/backups/reel-studio
echo '30 3 * * * root tar -czf /var/backups/reel-studio/data-$(date +\%a).tgz -C /srv/reel-studio --exclude=data/tmp data' | sudo tee /etc/cron.d/reel-studio-backup
```

To pull a copy down to your computer **(PC)**: `scp YOU@VPS:/var/backups/reel-studio/data-Mon.tgz .`
