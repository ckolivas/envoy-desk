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

### VPS, localhost only

If you SSH in with a SOCKS proxy, bind Envoy to loopback so it is not on the
public internet:

```ini
Environment=HOST=127.0.0.1
Environment=PORT=8080
```

Then in the browser that uses that SOCKS proxy, open `http://127.0.0.1:8080`.
That address is the VPS, not your laptop.

SOCKS must send DNS through the proxy (Firefox: “Proxy DNS when using SOCKS v5”).
If it doesn’t, use a local forward instead and skip SOCKS for this tab:

```bash
ssh -N -L 8080:127.0.0.1:8080 your-vps
```

After the host is up, **Patch in** and **Go live**. If the process restarts,
Go live again. One operator per process.


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
