// Moving a recorded fixture to a folder of the test: the night Run of Flight Recorder
// (test/fixtures/flight-recorder/night-run/) was recorded under one root, and its Journal, transcripts
// and gate logs name that root inside JSON strings. The test's root is a real folder of the system, and
// on Windows it holds backslashes (`C:\Users\RUNNER~1\...`): written into a JSON string as it is, a
// backslash starts an escape (`\U`), the line no longer parses, and the readers skip it.

/** The text of a JSON or JSON Lines file with every `from` replaced by `to`, as JSON spells it in a string. */
export function relocatedJsonText(text: string, from: string, to: string): string {
  const inString = (value: string): string => JSON.stringify(value).slice(1, -1)
  return text.replaceAll(inString(from), inString(to))
}
