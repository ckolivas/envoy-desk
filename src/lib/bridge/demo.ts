import {
  classifyAttachment,
  discordPayloadToIrc,
  fakeCdnLink,
  ircPayloadToDiscord,
} from "./format";
import type { Attachment, BridgeEvent, ChannelLink, DeskMessage, IrcNetwork } from "./types";

export const DEMO_SERVERS: IrcNetwork[] = [
  {
    id: "demo-libera",
    host: "irc.libera.chat",
    port: 6697,
    tls: true,
    nick: "you",
    serverPassword: "",
    nickservPassword: "",
  },
  {
    id: "demo-oftc",
    host: "irc.oftc.net",
    port: 6697,
    tls: true,
    nick: "you",
    serverPassword: "",
    nickservPassword: "",
  },
];

export const DEMO_LINKS: ChannelLink[] = [
  {
    id: "demo-main",
    serverId: "demo-libera",
    ircChannel: "#envoy-demo",
    discordChannelId: "mirror",
    discordWebhookUrl: "",
  },
  {
    id: "demo-ops",
    serverId: "demo-oftc",
    ircChannel: "#ops",
    discordChannelId: "ops",
    discordWebhookUrl: "",
  },
];

let seq = 0;
const nid = (p: string) => `${p}-${++seq}-${Math.random().toString(36).slice(2, 7)}`;

type DemoNick = {
  name: string;
  side: "irc";
};

const CAST: DemoNick[] = [
  { name: "alice", side: "irc" },
  { name: "gareth", side: "irc" },
  { name: "tanya", side: "irc" },
  { name: "moth", side: "irc" },
];

const LINES: Record<string, string[]> = {
  "demo-main": [
    "anyone still on for the 1100 cut?",
    "logs look clean on my end",
    "pushing the config now",
    "got it — one sec",
    "that patch is on staging",
    "ack, watching the join",
    "ship it",
    "brb, kettle",
  ],
  "demo-ops": [
    "page is quiet",
    "leaf 3 is back",
    "need eyes on the backlog",
    "rebooted the leaf",
    "hold the window",
    "ack on the failover",
  ],
};

function ircSafeAttachments(attachments: Attachment[], pairId: string): Attachment[] {
  return attachments.map((a, i) => {
    if (a.url.startsWith("blob:") || a.url.startsWith("data:")) {
      return { ...a, url: fakeCdnLink(`${pairId}${i}`, a.filename) };
    }
    return a;
  });
}

export function pairMessages(input: {
  at: number;
  from: "irc" | "discord";
  nick: string;
  text: string;
  attachments?: Attachment[];
  kind?: DeskMessage["kind"];
  linkId?: string;
}): { messages: DeskMessage[]; events: BridgeEvent[] } {
  const pairId = nid("pair");
  const attachments = input.attachments ?? [];
  const kind = input.kind ?? "chat";
  const linkId = input.linkId ?? DEMO_LINKS[0]!.id;
  const link = DEMO_LINKS.find((l) => l.id === linkId) ?? DEMO_LINKS[0]!;
  const events: BridgeEvent[] = [];

  if (input.from === "irc") {
    const discordText = ircPayloadToDiscord(input.nick, input.text, kind === "action");
    const ircMsg: DeskMessage = {
      id: nid("irc"),
      side: "irc",
      at: input.at,
      nick: input.nick,
      text: input.text,
      kind,
      attachments: [],
      bridged: false,
      pairId,
      linkId,
    };
    const discMsg: DeskMessage = {
      id: nid("dsc"),
      side: "discord",
      at: input.at + 40,
      nick: input.nick,
      text: discordText.replace(/^\*\*[^*]+\*\*\s*/, ""),
      kind,
      attachments: [],
      bridged: true,
      pairId,
      linkId,
    };
    events.push({
      id: nid("ev"),
      at: input.at,
      kind: "irc-in",
      summary: `${input.nick} ${link.ircChannel} → Discord`,
    });
    return { messages: [ircMsg, discMsg], events };
  }

  const ircAttachments = ircSafeAttachments(attachments, pairId);
  const packed = discordPayloadToIrc({
    content: input.text,
    attachments: ircAttachments,
  });
  const discMsg: DeskMessage = {
    id: nid("dsc"),
    side: "discord",
    at: input.at,
    nick: input.nick,
    text: input.text,
    kind,
    attachments,
    bridged: false,
    pairId,
    linkId,
  };
  const ircMsg: DeskMessage = {
    id: nid("irc"),
    side: "irc",
    at: input.at + 40,
    nick: input.nick,
    text: packed.text,
    kind,
    attachments: ircAttachments,
    bridged: true,
    pairId,
    linkId,
  };
  events.push({
    id: nid("ev"),
    at: input.at,
    kind: "discord-in",
    summary: `${input.nick} → ${link.ircChannel}`,
  });
  if (packed.imageCount > 0) {
    events.push({
      id: nid("ev"),
      at: input.at,
      kind: "image-link",
      summary: `${packed.imageCount} image${packed.imageCount === 1 ? "" : "s"} → link`,
    });
  }
  return { messages: [discMsg, ircMsg], events };
}

export function seedDemo(now: number, you: string): DeskMessage[] {
  const alice = pairMessages({
    at: now - 96_000,
    from: "irc",
    nick: "alice",
    text: "morning. queue is quiet",
    linkId: "demo-main",
  });
  const gareth = pairMessages({
    at: now - 71_000,
    from: "irc",
    nick: "gareth",
    text: "desk is live if you want to dump the shot here",
    linkId: "demo-main",
  });
  const stillId = "still01";
  const youShot = pairMessages({
    at: now - 48_000,
    from: "discord",
    nick: you,
    text: "here's the still from last night",
    attachments: [
      classifyAttachment(fakeCdnLink(stillId, "night-desk.png"), "night-desk.png", "image/png"),
    ],
    linkId: "demo-main",
  });
  const tanya = pairMessages({
    at: now - 22_000,
    from: "irc",
    nick: "tanya",
    text: "got it, pulling the link down now",
    linkId: "demo-main",
  });
  const ops1 = pairMessages({
    at: now - 80_000,
    from: "irc",
    nick: "moth",
    text: "leaf 3 flapped, watching it",
    linkId: "demo-ops",
  });
  const ops2 = pairMessages({
    at: now - 18_000,
    from: "irc",
    nick: "gareth",
    text: "hold the window — failover is clean",
    linkId: "demo-ops",
  });
  return [
    ...alice.messages,
    ...gareth.messages,
    ...youShot.messages,
    ...tanya.messages,
    ...ops1.messages,
    ...ops2.messages,
  ];
}

export function seedEvents(now: number, you: string): BridgeEvent[] {
  return [
    { id: "ev-s1", at: now - 96_000, kind: "irc-in", summary: "alice #envoy-demo → Discord" },
    { id: "ev-s2", at: now - 80_000, kind: "irc-in", summary: "moth #ops → Discord" },
    { id: "ev-s3", at: now - 71_000, kind: "irc-in", summary: "gareth #envoy-demo → Discord" },
    { id: "ev-s4", at: now - 48_000, kind: "discord-in", summary: `${you} → #envoy-demo` },
    { id: "ev-s5", at: now - 48_000, kind: "image-link", summary: "1 image → link" },
    { id: "ev-s6", at: now - 22_000, kind: "irc-in", summary: "tanya #envoy-demo → Discord" },
    { id: "ev-s7", at: now - 18_000, kind: "irc-in", summary: "gareth #ops → Discord" },
  ];
}

export function randomIrcLine(now: number, linkId?: string): ReturnType<typeof pairMessages> {
  const link =
    DEMO_LINKS.find((l) => l.id === linkId) ??
    DEMO_LINKS[Math.floor(Math.random() * DEMO_LINKS.length)]!;
  const pool = LINES[link.id] ?? LINES["demo-main"]!;
  const who = CAST[Math.floor(Math.random() * CAST.length)]!;
  const line = pool[Math.floor(Math.random() * pool.length)]!;
  const action = Math.random() < 0.08;
  return pairMessages({
    at: now,
    from: "irc",
    nick: who.name,
    text: action ? "taps the desk" : line,
    kind: action ? "action" : "chat",
    linkId: link.id,
  });
}

export function attachmentsFromFiles(files: File[]): Attachment[] {
  return files.map((file, i) => {
    const url = URL.createObjectURL(file);
    return classifyAttachment(url, file.name || `image-${i}.png`, file.type);
  });
}

export { nid };
