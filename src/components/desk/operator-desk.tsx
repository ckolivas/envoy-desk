import { Settings2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Toaster } from "sonner";
import { ChannelPane } from "@/components/desk/channel-pane";
import { ComposeBox } from "@/components/desk/compose-box";
import { SetupPanel } from "@/components/desk/setup-panel";
import { Button } from "@/components/ui/button";
import { pollLiveBridge, sendLiveIrc } from "@/lib/bridge/actions";
import { channelLabel, discordLabel, pairCaption } from "@/lib/bridge/format";
import { startAmbientIrc, stopAmbientIrc, useDesk, visibleLinks } from "@/lib/bridge/store";
import type { BridgeEvent, ChannelLink, LiveStatus } from "@/lib/bridge/types";
import { cn } from "@/lib/utils";

type Tab = "irc" | "discord" | "log";

function StatusPip({
  label,
  tone,
  detail,
}: {
  label: string;
  tone: "irc" | "discord" | "idle" | "error";
  detail: string;
}) {
  const color =
    tone === "irc"
      ? "bg-irc"
      : tone === "discord"
        ? "bg-discord"
        : tone === "error"
          ? "bg-danger"
          : "bg-subtle";
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className={cn("size-1.5 shrink-0 rounded-full", color, tone !== "idle" && "live-dot")} />
      <div className="min-w-0 leading-tight">
        <p className="text-2xs uppercase tracking-kicker text-subtle">{label}</p>
        <p className="truncate font-mono text-xs text-fg">{detail}</p>
      </div>
    </div>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <rect x="3" y="5" width="3.5" height="14" rx="0.8" className="fill-irc" />
      <rect x="17.5" y="5" width="3.5" height="14" rx="0.8" className="fill-discord" />
      <path d="M6.5 12h11" className="stroke-paper" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PairSwitcher({
  links,
  activeId,
  onSelect,
}: {
  links: ChannelLink[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  if (links.length < 2) return null;
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-fg/10 px-3 py-2 md:px-6">
      {links.map((link) => {
        const active = link.id === activeId;
        return (
          <button
            key={link.id}
            type="button"
            onClick={() => onSelect(link.id)}
            className={cn(
              "h-10 shrink-0 rounded-md px-3 font-mono text-xs transition-[background-color,color] duration-150",
              active ? "bg-elevated text-fg" : "text-muted hover:text-fg",
            )}
          >
            {pairCaption(link.ircChannel, link.discordChannelId)}
          </button>
        );
      })}
    </div>
  );
}

export function OperatorDesk() {
  const [tab, setTab] = useState<Tab>("discord");
  const [mounted, setMounted] = useState(false);
  const messages = useDesk((s) => s.messages);
  const events = useDesk((s) => s.events);
  const live = useDesk((s) => s.live);
  const you = useDesk((s) => s.you);
  const config = useDesk((s) => s.config);
  const activeLinkId = useDesk((s) => s.activeLinkId);
  const setActiveLinkId = useDesk((s) => s.setActiveLinkId);
  const postFromDiscord = useDesk((s) => s.postFromDiscord);
  const postFromIrc = useDesk((s) => s.postFromIrc);
  const setSetupOpen = useDesk((s) => s.setSetupOpen);
  const ingestLive = useDesk((s) => s.ingestLive);
  const lastError = useDesk((s) => s.lastLiveError);
  const sinceRef = useRef({ messageId: "", eventId: "" });

  const isLive = live.mode === "live";
  const links = useMemo(() => visibleLinks(isLive, config), [isLive, config]);
  const active = links.find((l) => l.id === activeLinkId) ?? links[0];
  const pairId = active?.id;
  const pairMessages = messages.filter((m) => !m.linkId || !pairId || m.linkId === pairId);
  const ircMessages = pairMessages.filter((m) => m.side === "irc");
  const discMessages = pairMessages.filter((m) => m.side === "discord");

  useEffect(() => {
    setMounted(true);
    void useDesk.persist.rehydrate();
    startAmbientIrc();
    return () => stopAmbientIrc();
  }, []);

  useEffect(() => {
    if (!active && links[0]) setActiveLinkId(links[0].id);
  }, [active, links, setActiveLinkId]);

  useEffect(() => {
    sinceRef.current = {
      messageId: messages.at(-1)?.id ?? "",
      eventId: events.at(-1)?.id ?? "",
    };
  }, [messages, events]);

  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const snap = await pollLiveBridge({
          data: {
            sinceMessageId: sinceRef.current.messageId,
            sinceEventId: sinceRef.current.eventId,
          },
        });
        if (!cancelled) ingestLive(snap.messages, snap.events, snap.status);
      } catch {
        /* keep last status */
      }
    };
    const id = window.setInterval(() => void tick(), 1200);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isLive, ingestLive]);

  const ircTitle = channelLabel(active?.ircChannel ?? "", "#envoy-demo");
  const discTitle = discordLabel(active?.discordChannelId ?? "", "#mirror");

  async function onIrcSend(text: string) {
    if (isLive) {
      try {
        await sendLiveIrc({
          data: { text, ircChannel: active?.ircChannel ?? "" },
        });
      } catch {
        postFromIrc(text);
      }
      return;
    }
    postFromIrc(text);
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <header className="flex items-center justify-between gap-3 border-b border-fg/10 px-4 py-3 md:px-6">
        <div className="flex items-center gap-2.5">
          <Mark />
          <div>
            <p className="text-sm font-semibold tracking-mark">ENVOY</p>
            <p className="text-2xs text-muted">Discord desk on IRC</p>
          </div>
        </div>
        <div className="hidden min-w-0 items-center gap-6 md:flex">
          <StatusPip
            label="IRC"
            tone={live.irc === "online" || !isLive ? "irc" : live.irc === "error" ? "error" : "idle"}
            detail={isLive ? live.ircDetail : `${links.length} pairs · demo`}
          />
          <StatusPip
            label="Discord"
            tone={
              live.discord === "online" || !isLive
                ? "discord"
                : live.discord === "error"
                  ? "error"
                  : "idle"
            }
            detail={isLive ? live.discordDetail : `${discTitle} · demo`}
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => setSetupOpen(true)}>
          <Settings2 className="size-4" />
          <span className="hidden sm:inline">Patch in</span>
        </Button>
      </header>

      {lastError ? (
        <p className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-paper">
          {lastError}
        </p>
      ) : null}

      <PairSwitcher links={links} activeId={active?.id ?? ""} onSelect={setActiveLinkId} />

      <div className="flex gap-1 border-b border-fg/10 px-3 py-2 md:hidden">
        {(["discord", "irc", "log"] as Tab[]).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "h-10 flex-1 rounded-md text-xs font-medium capitalize transition-[background-color,color] duration-150",
              tab === id ? "bg-elevated text-fg" : "text-muted",
            )}
          >
            {id}
          </button>
        ))}
      </div>

      <main className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className={cn("min-h-0 min-w-0 flex-1 md:flex", tab === "irc" ? "flex" : "hidden md:flex")}>
          <ChannelPane
            side="irc"
            title={ircTitle}
            subtitle={isLive ? `${config.ircHost}` : "Demo channel · everyone speaks"}
            status={isLive ? live.irc : "demo"}
            messages={mounted ? ircMessages : []}
          >
            <ComposeBox
              placeholder={isLive ? `Speak on ${ircTitle}` : `Speak on ${ircTitle} as ${you}`}
              onSend={(text) => void onIrcSend(text)}
              hint="IRC sees your nick only — no Discord wrapper."
            />
          </ChannelPane>
        </div>
        <div className="hidden w-px bg-fg/10 md:block" />
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 md:flex",
            tab === "discord" ? "flex" : "hidden md:flex",
          )}
        >
          <ChannelPane
            side="discord"
            title={discTitle}
            subtitle={
              isLive
                ? "Live channel"
                : `IRC arrives with names · your posts leave as ${you}`
            }
            status={isLive ? live.discord : "demo"}
            messages={mounted ? discMessages : []}
          >
            <ComposeBox
              placeholder={isLive ? "Post in Discord — Envoy relays you" : "Post as you in Discord"}
              allowImages={!isLive}
              disabled={isLive}
              onSend={(text, files) => postFromDiscord(text, files)}
              hint={
                isLive
                  ? "Type in the real Discord channel. Images become links on IRC."
                  : "Attach or paste an image — IRC receives the link, not the file."
              }
            />
          </ChannelPane>
        </div>
        <div
          className={cn(
            "min-h-0 flex-1 flex-col bg-surface md:hidden",
            tab === "log" ? "flex" : "hidden",
          )}
        >
          <LogStrip events={events} stats={live.stats} stacked />
        </div>
      </main>

      <div className="hidden md:block">
        <LogStrip events={events} stats={live.stats} />
      </div>

      <SetupPanel />
      <Toaster
        theme="dark"
        position="bottom-center"
        toastOptions={{
          style: {
            background: "#1f221e",
            color: "#e6e4db",
            border: "1px solid rgba(230,228,219,0.12)",
            fontFamily: "IBM Plex Sans, sans-serif",
          },
        }}
      />
    </div>
  );
}

function LogStrip({
  events,
  stats,
  stacked,
}: {
  events: BridgeEvent[];
  stats: LiveStatus["stats"];
  stacked?: boolean;
}) {
  const latest = [...events].slice(-6).reverse();
  return (
    <footer
      className={cn(
        "border-t border-fg/10 bg-bg",
        stacked ? "flex-1 overflow-y-auto px-4 py-3" : "flex items-center gap-6 px-6 py-2.5",
      )}
    >
      <dl
        className={cn(
          "flex gap-5 font-mono text-2xs tabular-nums text-muted",
          stacked && "mb-3",
        )}
      >
        <div>
          <dt className="sr-only">IRC to Discord</dt>
          <dd>
            <span className="text-irc">{stats.ircToDiscord}</span> irc → discord
          </dd>
        </div>
        <div>
          <dt className="sr-only">Discord to IRC</dt>
          <dd>
            <span className="text-discord">{stats.discordToIrc}</span> discord → irc
          </dd>
        </div>
        <div>
          <dt className="sr-only">Images as links</dt>
          <dd>{stats.imagesAsLinks} images as links</dd>
        </div>
      </dl>
      <ul
        className={cn(
          "min-w-0 text-xs text-subtle",
          stacked ? "space-y-2" : "hidden truncate lg:block",
        )}
      >
        {latest.map((e) => (
          <li key={e.id} className={stacked ? "" : "inline"}>
            <span className="mr-3 font-mono">{e.summary}</span>
          </li>
        ))}
      </ul>
    </footer>
  );
}
