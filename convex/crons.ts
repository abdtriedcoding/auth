/**
 * convex/crons.ts — scheduled jobs.
 *
 * Sweeps expired sessions once a day. Without this, the sessions table grows
 * forever; nothing breaks (getByToken filters expired rows in code) but
 * storage and index size creep up. The cleanup itself self-reschedules in
 * batches if there's a lot to delete — see internal.sessions.deleteExpired.
 */
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "cleanup expired sessions",
  { hours: 24 },
  internal.sessions.deleteExpired,
  {},
);

export default crons;
