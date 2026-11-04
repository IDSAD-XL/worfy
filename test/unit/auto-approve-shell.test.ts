import { describe, expect, it } from 'vitest'
import { analyze } from '../../src/main/agent/auto-approve/shell'

const posix = { cwd: '/tmp/demo', env: { HOME: '/home/demo', TMPDIR: '/tmp/demo-tmp' }, platform: 'linux' as const }

describe('analyze', () => {
  it('does not judge a command substitution in a target', () => {
    expect(analyze('rm -rf $(echo x)', posix).judged).toBe(false)
  })
})
