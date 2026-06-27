import WebSocket from 'ws';
import type { WsMessageHandler } from '../types.js';

export class ReconnectingWebSocket {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private reconnectAttempt = 0;

  constructor(
    private readonly url: string,
    private readonly handler: WsMessageHandler,
    private readonly options: {
      pingIntervalMs?: number;
      maxReconnectDelayMs?: number;
      onOpen?: (ws: WebSocket) => void;
    } = {},
  ) {}

  connect(): void {
    this.closed = false;
    this.ws = new WebSocket(this.url);

    this.ws.on('open', () => {
      this.reconnectAttempt = 0;
      this.options.onOpen?.(this.ws!);
    });

    this.ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        this.handler.onMessage(data);
      } catch {
        this.handler.onMessage(raw.toString());
      }
    });

    this.ws.on('error', (err) => {
      this.handler.onError(err instanceof Error ? err : new Error(String(err)));
    });

    this.ws.on('close', () => {
      this.handler.onClose();
      if (!this.closed) this.scheduleReconnect();
    });

    const pingMs = this.options.pingIntervalMs ?? 20_000;
    const pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, pingMs);
    this.ws.on('close', () => clearInterval(pingTimer));
  }

  send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private scheduleReconnect(): void {
    const max = this.options.maxReconnectDelayMs ?? 30_000;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, max);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
