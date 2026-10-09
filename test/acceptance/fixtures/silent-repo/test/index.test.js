import assert from 'node:assert/strict'
import { test } from 'node:test'
import { name } from '../src/index.js'

test('the package names itself', () => {
  assert.equal(name, 'silent-app')
})
