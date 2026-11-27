// What the fallback of ErrorBoundary.tsx says of an error (worfy-polish ticket 163): plain functions, apart from the
// component, so Fast Refresh keeps working on it.

/** The message of whatever was thrown: an Error's message, else the value as text. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message === '' ? error.name : error.message
  try {
    return typeof error === 'string' ? error : (JSON.stringify(error) ?? String(error))
  } catch {
    return String(error)
  }
}

/** The innermost component of a React component stack (`    at Journal (…)` in Chromium, `    in Journal` elsewhere). */
export function topComponent(stack: string | null | undefined): string | null {
  const line = stack
    ?.split('\n')
    .map((each) => each.trim())
    .find((each) => each !== '')
  const name = line?.match(/^(?:at|in)\s+([^\s(]+)/)?.[1]
  return name ?? null
}
