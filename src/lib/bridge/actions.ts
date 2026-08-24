import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const linkSchema = z.object({
  id: z.string(),
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
  links: z.array(linkSchema),
});

export const startLiveBridge = createServerFn({ method: "POST" })
  .validator(configSchema)
  .handler(async ({ data }) => {
    const { startBridge } = await import("./runtime.server");
    return startBridge(data);
  });

export const stopLiveBridge = createServerFn({ method: "POST" }).handler(async () => {
  const { stopBridge } = await import("./runtime.server");
  return stopBridge();
});

function after<T extends { id: string }>(list: T[], id: string): T[] {
  if (!id) return list;
  const i = list.findIndex((x) => x.id === id);
  if (i === -1) return list;
  return list.slice(i + 1);
}

export const pollLiveBridge = createServerFn({ method: "GET" })
  .validator(z.object({ sinceMessageId: z.string(), sinceEventId: z.string() }))
  .handler(async ({ data }) => {
    const { snapshot } = await import("./runtime.server");
    const snap = snapshot();
    return {
      status: snap.status,
      messages: after(snap.messages, data.sinceMessageId),
      events: after(snap.events, data.sinceEventId),
    };
  });

export const sendLiveIrc = createServerFn({ method: "POST" })
  .validator(z.object({ text: z.string(), ircChannel: z.string() }))
  .handler(async ({ data }) => {
    const { injectIrc } = await import("./runtime.server");
    await injectIrc(data.text, data.ircChannel);
    return { ok: true as const };
  });
