// A share of the week (0..1) in whole percents, the one rule for every place that prints one: the
// forecast lines of the Autopilot tooltip and the autopilot_start dialog (forecast-lines.ts), and the
// header of a Run in Run history (worfy-resource-planner ticket 11). The share goes to whole millionths
// first, then to percents half up in integers: 0.285 is 285 000 millionths, 29 %, where 0.285 × 100 in
// floating point is 28.499999999999996 and rounds to 28. Pure.

/** A share of the week in whole millionths, so that "at most" and the rounding read what the number means, not its binary error. */
export const shareUnits = (share: number): number => Math.round(share * 1_000_000)

/** One percent of the week in millionths. */
const PERCENT = 10_000

/** A share in whole percents, half up from whole millionths: 0.145 → 15, 0.285 → 29, 0.005 → 1, 0.0049 → 0. */
export const sharePercent = (share: number): number => Math.floor((shareUnits(share) + PERCENT / 2) / PERCENT)

/** A range in words: `18–31%`, `about 18%` when both edges round to one number, `less than 1%` when both are under 1 %. */
export function shareRangeText({ low, high }: { low: number; high: number }): string {
  if (shareUnits(high) < PERCENT) return 'less than 1%'
  const from = sharePercent(low)
  const to = sharePercent(high)
  return from === to ? `about ${to}%` : `${from}–${to}%`
}

/** One share in words: `24%`, `less than 1%` above nothing and under 1 %, `0%` for nothing. */
export function shareText(share: number): string {
  const units = shareUnits(share)
  return units > 0 && units < PERCENT ? 'less than 1%' : `${sharePercent(share)}%`
}
