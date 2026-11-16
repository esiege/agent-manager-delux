// The Reporting tab's "Plan" view: usage as a share of a Claude plan's weekly limit.
//
// Plan limits aren't counted in raw tokens. They track how much compute the work takes, which is
// close to what it would cost on the API: a cache read costs a tenth of fresh input or less, and
// a Fable token costs several times an Opus one. Raw token counts are mostly cache reads, so
// dividing them by a token allowance overstates usage several times over. This measures usage in
// API-equivalent dollars instead.
//
// Anthropic doesn't publish what a plan allows, so the allowance comes from the owner: they read
// the weekly percentage Claude shows (claude.ai Settings > Usage, or /usage in Claude Code) and
// the page works out what 100% is from the last 7 days.

export interface PlanSettings {
  /** API-equivalent dollars the plan allows per week; 0 until calibrated. */
  weekly: number;
}

export const DEFAULT_PLAN: PlanSettings = { weekly: 0 };

/** Dollars the plan allows per day; 0 until calibrated. */
export function allowancePerDay(s: PlanSettings): number {
  return s.weekly > 0 ? s.weekly / 7 : 0;
}

/**
 * The weekly allowance that makes the last 7 days' cost come to the percentage Claude shows.
 * null when there's nothing to go on.
 */
export function calibrate(costLast7Days: number, percent: number): number | null {
  if (!(costLast7Days > 0) || !(percent > 0)) return null;
  return costLast7Days / (percent / 100);
}
