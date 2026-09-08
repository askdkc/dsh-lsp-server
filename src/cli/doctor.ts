#!/usr/bin/env node
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { WebstackLspService } from '../service.js'
import { resolveConfig } from '../config.js'
import { localStatusService } from './availability.js'
import { readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'

export interface DoctorOptions { json?: boolean; deep?: boolean }
export interface DoctorIssue { code: string; severity: 'warning' | 'error'; message: string }
export interface DoctorReport { providerId: string; ok: boolean; servers: Array<{ id: string; enabled: boolean; available: boolean; source: string; command?: string; version?: string; liveWorkspaces: number; restarts: number }>; issues: DoctorIssue[]; deep?: { checked: boolean; readOnly: true; notes: string[] } }

export async function collectDoctorReport(service: WebstackLspService, options: DoctorOptions = {}): Promise<DoctorReport> {
  const snapshot = await service.status()
  const servers = snapshot.servers.map((server) => ({
    id: server.id,
    enabled: server.enabled,
    available: server.available,
    source: server.source,
    ...(server.command ? { command: redactCommand(server.command) } : {}),
    ...(server.version ? { version: server.version } : {}),
    liveWorkspaces: server.liveWorkspaces,
    restarts: server.restarts,
  }))
  const issues: DoctorIssue[] = []
  snapshot.servers.forEach((server) => {
    if (server.enabled && !server.available) issues.push({ code: 'server_unavailable', severity: 'error', message: `${server.id} is enabled but unavailable` })
    if (server.lastError) issues.push({ code: 'server_error', severity: 'warning', message: `${server.id}: ${redactMessage(server.lastError)}` })
  })
  if (servers.length === 0) issues.push({ code: 'no_servers', severity: 'error', message: 'no language servers are configured or available' })
  const report: DoctorReport = { providerId: snapshot.providerId, ok: issues.every((issue) => issue.severity !== 'error'), servers, issues }
  if (options.deep) report.deep = { checked: true, readOnly: true, notes: ['configuration snapshot inspected', 'no files, processes, or text edits were changed'] }
  return report
}

export async function runDoctor(service: WebstackLspService, options: DoctorOptions = {}): Promise<string> {
  const report = await collectDoctorReport(service, options)
  if (options.json) return JSON.stringify(report, null, 2)
  const lines = [`${report.providerId}: ${report.ok ? 'ok' : 'attention required'}`]
  for (const server of report.servers) lines.push(`- ${server.id}: ${server.enabled ? (server.available ? 'available' : 'missing') : 'disabled'}${server.version ? ` (${server.version})` : ''}`)
  for (const issue of report.issues) lines.push(`${issue.severity === 'error' ? 'ERROR' : 'WARN'}: ${issue.message}`)
  if (report.deep) lines.push(...report.deep.notes.map((note) => `- ${note}`))
  return lines.join('\n')
}

function redactCommand(command: string): string {
  const clean = command.replace(/\\/g, '/')
  return clean.includes('/') ? basename(clean) : clean
}
function redactMessage(message: string): string {
  return message.replace(/(?:[A-Za-z]:)?(?:\\|\/)[^\s'"`]+/g, '<path>').replace(/(token|password|secret|key)=\S+/gi, '$1=<redacted>')
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  const configIndex = process.argv.indexOf('--config')
  const configPath = configIndex >= 0 ? process.argv[configIndex + 1] : undefined
  if (configIndex >= 0 && (!configPath || configPath.startsWith('--'))) throw new Error('--config requires a JSON file path')
  const service = localStatusService(resolveConfig(configPath ? JSON.parse(await readFile(configPath, 'utf8')) : {}))
  const options = { json: args.has('--json'), deep: args.has('--deep') }
  const report = await collectDoctorReport(service, options)
  const output = options.json ? JSON.stringify(report, null, 2) : await runDoctor(service, options)
  process.stdout.write(`${output}\n`)
  process.exitCode = report.ok ? 0 : 1
}

function isMain(): boolean {
  try { return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href } catch { return false }
}

if (isMain()) void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'doctor failed'}\n`); process.exitCode = 1 })
