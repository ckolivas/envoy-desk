import {
  discordPayloadToIrc,
  ircChannelName,
  canonicalIrcChannel,
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
  IrcNetwork,
  LiveStatus,
} from "./types";
import { filledLinks, normalizeConfig } from "./types";

type Runtime = {
  config: BridgeConfig;
  links: ChannelLink[];
  servers: IrcNetwork[];
  discord: DiscordClient | null;
  ircs: Map<string, IrcClient>;
  ircState: Map<string, { state: LiveStatus["irc"]; detail: string }>;
  status: LiveStatus;
  messages: DeskMessage[];
  events: BridgeEvent[];
  recentIrcOut: { text: string; at: number; channel: string; serverId: string }[];
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
      servers: [],
      discord: null,
      ircs: new Map(),
      ircState: new Map(),
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

function rememberIrcOut(r: Runtime, text: string, channel: string, serverId: string) {
  const now = Date.now();
  r.recentIrcOut.push({
    text,
    at: now,
    channel: channel.toLowerCase(),
    serverId,
  });
  r.recentIrcOut = r.recentIrcOut.filter((x) => now - x.at < 30_000);
}

function wasEcho(
  r: Runtime,
  nick: string,
  text: string,
  channel: string,
  serverId: string,
): boolean {
  const client = r.ircs.get(serverId);
  const server = r.servers.find((s) => s.id === serverId);
  const me = (client?.currentNick || server?.nick || "").toLowerCase();
  if (!me || nick.toLowerCase() !== me) return false;
  const now = Date.now();
  const key = channel.toLowerCase();
  const hit = r.recentIrcOut.find(
    (x) =>
      x.text === text &&
      x.channel === key &&
      x.serverId === serverId &&
      now - x.at < 30_000,
  );
  if (hit) {
    r.recentIrcOut = r.recentIrcOut.filter((x) => x !== hit);
    return true;
  }
  return false;
}

function linkByIrc(r: Runtime, serverId: string, channel: string): ChannelLink | undefined {
  const name = canonicalIrcChannel(channel);
  if (!name) return undefined;
  const onServer = r.links.filter(
    (l) => l.serverId === serverId && canonicalIrcChannel(l.ircChannel) === name,
  );
  if (onServer.length === 1) return onServer[0];
  if (onServer.length > 1) return onServer[0];
  const unique = r.links.filter((l) => canonicalIrcChannel(l.ircChannel) === name);
  if (unique.length === 1) return unique[0];
  return undefined;
}

function linkByDiscord(r: Runtime, channelId: string): ChannelLink | undefined {
  return r.links.find((l) => l.discordChannelId.trim() === channelId.trim());
}

function destOf(link: ChannelLink, links: ChannelLink[]) {
  const channelId = link.discordChannelId.trim();
  const webhookUrl = link.discordWebhookUrl.trim();
  const shared =
    Boolean(webhookUrl) &&
    links.some(
      (l) =>
        l.id !== link.id &&
        l.discordWebhookUrl.trim() === webhookUrl &&
        l.discordChannelId.trim() !== channelId,
    );
  return {
    channelId,
    webhookUrl: shared ? undefined : webhookUrl || undefined,
  };
}

function clientFor(r: Runtime, serverId: string): IrcClient | undefined {
  return r.ircs.get(serverId) ?? [...r.ircs.values()][0];
}

function refreshIrcStatus(r: Runtime) {
  const states = [...r.ircState.values()];
  if (states.length === 0) {
    r.status.irc = "idle";
    r.status.ircDetail = "Off";
    return;
  }
  if (states.every((s) => s.state === "online")) r.status.irc = "online";
  else if (states.some((s) => s.state === "connecting")) r.status.irc = "connecting";
  else if (states.some((s) => s.state === "online")) r.status.irc = "online";
  else r.status.irc = "error";
  r.status.ircDetail = states.map((s) => s.detail).join(" · ");
}

function disconnectIrc(r: Runtime) {
  for (const client of r.ircs.values()) client.disconnect();
  r.ircs.clear();
  r.ircState.clear();
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
  disconnectIrc(r);
  r.discord = null;
  r.status = emptyStatus();
  pushEvent(r, { kind: "info", summary: "Bridge stopped" });
  return r.status;
}

export async function startBridge(raw: BridgeConfig): Promise<LiveStatus> {
  const config = normalizeConfig(raw);
  const links = filledLinks(config);
  const r = getRuntime();
  r.discord?.disconnect();
  disconnectIrc(r);
  r.discord = null;
  r.config = config;
  r.links = links;
  r.servers = config.servers;
  r.messages = [];
  r.events = [];
  r.recentIrcOut = [];
  r.status = {
    mode: "live",
    discord: "connecting",
    irc: "connecting",
    discordDetail: "Opening gateway",
    ircDetail: "Connecting IRC",
    lastError: "",
    startedAt: Date.now(),
    stats: { ircToDiscord: 0, discordToIrc: 0, imagesAsLinks: 0 },
  };
  pushEvent(r, { kind: "info", summary: "Starting live bridge" });

  if (!config.discordToken.trim()) throw new Error("Discord bot token is required");
  if (config.ownerOnly && !config.discordUserId.trim()) {
    throw new Error("Your Discord user ID is required when relaying only your posts");
  }
  if (links.length === 0) {
    throw new Error("Add at least one IRC ↔ Discord channel pair");
  }

  const webhookOwners = new Map<string, string>();
  for (const link of links) {
    const url = link.discordWebhookUrl.trim();
    if (!url) continue;
    const owner = webhookOwners.get(url);
    if (owner && owner !== link.discordChannelId.trim()) {
      pushEvent(r, {
        kind: "info",
        summary:
          "Same webhook on two Discord channels — IRC will post as the bot so it stays in the right channel. Use a unique webhook per Discord channel for IRC nicks.",
      });
      break;
    }
    webhookOwners.set(url, link.discordChannelId.trim());
  }

  const byServer = new Map<string, ChannelLink[]>();
  for (const link of links) {
    const list = byServer.get(link.serverId) ?? [];
    list.push(link);
    byServer.set(link.serverId, list);
  }

  const discordIds = links.map((l) => l.discordChannelId.trim());
  const discord = new DiscordClient({
    token: config.discordToken,
    channelIds: discordIds,
    onLog: (line) => pushEvent(r, { kind: "info", summary: line }),
    onReconnecting: (reason) => {
      r.status.discord = "connecting";
      r.status.discordDetail = reason;
      pushEvent(r, { kind: "info", summary: `Discord ${reason}` });
    },
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

  r.discord = discord;
  discord.connect();

  for (const [serverId, serverLinks] of byServer) {
    const server = config.servers.find((s) => s.id === serverId);
    if (!server) continue;
    const nick = server.nick.trim();
    const host = server.host.trim();
    if (!host) throw new Error("IRC host is required");
    if (!nick) throw new Error(`IRC nick is required for ${host}`);
    const channels = serverLinks.map((l) => ircChannelName(l.ircChannel));
    r.ircState.set(serverId, {
      state: "connecting",
      detail: `${nick}@${host}`,
    });
    const irc = new IrcClient({
      host,
      port: Number(server.port) || (server.tls ? 6697 : 6667),
      useTls: server.tls,
      nick,
      channels,
      serverPassword: server.serverPassword.trim() || undefined,
      nickservPassword: server.nickservPassword.trim() || undefined,
      onLog: (line) => pushEvent(r, { kind: "info", summary: `${host}: ${line}` }),
      onReconnecting: (reason) => {
        r.ircState.set(serverId, { state: "connecting", detail: `${nick}@${host} ${reason}` });
        refreshIrcStatus(r);
        pushEvent(r, { kind: "info", summary: `IRC ${host} ${reason}` });
      },
      onClose: (reason) => {
        r.ircState.set(serverId, { state: "error", detail: `${nick}@${host} ${reason}` });
        r.status.lastError = `${host}: ${reason}`;
        refreshIrcStatus(r);
        pushEvent(r, { kind: "error", summary: `IRC ${host}: ${reason}` });
      },
      onReady: (joinedNick) => {
        r.ircState.set(serverId, {
          state: "online",
          detail: `${joinedNick}@${host}`,
        });
        refreshIrcStatus(r);
        pushEvent(r, {
          kind: "info",
          summary: `IRC ${host} joined ${channels.join(", ")} as ${joinedNick}`,
        });
      },
      onMessage: (msg) => {
        void handleIrc(r, { ...msg, serverId });
      },
    });
    r.ircs.set(serverId, irc);
    irc.connect();
  }
  refreshIrcStatus(r);
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
  const irc = clientFor(r, link.serverId);
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
    irc?.say(line, ircChan);
    rememberIrcOut(r, line, ircChan, link.serverId);
  }
  pushMsg(r, {
    id: nid("irc", r),
    side: "irc",
    at: at + 20,
    nick: irc?.currentNick || r.servers.find((s) => s.id === link.serverId)?.nick || "",
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
  msg: { nick: string; text: string; isAction: boolean; target: string; serverId: string },
) {
  const link = linkByIrc(r, msg.serverId, msg.target);
  if (!link) {
    pushEvent(r, { kind: "skip", summary: `Skipped ${msg.target} (not mapped)` });
    return;
  }
  if (wasEcho(r, msg.nick, msg.text, msg.target, msg.serverId)) {
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
    const dest = destOf(link, r.links);
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

export async function injectIrc(
  text: string,
  ircChannel?: string,
  serverId?: string,
): Promise<void> {
  const r = getRuntime();
  const link =
    (serverId && ircChannel
      ? linkByIrc(r, serverId, ircChannel)
      : undefined) ??
    r.links.find((l) => !serverId || l.serverId === serverId) ??
    r.links[0];
  const sid = serverId || link?.serverId || "";
  const irc = clientFor(r, sid);
  if (!irc?.isReady) throw new Error("IRC is not connected");
  const channel = ircChannelName(ircChannel || link?.ircChannel || irc.channel);
  const lines = splitIrcLines(text);
  const pairId = nid("pair", r);
  const at = Date.now();
  for (const line of lines) {
    irc.say(line, channel);
    rememberIrcOut(r, line, channel, sid);
  }
  pushMsg(r, {
    id: nid("irc", r),
    side: "irc",
    at,
    nick: irc.currentNick,
    text: text,
    kind: "chat",
    attachments: [],
    bridged: false,
    pairId,
    linkId: link?.id,
  });
  pushEvent(r, { kind: "irc-out", summary: `Desk → ${channel}` });
}
