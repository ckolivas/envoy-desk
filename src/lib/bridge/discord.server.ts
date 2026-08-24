import { classifyAttachment, sanitizeWebhookName } from "./format";
import type { Attachment } from "./types";

const INTENTS = (1 << 0) | (1 << 9) | (1 << 15);
const GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
const API = "https://discord.com/api/v10";

export type DiscordIncoming = {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  authorBot: boolean;
  webhookId?: string;
  content: string;
  attachments: Attachment[];
};

export type DiscordDest = {
  channelId: string;
  webhookUrl?: string;
};

export type DiscordClientOpts = {
  token: string;
  channelIds: string[];
  onMessage: (msg: DiscordIncoming) => void;
  onReady: (tag: string) => void;
  onClose: (reason: string) => void;
  onLog: (line: string) => void;
};

type GatewayPayload = {
  op: number;
  s?: number | null;
  t?: string | null;
  d?: unknown;
};

export class DiscordClient {
  private ws: WebSocket | null = null;
  private seq: number | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private ready = false;
  private token: string;
  private channelSet: Set<string>;

  constructor(private opts: DiscordClientOpts) {
    this.token = opts.token.trim();
    this.channelSet = new Set(opts.channelIds.map((id) => id.trim()).filter(Boolean));
  }

  get isReady() {
    return this.ready;
  }

  connect() {
    this.closed = false;
    this.ws = new WebSocket(GATEWAY);
    this.ws.addEventListener("message", (ev) => {
      try {
        this.onPacket(JSON.parse(String(ev.data)) as GatewayPayload);
      } catch (err) {
        this.opts.onLog(`discord parse error: ${String(err)}`);
      }
    });
    this.ws.addEventListener("close", (ev) => {
      this.ready = false;
      this.stopHeartbeat();
      if (!this.closed) this.opts.onClose(`gateway closed (${ev.code})`);
    });
    this.ws.addEventListener("error", () => {
      this.opts.onLog("discord gateway error");
    });
  }

  disconnect() {
    this.closed = true;
    this.ready = false;
    this.stopHeartbeat();
    try {
      this.ws?.close(1000, "envoy stop");
    } catch {
      /* ignore */
    }
    this.ws = null;
  }

  async sendAsBridge(content: string, dest: DiscordDest) {
    const text = content.slice(0, 1900);
    if (!text) return;
    if (dest.webhookUrl) {
      await postWebhook(dest.webhookUrl, { content: text });
      return;
    }
    await this.postChannel(dest.channelId, text);
  }

  async sendAsNick(nick: string, content: string, dest: DiscordDest) {
    const text = content.slice(0, 1900);
    if (!text) return;
    if (dest.webhookUrl) {
      await postWebhook(dest.webhookUrl, {
        username: sanitizeWebhookName(nick),
        content: text,
      });
      return;
    }
    await this.postChannel(dest.channelId, text);
  }

  private async postChannel(channelId: string, content: string) {
    const res = await fetch(`${API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`discord ${res.status}: ${body.slice(0, 180)}`);
    }
  }

  private identify() {
    this.send({
      op: 2,
      d: {
        token: this.token,
        intents: INTENTS,
        properties: { os: "linux", browser: "envoy", device: "envoy" },
      },
    });
  }

  private send(payload: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private startHeartbeat(interval: number) {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      this.send({ op: 1, d: this.seq });
    }, interval);
  }

  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private onPacket(p: GatewayPayload) {
    if (typeof p.s === "number") this.seq = p.s;
    if (p.op === 10) {
      const d = p.d as { heartbeat_interval: number };
      this.startHeartbeat(d.heartbeat_interval);
      this.identify();
      return;
    }
    if (p.op === 7) {
      this.opts.onLog("discord requested reconnect");
      try {
        this.ws?.close();
      } catch {
        /* ignore */
      }
      return;
    }
    if (p.op === 9) {
      this.opts.onLog("discord invalid session, identifying");
      this.identify();
      return;
    }
    if (p.op !== 0) return;
    if (p.t === "READY") {
      const d = p.d as {
        session_id: string;
        user: { username: string; discriminator?: string };
      };
      this.ready = true;
      const tag =
        d.user.discriminator && d.user.discriminator !== "0"
          ? `${d.user.username}#${d.user.discriminator}`
          : d.user.username;
      this.opts.onReady(tag);
      return;
    }
    if (p.t === "MESSAGE_CREATE") {
      const d = p.d as {
        id: string;
        channel_id: string;
        content?: string;
        webhook_id?: string;
        author?: { id: string; username: string; global_name?: string; bot?: boolean };
        attachments?: { url: string; filename: string; content_type?: string }[];
        sticker_items?: { name: string; id: string; format_type?: number }[];
        embeds?: {
          url?: string;
          image?: { url?: string };
          thumbnail?: { url?: string };
          video?: { url?: string };
        }[];
      };
      if (!this.channelSet.has(d.channel_id)) return;
      const author = d.author;
      if (!author) return;
      const attachments: Attachment[] = [];
      for (const a of d.attachments ?? []) {
        attachments.push(classifyAttachment(a.url, a.filename, a.content_type));
      }
      for (const s of d.sticker_items ?? []) {
        const ext = s.format_type === 1 ? "png" : s.format_type === 2 ? "png" : "json";
        const url = `https://cdn.discordapp.com/stickers/${s.id}.${ext}`;
        attachments.push(classifyAttachment(url, `${s.name}.${ext}`, undefined));
      }
      for (const e of d.embeds ?? []) {
        for (const url of [e.image?.url, e.thumbnail?.url, e.video?.url, e.url]) {
          if (!url) continue;
          if (attachments.some((a) => a.url === url)) continue;
          const filename = url.split("/").pop() || "embed";
          attachments.push(classifyAttachment(url, filename));
        }
      }
      this.opts.onMessage({
        id: d.id,
        channelId: d.channel_id,
        authorId: author.id,
        authorName: author.global_name || author.username,
        authorBot: Boolean(author.bot) || Boolean(d.webhook_id),
        webhookId: d.webhook_id,
        content: d.content ?? "",
        attachments,
      });
    }
  }
}

async function postWebhook(url: string, body: Record<string, string>) {
  const dest = url + (url.includes("?") ? "&" : "?") + "wait=true";
  const res = await fetch(dest, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`webhook ${res.status}: ${text.slice(0, 180)}`);
  }
}
