// The registry of Topics of the worfy Guide (worfy-guide ticket 03, ADR-0090): one line per Topic,
// so that parallel pull requests that add Topics barely touch the same lines. It is part of the
// app's first chunk — the Command palette builds a row per Topic from it — so it holds only what
// the palette needs: the id, the English title and the search words. Everything a Topic says lives
// in its folder topics/<id>/ (topic.json, en.json, ru.json, Scene.tsx), which only the Guide's own
// chunk loads (GuideHost.tsx). test/unit/guide-content.test.tsx checks that each entry has a folder,
// each folder an entry, and that the title here is the title of en.json.

export interface GuideTopicEntry {
  /** The name of its folder under topics/. */
  readonly id: string
  /** The English title, as en.json has it: the palette's row says "Guide: <title>". */
  readonly title: string
  /** More words the palette finds the Topic by. */
  readonly keys?: readonly string[]
  /** A Topic for checking the Guide itself: never shown in a packaged build (the epic's spec). */
  readonly devOnly?: boolean
}

/** In the order of the Guide's list; the first one shown is the Topic the Guide opens at. */
export const GUIDE_TOPICS: readonly GuideTopicEntry[] = [
  { id: 'map-of-worfy', title: 'Map of worfy', keys: ['overview', 'concepts', 'how worfy fits together'] },
  { id: 'canvas', title: 'Canvas', keys: ['done shelf', 'focus mode'] },
  { id: 'skeleton', title: 'How the Guide works', keys: ['guide test', 'skeleton'], devOnly: true },
]

/**
 * The Topics a build shows: all of them in a build known not to be packaged (`pnpm dev`, the e2e
 * tests), the ones without devOnly in a packaged build — and while that is not known yet (null).
 */
export function shownTopics(packaged: boolean | null): GuideTopicEntry[] {
  return GUIDE_TOPICS.filter((topic) => topic.devOnly !== true || packaged === false)
}
