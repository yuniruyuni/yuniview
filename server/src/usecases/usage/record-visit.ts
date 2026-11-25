import { usecase } from "../runner";

/** Counts today's visit of a signed-in subject through the local agent. */
export const recordVisit = (subject: string | undefined) =>
  usecase({
    post: async (ctx) =>
      subject ? ctx.repos.usageAgent.visit(subject) : ("recorded" as const),
  });
