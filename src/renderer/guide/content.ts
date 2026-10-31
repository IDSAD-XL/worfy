/// <reference types="vite/client" />
// What the worfy Guide says (worfy-guide ticket 03, ADR-0090): its own labels and every Topic. Part
// of the Guide's chunk only — GuideWindow.tsx imports it, and nothing in the app's first chunk does.
//
// A Topic is a folder topics/<id>/:
//   - topic.json — the pages of docs/features/ it was checked against, each with the commit it was
//     checked at (scripts/guide-lag.mjs reports a page that has moved on since), and the main files
//     of Under the hood, as paths of the repository;
//   - en.json and ru.json — every text of the Topic, one file per language, the same keys in both
//     (translation.ts; test/unit/guide-content.test.tsx fails on a string with one version only);
//   - Scene.tsx — its diagram, labelled from the texts' `scene.labels`.
// The texts are JSON, data rather than code: the rule "no Cyrillic in code" (scripts/check-cyrillic.mjs)
// stays as it is for every .ts and .tsx file, the Guide's included.
import type { ComponentType } from 'react'
import { z } from 'zod'
import type { GuideLanguage } from '../../shared/settings/app-settings'
import en from './strings/en.json'
import ru from './strings/ru.json'

/** The Guide's own labels in each language; ru.json must have every key of en.json (checked by TypeScript and by the test). */
export type GuideStrings = typeof en
export const GUIDE_STRINGS: Readonly<Record<GuideLanguage, GuideStrings>> = { en, ru }

const filled = z.string().trim().min(1)
/** A path of the repository: relative, forward slashes, no `..`. */
const repoPath = z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\w.@-]+(?:\/[\w.@-]+)*$/, 'a relative path of the repository')

export const topicMetaSchema = z.strictObject({
  sources: z.array(z.strictObject({ page: repoPath.regex(/^docs\/features\/[\w-]+\.md$/, 'a page of docs/features/'), sha: z.string().regex(/^[0-9a-f]{7,40}$/) })).min(1),
  files: z.array(repoPath),
})
export type TopicMeta = z.output<typeof topicMetaSchema>

export const topicTextSchema = z.strictObject({
  title: filled,
  summary: z.array(filled).min(1),
  scene: z.strictObject({ description: filled, labels: z.record(z.string(), filled) }),
  underTheHood: z.strictObject({ text: z.array(filled), files: z.record(repoPath, filled), limits: z.array(filled) }),
})
export type TopicText = z.output<typeof topicTextSchema>

export interface SceneProps {
  /** `scene.labels` of the Topic in the language on screen. */
  labels: Readonly<Record<string, string>>
}

export interface GuideTopic {
  id: string
  meta: TopicMeta
  text: Readonly<Record<GuideLanguage, TopicText>>
  /** The Topic's diagram; null for a Topic without Scene.tsx. */
  Scene: ComponentType<SceneProps> | null
}

const metas = import.meta.glob<TopicMeta>('./topics/*/topic.json', { eager: true, import: 'default' })
const english = import.meta.glob<TopicText>('./topics/*/en.json', { eager: true, import: 'default' })
const russian = import.meta.glob<TopicText>('./topics/*/ru.json', { eager: true, import: 'default' })
const scenes = import.meta.glob<ComponentType<SceneProps>>('./topics/*/Scene.tsx', { eager: true, import: 'default' })

/** `skeleton` of ./topics/skeleton/en.json. */
const idOf = (path: string): string => path.split('/')[2] ?? path

function byId<T>(files: Record<string, T>): Map<string, T> {
  return new Map(Object.entries(files).map(([path, value]) => [idOf(path), value]))
}

/** Every folder under topics/, by id, with its files as they are; the test checks them, not this code. */
export const TOPIC_FILES = {
  meta: byId(metas),
  en: byId(english),
  ru: byId(russian),
  scene: byId(scenes),
}

/** The Topics that have topic.json and both texts, by id. */
export const GUIDE_CONTENT: ReadonlyMap<string, GuideTopic> = new Map(
  [...TOPIC_FILES.meta].flatMap(([id, meta]) => {
    const enText = TOPIC_FILES.en.get(id)
    const ruText = TOPIC_FILES.ru.get(id)
    if (enText === undefined || ruText === undefined) return []
    return [[id, { id, meta, text: { en: enText, ru: ruText }, Scene: TOPIC_FILES.scene.get(id) ?? null }] as const]
  }),
)
