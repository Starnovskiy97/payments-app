function integer(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name}: нужно целое число от ${min} до ${max}`);
  }
  return value;
}

export function outboxSettings() {
  const enabled = process.env.OUTBOX_WORKER_ENABLED ?? 'true';
  if (!['true', 'false'].includes(enabled))
    throw new Error('OUTBOX_WORKER_ENABLED: true или false');
  return {
    enabled: enabled === 'true',
    pollMs: integer('OUTBOX_POLL_MS', 250, 50, 60000),
    leaseMs: integer('OUTBOX_LEASE_MS', 30000, 1000, 300000),
    retryBaseMs: integer('OUTBOX_RETRY_BASE_MS', 500, 100, 30000),
  };
}
