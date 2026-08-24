import { Check, Copy, ExternalLink, LoaderCircle, Plus, Plug, Trash2, X } from "lucide-react";
import { useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { startLiveBridge, stopLiveBridge } from "@/lib/bridge/actions";
import { inviteUrl } from "@/lib/bridge/format";
import { useDesk } from "@/lib/bridge/store";
import { normalizeConfig, type BridgeConfig } from "@/lib/bridge/types";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs leading-snug text-subtle">{hint}</p> : null}
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    el.remove();
    return ok;
  } catch {
    return false;
  }
}

export function SetupPanel() {
  const open = useDesk((s) => s.setupOpen);
  const setOpen = useDesk((s) => s.setSetupOpen);
  const config = useDesk((s) => s.config);
  const patch = useDesk((s) => s.patchConfig);
  const patchLink = useDesk((s) => s.patchLink);
  const addLink = useDesk((s) => s.addLink);
  const removeLink = useDesk((s) => s.removeLink);
  const you = useDesk((s) => s.you);
  const setYou = useDesk((s) => s.setYou);
  const connecting = useDesk((s) => s.connecting);
  const setConnecting = useDesk((s) => s.setConnecting);
  const setLastLiveError = useDesk((s) => s.setLastLiveError);
  const resetDemo = useDesk((s) => s.resetDemo);
  const beginLive = useDesk((s) => s.beginLive);
  const live = useDesk((s) => s.live);
  const [copied, setCopied] = useState(false);

  const links = normalizeConfig(config).links;
  const invite = useMemo(() => inviteUrl(config.discordAppId), [config.discordAppId]);
  const liveOn =
    live.mode === "live" &&
    (live.discord === "online" || live.irc === "online" || live.discord === "connecting");

  const set =
    (key: keyof BridgeConfig) => (e: ChangeEvent<HTMLInputElement>) => {
      const value = e.target.type === "number" ? Number(e.target.value) : e.target.value;
      patch({ [key]: value } as Partial<BridgeConfig>);
    };

  async function connect() {
    setConnecting(true);
    setLastLiveError("");
    try {
      const status = await startLiveBridge({ data: normalizeConfig(config) });
      beginLive(status);
      toast("Bridge starting");
      setOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not start the bridge";
      setLastLiveError(message);
      toast(message);
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    setConnecting(true);
    try {
      await stopLiveBridge();
      resetDemo();
      toast("Back to the demo desk");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not stop");
    } finally {
      setConnecting(false);
    }
  }

  function copyInvite() {
    if (!invite) return;
    void copyText(invite).then((ok) => {
      if (ok) {
        setCopied(true);
        toast("Invite link copied");
        window.setTimeout(() => setCopied(false), 1600);
      } else {
        toast("Couldn't copy — use the link below");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-describedby="setup-copy">
        <div className="flex items-center justify-between border-b border-fg/10 px-5 py-4">
          <div>
            <DialogTitle className="text-base font-medium tracking-tight">Patch in</DialogTitle>
            <DialogDescription id="setup-copy" className="text-xs text-muted">
              Demo runs without credentials. Live needs a Discord bot and an IRC nick.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" aria-label="Close setup">
              <X className="size-4" />
            </Button>
          </DialogClose>
        </div>

        <div className="flex-1 space-y-8 overflow-y-auto px-5 py-5">
          <section className="space-y-3">
            <h3 className="text-xs font-medium uppercase tracking-kicker text-subtle">You</h3>
            <Field
              label="Desk name"
              hint="Shown on Discord when you post, and used as your IRC nick if you leave nick blank."
            >
              <Input
                value={you}
                onChange={(e) => setYou(e.target.value)}
                placeholder="you"
                autoComplete="off"
              />
            </Field>
            <Field
              label="Your Discord user ID"
              hint="Discord Settings → Advanced → Developer Mode, then right-click your avatar → Copy User ID."
            >
              <Input
                value={config.discordUserId}
                onChange={set("discordUserId")}
                placeholder="123456789012345678"
                inputMode="numeric"
                autoComplete="off"
              />
            </Field>
            <div className="flex items-center justify-between gap-4 rounded-lg bg-elevated px-3 py-3 shadow-[var(--shadow-border)]">
              <div>
                <p className="text-sm font-medium">Only my Discord posts</p>
                <p className="text-xs text-muted">IRC still mirrors everyone.</p>
              </div>
              <Switch
                checked={config.ownerOnly}
                onCheckedChange={(v) => patch({ ownerOnly: v })}
                aria-label="Relay only my Discord posts"
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-medium uppercase tracking-kicker text-subtle">Discord bot</h3>
            <p className="text-xs leading-relaxed text-muted">
              One bot, one server. Enable Message Content Intent, invite it, then map as many
              channels as you need below.
            </p>
            <Field label="Bot token">
              <Input
                type="password"
                value={config.discordToken}
                onChange={set("discordToken")}
                placeholder="MTAy…"
                autoComplete="off"
              />
            </Field>
            <Field label="Application ID" hint="Used only to build the invite URL.">
              <Input
                value={config.discordAppId}
                onChange={set("discordAppId")}
                placeholder="123456789012345678"
                autoComplete="off"
              />
            </Field>
            {invite ? (
              <>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-w-0 flex-1"
                    onClick={() => window.open(invite, "_blank", "noopener,noreferrer")}
                  >
                    <ExternalLink className="size-4" />
                    Open invite
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void copyInvite()}>
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    Copy
                  </Button>
                </div>
                <Field label="Invite URL" hint="Select and copy if the button is blocked (plain HTTP).">
                  <Input value={invite} readOnly onFocus={(e) => e.currentTarget.select()} />
                </Field>
              </>
            ) : (
              <Button type="button" variant="outline" className="w-full" disabled>
                <Copy className="size-4" />
                Add an application ID to invite
              </Button>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-medium uppercase tracking-kicker text-subtle">IRC</h3>
            <Field label="Nick">
              <Input
                value={config.ircNick}
                onChange={set("ircNick")}
                placeholder={you || "envoy"}
                autoComplete="off"
              />
            </Field>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Field label="Host">
                  <Input
                    value={config.ircHost}
                    onChange={set("ircHost")}
                    placeholder="irc.libera.chat"
                    autoComplete="off"
                  />
                </Field>
              </div>
              <div className="w-24 shrink-0">
                <Field label="Port">
                  <Input
                    type="number"
                    value={config.ircPort}
                    onChange={set("ircPort")}
                    min={1}
                    max={65535}
                  />
                </Field>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg bg-elevated px-3 py-3 shadow-[var(--shadow-border)]">
              <p className="text-sm font-medium">TLS</p>
              <Switch
                checked={config.ircTls}
                onCheckedChange={(v) => patch({ ircTls: v, ircPort: v ? 6697 : 6667 })}
                aria-label="Use TLS"
              />
            </div>
            <Field label="Server password (optional)">
              <Input
                type="password"
                value={config.ircServerPassword}
                onChange={set("ircServerPassword")}
                autoComplete="off"
              />
            </Field>
            <Field label="NickServ password (optional)">
              <Input
                type="password"
                value={config.ircNickservPassword}
                onChange={set("ircNickservPassword")}
                autoComplete="off"
              />
            </Field>
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-xs font-medium uppercase tracking-kicker text-subtle">
                Channel pairs
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Each IRC channel maps to one Discord channel on the same server.
              </p>
            </div>
            {links.map((link, index) => (
              <div
                key={link.id}
                className="space-y-3 rounded-lg bg-elevated p-3 shadow-[var(--shadow-border)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-2xs uppercase tracking-kicker text-subtle">
                    Pair {index + 1}
                  </p>
                  {links.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 px-2 text-muted"
                      onClick={() => removeLink(link.id)}
                      aria-label={`Remove pair ${index + 1}`}
                    >
                      <Trash2 className="size-3.5" />
                      Remove
                    </Button>
                  ) : null}
                </div>
                <Field label="IRC channel">
                  <Input
                    value={link.ircChannel}
                    onChange={(e) => patchLink(link.id, { ircChannel: e.target.value })}
                    placeholder="#your-channel"
                    autoComplete="off"
                  />
                </Field>
                <Field
                  label="Discord channel ID"
                  hint="Right-click the Discord channel → Copy Channel ID."
                >
                  <Input
                    value={link.discordChannelId}
                    onChange={(e) => patchLink(link.id, { discordChannelId: e.target.value })}
                    placeholder="123456789012345678"
                    autoComplete="off"
                  />
                </Field>
                <Field
                  label="Webhook URL (optional)"
                  hint="If set, IRC nicks appear as Discord usernames in this pair."
                >
                  <Input
                    type="password"
                    value={link.discordWebhookUrl}
                    onChange={(e) => patchLink(link.id, { discordWebhookUrl: e.target.value })}
                    placeholder="https://discord.com/api/webhooks/…"
                    autoComplete="off"
                  />
                </Field>
              </div>
            ))}
            <Button type="button" variant="outline" className="w-full" onClick={addLink}>
              <Plus className="size-4" />
              Add another pair
            </Button>
          </section>
        </div>

        <div className="flex flex-col gap-2 border-t border-fg/10 p-4">
          {liveOn ? (
            <Button variant="danger" onClick={() => void disconnect()} disabled={connecting}>
              {connecting ? <LoaderCircle className="size-4 animate-spin" /> : <Plug className="size-4" />}
              Disconnect
            </Button>
          ) : (
            <Button onClick={() => void connect()} disabled={connecting}>
              {connecting ? <LoaderCircle className="size-4 animate-spin" /> : <Plug className="size-4" />}
              Go live
            </Button>
          )}
          <p className="text-center text-xs text-subtle">
            Envoy stays bridged while this desk is running.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
