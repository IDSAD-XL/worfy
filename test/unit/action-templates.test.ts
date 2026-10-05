import { describe, expect, it } from 'vitest'
import {
  actionTemplateSchema,
  defaultProjectSettings,
  isActionConfigured,
  projectSettingsSchema,
  templateError,
  unknownPlaceholders,
} from '../../src/shared/projects/action-templates'

describe('action templates', () => {
  it('gives a new Project the default templates', () => {
    expect(defaultProjectSettings()).toStrictEqual({
      actionTemplates: {
        shipTicket: '/ship-ticket {epic} {NN}',
        runWave: '/epic-wave волна {wave} эпика {epic}',
      },
    })
  })

  it('hands out a fresh copy each time, so editing one does not change the defaults', () => {
    const first = defaultProjectSettings()
    first.actionTemplates.shipTicket = 'changed'
    expect(defaultProjectSettings().actionTemplates.shipTicket).toBe('/ship-ticket {epic} {NN}')
  })

  it('accepts every known placeholder', () => {
    const template = '{epic} {NN} {wave} {slug} {branch}'
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
