import { classifyAttachment, sanitizeWebhookName } from "./format";
import type { Attachment } from "./types";

const INTENTS = (1 << 0) | (1 << 9) | (1 << 15);
const GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
const API = "https://discord.com/api/v10";
const FATAL_CLOSE = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

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
  onReconnecting?: (reason: string) => void;
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
  private sessionId: string | null = null;
  private resumeUrl = GATEWAY;
  private lastTag = "";
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private awaitingAck = false;
  private attempt = 0;
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
    this.openSocket();
  }

  disconnect() {
    this.closed = true;
    this.ready = false;
    this.sessionId = null;
    this.seq = null;
    this.clearReconnect();
    this.stopHeartbeat();
    this.closeSocket(1000, "envoy stop");
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

  private openSocket() {
    this.stopHeartbeat();
    this.awaitingAck = false;
    this.closeSocket();
    const url = this.sessionId ? this.resumeUrl : GATEWAY;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      try {
        this.onPacket(JSON.parse(String(ev.data)) as GatewayPayload);
      } catch (err) {
        this.opts.onLog(`discord parse error: ${String(err)}`);
      }
    });
    ws.addEventListener("close", (ev) => {
      if (this.ws !== ws) return;
      this.ready = false;
      this.stopHeartbeat();
      this.ws = null;
      if (this.closed) return;
      if (FATAL_CLOSE.has(ev.code)) {
        this.opts.onClose(`gateway closed (${ev.code})`);
        return;
      }
      if (ev.code === 4007 || ev.code === 4009) {
        this.sessionId = null;
        this.seq = null;
      }
      this.scheduleReconnect(`gateway closed (${ev.code})`);
    });
    ws.addEventListener("error", () => {
      this.opts.onLog("discord gateway error");
    });
  }

  private closeSocket(code?: number, reason?: string) {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    try {
      if (code != null) ws.close(code, reason);
      else ws.close();
    } catch {
      /* ignore */
    }
  }

  private scheduleReconnect(reason: string) {
    if (this.closed || this.reconnectTimer) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.attempt);
    this.attempt += 1;
    const wait = Math.max(1, Math.round(delay / 1000));
    this.opts.onReconnecting?.(`reconnecting in ${wait}s`);
    this.opts.onLog(`${reason}; retry in ${wait}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) this.openSocket();
    }, delay);
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
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

  private resume() {
    this.send({
      op: 6,
      d: {
        token: this.token,
        session_id: this.sessionId,
        seq: this.seq,
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
    this.awaitingAck = false;
    this.heartbeat = setInterval(() => {
      if (this.awaitingAck) {
        this.opts.onLog("discord heartbeat timed out");
        try {
          this.ws?.close(4000, "heartbeat timeout");
        } catch {
          /* ignore */
        }
        return;
      }
      this.awaitingAck = true;
      this.send({ op: 1, d: this.seq });
    }, interval);
  }

  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.awaitingAck = false;
  }

  private markOnline(tag: string) {
    this.ready = true;
    this.attempt = 0;
    this.lastTag = tag || this.lastTag;
    this.opts.onReady(this.lastTag || "discord");
  }

  private onPacket(p: GatewayPayload) {
    if (typeof p.s === "number") this.seq = p.s;
    if (p.op === 11) {
      this.awaitingAck = false;
      return;
    }
    if (p.op === 10) {
      const d = p.d as { heartbeat_interval: number };
      this.startHeartbeat(d.heartbeat_interval);
      if (this.sessionId && this.seq != null) this.resume();
      else this.identify();
      return;
    }
    if (p.op === 7) {
      this.opts.onLog("discord requested reconnect");
      this.closeSocket();
      if (!this.closed) this.scheduleReconnect("discord requested reconnect");
      return;
    }
    if (p.op === 9) {
      const resumable = p.d === true;
      this.opts.onLog(resumable ? "discord session invalid, retrying resume" : "discord session invalid");
      if (!resumable) {
        this.sessionId = null;
        this.seq = null;
      }
      const later = 1500 + Math.floor(Math.random() * 3500);
      setTimeout(() => {
        if (this.closed) return;
        if (resumable && this.sessionId) this.resume();
        else this.identify();
      }, later);
      return;
    }
    if (p.op !== 0) return;
    if (p.t === "READY") {
      const d = p.d as {
        session_id: string;
        resume_gateway_url?: string;
        user: { username: string; discriminator?: string };
      };
      this.sessionId = d.session_id;
      if (d.resume_gateway_url) {
        const base = d.resume_gateway_url.replace(/\/$/, "");
        this.resumeUrl = `${base}/?v=10&encoding=json`;
      }
      const tag =
        d.user.discriminator && d.user.discriminator !== "0"
          ? `${d.user.username}#${d.user.discriminator}`
          : d.user.username;
      this.markOnline(tag);
      return;
    }
    if (p.t === "RESUMED") {
      this.markOnline(this.lastTag);
      this.opts.onLog("discord session resumed");
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
        attachments.push(classifyAttachment(url, filenameFor(s.name, ext), undefined));
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

function filenameFor(name: string, ext: string) {
  return `${name}.${ext}`;
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
