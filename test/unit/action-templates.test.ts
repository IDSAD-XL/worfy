import { describe, expect, it } from 'vitest'
import {
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
  templateError,
  unknownPlaceholders,
} from '../../src/shared/projects/action-templates'

const LEGACY = { shipTicket: '/ship-ticket {epic} {NN}', runWave: '/epic-wave Ticket-ы {tickets} эпика {epic}' }
const PLUGIN = { shipTicket: '/worfy:ship-ticket {epic} {NN}', runWave: '/worfy:epic-wave tickets {tickets} of epic {epic}' }

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
    const old = { actionTemplates: { shipTicket: 'my ship {NN}', runWave: LEGACY_RUN_WAVE_TEMPLATE } }
    expect(migrateProjectSettings(old, 'legacy')).toStrictEqual({ actionTemplates: { shipTicket: 'my ship {NN}', runWave: '/epic-wave Ticket-ы {tickets} эпика {epic}' } })
    // The argument is not changed in place.
    expect(old.actionTemplates.runWave).toBe(LEGACY_RUN_WAVE_TEMPLATE)
    for (const own of ['/epic-wave волна {wave} эпика {epic} ', '/epic-wave wave {wave} of {epic}', '', '/epic-wave Ticket-ы {tickets} эпика {epic}']) {
      expect(migrateProjectSettings({ actionTemplates: { shipTicket: '', runWave: own } }, 'legacy').actionTemplates.runWave).toBe(own)
    }
    // A Ship ticket template that happens to read like the old Run wave default is not touched.
    expect(migrateProjectSettings({ actionTemplates: { shipTicket: LEGACY_RUN_WAVE_TEMPLATE, runWave: '' } }, 'legacy').actionTemplates.shipTicket).toBe(LEGACY_RUN_WAVE_TEMPLATE)
  })

  it.each(HARNESS_KINDS)('reads every earlier default as the default of the Harness found (%s), and returns the saved object when nothing changes', (harness) => {
    const defaults = defaultActionTemplates(harness)
    const earlier = {
      shipTicket: [LEGACY.shipTicket, PLUGIN.shipTicket],
      runWave: [LEGACY.runWave, LEGACY_RUN_WAVE_TEMPLATE, PLUGIN.runWave],
    }
    for (const action of ACTIONS) {
      for (const saved of earlier[action]) {
        const settings = { actionTemplates: { shipTicket: 'my ship {NN}', runWave: '', [action]: saved } }
        const read = migrateProjectSettings(settings, harness)
        expect(read.actionTemplates[action]).toBe(defaults[action])
        // The other action keeps the owner's own template.
        const other = action === 'shipTicket' ? 'runWave' : 'shipTicket'
        expect(read.actionTemplates[other]).toBe(settings.actionTemplates[other])
        // The saved settings are not changed in place.
        expect(settings.actionTemplates[action]).toBe(saved)
      }
    }
    const own = { actionTemplates: { shipTicket: 'my ship {NN}', runWave: '' } }
    expect(migrateProjectSettings(own, harness)).toBe(own)
    const current = defaultProjectSettings(harness)
    expect(migrateProjectSettings(current, harness)).toBe(current)
  })

  it('keeps the owner\'s own templates under every Harness, a near miss of a default included', () => {
    for (const harness of HARNESS_KINDS) {
      for (const own of ['my ship {NN}', '', ' ', '/worfy:ship-ticket {epic} {NN} ', '/ship-ticket {NN}', PLUGIN.runWave]) {
        expect(migrateProjectSettings({ actionTemplates: { shipTicket: own, runWave: '' } }, harness).actionTemplates.shipTicket).toBe(own)
      }
      for (const own of ['/worfy:epic-wave wave {wave} of epic {epic}', '/epic-wave tickets {tickets} of epic {epic}', PLUGIN.shipTicket]) {
        expect(migrateProjectSettings({ actionTemplates: { shipTicket: '', runWave: own } }, harness).actionTemplates.runWave).toBe(own)
      }
    }
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
    expect(projectSettingsSchema.safeParse({ actionTemplates: { shipTicket: '{foo}', runWave: '' } }).success).toBe(false)
    expect(projectSettingsSchema.safeParse({ actionTemplates: { shipTicket: '' } }).success).toBe(false)
    const parsed = projectSettingsSchema.parse({ actionTemplates: { shipTicket: '', runWave: '', extra: 'x' }, other: 1 })
    expect(parsed).toStrictEqual({ actionTemplates: { shipTicket: '', runWave: '' } })
  })
})
