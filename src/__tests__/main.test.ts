import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// vi.hoisted ensures these are available when vi.mock factories execute (hoisted above imports)
const { mockGetInput, mockSetSecret, mockSetFailed, mockSetOutput, mockInfo, mockSendPolicyRequest } = vi.hoisted(() => ({
  mockGetInput: vi.fn(),
  mockSetSecret: vi.fn(),
  mockSetFailed: vi.fn(),
  mockSetOutput: vi.fn(),
  mockInfo: vi.fn(),
  mockSendPolicyRequest: vi.fn(),
}))

vi.mock('@actions/core', () => ({
  getInput: mockGetInput,
  setSecret: mockSetSecret,
  setFailed: mockSetFailed,
  setOutput: mockSetOutput,
  info: mockInfo,
}))

vi.mock('../../src/lib/request.js', () => ({
  sendPolicyRequest: mockSendPolicyRequest,
}))

// Import run — the top-level run() call in main.ts will execute with mocked deps
// which is fine since all mocks return undefined/empty by default
import { run } from '../../src/main.js'

describe('Action Entry Point (run)', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv, GITHUB_REPOSITORY: 'test-org/test-repo' }

    // Default input mapping
    mockGetInput.mockImplementation((name: string) => {
      switch (name) {
        case 'secret': return 'test-secret-value'
        case 'api-endpoint': return 'https://api.example.com/check'
        case 'timeout-ms': return '10000'
        default: return ''
      }
    })

    // Default successful response
    mockSendPolicyRequest.mockResolvedValue({
      statusCode: 200,
      body: '{"status":"compliant"}',
      durationMs: 42,
    })
  })

  afterEach(() => {
    process.env = originalEnv
  })

  // ---------------------------------------------------------------
  // Secret masking
  // ---------------------------------------------------------------

  it('should call setSecret immediately with the secret value', async () => {
    await run()

    expect(mockSetSecret).toHaveBeenCalledWith('test-secret-value')
    // setSecret should be called before any setFailed/setOutput
    const setSecretOrder = mockSetSecret.mock.invocationCallOrder[0]
    for (const call of mockSetFailed.mock.invocationCallOrder) {
      expect(setSecretOrder).toBeLessThan(call)
    }
  })

  it('should never include the secret in any setFailed or info call', async () => {
    mockSendPolicyRequest.mockRejectedValue(new Error('Network failure'))
    await run()

    for (const call of mockSetFailed.mock.calls) {
      expect(String(call[0])).not.toContain('test-secret-value')
    }
    for (const call of mockInfo.mock.calls) {
      expect(String(call[0])).not.toContain('test-secret-value')
    }
  })

  // ---------------------------------------------------------------
  // Successful request
  // ---------------------------------------------------------------

  it('should set outputs on successful 2xx response', async () => {
    await run()

    expect(mockSetOutput).toHaveBeenCalledWith('status-code', '200')
    expect(mockSetOutput).toHaveBeenCalledWith('response-body', '{"status":"compliant"}')
    expect(mockSetFailed).not.toHaveBeenCalled()
  })

  it('should log success info', async () => {
    await run()

    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('passed'))
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('200'))
  })

  it('should pass correct options to sendPolicyRequest', async () => {
    await run()

    expect(mockSendPolicyRequest).toHaveBeenCalledWith({
      repo: 'test-org/test-repo',
      secret: 'test-secret-value',
      endpoint: 'https://api.example.com/check',
      timeoutMs: 10000,
    })
  })

  // ---------------------------------------------------------------
  // Non-2xx responses
  // ---------------------------------------------------------------

  it('should call setFailed on non-2xx response', async () => {
    mockSendPolicyRequest.mockResolvedValue({
      statusCode: 403,
      body: '{"error":"FORBIDDEN_REPO"}',
      durationMs: 50,
    })

    await run()

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('403')
    )
    // Outputs should still be set
    expect(mockSetOutput).toHaveBeenCalledWith('status-code', '403')
  })

  // ---------------------------------------------------------------
  // Missing / empty inputs
  // ---------------------------------------------------------------

  it('should fail with descriptive message when secret is empty', async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'secret') return ''
      if (name === 'api-endpoint') return 'https://api.example.com/check'
      return ''
    })

    await run()

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('DEPENDABOT_ENFORCER_SECRET')
    )
    expect(mockSendPolicyRequest).not.toHaveBeenCalled()
  })

  it('should fail with descriptive message when api-endpoint is empty', async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'secret') return 'test-secret-value'
      if (name === 'api-endpoint') return ''
      return ''
    })

    await run()

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('api-endpoint')
    )
    expect(mockSendPolicyRequest).not.toHaveBeenCalled()
  })

  it('should fail when api-endpoint is not a valid URL', async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'secret') return 'test-secret-value'
      if (name === 'api-endpoint') return 'not-a-url'
      return ''
    })

    await run()

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('not a valid URL')
    )
    expect(mockSendPolicyRequest).not.toHaveBeenCalled()
  })

  it('should fail when GITHUB_REPOSITORY is not set', async () => {
    delete process.env.GITHUB_REPOSITORY

    await run()

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('GITHUB_REPOSITORY')
    )
    expect(mockSendPolicyRequest).not.toHaveBeenCalled()
  })

  it('should fail when timeout-ms is not a valid number', async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'secret') return 'test-secret-value'
      if (name === 'api-endpoint') return 'https://api.example.com/check'
      if (name === 'timeout-ms') return 'abc'
      return ''
    })

    await run()

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('timeout-ms')
    )
    expect(mockSendPolicyRequest).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------
  // Network / unexpected errors
  // ---------------------------------------------------------------

  it('should catch and report network errors', async () => {
    mockSendPolicyRequest.mockRejectedValue(new Error('ECONNREFUSED'))

    await run()

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('ECONNREFUSED')
    )
  })

  it('should catch and report timeout errors', async () => {
    mockSendPolicyRequest.mockRejectedValue(new Error('Request timed out after 10000ms'))

    await run()

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('timed out')
    )
  })

  it('should handle non-Error throws gracefully', async () => {
    mockSendPolicyRequest.mockRejectedValue('string error')

    await run()

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('string error')
    )
  })
})
