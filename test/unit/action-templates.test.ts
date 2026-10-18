import { describe, expect, it } from 'vitest'
import { emptyTemplateHint } from '../../src/shared/actions/render-template'
import {
  ACTION_LABELS,
  actionTemplateSchema,
  ACTIONS,
  DEFAULT_ACTION_TEMPLATES,
  defaultActionTemplates,
  defaultProjectSettings,
  HARNESS_KINDS,
  isActionConfigured,
  LEGACY_RUN_WAVE_TEMPLATE,
  migrateProjectSettings,
  namesWaveTickets,
  projectSettingsSchema,
  savedProjectSettingsSchema,
  templateError,
  unknownPlaceholders,
} from '../../src/shared/projects/action-templates'

const LEGACY = { shipTicket: '/ship-ticket {epic} {NN}', runWave: '/epic-wave Ticket-ы {tickets} эпика {epic}', gateQueue: '' }
const PLUGIN = { shipTicket: '/worfy:ship-ticket {epic} {NN}', runWave: '/worfy:epic-wave tickets {tickets} of epic {epic}', gateQueue: '/worfy:gate-queue' }

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

  it('names the Wave\'s tickets in the Run wave default of every Harness, as Autopilot needs (ADR-0033)', () => {
    for (const harness of HARNESS_KINDS) expect(namesWaveTickets(defaultActionTemplates(harness).runWave)).toBe(true)
  })

  it('reads a saved Run wave template equal to the old default as the new default, and leaves every other template alone (ticket 30)', () => {
    expect(LEGACY_RUN_WAVE_TEMPLATE).toBe('/epic-wave волна {wave} эпика {epic}')
    const old = { actionTemplates: { shipTicket: 'my ship {NN}', runWave: LEGACY_RUN_WAVE_TEMPLATE, gateQueue: '' } }
    expect(migrateProjectSettings(old, 'legacy')).toStrictEqual({ actionTemplates: { shipTicket: 'my ship {NN}', runWave: '/epic-wave Ticket-ы {tickets} эпика {epic}', gateQueue: '' } })
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
    }
    for (const action of ACTIONS) {
      for (const saved of earlier[action]) {
        const settings = { actionTemplates: { shipTicket: 'my ship {NN}', runWave: '', gateQueue: 'my queue', [action]: saved } }
        const read = migrateProjectSettings(settings, harness)
        expect(read.actionTemplates[action]).toBe(defaults[action])
        // The other actions keep the owner's own templates.
        for (const other of ACTIONS.filter((each) => each !== action)) expect(read.actionTemplates[other]).toBe(settings.actionTemplates[other])
        // The saved settings are not changed in place.
        expect(settings.actionTemplates[action]).toBe(saved)
      }
    }
    const own = { actionTemplates: { shipTicket: 'my ship {NN}', runWave: '', gateQueue: '' } }
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
      actionTemplates: { shipTicket: 'my ship {NN}', runWave: 'my wave {tickets}', gateQueue: defaultActionTemplates(harness).gateQueue },
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
    const template = '{epic} {NN} {wave} {slug} {branch} {tickets}'
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
    expect(projectSettingsSchema.safeParse({ actionTemplates: { shipTicket: '{foo}', runWave: '', gateQueue: '' } }).success).toBe(false)
    expect(projectSettingsSchema.safeParse({ actionTemplates: { shipTicket: '' } }).success).toBe(false)
    const parsed = projectSettingsSchema.parse({ actionTemplates: { shipTicket: '', runWave: '', gateQueue: '', extra: 'x' }, other: 1 })
    expect(parsed).toStrictEqual({ actionTemplates: { shipTicket: '', runWave: '', gateQueue: '' } })
  })
})
