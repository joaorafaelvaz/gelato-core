import { describe, expect, it } from 'vitest'
import { PERMISSIONS, ROLE_PERMISSIONS } from './permissions'

describe('integration_reader role', () => {
  it('catálogo contém integration.read', () => {
    expect(PERMISSIONS).toContain('integration.read')
  })

  it('role integration_reader tem apenas integration.read', () => {
    expect(ROLE_PERMISSIONS.integration_reader).toEqual(['integration.read'])
  })
})
