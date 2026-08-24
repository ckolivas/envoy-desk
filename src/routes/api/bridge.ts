import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { normalizeConfig, type BridgeConfig } from "@/lib/bridge/types";

const serverSchema = z.object({
  id: z.string(),
  host: z.string(),
  port: z.number(),
  tls: z.boolean(),
  nick: z.string(),
  serverPassword: z.string(),
  nickservPassword: z.string(),
});

const linkSchema = z.object({
  id: z.string(),
  serverId: z.string(),
  ircChannel: z.string(),
  discordChannelId: z.string(),
  discordWebhookUrl: z.string(),
});

const configSchema = z.object({
  discordToken: z.string(),
  discordAppId: z.string(),
  discordChannelId: z.string(),
  discordUserId: z.string(),
  discordWebhookUrl: z.string(),
  ircHost: z.string(),
  ircPort: z.number(),
  ircTls: z.boolean(),
  ircNick: z.string(),
  ircChannel: z.string(),
  ircServerPassword: z.string(),
  ircNickservPassword: z.string(),
  ownerOnly: z.boolean(),
  servers: z.array(serverSchema),
  links: z.array(linkSchema),
});

const bodySchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("start"), config: configSchema }),
  z.object({ op: z.literal("stop") }),
  z.object({
    op: z.literal("poll"),
    sinceMessageId: z.string(),
    sinceEventId: z.string(),
  }),
  z.object({
    op: z.literal("irc"),
    text: z.string(),
    ircChannel: z.string(),
    serverId: z.string(),
  }),
]);

function after<T extends { id: string }>(list: T[], id: string): T[] {
  if (!id) return list;
  const i = list.findIndex((x) => x.id === id);
  if (i === -1) return list;
  return list.slice(i + 1);
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/bridge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed: z.infer<typeof bodySchema>;
        try {
          parsed = bodySchema.parse(await request.json());
        } catch (err) {
          const message = err instanceof Error ? err.message : "Invalid request";
          return json({ error: message }, 400);
        }

        try {
          const runtime = await import("@/lib/bridge/runtime.server");
          if (parsed.op === "start") {
            const status = await runtime.startBridge(
              normalizeConfig(parsed.config as BridgeConfig),
            );
            return json(status);
          }
          if (parsed.op === "stop") {
            return json(await runtime.stopBridge());
          }
          if (parsed.op === "poll") {
            const snap = runtime.snapshot();
            return json({
              status: snap.status,
              messages: after(snap.messages, parsed.sinceMessageId),
              events: after(snap.events, parsed.sinceEventId),
            });
          }
          await runtime.injectIrc(parsed.text, parsed.ircChannel, parsed.serverId);
          return json({ ok: true as const });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Bridge request failed";
          return json({ error: message }, 400);
        }
      },
    },
  },
});
