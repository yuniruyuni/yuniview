import { untraced } from "../infra/tracing";
import type { Context } from "../usecases/context";
import { deliverNotifications } from "../usecases/monitor/deliver";
import { evaluateMonitors } from "../usecases/monitor/evaluate";
import { planSweep, sweep } from "../usecases/retention/sweep";
import { expire } from "../usecases/telemetry/expire";
import { indexPending, indexStep } from "../usecases/telemetry/index-pending";

const tickMs = 5000;
const expiryMs = 60000;
/** Batches indexed per tick before evaluation runs, in steps. */
const indexSteps = 16;

/**
 * The periodic trigger for background usecases. Every server runs one;
 * usecases claim rows so servers do not repeat each other's work.
 */
export function startWorker(ctx: Context) {
  const days = Number(process.env.TELEMETRY_RETENTION_DAYS ?? 0);
  if (!Number.isInteger(days) || days < 0 || days > 3650)
    throw Error("TELEMETRY_RETENTION_DAYS must be 0–3650");
  const payloadDays = Number(process.env.TELEMETRY_PAYLOAD_DAYS ?? 7);
  if (!Number.isInteger(payloadDays) || payloadDays < 0 || payloadDays > 3650)
    throw Error("TELEMETRY_PAYLOAD_DAYS must be 0–3650");
  const notifications = Boolean(process.env.MONITOR_WEBHOOK_URL);
  let nextExpiry = 0;
  let stopped = false;
  let running: Promise<void> | undefined;
  const run = async <T>(u: {
    run(c: Context): Promise<{ ok: boolean; value?: T }>;
  }) => {
    const result = await u.run({ ...ctx, now: new Date() });
    return result.ok ? result.value : undefined;
  };
  const tick = () => {
    if (stopped || running) return;
    running = (async () => {
      for (let i = 0; i < indexSteps && !stopped; i++) {
        const indexed = await run<number>(indexPending());
        if ((indexed ?? 0) < indexStep) break;
      }
      await run(evaluateMonitors());
      if (Date.now() >= nextExpiry) {
        await run(expire(days, payloadDays));
        nextExpiry = Date.now() + expiryMs;
      }
      // Planning runs every tick, so it is not traced; a sweep that has rows
      // to delete is, about once a minute per rule.
      const steps = await untraced(() => run(planSweep()));
      if (steps?.length) await run(sweep(steps));
      if (notifications) await run(deliverNotifications());
    })()
      .catch((e) => ctx.logger.error("console worker", e))
      .finally(() => {
        running = undefined;
      });
  };
  const timer = setInterval(tick, tickMs);
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
