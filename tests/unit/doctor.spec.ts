import { describe, expect, it } from 'vitest'
import { collectDoctorReport, runDoctor } from '../../src/cli/doctor.js'
import type { WebstackLspService } from '../../src/service.js'

const service: WebstackLspService = {
  status: async () => ({ providerId: 'webstack', servers: [
    { id: 'typescript', enabled: true, available: true, source: 'bundled', command: '/private/project/node_modules/.bin/typescript-language-server', liveWorkspaces: 1, restarts: 0 },
    { id: 'phpantom', enabled: true, available: false, source: 'path', command: 'phpantom_lsp', lastError: 'secret=abc /private/project/file', liveWorkspaces: 0, restarts: 1 },
  ] }),
  diagnostics: async () => ({ diagnostics: [] }),
  completion: async () => ({ items: [] }),
}

describe('doctor', () => {
  it('reports unavailable servers and redacts command/error details', async () => {
    const report = await collectDoctorReport(service, { json: true })
    expect(report.ok).toBe(false)
    expect(report.servers[0]!.command).toBe('typescript-language-server')
    expect(JSON.stringify(report)).not.toContain('abc')
    expect(JSON.stringify(report)).not.toContain('/private/project')
  })

  it('supports stable JSON and read-only deep mode', async () => {
    const output = await runDoctor(service, { json: true, deep: true })
    const report = JSON.parse(output) as { deep: { readOnly: boolean } }
    expect(report.deep.readOnly).toBe(true)
  })
})
