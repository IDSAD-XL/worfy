import { describe, expect, it } from 'vitest'
import {
  actionTemplateSchema,
  defaultProjectSettings,
  isActionConfigured,
  LEGACY_RUN_WAVE_TEMPLATE,
  migrateProjectSettings,
  namesWaveTickets,
  projectSettingsSchema,
  templateError,
  unknownPlaceholders,
} from '../../src/shared/projects/action-templates'

describe('action templates', () => {
  it('gives a new Project the default templates', () => {
    expect(defaultProjectSettings()).toStrictEqual({
      actionTemplates: {
        shipTicket: '/ship-ticket {epic} {NN}',
        runWave: '/epic-wave Ticket-ы {tickets} эпика {epic}',
      },
    })
  })

  it('reads a saved Run wave template equal to the old default as the new default, and leaves every other template alone (ticket 30)', () => {
    expect(LEGACY_RUN_WAVE_TEMPLATE).toBe('/epic-wave волна {wave} эпика {epic}')
    const old = { actionTemplates: { shipTicket: 'my ship {NN}', runWave: LEGACY_RUN_WAVE_TEMPLATE } }
    expect(migrateProjectSettings(old)).toStrictEqual({ actionTemplates: { shipTicket: 'my ship {NN}', runWave: '/epic-wave Ticket-ы {tickets} эпика {epic}' } })
    // The argument is not changed in place.
    expect(old.actionTemplates.runWave).toBe(LEGACY_RUN_WAVE_TEMPLATE)
    for (const own of ['/epic-wave волна {wave} эпика {epic} ', '/epic-wave wave {wave} of {epic}', '', '/epic-wave Ticket-ы {tickets} эпика {epic}']) {
      expect(migrateProjectSettings({ actionTemplates: { shipTicket: '', runWave: own } }).actionTemplates.runWave).toBe(own)
    }
    // A Ship ticket template that happens to read like the old Run wave default is not touched.
    expect(migrateProjectSettings({ actionTemplates: { shipTicket: LEGACY_RUN_WAVE_TEMPLATE, runWave: '' } }).actionTemplates.shipTicket).toBe(LEGACY_RUN_WAVE_TEMPLATE)
  })

  it('tells whether a Run wave template names the Wave\'s tickets', () => {
    expect(namesWaveTickets('/epic-wave Ticket-ы {tickets} эпика {epic}')).toBe(true)
    expect(namesWaveTickets(LEGACY_RUN_WAVE_TEMPLATE)).toBe(false)
    expect(namesWaveTickets('/epic-wave {Tickets}')).toBe(false)
    expect(namesWaveTickets('')).toBe(false)
  })

  it('hands out a fresh copy each time, so editing one does not change the defaults', () => {
    const first = defaultProjectSettings()
    first.actionTemplates.shipTicket = 'changed'
    expect(defaultProjectSettings().actionTemplates.shipTicket).toBe('/ship-ticket {epic} {NN}')
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
