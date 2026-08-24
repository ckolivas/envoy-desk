# Envoy

A Discord operator desk on IRC. One nick, one bot, many channel pairs.

Open the desk, patch in a Discord bot and an IRC nick, then map each IRC
channel to a Discord channel on the same server. Chat flows both ways. Images
from Discord land on IRC as links.

## Run it

Needs Node 22+.

```bash
npm install
npm run dev
```

Then open the URL your host prints (locally that's `http://localhost:8080`).
The demo desk works with no credentials. **Patch in → Go live** to actually
bridge.

## Deploy

The live bridge holds an IRC TCP socket and a Discord gateway connection **in
process memory**. It will drop if the host sleeps, scales to zero, or recycles
the process. **Do not use Vercel / Netlify / Cloudflare Workers** for a live
bridge.

Use an always-on Node host:

- [Railway](https://railway.app) — New project → Deploy from GitHub → this repo
- [Render](https://render.com) — New **Web Service** → this repo
- [Fly.io](https://fly.io) — `fly launch` from a clone
- Any VPS with Node 22

Start command: `npm run dev`  
Health / public port: whatever `$PORT` is (Envoy falls back to `8080`)

After the host is up:

1. Open the public URL
2. **Patch in** — bot token, your Discord user ID, IRC nick/host, channel pairs
3. **Go live**

Credentials stay in your browser. The server only sees them when you connect,
and only while that process is running. If the host restarts, open the desk
and Go live again.

One process, one operator. Don't share the live URL as a public site.

### Discord bot

1. [Discord Developer Portal](https://discord.com/developers/applications) → New Application → Bot
2. Enable **Message Content Intent**
3. Copy the token and application ID into Patch in
4. Invite the bot to **one** server (the copy-invite button builds the URL)
5. Developer Mode on in Discord, then copy channel IDs and your user ID

Optional: a webhook per Discord channel so IRC nicks show as Discord usernames
instead of one bot voice.

### IRC

Outbound TCP to the IRC host (usually `6697` TLS). Some hosts block that —
pick one that doesn't.
