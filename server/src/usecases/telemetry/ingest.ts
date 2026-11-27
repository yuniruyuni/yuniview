import { Batch, Delivery } from "../../models/batch";
import { fail } from "../../models/common";
import { Credential } from "../../models/credential";
import { usecase } from "../runner";

/**
 * Stores one agent delivery. A batch is stored with its rows at most once;
 * repeated deliveries of the same batch ID are accepted without effect.
 */
export const ingest = (token: string, body: unknown) =>
  usecase({
    pre: () => ({ envelope: Delivery.envelope(body) }),
    read: async (ctx, { envelope }) => {
      const credential = await ctx.repos.credentials.get(
        Credential.ByToken(token),
      );
      if (!credential) return fail("UNAUTHORIZED", "unknown credential");
      if (!envelope) return fail("INVALID_INPUT", "invalid batch");
      if (!Credential.covers(credential, envelope.source))
        return fail("FORBIDDEN", "credential does not cover the source");
      const delivery = Delivery.of(envelope);
      if (!delivery) return fail("INVALID_INPUT", "invalid payload");
      if (delivery.type === "member") return { delivery, stored: false };
      const stored = await ctx.repos.batches.count(
        Batch.ByKeys({ source: envelope.source.service, id: envelope.id }),
      );
      return { delivery, stored: stored > 0 };
    },
    process: (ctx, { delivery, stored }) => ({
      delivery,
      batch:
        delivery.type === "batch" && !stored
          ? Batch.index(Batch.received(delivery.envelope, ctx.now))
          : null,
    }),
    write: async (ctx, { delivery, batch }) => {
      if (delivery.type === "member") {
        await ctx.repos.dailySets.upsert(delivery.member);
        if (delivery.field) await ctx.repos.fieldNotes.upsert(delivery.field);
      }
      if (batch) {
        await ctx.repos.batches.upsert(batch);
        for (const field of batch.fields)
          await ctx.repos.fieldNotes.upsert(field);
      }
      return true as const;
    },
  });
