export type BridgeMode = "demo" | "live";

export type ConnectionState = "idle" | "connecting" | "online" | "error";

export type MessageKind = "chat" | "action" | "system";

export type Side = "irc" | "discord";

export type Attachment = {
  url: string;
  filename: string;
  contentType?: string;
  isImage: boolean;
};

export type IrcNetwork = {
  id: string;
  host: string;
  port: number;
  tls: boolean;
  nick: string;
  serverPassword: string;
  nickservPassword: string;
};

export type ChannelLink = {
  id: string;
  serverId: string;
  ircChannel: string;
  discordChannelId: string;
  discordWebhookUrl: string;
};

export type DeskMessage = {
  id: string;
  side: Side;
  at: number;
  nick: string;
  text: string;
  kind: MessageKind;
  attachments: Attachment[];
  /** True when this line was created by the bridge, not typed in-place. */
  bridged: boolean;
  /** Shared id linking the IRC and Discord copies of one event. */
  pairId?: string;
  /** Channel pair this line belongs to. */
  linkId?: string;
};

export type BridgeEvent = {
  id: string;
  at: number;
  kind:
    | "irc-in"
    | "discord-in"
    | "irc-out"
    | "discord-out"
    | "image-link"
    | "skip"
    | "info"
    | "error";
  summary: string;
};

export type BridgeConfig = {
  discordToken: string;
  discordAppId: string;
  discordChannelId: string;
  discordUserId: string;
  discordWebhookUrl: string;
  ircHost: string;
  ircPort: number;
  ircTls: boolean;
  ircNick: string;
  ircChannel: string;
  ircServerPassword: string;
  ircNickservPassword: string;
  ownerOnly: boolean;
  servers: IrcNetwork[];
  links: ChannelLink[];
};

export function makeLinkId(): string {
  return `link-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function makeServerId(): string {
  return `irc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyServer(id = makeServerId()): IrcNetwork {
  return {
    id,
    host: "irc.libera.chat",
    port: 6697,
    tls: true,
    nick: "",
    serverPassword: "",
    nickservPassword: "",
  };
}

export function emptyLink(serverId: string, id = makeLinkId()): ChannelLink {
  return { id, serverId, ircChannel: "", discordChannelId: "", discordWebhookUrl: "" };
}

function asServer(raw: Partial<IrcNetwork> | undefined, fallback: IrcNetwork): IrcNetwork {
  return {
    id: raw?.id || fallback.id,
    host: raw?.host ?? fallback.host,
    port: Number(raw?.port) || fallback.port,
    tls: raw?.tls ?? fallback.tls,
    nick: raw?.nick ?? fallback.nick,
    serverPassword: raw?.serverPassword ?? fallback.serverPassword,
    nickservPassword: raw?.nickservPassword ?? fallback.nickservPassword,
  };
}

export function normalizeConfig(config: BridgeConfig): BridgeConfig {
  const legacy = emptyServer("primary-irc");
  legacy.host = config.ircHost || legacy.host;
  legacy.port = Number(config.ircPort) || legacy.port;
  legacy.tls = config.ircTls ?? legacy.tls;
  legacy.nick = config.ircNick || legacy.nick;
  legacy.serverPassword = config.ircServerPassword || "";
  legacy.nickservPassword = config.ircNickservPassword || "";

  let servers = (config.servers ?? []).map((s, i) =>
    asServer(s, i === 0 ? legacy : emptyServer(s.id)),
  );
  if (servers.length === 0) servers = [legacy];

  const primaryId = servers[0]!.id;
  const links = (config.links ?? []).map((l) => ({
    id: l.id || makeLinkId(),
    serverId: l.serverId || primaryId,
    ircChannel: l.ircChannel ?? "",
    discordChannelId: l.discordChannelId ?? "",
    discordWebhookUrl: l.discordWebhookUrl ?? "",
  }));
  if (links.length === 0) {
    links.push(emptyLink(primaryId, "primary"));
  } else {
    const first = links[0]!;
    if (!first.ircChannel.trim()) first.ircChannel = config.ircChannel ?? "";
    if (!first.discordChannelId.trim()) first.discordChannelId = config.discordChannelId ?? "";
    if (!first.discordWebhookUrl.trim()) first.discordWebhookUrl = config.discordWebhookUrl ?? "";
  }

  const ids = new Set(servers.map((s) => s.id));
  for (const link of links) {
    if (!ids.has(link.serverId)) link.serverId = primaryId;
  }

  const primary = servers[0]!;
  const head = links[0]!;
  return {
    ...config,
    servers,
    links,
    ircHost: primary.host,
    ircPort: primary.port,
    ircTls: primary.tls,
    ircNick: primary.nick,
    ircServerPassword: primary.serverPassword,
    ircNickservPassword: primary.nickservPassword,
    ircChannel: head.ircChannel,
    discordChannelId: head.discordChannelId,
    discordWebhookUrl: head.discordWebhookUrl,
  };
}

export function filledLinks(config: BridgeConfig): ChannelLink[] {
  const cfg = normalizeConfig(config);
  const ready = new Set(
    cfg.servers.filter((s) => s.host.trim() && s.nick.trim()).map((s) => s.id),
  );
  return cfg.links.filter(
    (l) =>
      ready.has(l.serverId) &&
      l.ircChannel.trim().length > 0 &&
      l.discordChannelId.trim().length > 0,
  );
}

export const defaultConfig = (): BridgeConfig => {
  const server = emptyServer("primary-irc");
  return {
    discordToken: "",
    discordAppId: "",
    discordChannelId: "",
    discordUserId: "",
    discordWebhookUrl: "",
    ircHost: server.host,
    ircPort: server.port,
    ircTls: server.tls,
    ircNick: "",
    ircChannel: "",
    ircServerPassword: "",
    ircNickservPassword: "",
    ownerOnly: true,
    servers: [server],
    links: [emptyLink(server.id, "primary")],
  };
};

export type LiveStatus = {
  mode: BridgeMode;
  discord: ConnectionState;
  irc: ConnectionState;
  discordDetail: string;
  ircDetail: string;
  lastError: string;
  startedAt: number | null;
  stats: {
    ircToDiscord: number;
    discordToIrc: number;
    imagesAsLinks: number;
  };
};
