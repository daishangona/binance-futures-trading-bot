import { createHmac } from 'node:crypto';

export async function httpRequest<T>(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 15_000, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const body = (await res.json()) as T & { code?: number | string; msg?: string };

    if (!res.ok) {
      throw new Error(
        `HTTP ${res.status}: ${typeof body === 'object' && body && 'msg' in body ? body.msg : res.statusText}`,
      );
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export function hmacSha256(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function hmacSha256Base64(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64');
}

export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  return entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

export function nowMs(): number {
  return Date.now();
}

export function generateClientOrderId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function sideToBinance(side: 'buy' | 'sell'): 'BUY' | 'SELL' {
  return side === 'buy' ? 'BUY' : 'SELL';
}

export function sideToBybit(side: 'buy' | 'sell'): 'Buy' | 'Sell' {
  return side === 'buy' ? 'Buy' : 'Sell';
}

export function sideToOkx(side: 'buy' | 'sell'): 'buy' | 'sell' {
  return side;
}

export function mapOrderStatus(
  raw: string,
): 'pending' | 'open' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected' | 'expired' {
  const s = raw.toLowerCase();
  if (['new', 'created', 'live', 'untriggered'].includes(s)) return 'open';
  if (['partiallyfilled', 'partially_filled'].includes(s)) return 'partially_filled';
  if (['filled', 'closed'].includes(s)) return 'filled';
  if (['cancelled', 'canceled', 'deactivated'].includes(s)) return 'cancelled';
  if (['rejected', 'failed'].includes(s)) return 'rejected';
  if (['expired'].includes(s)) return 'expired';
  return 'pending';
}
