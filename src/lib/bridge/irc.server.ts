import net from "node:net";
import tls from "node:tls";
import { ircChannelName, parseIrcAction, stripIrcFormatting } from "./format";

export type IrcIncoming = {
  nick: string;
  text: string;
  isAction: boolean;
  target: string;
};

export type IrcClientOpts = {
  host: string;
  port: number;
  useTls: boolean;
  nick: string;
  username?: string;
  realname?: string;
  channels: string[];
  serverPassword?: string;
  nickservPassword?: string;
  onMessage: (msg: IrcIncoming) => void;
  onReady: (nick: string) => void;
  onClose: (reason: string) => void;
  onLog: (line: string) => void;
};

function parseArgs(rest: string): string[] {
  const out: string[] = [];
  let s = rest;
  while (s.length) {
    if (s.startsWith(":")) {
      out.push(s.slice(1));
      break;
    }
    const sp = s.indexOf(" ");
    if (sp === -1) {
      out.push(s);
      break;
    }
    out.push(s.slice(0, sp));
    s = s.slice(sp + 1);
  }
  return out;
}

function nickFromPrefix(prefix: string): string {
  const bang = prefix.indexOf("!");
  return bang === -1 ? prefix : prefix.slice(0, bang);
}

export class IrcClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buf = "";
  private nick: string;
  private desiredNick: string;
  private ready = false;
  private closed = false;
  private queue: string[] = [];
  private drainTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private joined = new Set<string>();
  readonly channels: string[];
  private channelSet: Set<string>;

  constructor(private opts: IrcClientOpts) {
    this.desiredNick = opts.nick;
    this.nick = opts.nick;
    this.channels = opts.channels.map((c) => ircChannelName(c)).filter(Boolean);
    this.channelSet = new Set(this.channels.map((c) => c.toLowerCase()));
  }

  get currentNick() {
    return this.nick;
  }

  get channel() {
    return this.channels[0] ?? "";
  }

  get isReady() {
    return this.ready;
  }

  connect() {
    this.closed = false;
    const { host, port, useTls } = this.opts;
    const onConnect = () => this.register();
    if (useTls) {
      this.socket = tls.connect({ host, port, servername: host }, onConnect);
    } else {
      this.socket = net.connect({ host, port }, onConnect);
    }
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk: string) => this.onData(chunk));
    this.socket.on("error", (err) => {
      this.opts.onLog(`irc error: ${err.message}`);
    });
    this.socket.on("close", () => {
      this.ready = false;
      this.stopTimers();
      if (!this.closed) this.opts.onClose("socket closed");
    });
    this.drainTimer = setInterval(() => this.drain(), 900);
    this.pingTimer = setInterval(() => {
      if (this.socket && !this.socket.destroyed) this.raw(`PING :envoy`);
    }, 60000);
  }

  disconnect() {
    this.closed = true;
    this.ready = false;
    this.stopTimers();
    try {
      this.raw("QUIT :Envoy signing off");
    } catch {
      /* ignore */
    }
    this.socket?.destroy();
    this.socket = null;
  }

  say(text: string, channel?: string) {
    const line = text.replace(/\r?\n/g, " ").slice(0, 400);
    if (!line) return;
    const dest = ircChannelName(channel || this.channel);
    if (!dest) return;
    this.queue.push(`PRIVMSG ${dest} :${line}`);
  }

  private stopTimers() {
    if (this.drainTimer) clearInterval(this.drainTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.drainTimer = null;
    this.pingTimer = null;
  }

  private drain() {
    const line = this.queue.shift();
    if (line) this.raw(line);
  }

  private register() {
    const { serverPassword, username, realname } = this.opts;
    if (serverPassword) this.raw(`PASS ${serverPassword}`);
    this.raw(`NICK ${this.nick}`);
    this.raw(`USER ${username || "envoy"} 0 * :${realname || "Envoy bridge"}`);
  }

  private raw(line: string) {
    if (!this.socket || this.socket.destroyed) return;
    this.socket.write(line + "\r\n");
  }

  private onData(chunk: string) {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).replace(/\r$/, "");
      this.buf = this.buf.slice(idx + 1);
      if (line) this.handleLine(line);
    }
  }

  private markJoined(raw: string) {
    const chan = ircChannelName(raw.split("\x07")[0] ?? "");
    if (!chan) return;
    this.joined.add(chan.toLowerCase());
    if (!this.ready) {
      this.ready = true;
      this.opts.onReady(this.nick);
    }
  }

  private handleLine(line: string) {
    let rest = line;
    if (rest.startsWith("@")) {
      const sp = rest.indexOf(" ");
      rest = sp === -1 ? rest : rest.slice(sp + 1);
    }
    let prefix = "";
    if (rest.startsWith(":")) {
      const sp = rest.indexOf(" ");
      prefix = rest.slice(1, sp);
      rest = rest.slice(sp + 1);
    }
    const sp = rest.indexOf(" ");
    const cmd = (sp === -1 ? rest : rest.slice(0, sp)).toUpperCase();
    const args = parseArgs(sp === -1 ? "" : rest.slice(sp + 1));

    if (cmd === "PING") {
      this.raw(`PONG :${args[0] ?? ""}`);
      return;
    }
    if (cmd === "001") {
      this.opts.onLog(`welcome as ${this.nick}`);
      if (this.opts.nickservPassword) {
        this.raw(`PRIVMSG NickServ :IDENTIFY ${this.opts.nickservPassword}`);
      }
      for (const channel of this.channels) this.raw(`JOIN ${channel}`);
      return;
    }
    if (cmd === "433" || cmd === "432") {
      this.nick = `${this.desiredNick}_${Math.floor(Math.random() * 90 + 10)}`;
      this.opts.onLog(`nick taken, trying ${this.nick}`);
      this.raw(`NICK ${this.nick}`);
      return;
    }
    if (cmd === "366") {
      const chan = args[1] || args[0] || "";
      this.opts.onLog(`joined ${ircChannelName(chan)}`);
      this.markJoined(chan);
      return;
    }
    if (cmd === "JOIN") {
      const who = nickFromPrefix(prefix);
      const chan = args[0] || "";
      if (who.toLowerCase() === this.nick.toLowerCase()) this.markJoined(chan);
      return;
    }
    if (cmd === "PRIVMSG") {
      const target = args[0] ?? "";
      const rawText = args[1] ?? "";
      if (!this.channelSet.has(target.toLowerCase())) return;
      const who = nickFromPrefix(prefix);
      const parsed = parseIrcAction(rawText);
      this.opts.onMessage({
        nick: who,
        text: stripIrcFormatting(parsed.text),
        isAction: parsed.isAction,
        target,
      });
    }
  }
}
