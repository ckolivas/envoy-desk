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

export type ChannelLink = {
  id: string;
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
  links: ChannelLink[];
};

export function makeLinkId(): string {
  return `link-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyLink(id = makeLinkId()): ChannelLink {
  return { id, ircChannel: "", discordChannelId: "", discordWebhookUrl: "" };
}

export function normalizeConfig(config: BridgeConfig): BridgeConfig {
  const links = (config.links ?? []).map((l) => ({
    id: l.id || makeLinkId(),
    ircChannel: l.ircChannel ?? "",
    discordChannelId: l.discordChannelId ?? "",
    discordWebhookUrl: l.discordWebhookUrl ?? "",
  }));
  if (links.length === 0) {
    links.push({
      id: "primary",
      ircChannel: config.ircChannel ?? "",
      discordChannelId: config.discordChannelId ?? "",
      discordWebhookUrl: config.discordWebhookUrl ?? "",
    });
  } else {
    const first = links[0]!;
    if (!first.ircChannel.trim()) first.ircChannel = config.ircChannel ?? "";
    if (!first.discordChannelId.trim()) first.discordChannelId = config.discordChannelId ?? "";
    if (!first.discordWebhookUrl.trim()) first.discordWebhookUrl = config.discordWebhookUrl ?? "";
  }
  const primary = links[0]!;
  return {
    ...config,
    links,
    ircChannel: primary.ircChannel,
    discordChannelId: primary.discordChannelId,
    discordWebhookUrl: primary.discordWebhookUrl,
  };
}

export function filledLinks(config: BridgeConfig): ChannelLink[] {
  return normalizeConfig(config).links.filter(
    (l) => l.ircChannel.trim().length > 0 && l.discordChannelId.trim().length > 0,
  );
}

export const defaultConfig = (): BridgeConfig => ({
  discordToken: "",
  discordAppId: "",
  discordChannelId: "",
  discordUserId: "",
  discordWebhookUrl: "",
  ircHost: "irc.libera.chat",
  ircPort: 6697,
  ircTls: true,
  ircNick: "",
  ircChannel: "",
  ircServerPassword: "",
  ircNickservPassword: "",
  ownerOnly: true,
  links: [emptyLink("primary")],
});

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
