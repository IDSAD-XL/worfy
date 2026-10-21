// Statistics of the outcome eval (scripts/eval-outcome-score.mjs): intervals for a rate and for the
// difference of two rates, the two-sided Fisher exact test, the Holm adjustment, and the median and
// percentiles of cost and time. Plain functions, no dependencies; test/contract/
// harness-evals-outcome.test.ts checks them against published values.

/** The two-sided 95% normal quantile. */
export const Z95 = 1.959963984540054

/**
 * The Wilson score interval of k successes in n trials (Wilson 1927). `rate` is k / n; all three
 * are null when n is 0.
 */
export function wilson(k, n, z = Z95) {
  if (n === 0) return { rate: null, low: null, high: null }
  const p = k / n
  const z2 = z * z
  const denominator = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denominator
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator
  return { rate: p, low: Math.max(0, center - half), high: Math.min(1, center + half) }
}

/**
 * The difference k1/n1 − k2/n2 with the Newcombe hybrid score interval (Newcombe 1998, method 10),
 * built from the two Wilson intervals. Null fields when either n is 0.
 */
export function newcombe(k1, n1, k2, n2, z = Z95) {
  if (n1 === 0 || n2 === 0) return { difference: null, low: null, high: null }
  const a = wilson(k1, n1, z)
  const b = wilson(k2, n2, z)
  const difference = a.rate - b.rate
  const low = difference - Math.sqrt((a.rate - a.low) ** 2 + (b.high - b.rate) ** 2)
  const high = difference + Math.sqrt((a.high - a.rate) ** 2 + (b.rate - b.low) ** 2)
  return { difference, low: Math.max(-1, low), high: Math.min(1, high) }
}

const logFactorials = [0]
const logFactorial = (n) => {
  for (let i = logFactorials.length; i <= n; i++) logFactorials[i] = logFactorials[i - 1] + Math.log(i)
  return logFactorials[n]
}

/**
 * The two-sided Fisher exact test of the table [[a, b], [c, d]]: the sum of the probabilities of
 * every table with the same margins that is no more likely than the one observed.
 */
export function fisherExact(a, b, c, d) {
  const row1 = a + b
  const col1 = a + c
  const n = a + b + c + d
  const logP = (x) =>
    logFactorial(row1) + logFactorial(n - row1) + logFactorial(col1) + logFactorial(n - col1) -
    logFactorial(n) - logFactorial(x) - logFactorial(row1 - x) - logFactorial(col1 - x) - logFactorial(n - row1 - col1 + x)
  const observed = logP(a)
  let p = 0
  for (let x = Math.max(0, row1 + col1 - n); x <= Math.min(row1, col1); x++) {
    const lp = logP(x)
    // A relative tolerance, so that a table exactly as likely as the observed one is not lost to rounding.
    if (lp <= observed + 1e-7) p += Math.exp(lp)
  }
  return Math.min(1, p)
}

/** Holm's step-down adjustment of p-values; the result keeps the order of the input. */
export function holm(pValues) {
  const m = pValues.length
  const order = pValues.map((p, i) => [p, i]).sort((x, y) => x[0] - y[0])
  const adjusted = new Array(m)
  let running = 0
  order.forEach(([p, i], rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * p))
    adjusted[i] = running
  })
  return adjusted
}

/** The q-quantile with linear interpolation between order statistics (type 7); null for no values. */
export function quantile(values, q) {
  if (values.length === 0) return null
  const sorted = [...values].sort((x, y) => x - y)
  const h = (sorted.length - 1) * q
  const lower = Math.floor(h)
  return sorted[lower] + (h - lower) * ((sorted[Math.min(lower + 1, sorted.length - 1)] ?? sorted[lower]) - sorted[lower])
}

export const median = (values) => quantile(values, 0.5)
