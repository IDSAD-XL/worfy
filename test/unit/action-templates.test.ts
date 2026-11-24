import { describe, expect, it } from 'vitest'
import { emptyTemplateHint, ownerCheckState, ownerWordsParagraph, type OwnerCheckDecision } from '../../src/shared/actions/render-template'
import {
  ACTION_LABELS,
  actionTemplateSchema,
  ACTIONS,
  AGENT_REVIEW_LABEL,
  AGENT_REVIEW_VENDOR,
  agentReviewText,
  DEFAULT_ACTION_TEMPLATES,
  defaultActionTemplates,
  defaultProjectSettings,
  HARNESS_KINDS,
  isActionConfigured,
  LEGACY_RUN_WAVE_TEMPLATE,
  migrateProjectSettings,
  namesWaveTickets,
  PLACEHOLDERS,
  PR_FOLLOW_ACTIONS,
  projectSettingsAnswerSchema,
  projectSettingsInputSchema,
  projectSettingsSchema,
  savedProjectSettingsSchema,
  templateError,
  unknownPlaceholders,
} from '../../src/shared/projects/action-templates'

const NO_FOLLOW = { fixChecks: '', resolveConflicts: '', addressComments: '' }
const FOLLOW = { fixChecks: '/worfy:pr-fix checks {repo}#{pr} {sha}', resolveConflicts: '/worfy:pr-fix conflicts {repo}#{pr} {sha}', addressComments: '/worfy:pr-fix comments {repo}#{pr} {sha}' }
const OWNER_CHECK = '/worfy:owner-check {epic} {NN} {item} {verdict} {platform} {copy} {sha}'
const LEGACY = { shipTicket: '/ship-ticket {epic} {NN}', runWave: '/epic-wave Ticket-ы {tickets} эпика {epic}', gateQueue: '', prReply: '', ...NO_FOLLOW, ownerCheck: '' }
const PLUGIN = { shipTicket: '/worfy:ship-ticket {epic} {NN}', runWave: '/worfy:epic-wave tickets {tickets} of epic {epic}', gateQueue: '/worfy:gate-queue', prReply: '/worfy:pr-reply {repo}#{pr}', ...FOLLOW, ownerCheck: OWNER_CHECK }

describe('action templates', () => {
  it('gives a new Project the default templates of the Harness found: the bare skill names with the old Harness', () => {
    expect(defaultProjectSettings('legacy')).toStrictEqual({ actionTemplates: LEGACY })
    // Tests and fixtures on a Claude home with bin/epic-status keep using this name.
    expect(DEFAULT_ACTION_TEMPLATES).toStrictEqual(LEGACY)
  })

  it('gives the plugin\'s names with the plugin and with no Harness found (worfy-harness ticket 12)', () => {
    expect(defaultProjectSettings('plugin')).toStrictEqual({ actionTemplates: PLUGIN })
    expect(defaultProjectSettings('none')).toStrictEqual({ actionTemplates: PLUGIN })
  })

  it('sends the agent English with the plugin and with no Harness; the old Harness keeps its Russian Run wave, the only form its skill reads (worfy-neutral ticket 05)', () => {
    const cyrillic = /[\u0400-\u04FF]/u
    for (const harness of ['plugin', 'none'] as const) {
      for (const action of ACTIONS) expect(defaultActionTemplates(harness)[action]).not.toMatch(cyrillic)
    }
    const legacy = defaultActionTemplates('legacy')
    expect(ACTIONS.filter((action) => cyrillic.test(legacy[action]))).toEqual(['runWave'])
  })

  it('names the Wave\'s tickets in the Run wave default of every Harness, as Autopilot needs (ADR-0033)', () => {
    for (const harness of HARNESS_KINDS) expect(namesWaveTickets(defaultActionTemplates(harness).runWave)).toBe(true)
  })

  it('reads a saved Run wave template equal to the old default as the new default, and leaves every other template alone (ticket 30)', () => {
    expect(LEGACY_RUN_WAVE_TEMPLATE).toBe('/epic-wave волна {wave} эпика {epic}')
    const old = { actionTemplates: { shipTicket: 'my ship {NN}', runWave: LEGACY_RUN_WAVE_TEMPLATE, gateQueue: '' } }
    expect(migrateProjectSettings(old, 'legacy')).toStrictEqual({ actionTemplates: { shipTicket: 'my ship {NN}', runWave: '/epic-wave Ticket-ы {tickets} эпика {epic}', gateQueue: '', prReply: '', ...NO_FOLLOW, ownerCheck: '' } })
    // The argument is not changed in place.
    expect(old.actionTemplates.runWave).toBe(LEGACY_RUN_WAVE_TEMPLATE)
    for (const own of ['/epic-wave волна {wave} эпика {epic} ', '/epic-wave wave {wave} of {epic}', '', '/epic-wave Ticket-ы {tickets} эпика {epic}']) {
      expect(migrateProjectSettings({ actionTemplates: { shipTicket: '', runWave: own, gateQueue: '' } }, 'legacy').actionTemplates.runWave).toBe(own)
    }
    // A Ship ticket template that happens to read like the old Run wave default is not touched.
    expect(migrateProjectSettings({ actionTemplates: { shipTicket: LEGACY_RUN_WAVE_TEMPLATE, runWave: '', gateQueue: '' } }, 'legacy').actionTemplates.shipTicket).toBe(LEGACY_RUN_WAVE_TEMPLATE)
  })

  it.each(HARNESS_KINDS)('reads every earlier default as the default of the Harness found (%s), and returns the saved object when nothing changes', (harness) => {
    const defaults = defaultActionTemplates(harness)
    const earlier = {
      shipTicket: [LEGACY.shipTicket, PLUGIN.shipTicket],
      runWave: [LEGACY.runWave, LEGACY_RUN_WAVE_TEMPLATE, PLUGIN.runWave],
      gateQueue: [PLUGIN.gateQueue],
      prReply: [PLUGIN.prReply],
      fixChecks: [PLUGIN.fixChecks],
      resolveConflicts: [PLUGIN.resolveConflicts],
      addressComments: [PLUGIN.addressComments],
      ownerCheck: [PLUGIN.ownerCheck],
    }
    const mine = { shipTicket: 'my ship {NN}', runWave: '', gateQueue: 'my queue', prReply: 'my replies {repo}#{pr}', fixChecks: 'my checks {sha}', resolveConflicts: 'my conflicts {sha}', addressComments: 'my comments {sha}', ownerCheck: 'my check {item} {verdict}' }
    for (const action of ACTIONS) {
      for (const saved of earlier[action]) {
        const settings = { actionTemplates: { ...mine, [action]: saved } }
        const read = migrateProjectSettings(settings, harness)
        expect(read.actionTemplates[action]).toBe(defaults[action])
        // The other actions keep the owner's own templates.
        for (const other of ACTIONS.filter((each) => each !== action)) expect(read.actionTemplates[other]).toBe(settings.actionTemplates[other])
        // The saved settings are not changed in place.
        expect(settings.actionTemplates[action]).toBe(saved)
      }
    }
    const own = { actionTemplates: { shipTicket: 'my ship {NN}', runWave: '', gateQueue: '', prReply: '', ...NO_FOLLOW, ownerCheck: '' } }
    expect(migrateProjectSettings(own, harness)).toBe(own)
    const current = defaultProjectSettings(harness)
    expect(migrateProjectSettings(current, harness)).toBe(current)
  })

  it('keeps the owner\'s own templates under every Harness, a near miss of a default included', () => {
    for (const harness of HARNESS_KINDS) {
      for (const own of ['my ship {NN}', '', ' ', '/worfy:ship-ticket {epic} {NN} ', '/ship-ticket {NN}', PLUGIN.runWave]) {
        expect(migrateProjectSettings({ actionTemplates: { shipTicket: own, runWave: '', gateQueue: '' } }, harness).actionTemplates.shipTicket).toBe(own)
      }
      for (const own of ['/worfy:epic-wave wave {wave} of epic {epic}', '/epic-wave tickets {tickets} of epic {epic}', PLUGIN.shipTicket]) {
        expect(migrateProjectSettings({ actionTemplates: { shipTicket: '', runWave: own, gateQueue: '' } }, harness).actionTemplates.runWave).toBe(own)
      }
      // An empty Process gate queue template is the owner's own under the plugin too, and so is a near miss.
      for (const own of ['', '/worfy:gate-queue ', '/gate-queue']) {
        expect(migrateProjectSettings({ actionTemplates: { shipTicket: '', runWave: '', gateQueue: own } }, harness).actionTemplates.gateQueue).toBe(own)
      }
    }
  })

  it('has Process gate queue among the actions: /worfy:gate-queue with the plugin and with no Harness, empty with the old Harness (worfy-windows ticket 17)', () => {
    expect(ACTIONS).toContain('gateQueue')
    expect(ACTION_LABELS.gateQueue).toBe('Process gate queue')
    expect(defaultActionTemplates('plugin').gateQueue).toBe('/worfy:gate-queue')
    expect(defaultActionTemplates('none').gateQueue).toBe('/worfy:gate-queue')
    expect(defaultActionTemplates('legacy').gateQueue).toBe('')
    expect(unknownPlaceholders(defaultActionTemplates('plugin').gateQueue)).toEqual([])
    // An empty template: the action names the setting to fill in.
    expect(emptyTemplateHint('gateQueue')).toBe('Set the Process gate queue template in Project settings')
  })

  it.each(HARNESS_KINDS)('reads saved settings without gateQueue with the default of the Harness found (%s), and keeps the rest', (harness) => {
    const saved = savedProjectSettingsSchema.parse({ actionTemplates: { shipTicket: 'my ship {NN}', runWave: 'my wave {tickets}' }, terminalShell: 'git-bash' })
    expect(migrateProjectSettings(saved, harness)).toStrictEqual({
      actionTemplates: { ...defaultActionTemplates(harness), shipTicket: 'my ship {NN}', runWave: 'my wave {tickets}' },
      terminalShell: 'git-bash',
    })
    // What is saved has the field: settings without it are refused.
    expect(projectSettingsSchema.safeParse({ actionTemplates: { shipTicket: '', runWave: '' } }).success).toBe(false)
  })

  it('tells whether a Run wave template names the Wave\'s tickets', () => {
    expect(namesWaveTickets('/epic-wave Ticket-ы {tickets} эпика {epic}')).toBe(true)
    expect(namesWaveTickets(LEGACY_RUN_WAVE_TEMPLATE)).toBe(false)
    expect(namesWaveTickets('/epic-wave {Tickets}')).toBe(false)
    expect(namesWaveTickets('')).toBe(false)
  })

  it('hands out a fresh copy each time, so editing one does not change the defaults', () => {
    for (const harness of HARNESS_KINDS) {
      const first = defaultProjectSettings(harness)
      first.actionTemplates.shipTicket = 'changed'
      expect(defaultProjectSettings(harness).actionTemplates.shipTicket).toBe(defaultActionTemplates(harness).shipTicket)
    }
    expect(DEFAULT_ACTION_TEMPLATES.shipTicket).toBe(LEGACY.shipTicket)
    expect(defaultActionTemplates('plugin').shipTicket).toBe(PLUGIN.shipTicket)
  })

  it('accepts every known placeholder', () => {
    const template = '{epic} {NN} {wave} {slug} {branch} {tickets} {repo} {pr} {sha}'
    expect(unknownPlaceholders(template)).toEqual([])
    expect(actionTemplateSchema.safeParse(template).success).toBe(true)
  })

  it('rejects an unknown placeholder and names it', () => {
    const result = actionTemplateSchema.safeParse('/ship-ticket {foo}')
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toMatch(/Unknown placeholder \{foo\}/)
    expect(templateError('/ship-ticket {foo} {NN} {Epic}')).toMatch(/\{foo\}, \{Epic\}/)
  })

  it('rejects an empty placeholder', () => {
    expect(unknownPlaceholders('/ship-ticket {}')).toEqual([''])
  })

  it('treats placeholder names as case-sensitive', () => {
    expect(unknownPlaceholders('{nn}')).toEqual(['nn'])
  })

  it('accepts an empty template, which means the action is not configured', () => {
    expect(actionTemplateSchema.safeParse('').success).toBe(true)
    expect(isActionConfigured('')).toBe(false)
    expect(isActionConfigured('   ')).toBe(false)
    expect(isActionConfigured('/ship-ticket {epic} {NN}')).toBe(true)
  })

  it('refuses settings with a bad template and drops undeclared keys from good ones', () => {
    expect(projectSettingsSchema.safeParse({ actionTemplates: { shipTicket: '{foo}', runWave: '', gateQueue: '', prReply: '', ...NO_FOLLOW, ownerCheck: '' } }).success).toBe(false)
    expect(projectSettingsSchema.safeParse({ actionTemplates: { shipTicket: '' } }).success).toBe(false)
    const parsed = projectSettingsSchema.parse({ actionTemplates: { shipTicket: '', runWave: '', gateQueue: '', prReply: '', ...NO_FOLLOW, ownerCheck: '', extra: 'x' }, other: 1 })
    expect(parsed).toStrictEqual({ actionTemplates: { shipTicket: '', runWave: '', gateQueue: '', prReply: '', ...NO_FOLLOW, ownerCheck: '' } })
  })

  it('Agent review: the Team reviewer when the Project has one built, else the review lenses of /worfy:code-review, with the rule of the draft; on Claude Code (worfy-pr-review ticket 08)', () => {
    expect(AGENT_REVIEW_LABEL).toBe('Agent review')
    expect(AGENT_REVIEW_VENDOR).toBe('claude')
    const rule = 'Agent review: write the review draft only through bin/pr-review-draft (pr-review-draft --help); the verdict is only a suggestion; nothing goes to GitHub.'
    // The commit the draft is placed on: the agent numbers its lines there, as bin/pr-review-draft reads them.
    const at = 'Review the commit 3f2a9c1d: number the lines of each comment at that commit.'
    expect(agentReviewText({ teamReviewer: true, repo: 'owner/web', pr: 118, fill: 'new', head: '3f2a9c1d' })).toBe(`/human-review owner/web#118 ${rule} ${at}`)
    expect(agentReviewText({ teamReviewer: false, repo: 'owner/web', pr: 118, fill: 'new', head: '3f2a9c1d' })).toBe(`/worfy:code-review owner/web#118 ${rule} ${at}`)
    // Ask the agent to add comments: the person's comments and summary stay.
    expect(agentReviewText({ teamReviewer: false, repo: 'owner/web', pr: 7, fill: 'add', head: '3f2a9c1d' })).toBe(`/worfy:code-review owner/web#7 ${rule} ${at} Add your comments to the person's draft: their comments and their summary stay.`)
    // Not one of the Project's editable templates: the Team reviewer decides the command, not a setting.
    expect(ACTIONS).not.toContain('agentReview')
  })

  it('has Draft replies among the actions: /worfy:pr-reply {repo}#{pr} with the plugin and with no Harness, empty with the old Harness (worfy-pr-inbox ticket 04)', () => {
    expect(ACTIONS).toContain('prReply')
    expect(ACTION_LABELS.prReply).toBe('Draft replies')
    expect(defaultActionTemplates('plugin').prReply).toBe('/worfy:pr-reply {repo}#{pr}')
    expect(defaultActionTemplates('none').prReply).toBe('/worfy:pr-reply {repo}#{pr}')
    expect(defaultActionTemplates('legacy').prReply).toBe('')
    expect(unknownPlaceholders(defaultActionTemplates('plugin').prReply)).toEqual([])
    expect(emptyTemplateHint('prReply')).toBe('Set the Draft replies template in Project settings')
    // What is saved has the field; a file saved before it reads with the default of the Harness found.
    expect(projectSettingsSchema.safeParse({ actionTemplates: { shipTicket: '', runWave: '', gateQueue: '' } }).success).toBe(false)
    const saved = savedProjectSettingsSchema.parse({ actionTemplates: { shipTicket: '', runWave: '', gateQueue: '' } })
    expect(migrateProjectSettings(saved, 'plugin').actionTemplates.prReply).toBe('/worfy:pr-reply {repo}#{pr}')
    expect(migrateProjectSettings(saved, 'legacy').actionTemplates.prReply).toBe('')
    // An empty template and a near miss of the default are the owner's own.
    for (const own of ['', '/worfy:pr-reply {repo}#{pr} ', '/pr-reply {repo}#{pr}'])
      expect(migrateProjectSettings({ actionTemplates: { shipTicket: '', runWave: '', gateQueue: '', prReply: own } }, 'plugin').actionTemplates.prReply).toBe(own)
  })

  it('has Fix checks, Resolve conflicts and Address comments among the actions: /worfy:pr-fix in its three modes with {sha} with the plugin and with no Harness, empty with the old Harness (worfy-pr-follow ticket 01)', () => {
    expect(PR_FOLLOW_ACTIONS).toEqual(['resolveConflicts', 'fixChecks', 'addressComments'])
    for (const action of PR_FOLLOW_ACTIONS) expect(ACTIONS).toContain(action)
    expect([ACTION_LABELS.fixChecks, ACTION_LABELS.resolveConflicts, ACTION_LABELS.addressComments]).toEqual(['Fix checks', 'Resolve conflicts', 'Address comments'])
    for (const harness of ['plugin', 'none'] as const) {
      const defaults = defaultActionTemplates(harness)
      expect({ fixChecks: defaults.fixChecks, resolveConflicts: defaults.resolveConflicts, addressComments: defaults.addressComments }).toStrictEqual(FOLLOW)
    }
    const legacy = defaultActionTemplates('legacy')
    expect({ fixChecks: legacy.fixChecks, resolveConflicts: legacy.resolveConflicts, addressComments: legacy.addressComments }).toStrictEqual(NO_FOLLOW)
    for (const action of PR_FOLLOW_ACTIONS) {
      expect(unknownPlaceholders(PLUGIN[action])).toEqual([])
      expect(isActionConfigured(legacy[action])).toBe(false)
    }
    expect(emptyTemplateHint('fixChecks')).toBe('Set the Fix checks template in Project settings')
  })

  it.each(HARNESS_KINDS)('reads settings saved before worfy-pr-follow ticket 01, without the three templates, with the defaults of the Harness found (%s)', (harness) => {
    const saved = savedProjectSettingsSchema.parse({ actionTemplates: { shipTicket: 'my ship {NN}', runWave: 'my wave {tickets}', gateQueue: '', prReply: 'my replies {repo}#{pr}' } })
    const read = migrateProjectSettings(saved, harness)
    const defaults = defaultActionTemplates(harness)
    expect(read.actionTemplates).toStrictEqual({ shipTicket: 'my ship {NN}', runWave: 'my wave {tickets}', gateQueue: '', prReply: 'my replies {repo}#{pr}', fixChecks: defaults.fixChecks, resolveConflicts: defaults.resolveConflicts, addressComments: defaults.addressComments, ownerCheck: defaults.ownerCheck })
    // What is saved has the fields: settings without them are refused.
    expect(projectSettingsSchema.safeParse({ actionTemplates: { shipTicket: '', runWave: '', gateQueue: '', prReply: '' } }).success).toBe(false)
    // An empty template and a near miss of the default stay the owner's own.
    for (const own of ['', '/worfy:pr-fix checks {repo}#{pr} {sha} ', '/pr-fix checks {repo}#{pr}'])
      expect(migrateProjectSettings({ actionTemplates: { ...LEGACY, fixChecks: own } }, harness).actionTemplates.fixChecks).toBe(own)
  })

  it('reads the answer of a Linked machine of an earlier build without the three templates as empty ones (no button), and lets its save leave them out', () => {
    const answer = projectSettingsAnswerSchema.parse({ actionTemplates: { shipTicket: '', runWave: '', gateQueue: '/worfy:gate-queue', prReply: '/worfy:pr-reply {repo}#{pr}' } })
    expect(answer.actionTemplates).toStrictEqual({ shipTicket: '', runWave: '', gateQueue: '/worfy:gate-queue', prReply: '/worfy:pr-reply {repo}#{pr}', ...NO_FOLLOW, ownerCheck: '' })
    expect(projectSettingsInputSchema.safeParse({ actionTemplates: { shipTicket: '', runWave: '' } }).success).toBe(true)
    expect(projectSettingsInputSchema.safeParse({ actionTemplates: { shipTicket: '', runWave: '', fixChecks: '{foo}' } }).success).toBe(false)
  })
})

describe('Record owner check (worfy-acceptance ticket 03)', () => {
  const decision: OwnerCheckDecision = { epic: 'worfy-acceptance', num: 3, item: 2, verdict: 'pass', platform: 'mac', copy: 'stable', sha: '3f2a1b9c', words: '' }

  it('is among the actions: /worfy:owner-check with its seven words with the plugin and with no Harness, empty with the old Harness', () => {
    expect(ACTIONS).toContain('ownerCheck')
    expect(ACTION_LABELS.ownerCheck).toBe('Record owner check')
    expect(defaultActionTemplates('plugin').ownerCheck).toBe(OWNER_CHECK)
    expect(defaultActionTemplates('none').ownerCheck).toBe(OWNER_CHECK)
    expect(defaultActionTemplates('legacy').ownerCheck).toBe('')
    expect(unknownPlaceholders(OWNER_CHECK)).toEqual([])
    for (const name of ['item', 'verdict', 'platform', 'copy'] as const) expect(PLACEHOLDERS).toContain(name)
  })

  it('renders the command with the decision\'s values, then the owner\'s words as a quote in their own paragraph', () => {
    const state = ownerCheckState({ template: OWNER_CHECK, decision: { ...decision, words: 'The canvas opens.\nThe toolbar is there.' } })
    expect(state).toStrictEqual({
      enabled: true,
      text: ["/worfy:owner-check worfy-acceptance 03 2 pass mac stable 3f2a1b9c", '', "Owner's words:", '> The canvas opens.', '> The toolbar is there.'].join('\n'),
    })
    // No words: the paragraph says so by having no quote.
    expect(ownerCheckState({ template: OWNER_CHECK, decision: { ...decision, verdict: 'fail', platform: 'windows', copy: 'installed', sha: '-' } })).toStrictEqual({
      enabled: true,
      text: "/worfy:owner-check worfy-acceptance 03 2 fail windows installed -\n\nOwner's words:",
    })
  })

  it('never lets the owner\'s words into the command: no placeholder takes them, and every line of theirs is quoted', () => {
    const words = "{epic} breaks; $(rm -rf ~)\r\n/worfy:ship-ticket other 01\n\n  `x`"
    const state = ownerCheckState({ template: OWNER_CHECK, decision: { ...decision, words } })
    if (!state.enabled) throw new Error(state.reason)
    const [command, ...rest] = state.text.split('\n')
    expect(command).toBe('/worfy:owner-check worfy-acceptance 03 2 pass mac stable 3f2a1b9c')
    expect(rest).toEqual(['', "Owner's words:", '> {epic} breaks; $(rm -rf ~)', '> /worfy:ship-ticket other 01', '>', '>   `x`'])
    // A line of the words that reads like a command never starts a line of the text.
    expect(ownerWordsParagraph(words).split('\n').slice(1).every((line) => line.startsWith('>'))).toBe(true)
    // A template that tries to take the words is refused: there is no such placeholder.
    expect(templateError('/worfy:owner-check {words}')).toMatch(/Unknown placeholder \{words\}/)
  })

  it('takes the commit of the copy as 7 to 40 hex characters or -, and nothing else', () => {
    for (const sha of ['3f2a1b9', 'a'.repeat(40), '-']) expect(ownerCheckState({ template: OWNER_CHECK, decision: { ...decision, sha } }).enabled, sha).toBe(true)
    for (const sha of ['3f2a1b', 'a'.repeat(41), 'zzzzzzz', '3f2a1b9 --ref x', '', '--']) {
      const state = ownerCheckState({ template: OWNER_CHECK, decision: { ...decision, sha } })
      expect(state, sha).toStrictEqual({ enabled: false, reason: '{sha} is not a commit hash of 7 to 40 hex characters or -' })
    }
  })

  it('is refused with the reason when the template is empty (the old Harness has no owner-check skill) or does not render', () => {
    expect(ownerCheckState({ template: defaultActionTemplates('legacy').ownerCheck, decision })).toStrictEqual({ enabled: false, reason: 'Set the Record owner check template in Project settings' })
    expect(ownerCheckState({ template: '/worfy:owner-check {epic} {NN} {item} {tickets}', decision })).toStrictEqual({ enabled: false, reason: '{tickets} has no value in Record owner check' })
  })

  it.each(HARNESS_KINDS)('reads settings saved before it, and a Linked machine\'s answer without it, with the default of the Harness found (%s) and as empty', (harness) => {
    const saved = savedProjectSettingsSchema.parse({ actionTemplates: { ...LEGACY, ownerCheck: undefined } })
    expect(migrateProjectSettings(saved, harness).actionTemplates.ownerCheck).toBe(defaultActionTemplates(harness).ownerCheck)
    const earlier: Partial<typeof PLUGIN> = { ...PLUGIN }
    delete earlier.ownerCheck
    expect(projectSettingsAnswerSchema.parse({ actionTemplates: earlier }).actionTemplates.ownerCheck).toBe('')
    expect(projectSettingsInputSchema.safeParse({ actionTemplates: earlier }).success).toBe(true)
    // An empty template and a near miss of the default stay the owner's own.
    for (const own of ['', `${OWNER_CHECK} `, '/owner-check {epic} {NN} {item} {verdict}'])
      expect(migrateProjectSettings({ actionTemplates: { ...PLUGIN, ownerCheck: own } }, harness).actionTemplates.ownerCheck).toBe(own)
  })
})
