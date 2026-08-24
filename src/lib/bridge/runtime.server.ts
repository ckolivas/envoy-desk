import {
  discordPayloadToIrc,
  ircChannelName,
  ircPayloadToDiscord,
  splitIrcLines,
} from "./format";
import { DiscordClient } from "./discord.server";
import { IrcClient } from "./irc.server";
import type {
  BridgeConfig,
  BridgeEvent,
  ChannelLink,
  DeskMessage,
  LiveStatus,
} from "./types";
import { filledLinks, normalizeConfig } from "./types";

type Runtime = {
  config: BridgeConfig;
  links: ChannelLink[];
  discord: DiscordClient | null;
  irc: IrcClient | null;
  status: LiveStatus;
  messages: DeskMessage[];
  events: BridgeEvent[];
  recentIrcOut: { text: string; at: number; channel: string }[];
  seq: number;
};

const g = globalThis as typeof globalThis & { __envoyRuntime?: Runtime };

function nid(p: string, r: Runtime) {
  r.seq += 1;
  return `${p}-${r.seq}`;
}

function emptyStatus(): LiveStatus {
  return {
    mode: "live",
    discord: "idle",
    irc: "idle",
    discordDetail: "Off",
    ircDetail: "Off",
    lastError: "",
    startedAt: null,
    stats: { ircToDiscord: 0, discordToIrc: 0, imagesAsLinks: 0 },
  };
}

function getRuntime(): Runtime {
  if (!g.__envoyRuntime) {
    g.__envoyRuntime = {
      config: {} as BridgeConfig,
      links: [],
      discord: null,
      irc: null,
      status: emptyStatus(),
      messages: [],
      events: [],
      recentIrcOut: [],
      seq: 0,
    };
  }
  return g.__envoyRuntime;
}

function pushEvent(r: Runtime, event: Omit<BridgeEvent, "id" | "at"> & { at?: number }) {
  const full: BridgeEvent = {
    id: nid("ev", r),
    at: event.at ?? Date.now(),
    kind: event.kind,
    summary: event.summary,
  };
  r.events.push(full);
  if (r.events.length > 300) r.events.splice(0, r.events.length - 300);
  return full;
}

function pushMsg(r: Runtime, msg: DeskMessage) {
  r.messages.push(msg);
  if (r.messages.length > 400) r.messages.splice(0, r.messages.length - 400);
}

function rememberIrcOut(r: Runtime, text: string, channel: string) {
  const now = Date.now();
  r.recentIrcOut.push({ text, at: now, channel: channel.toLowerCase() });
  r.recentIrcOut = r.recentIrcOut.filter((x) => now - x.at < 30_000);
}

function wasEcho(r: Runtime, nick: string, text: string, channel: string): boolean {
  const me = (r.irc?.currentNick || r.config.ircNick).toLowerCase();
  if (nick.toLowerCase() !== me) return false;
  const now = Date.now();
  const key = channel.toLowerCase();
  const hit = r.recentIrcOut.find(
    (x) => x.text === text && x.channel === key && now - x.at < 30_000,
  );
  if (hit) {
    r.recentIrcOut = r.recentIrcOut.filter((x) => x !== hit);
    return true;
  }
  return false;
}

function linkByIrc(r: Runtime, channel: string): ChannelLink | undefined {
  const name = ircChannelName(channel).toLowerCase();
  return r.links.find((l) => ircChannelName(l.ircChannel).toLowerCase() === name);
}

function linkByDiscord(r: Runtime, channelId: string): ChannelLink | undefined {
  return r.links.find((l) => l.discordChannelId.trim() === channelId.trim());
}

function destOf(link: ChannelLink) {
  return {
    channelId: link.discordChannelId.trim(),
    webhookUrl: link.discordWebhookUrl.trim() || undefined,
  };
}

export function snapshot(): {
  status: LiveStatus;
  messages: DeskMessage[];
  events: BridgeEvent[];
} {
  const r = getRuntime();
  return { status: r.status, messages: r.messages, events: r.events };
}

export async function stopBridge(): Promise<LiveStatus> {
  const r = getRuntime();
  r.discord?.disconnect();
  r.irc?.disconnect();
  r.discord = null;
  r.irc = null;
  r.status = emptyStatus();
  pushEvent(r, { kind: "info", summary: "Bridge stopped" });
  return r.status;
}

export async function startBridge(raw: BridgeConfig): Promise<LiveStatus> {
  const config = normalizeConfig(raw);
  const links = filledLinks(config);
  const r = getRuntime();
  r.discord?.disconnect();
  r.irc?.disconnect();
  r.discord = null;
  r.irc = null;
  r.config = config;
  r.links = links;
  r.messages = [];
  r.events = [];
  r.recentIrcOut = [];
  r.status = {
    mode: "live",
    discord: "connecting",
    irc: "connecting",
    discordDetail: "Opening gateway",
    ircDetail: `Connecting ${config.ircHost}:${config.ircPort}`,
    lastError: "",
    startedAt: Date.now(),
    stats: { ircToDiscord: 0, discordToIrc: 0, imagesAsLinks: 0 },
  };
  pushEvent(r, { kind: "info", summary: "Starting live bridge" });

  if (!config.discordToken.trim()) throw new Error("Discord bot token is required");
  if (config.ownerOnly && !config.discordUserId.trim()) {
    throw new Error("Your Discord user ID is required when relaying only your posts");
  }
  if (!config.ircHost.trim()) throw new Error("IRC host is required");
  if (!config.ircNick.trim()) throw new Error("IRC nick is required");
  if (links.length === 0) {
    throw new Error("Add at least one IRC ↔ Discord channel pair");
  }

  const ircChannels = links.map((l) => ircChannelName(l.ircChannel));
  const discordIds = links.map((l) => l.discordChannelId.trim());

  const discord = new DiscordClient({
    token: config.discordToken,
    channelIds: discordIds,
    onLog: (line) => pushEvent(r, { kind: "info", summary: line }),
    onClose: (reason) => {
      r.status.discord = "error";
      r.status.discordDetail = reason;
      r.status.lastError = reason;
      pushEvent(r, { kind: "error", summary: `Discord: ${reason}` });
    },
    onReady: (tag) => {
      r.status.discord = "online";
      r.status.discordDetail = `${tag} · ${links.length} ${links.length === 1 ? "pair" : "pairs"}`;
      pushEvent(r, { kind: "info", summary: `Discord ready as ${tag}` });
    },
    onMessage: (msg) => {
      void handleDiscord(r, msg);
    },
  });

  const irc = new IrcClient({
    host: config.ircHost.trim(),
    port: Number(config.ircPort) || (config.ircTls ? 6697 : 6667),
    useTls: config.ircTls,
    nick: config.ircNick.trim(),
    channels: ircChannels,
    serverPassword: config.ircServerPassword.trim() || undefined,
    nickservPassword: config.ircNickservPassword.trim() || undefined,
    onLog: (line) => pushEvent(r, { kind: "info", summary: line }),
    onClose: (reason) => {
      r.status.irc = "error";
      r.status.ircDetail = reason;
      r.status.lastError = reason;
      pushEvent(r, { kind: "error", summary: `IRC: ${reason}` });
    },
    onReady: (nick) => {
      r.status.irc = "online";
      r.status.ircDetail = `${nick} · ${ircChannels.join(" ")}`;
      pushEvent(r, {
        kind: "info",
        summary: `IRC joined ${ircChannels.join(", ")} as ${nick}`,
      });
    },
    onMessage: (msg) => {
      void handleIrc(r, msg);
    },
  });

  r.discord = discord;
  r.irc = irc;
  discord.connect();
  irc.connect();
  return r.status;
}

async function handleDiscord(
  r: Runtime,
  msg: Parameters<NonNullable<ConstructorParameters<typeof DiscordClient>[0]["onMessage"]>>[0],
) {
  const link = linkByDiscord(r, msg.channelId);
  if (!link) {
    pushEvent(r, { kind: "skip", summary: "Skipped Discord channel (not mapped)" });
    return;
  }
  if (msg.authorBot) {
    pushEvent(r, { kind: "skip", summary: "Skipped Discord bot/webhook" });
    return;
  }
  if (r.config.ownerOnly && msg.authorId !== r.config.discordUserId.trim()) {
    pushEvent(r, {
      kind: "skip",
      summary: `Skipped ${msg.authorName} (not you)`,
    });
    return;
  }
  const packed = discordPayloadToIrc({
    content: msg.content,
    attachments: msg.attachments,
  });
  if (!packed.text) {
    pushEvent(r, { kind: "skip", summary: "Empty Discord message" });
    return;
  }
  const ircChan = ircChannelName(link.ircChannel);
  const pairId = nid("pair", r);
  const at = Date.now();
  pushMsg(r, {
    id: nid("dsc", r),
    side: "discord",
    at,
    nick: msg.authorName,
    text: msg.content,
    kind: "chat",
    attachments: msg.attachments,
    bridged: false,
    pairId,
    linkId: link.id,
  });
  const lines = splitIrcLines(packed.text);
  for (const line of lines) {
    r.irc?.say(line, ircChan);
    rememberIrcOut(r, line, ircChan);
  }
  pushMsg(r, {
    id: nid("irc", r),
    side: "irc",
    at: at + 20,
    nick: r.irc?.currentNick || r.config.ircNick,
    text: packed.text,
    kind: "chat",
    attachments: msg.attachments,
    bridged: true,
    pairId,
    linkId: link.id,
  });
  r.status.stats.discordToIrc += 1;
  r.status.stats.imagesAsLinks += packed.imageCount;
  pushEvent(r, {
    kind: "discord-in",
    summary: `${msg.authorName} → ${ircChan}`,
  });
  if (packed.imageCount) {
    pushEvent(r, {
      kind: "image-link",
      summary: `${packed.imageCount} image${packed.imageCount === 1 ? "" : "s"} → link`,
    });
  }
}

async function handleIrc(
  r: Runtime,
  msg: { nick: string; text: string; isAction: boolean; target: string },
) {
  const link = linkByIrc(r, msg.target);
  if (!link) {
    pushEvent(r, { kind: "skip", summary: `Skipped ${msg.target} (not mapped)` });
    return;
  }
  if (wasEcho(r, msg.nick, msg.text, msg.target)) {
    pushEvent(r, { kind: "skip", summary: "Suppressed IRC echo" });
    return;
  }
  const pairId = nid("pair", r);
  const at = Date.now();
  const discordText = ircPayloadToDiscord(msg.nick, msg.text, msg.isAction);
  pushMsg(r, {
    id: nid("irc", r),
    side: "irc",
    at,
    nick: msg.nick,
    text: msg.text,
    kind: msg.isAction ? "action" : "chat",
    attachments: [],
    bridged: false,
    pairId,
    linkId: link.id,
  });
  try {
    const dest = destOf(link);
    if (dest.webhookUrl) {
      const content = msg.isAction ? `_${msg.text}_` : msg.text || "·";
      await r.discord?.sendAsNick(msg.nick, content, dest);
    } else {
      await r.discord?.sendAsBridge(discordText, dest);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    r.status.lastError = reason;
    pushEvent(r, { kind: "error", summary: `Discord send failed: ${reason}` });
    return;
  }
  pushMsg(r, {
    id: nid("dsc", r),
    side: "discord",
    at: at + 20,
    nick: msg.nick,
    text: msg.text,
    kind: msg.isAction ? "action" : "chat",
    attachments: [],
    bridged: true,
    pairId,
    linkId: link.id,
  });
  r.status.stats.ircToDiscord += 1;
  pushEvent(r, {
    kind: "irc-in",
    summary: `${msg.nick} ${ircChannelName(link.ircChannel)} → Discord`,
  });
}

export async function injectIrc(text: string, ircChannel?: string): Promise<void> {
  const r = getRuntime();
  if (!r.irc?.isReady) throw new Error("IRC is not connected");
  const channel = ircChannelName(ircChannel || r.irc.channel);
  const link = linkByIrc(r, channel) ?? r.links[0];
  const lines = splitIrcLines(text);
  const pairId = nid("pair", r);
  const at = Date.now();
  for (const line of lines) {
    r.irc.say(line, channel);
    rememberIrcOut(r, line, channel);
  }
  pushMsg(r, {
    id: nid("irc", r),
    side: "irc",
    at,
    nick: r.irc.currentNick,
    text: text,
    kind: "chat",
    attachments: [],
    bridged: false,
    pairId,
    linkId: link?.id,
  });
  pushEvent(r, { kind: "irc-out", summary: `Desk → ${channel}` });
}
