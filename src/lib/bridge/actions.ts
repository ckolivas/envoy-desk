import type { BridgeConfig, BridgeEvent, DeskMessage, LiveStatus } from "./types";

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/bridge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(json.error || `Bridge request failed (${res.status})`);
  return json;
}

export function startLiveBridge({ data }: { data: BridgeConfig }) {
  return post<LiveStatus>({ op: "start", config: data });
}

export function stopLiveBridge() {
  return post<LiveStatus>({ op: "stop" });
}

export function pollLiveBridge({
  data,
}: {
  data: { sinceMessageId: string; sinceEventId: string };
}) {
  return post<{
    status: LiveStatus;
    messages: DeskMessage[];
    events: BridgeEvent[];
  }>({ op: "poll", ...data });
}

export function sendLiveIrc({
  data,
}: {
  data: { text: string; ircChannel: string; serverId: string };
}) {
  return post<{ ok: true }>({ op: "irc", ...data });
}
