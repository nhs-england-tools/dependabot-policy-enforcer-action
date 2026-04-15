import { describe, it, expect } from 'vitest'
import { extractPrNumber } from '../../src/lib/github.js'

// ---------------------------------------------------------------------------
// extractPrNumber
// ---------------------------------------------------------------------------

describe('extractPrNumber', () => {
  it('should extract PR number from pull_request ref', () => {
    expect(extractPrNumber('pull_request', 'refs/pull/42/merge')).toBe(42)
  })

  it('should extract PR number from pull_request_target ref', () => {
    expect(extractPrNumber('pull_request_target', 'refs/pull/7/merge')).toBe(7)
  })

  it('should return null for push event', () => {
    expect(extractPrNumber('push', 'refs/heads/main')).toBeNull()
  })

  it('should return null when eventName is undefined', () => {
    expect(extractPrNumber(undefined, 'refs/pull/1/merge')).toBeNull()
  })

  it('should return null when ref is undefined', () => {
    expect(extractPrNumber('pull_request', undefined)).toBeNull()
  })

  it('should return null when ref does not contain a PR number', () => {
    expect(extractPrNumber('pull_request', 'refs/heads/feature')).toBeNull()
  })
})
