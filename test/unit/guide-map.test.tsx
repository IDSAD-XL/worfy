// The Map of worfy (src/renderer/guide/topics/map-of-worfy/, worfy-guide ticket 05): the first Topic of
// the Guide, the overview diagram of docs/features/concepts.md. What it draws is checked against that
// page here, line by line in the comments: which blocks lie inside the Canvas frame (Nodes) and which
// outside (not Nodes), the Ticket inside the Epic frame, every Edge with the line it comes from. Every
// block leads to one of the Topics of the epic's spec, or to that Topic's page while it is not
// written; every Topic of the registry has a block. In the DOM, a click on a block of a Topic that is
// not written opens its Full page on GitHub, and a click on one whose Topic is shown opens the Topic.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { GUIDE_STRINGS, TOPIC_FILES } from '../../src/renderer/guide/content'
import { GUIDE_REPO_URL } from '../../src/renderer/guide/links'
import { GUIDE_TOPICS, shownTopics } from '../../src/renderer/guide/registry'
import { LivingScene } from '../../src/renderer/guide/scene/LivingScene'
import { boxOf, edgeId, type Box, type SceneBlock } from '../../src/renderer/guide/scene/model'
import { useGuide } from '../../src/renderer/guide/store'
import Scene from '../../src/renderer/guide/topics/map-of-worfy/Scene'
import { MAP_SPEC } from '../../src/renderer/guide/topics/map-of-worfy/spec'

const REPO = join(import.meta.dirname, '..', '..')
const ID = 'map-of-worfy'
const en = TOPIC_FILES.en.get(ID)!
const ru = TOPIC_FILES.ru.get(ID)!

/** The Topics of the epic's spec (.scratch/worfy-guide/spec.md, the table of Topics and their pages), by the slug of their Ticket. */
const SPEC_TOPICS = ['autopilot', 'browser', 'canvas', 'cards', 'gate-and-github', 'harness', 'link', 'projects', 'sessions', 'terminal', 'the-window-and-your-data', 'workflow']

const blocks = new Map(MAP_SPEC.blocks.map((block) => [block.id, block]))
const frame = (id: string) => MAP_SPEC.frames!.find((each) => each.block === id)!
const inside = (box: Box, outer: Box) => box.x >= outer.x && box.y >= outer.y && box.x + box.width <= outer.x + outer.width && box.y + box.height <= outer.y + outer.height
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const boxOfId = (id: string) => boxOf(blocks.get(id)!)

describe('the Map in the Guide', () => {
  it('is the first Topic of the registry and is shown in a packaged build', () => {
    expect(GUIDE_TOPICS[0]?.id).toBe(ID)
    expect(shownTopics(true)[0]?.id).toBe(ID)
    expect(shownTopics(null)[0]?.id).toBe(ID)
  })

  it('every block, Edge, area and step has its text in both languages', () => {
    const keys = [
      ...MAP_SPEC.blocks.flatMap((block) => [block.id, `${block.id}Note`]),
      ...MAP_SPEC.edges.map((edge) => edge.label!),
      ...(MAP_SPEC.regions ?? []).map((region) => region.label),
      ...(MAP_SPEC.steps ?? []).map((step) => step.caption),
    ]
    for (const text of [en, ru]) for (const key of keys) expect(text.scene.labels[key], key).toBeTruthy()
    // Names of things stay English in Russian too: the titles of the blocks are the same.
    for (const block of MAP_SPEC.blocks) expect(ru.scene.labels[block.id], block.id).toBe(en.scene.labels[block.id])
  })
})

describe('what the Map draws, against docs/features/concepts.md', () => {
  it('has the blocks of the page: the nine the ticket names and the ones that lead to the other Topics', () => {
    expect([...blocks.keys()].sort()).toEqual(
      ['autopilot', 'browser', 'canvas', 'card', 'epic', 'gate', 'harness', 'limits', 'linked', 'machine', 'profile', 'project', 'session', 'subagent', 'terminal', 'ticket', 'wave'].sort(),
    )
  })

  it('every block lies in the diagram and no two blocks cover each other', () => {
    for (const block of MAP_SPEC.blocks) expect(inside(boxOf(block), { x: 0, y: 0, width: MAP_SPEC.width, height: MAP_SPEC.height }), block.id).toBe(true)
    for (const [index, a] of MAP_SPEC.blocks.entries()) {
      for (const b of MAP_SPEC.blocks.slice(index + 1)) expect(overlap(boxOf(a), boxOf(b)), `${a.id} and ${b.id}`).toBe(false)
    }
  })

  it('the Nodes lie inside the Canvas frame and what is not a Node lies outside it', () => {
    const canvas = frame('canvas')
    // concepts.md:11-12 "A Node is any object on the Canvas: a Ticket, a Session, a Card, a Terminal";
    // :15-16 the Epic frame, the Ticket and the tree of Subagents are Derived Nodes; :23 a Browser is a Node.
    for (const id of ['epic', 'ticket', 'session', 'subagent', 'card', 'terminal', 'browser']) expect(inside(boxOfId(id), canvas), id).toBe(true)
    // :10-11 a Project has a Canvas and is not on it; :112 a Machine; :117 a Linked machine; :94-99 the
    // Harness and the Profile; :65 the Gate; :59 Autopilot; :32 Limits.
    for (const id of ['linked', 'machine', 'project', 'harness', 'profile', 'gate', 'autopilot', 'limits']) expect(overlap(boxOfId(id), canvas), id).toBe(false)
  })

  it('the Ticket lies inside the Epic frame, and the Ready wave chip stands on it', () => {
    const epic = frame('epic')
    // concepts.md:37 "An Epic is a set of Tickets"; epic-frames.md:26 the chip "Ready wave · N" on the frame.
    expect(inside(boxOfId('ticket'), epic)).toBe(true)
    expect(inside(epic, frame('canvas'))).toBe(true)
    const wave = boxOfId('wave')
    expect(wave.y).toBeLessThan(epic.y)
    expect(wave.y + wave.height).toBeGreaterThan(epic.y)
    expect(blocks.get('wave')?.shape).toBe('chip')
    expect(en.scene.labels.wave).toBe('Ready wave · N')
  })

  it('draws exactly the Edges of the page, each with its line', () => {
    expect(MAP_SPEC.edges.map(edgeId).sort()).toEqual(
      [
        'linked->machine', //   :117 "A Linked machine is a Machine connected to this one by a 6-digit code."
        'linked->canvas', //    :118-120 "If access ... is on, the Linked machine ... opens the Canvas"
        'machine->project', //  :113-114 "A Project lives on exactly one Machine"
        'project->canvas', //   :10-11 "A Project has exactly one Canvas"
        'machine->harness', //  :96-97 "There is one Harness on a Machine"
        'harness->profile', //  :97 "it runs each Project by that Project's Profile"
        'profile->project', //  :97-99 the Profile says how to check changes, where the Tickets are, ...
        'harness->session', //  :94 "rules, skills, agents, scripts and hooks by which Claude agents carry out the work"
        'harness->gate', //     :94-95 "... carry out the work on a Project: Epics, Tickets, Waves, the Gate and review"
        'ticket->wave', //      :39-40 "open, with all blockers closed and no shared files"
        'autopilot->wave', //   :59 "Autopilot is the mode in which the Waves of an Epic run without a person"
        'autopilot->limits', // :59-60 "waits for Limits to reset"
        'session->subagent', // :81-82 "A Subagent is an agent that a Session started"
        'session->ticket', //   :90 "A Binding connects a Session or a Subagent to the Ticket or Epic it works on"
        'subagent->ticket', //  :90, the same sentence
        'session->card', //     :21-22 "It belongs to the Project and not to a Session, so any Session of the Project may change it"
        'session->browser', //  :26 "Sessions arrive signed in and never see the passwords"
      ].sort(),
    )
  })
})

describe('where a block leads', () => {
  it('each block names a Topic of the spec and the page of docs/features/ that is its Full page', () => {
    for (const block of MAP_SPEC.blocks) {
      expect(SPEC_TOPICS, block.id).toContain(block.topic)
      expect(block.page, block.id).toMatch(/^docs\/features\/[\w-]+\.md$/)
      expect(existsSync(join(REPO, block.page!)), block.page).toBe(true)
    }
  })

  it('every Topic of the spec has a block, and every Topic of the registry but the Map and test Topics has one', () => {
    const named = new Set(MAP_SPEC.blocks.map((block) => block.topic))
    expect([...named].sort()).toEqual(SPEC_TOPICS)
    // A Topic added under another id than its block names would never be reached from the Map.
    for (const topic of GUIDE_TOPICS) if (topic.id !== ID && topic.devOnly !== true) expect(named, topic.id).toContain(topic.id)
  })
})

describe('a click on a block of the Map', () => {
  const globals = globalThis as { worfy?: WorfyBridge }
  const svgPrototype = SVGElement.prototype as unknown as Record<string, unknown>
  let opened: string[]

  beforeEach(() => {
    opened = []
    globals.worfy = {
      invoke: (channel: string, input: unknown) => {
        if (channel === 'shell.openExternal') opened.push((input as { url: string }).url)
        return Promise.resolve({ ok: true, value: undefined })
      },
      on: () => 1,
      off: () => undefined,
    } as unknown as WorfyBridge
    svgPrototype.getTotalLength = () => 100
    svgPrototype.getPointAtLength = (distance: number) => ({ x: distance, y: 0 })
    useGuide.setState({ open: true, topic: ID, build: { version: '0.3.0+e61cb1fe', packaged: true } })
  })

  afterEach(() => {
    delete globals.worfy
    delete svgPrototype.getTotalLength
    delete svgPrototype.getPointAtLength
    useGuide.setState({ open: false, topic: null, build: { version: null, packaged: null } })
  })

  const blockOf = (id: string) => document.querySelector<SVGGElement>(`[data-block="${id}"]`)!

  it('opens the Full page on GitHub, at the build commit, while its Topic is not written', async () => {
    render(<Scene labels={en.scene.labels} strings={GUIDE_STRINGS.en} />)
    const autopilot = blockOf('autopilot')
    expect(autopilot.getAttribute('role')).toBe('link')
    expect(autopilot.dataset.target).toBe('page')
    expect(autopilot.dataset.to).toBe('docs/features/autopilot.md')
    expect(autopilot.querySelector('title')?.textContent).toBe(GUIDE_STRINGS.en.openOnGitHub)
    fireEvent.click(autopilot)
    fireEvent.keyDown(blockOf('canvas'), { key: 'Enter' })
    await act(() => Promise.resolve())
    expect(opened).toEqual([`${GUIDE_REPO_URL}/blob/e61cb1fe/docs/features/autopilot.md`, `${GUIDE_REPO_URL}/blob/e61cb1fe/docs/features/canvas.md`])
    expect(useGuide.getState().topic).toBe(ID)
  })

  it('opens the Topic instead once the Guide shows it, and nothing on GitHub', async () => {
    // The Topics the Map names are not written yet; the Map itself is a Topic the Guide shows.
    const spec = { ...MAP_SPEC, blocks: MAP_SPEC.blocks.map((block): SceneBlock => (block.id === 'machine' ? { ...block, topic: ID } : block)) }
    render(<LivingScene spec={spec} labels={en.scene.labels} strings={GUIDE_STRINGS.en} />)
    useGuide.setState({ topic: null })
    expect(blockOf('machine').dataset.target).toBe('topic')
    expect(blockOf('machine').dataset.to).toBe(ID)
    expect(blockOf('machine').querySelector('title')).toBeNull()
    fireEvent.click(blockOf('machine'))
    await act(() => Promise.resolve())
    expect(useGuide.getState().topic).toBe(ID)
    expect(opened).toEqual([])
  })
})
