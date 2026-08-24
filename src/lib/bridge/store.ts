import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  attachmentsFromFiles,
  DEMO_LINKS,
  DEMO_SERVERS,
  pairMessages,
  randomIrcLine,
  seedDemo,
  seedEvents,
} from "./demo";
import {
  defaultConfig,
  emptyLink,
  emptyServer,
  filledLinks,
  normalizeConfig,
  type BridgeConfig,
  type BridgeEvent,
  type ChannelLink,
  type DeskMessage,
  type IrcNetwork,
  type LiveStatus,
} from "./types";

const YOU_DEFAULT = "you";

type DeskState = {
  setupOpen: boolean;
  you: string;
  config: BridgeConfig;
  activeLinkId: string;
  messages: DeskMessage[];
  events: BridgeEvent[];
  live: LiveStatus;
  connecting: boolean;
  lastLiveError: string;
  setSetupOpen: (open: boolean) => void;
  setYou: (you: string) => void;
  setActiveLinkId: (id: string) => void;
  patchConfig: (patch: Partial<BridgeConfig>) => void;
  patchServer: (id: string, patch: Partial<IrcNetwork>) => void;
  addServer: () => void;
  removeServer: (id: string) => void;
  patchLink: (id: string, patch: Partial<ChannelLink>) => void;
  addLink: () => void;
  removeLink: (id: string) => void;
  resetDemo: () => void;
  beginLive: (status: LiveStatus) => void;
  postFromDiscord: (text: string, files?: File[]) => void;
  postFromIrc: (text: string) => void;
  ingestLive: (messages: DeskMessage[], events: BridgeEvent[], live: LiveStatus) => void;
  setConnecting: (v: boolean) => void;
  setLastLiveError: (v: string) => void;
};

function blankLive(): LiveStatus {
  return {
    mode: "demo",
    discord: "idle",
    irc: "idle",
    discordDetail: "Demo feed",
    ircDetail: "Demo feed",
    lastError: "",
    startedAt: null,
    stats: { ircToDiscord: 0, discordToIrc: 0, imagesAsLinks: 0 },
  };
}

function boot(you: string): Pick<DeskState, "messages" | "events" | "live" | "activeLinkId"> {
  const now = Date.now();
  const seeded = seedDemo(now, you);
  const events = seedEvents(now, you);
  const images = events.filter((e) => e.kind === "image-link").length;
  const ircIn = events.filter((e) => e.kind === "irc-in").length;
  const discIn = events.filter((e) => e.kind === "discord-in").length;
  return {
    activeLinkId: DEMO_LINKS[0]!.id,
    messages: seeded,
    events,
    live: {
      ...blankLive(),
      stats: { ircToDiscord: ircIn, discordToIrc: discIn, imagesAsLinks: images },
    },
  };
}

export const useDesk = create<DeskState>()(
  persist(
    (set, get) => ({
      setupOpen: false,
      you: YOU_DEFAULT,
      config: defaultConfig(),
      ...boot(YOU_DEFAULT),
      connecting: false,
      lastLiveError: "",
      setSetupOpen: (setupOpen) => set({ setupOpen }),
      setYou: (you) => {
        const trimmed = you.trim() || YOU_DEFAULT;
        const config = normalizeConfig(get().config);
        const servers = config.servers.map((s, i) =>
          i === 0 && !s.nick.trim() ? { ...s, nick: trimmed } : s,
        );
        set({
          you: trimmed,
          config: normalizeConfig({ ...config, servers, ircNick: config.ircNick || trimmed }),
        });
      },
      setActiveLinkId: (activeLinkId) => set({ activeLinkId }),
      patchConfig: (patch) => {
        const merged = { ...get().config, ...patch };
        set({ config: normalizeConfig(merged) });
      },
      patchServer: (id, patch) => {
        const config = normalizeConfig(get().config);
        const servers = config.servers.map((s) => (s.id === id ? { ...s, ...patch } : s));
        set({ config: normalizeConfig({ ...config, servers }) });
      },
      addServer: () => {
        const config = normalizeConfig(get().config);
        const next = emptyServer();
        const nick = config.servers[0]?.nick.trim();
        if (nick) next.nick = nick;
        set({ config: normalizeConfig({ ...config, servers: [...config.servers, next] }) });
      },
      removeServer: (id) => {
        const config = normalizeConfig(get().config);
        let servers = config.servers.filter((s) => s.id !== id);
        if (servers.length === 0) servers = [emptyServer("primary-irc")];
        const fallback = servers[0]!.id;
        const links = config.links.map((l) =>
          l.serverId === id ? { ...l, serverId: fallback } : l,
        );
        set({ config: normalizeConfig({ ...config, servers, links }) });
      },
      patchLink: (id, patch) => {
        const config = normalizeConfig(get().config);
        const links = config.links.map((l) => (l.id === id ? { ...l, ...patch } : l));
        set({ config: normalizeConfig({ ...config, links }) });
      },
      addLink: () => {
        const config = normalizeConfig(get().config);
        const serverId = config.servers[0]?.id ?? emptyServer("primary-irc").id;
        const links = [...config.links, emptyLink(serverId)];
        set({ config: normalizeConfig({ ...config, links }) });
      },
      removeLink: (id) => {
        const config = normalizeConfig(get().config);
        let links = config.links.filter((l) => l.id !== id);
        if (links.length === 0) {
          links = [emptyLink(config.servers[0]?.id ?? "primary-irc", "primary")];
        }
        const activeLinkId =
          get().activeLinkId === id ? links[0]!.id : get().activeLinkId;
        set({ config: normalizeConfig({ ...config, links }), activeLinkId });
      },
      resetDemo: () => set({ ...boot(get().you), lastLiveError: "", connecting: false }),
      beginLive: (status) => {
        const links = filledLinks(get().config);
        set({
          messages: [],
          events: [],
          live: status,
          connecting: false,
          lastLiveError: status.lastError,
          activeLinkId: links[0]?.id ?? get().activeLinkId,
        });
      },
      postFromDiscord: (text, files) => {
        const attachments = files && files.length ? attachmentsFromFiles(files) : [];
        if (!text.trim() && attachments.length === 0) return;
        const packed = pairMessages({
          at: Date.now(),
          from: "discord",
          nick: get().you,
          text: text.trim(),
          attachments,
          linkId: get().activeLinkId,
        });
        set((s) => ({
          messages: [...s.messages, ...packed.messages].slice(-400),
          events: [...s.events, ...packed.events].slice(-200),
          live: {
            ...s.live,
            stats: {
              ...s.live.stats,
              discordToIrc: s.live.stats.discordToIrc + 1,
              imagesAsLinks:
                s.live.stats.imagesAsLinks + attachments.filter((a) => a.isImage).length,
            },
          },
        }));
      },
      postFromIrc: (text) => {
        if (!text.trim()) return;
        const packed = pairMessages({
          at: Date.now(),
          from: "irc",
          nick: get().config.ircNick || get().you,
          text: text.trim(),
          linkId: get().activeLinkId,
        });
        set((s) => ({
          messages: [...s.messages, ...packed.messages].slice(-400),
          events: [...s.events, ...packed.events].slice(-200),
          live: {
            ...s.live,
            stats: {
              ...s.live.stats,
              ircToDiscord: s.live.stats.ircToDiscord + 1,
            },
          },
        }));
      },
      ingestLive: (messages, events, live) =>
        set((s) => {
          const newMessages = messages.filter((m) => !s.messages.some((x) => x.id === m.id));
          const newEvents = events.filter((e) => !s.events.some((x) => x.id === e.id));
          const statusChanged = JSON.stringify(s.live) !== JSON.stringify(live);
          if (newMessages.length === 0 && newEvents.length === 0 && !statusChanged) return s;
          return {
            messages: [...s.messages, ...newMessages].slice(-400),
            events: [...s.events, ...newEvents].slice(-200),
            live,
            connecting: false,
            lastLiveError: live.lastError,
          };
        }),
      setConnecting: (connecting) => set({ connecting }),
      setLastLiveError: (lastLiveError) => set({ lastLiveError }),
    }),
    {
      name: "envoy-desk",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ config: s.config, you: s.you }),
      skipHydration: true,
      version: 3,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Pick<DeskState, "config" | "you">>;
        return {
          ...current,
          ...p,
          config: normalizeConfig({ ...current.config, ...(p.config ?? {}) }),
          you: p.you || current.you,
        };
      },
    },
  ),
);

let ambientTimer: number | null = null;

export function startAmbientIrc() {
  if (typeof window === "undefined") return;
  if (ambientTimer != null) return;
  const tick = () => {
    const s = useDesk.getState();
    if (s.live.mode === "live") return;
    if (document.hidden) return;
    if (Math.random() < 0.55) {
      const packed = randomIrcLine(Date.now(), s.activeLinkId);
      useDesk.setState((cur) => ({
        messages: [...cur.messages, ...packed.messages].slice(-400),
        events: [...cur.events, ...packed.events].slice(-200),
        live: {
          ...cur.live,
          stats: {
            ...cur.live.stats,
            ircToDiscord: cur.live.stats.ircToDiscord + 1,
          },
        },
      }));
    }
  };
  ambientTimer = window.setInterval(tick, 14000);
}

export function stopAmbientIrc() {
  if (ambientTimer != null) {
    window.clearInterval(ambientTimer);
    ambientTimer = null;
  }
}

export function visibleLinks(isLive: boolean, config: BridgeConfig): ChannelLink[] {
  if (isLive) {
    const live = filledLinks(config);
    return live.length ? live : normalizeConfig(config).links;
  }
  return DEMO_LINKS;
}

export function visibleServers(isLive: boolean, config: BridgeConfig): IrcNetwork[] {
  if (isLive) return normalizeConfig(config).servers;
  return DEMO_SERVERS;
}
