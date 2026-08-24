import { ArrowLeftRight, Image as ImageIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { formatClock } from "@/lib/bridge/format";
import type { DeskMessage, Side } from "@/lib/bridge/types";
import { cn } from "@/lib/utils";

const URL_RE = /https?:\/\/[^\s<]+/g;

function Linkified({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  const re = new RegExp(URL_RE);
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const href = m[0].replace(/[),.;]+$/, "");
    parts.push(
      <a
        key={`u-${i++}`}
        href={href}
        target="_blank"
        rel="noreferrer"
        className="break-all text-fg underline decoration-fg/30 underline-offset-2 hover:decoration-fg"
      >
        {href}
      </a>,
    );
    last = m.index + href.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function Clock({ at }: { at: number }) {
  return (
    <time
      dateTime={new Date(at).toISOString()}
      suppressHydrationWarning
      className="w-12 shrink-0 pt-0.5 font-mono text-2xs tabular-nums text-subtle"
    >
      {formatClock(at)}
    </time>
  );
}

function MessageRow({ msg, side }: { msg: DeskMessage; side: Side }) {
  const nickColor = side === "irc" ? "text-irc" : "text-discord";
  const images = msg.attachments.filter((a) => a.isImage);
  const files = msg.attachments.filter((a) => !a.isImage);

  return (
    <article
      className={cn(
        "flex gap-3 px-4 py-2.5",
        msg.bridged && "bg-elevated/40",
      )}
    >
      <Clock at={msg.at} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn("font-mono text-sm font-medium", nickColor)}>{msg.nick}</span>
          {msg.bridged ? (
            <span className="inline-flex items-center gap-1 text-2xs uppercase tracking-kicker text-subtle">
              <ArrowLeftRight className="size-2.5" />
              bridged
            </span>
          ) : null}
        </div>
        {msg.kind === "action" ? (
          <p className="text-sm italic text-muted">
            {msg.nick} {msg.text}
          </p>
        ) : msg.text ? (
          <p className="text-sm text-fg">
            <Linkified text={msg.text} />
          </p>
        ) : null}
        {images.length > 0 && side === "discord" && !msg.bridged ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {images.map((img) => (
              <li key={img.url} className="overflow-hidden rounded-sm">
                {img.url.startsWith("blob:") || img.url.startsWith("data:") ? (
                  <img src={img.url} alt={img.filename} className="max-h-36 max-w-full object-cover" />
                ) : img.url.includes("/attachments/envoy/") ? (
                  <div className="flex items-center gap-2 rounded-sm bg-elevated px-2.5 py-2 text-xs text-muted">
                    <ImageIcon className="size-3.5" />
                    {img.filename}
                  </div>
                ) : (
                  <img src={img.url} alt={img.filename} className="max-h-36 max-w-full object-cover" />
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {files.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {files.map((f) => (
              <li key={f.url} className="font-mono text-xs">
                <a href={f.url} target="_blank" rel="noreferrer" className="underline decoration-fg/30">
                  {f.filename}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}

export function ChannelPane({
  side,
  title,
  subtitle,
  status,
  messages,
  children,
}: {
  side: Side;
  title: string;
  subtitle: string;
  status: string;
  messages: DeskMessage[];
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const rail = side === "irc" ? "bg-irc" : "bg-discord";

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-fg/10 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn("h-8 w-1 shrink-0 rounded-full", rail)} aria-hidden />
          <div className="min-w-0">
            <h2 className="truncate font-mono text-sm font-medium">{title}</h2>
            <p className="truncate text-xs text-muted">{subtitle}</p>
          </div>
        </div>
        <span className="shrink-0 font-mono text-2xs uppercase tracking-kicker text-subtle">
          {status}
        </span>
      </header>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="px-4 py-10 text-sm text-muted">Waiting for the first line.</p>
        ) : (
          <div className="flex min-h-full flex-col justify-end">
            {messages.map((msg) => (
              <MessageRow key={msg.id} msg={msg} side={side} />
            ))}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}
