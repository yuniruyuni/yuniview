import { initTRPC } from "@trpc/server";
import { traced } from "../../infra/tracing";
import type { Context } from "../../usecases/context";

const t = initTRPC.context<Context>().create();

export const router = t.router;

/**
 * 手続きごとに計測する。ここが presentation 層の境目。
 *
 * 認証の要否に関わらず掛けたいので、両方の procedure の土台にする。
 */
const measured = t.procedure.use(({ ctx, path, type, next }) =>
  traced(`trpc.${path}`, () => next({ ctx }), { "rpc.type": type }),
);
export const publicProcedure = measured;
