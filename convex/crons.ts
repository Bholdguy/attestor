// One statically-defined sweep (D-1). It does NOT register one cron per license
// — cron jobs must be static at deploy time. `runSweep` fans out one scheduled
// action per watch_enabled license, staggered to stay under the Firecrawl rate
// limit (D-7). Demo mode drives its own compressed chain instead (Step 10).
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const SWEEP_INTERVAL_MINUTES = Math.max(
  1,
  Number(process.env.SWEEP_INTERVAL_MINUTES ?? 5) || 5,
);

const crons = cronJobs();

crons.interval(
  "sweep",
  { minutes: SWEEP_INTERVAL_MINUTES },
  internal.sweep.runSweep,
  {},
);

export default crons;
