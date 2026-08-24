import type { Attachment } from "./types";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|tif{1,2})$/i;
const IMAGE_TYPE = /^image\//i;

export function isImageAttachment(filename: string, contentType?: string): boolean {
  if (contentType && IMAGE_TYPE.test(contentType)) return true;
  return IMAGE_EXT.test(filename.split("?")[0] ?? filename);
}

export function classifyAttachment(
  url: string,
  filename: string,
  contentType?: string,
): Attachment {
  return {
    url,
    filename: filename || url.split("/").pop() || "file",
    contentType,
    isImage: isImageAttachment(filename, contentType),
  };
}

/** Flatten Discord markdown into something that reads on IRC. */
export function discordMarkupToIrc(content: string): string {
  let text = content.replace(/\r\n/g, "\n");
  text = text.replace(/<a?:([a-zA-Z0-9_]+):\d+>/g, ":$1:");
  text = text.replace(/<@!?(\d+)>/g, "@user");
  text = text.replace(/<@&(\d+)>/g, "@role");
  text = text.replace(/<#(\d+)>/g, "#channel");
  text = text.replace(/<t:(\d+)(?::[tTdDfFR])?>/g, (_, s) => {
    const ms = Number(s) * 1000;
    if (!Number.isFinite(ms)) return "";
    return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  });
  text = text.replace(/\|\|(.+?)\|\|/g, "$1");
  text = text.replace(/```(?:[a-zA-Z0-9]+)?\n?([\s\S]*?)```/g, (_, body) =>
    String(body).trim().replace(/\n/g, " | "),
  );
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/\*\*(.+?)\*\*/g, "$1");
  text = text.replace(/__(.+?)__/g, "$1");
  text = text.replace(/\*(.+?)\*/g, "$1");
  text = text.replace(/_(.+?)_/g, "$1");
  text = text.replace(/~~(.+?)~~/g, "$1");
  text = text.replace(/\n+/g, " | ");
  return text.replace(/[ \t]+/g, " ").trim();
}

export function stripIrcFormatting(text: string): string {
  return text
    .replace(/\x03\d{1,2}(?:,\d{1,2})?/g, "")
    .replace(/[\x02\x1d\x1f\x16\x0f\x04]/g, "")
    .replace(/\x01/g, "");
}

export function parseIrcAction(text: string): { text: string; isAction: boolean } {
  const m = text.match(/^\x01ACTION (.*)\x01$/s);
  if (m) return { text: m[1] ?? "", isAction: true };
  return { text, isAction: false };
}

/**
 * What Envoy types on IRC when you post in Discord:
 * message text plus every image/file as a raw URL.
 */
export function discordPayloadToIrc(input: {
  content: string;
  attachments: Attachment[];
}): { text: string; imageCount: number; links: string[] } {
  const body = discordMarkupToIrc(input.content);
  const links: string[] = [];
  let imageCount = 0;
  for (const a of input.attachments) {
    if (!a.url) continue;
    if (!links.includes(a.url)) links.push(a.url);
    if (a.isImage) imageCount += 1;
  }
  const parts = [body, ...links].filter((p) => p.length > 0);
  return { text: parts.join(" ").trim(), imageCount, links };
}

/** IRC → Discord line, always carrying the speaker's nick. */
export function ircPayloadToDiscord(nick: string, text: string, isAction: boolean): string {
  const clean = stripIrcFormatting(text).trim();
  const safeNick = nick.replace(/[*_`~]/g, "") || "unknown";
  if (isAction) return `\\* **${safeNick}** ${clean}`.trim();
  if (!clean) return `**${safeNick}**`;
  return `**${safeNick}**  ${clean}`;
}

export function splitIrcLines(text: string, max = 400): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

export function sanitizeWebhookName(nick: string): string {
  const cleaned = nick.replace(/discord/gi, "d1scord").replace(/clyde/gi, "c1yde");
  return cleaned.slice(0, 80) || "irc";
}

export function fakeCdnLink(id: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, "_") || "image.png";
  return `https://cdn.discordapp.com/attachments/envoy/${id}/${safe}`;
}

export function formatClock(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function inviteUrl(appId: string): string {
  const id = appId.trim();
  if (!id) return "";
  const permissions = 117760;
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(id)}&permissions=${permissions}&scope=bot`;
}

export function channelLabel(raw: string, fallback: string): string {
  const v = raw.trim();
  if (!v) return fallback;
  return v.startsWith("#") ? v : `#${v}`;
}

export function discordLabel(raw: string, fallback = "#mirror"): string {
  const v = raw.trim();
  if (!v) return fallback;
  if (v.startsWith("#")) return v;
  if (/^\d{8,}$/.test(v)) return `#${v.slice(-6)}`;
  return `#${v}`;
}

export function ircChannelName(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  return v.startsWith("#") ? v : `#${v}`;
}

export function pairCaption(ircChannel: string, discordChannelId: string): string {
  return `${channelLabel(ircChannel, "#irc")} · ${discordLabel(discordChannelId)}`;
}
