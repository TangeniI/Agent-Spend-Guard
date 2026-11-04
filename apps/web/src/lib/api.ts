'use client';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/proxy/${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, (data as { message?: string } | null)?.message ?? 'Request failed');
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
};

export interface Balance {
  mandateId: string;
  currency: string;
  budgetMinor: number;
  spentMinor: number;
  heldMinor: number;
}

export interface Mandate {
  id: string;
  perItemLimitMinor: number;
  allowedMerchantCategories: string[];
  blockedMerchants: string[];
  maxQuantityPerItem: number;
  approvalThresholdMinor: number;
  splitWindowMinutes: number;
  expiresAt: string;
  status: 'active' | 'paused' | 'revoked';
  killSwitch: boolean;
  createdAt: string;
  balance: Balance;
}

export interface Run {
  id: string;
  mandateId: string;
  task: string;
  status: 'running' | 'completed' | 'failed';
  result: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface Step {
  seq: number;
  type: 'model' | 'tool';
  payload: {
    text?: string;
    toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
    name?: string;
    args?: Record<string, unknown>;
    output?: { status?: string; reasons?: string[]; error?: string; content?: string };
  };
  createdAt: string;
}

export interface Pending {
  paymentId: string;
  mandateId: string;
  merchant: string;
  amountMinor: number;
  currency: string;
  reasons: string[];
  createdAt: string;
  agentReason: string | null;
  items: { sku?: string; quantity?: number; unitPriceMinor?: number }[];
  balance: { budgetMinor: number; spentMinor: number; heldMinor: number };
}

export interface AuditEvent {
  id: string;
  type: string;
  actor: 'agent' | 'policy' | 'human' | 'system';
  mandateId: string | null;
  payload: unknown;
  createdAt: string;
}

export interface PaymentResult {
  paymentId: string;
  status: string;
  reasons: string[];
  replayed: boolean;
}
