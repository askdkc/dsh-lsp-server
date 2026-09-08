import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { SERVER_IDS, type ResolvedConfig } from '../config.js'
import { resolveLaunch } from '../servers/launch.js'
import type { WebstackLspService } from '../service.js'
import { createUnavailableService } from '../service.js'

export function localStatusService(config: ResolvedConfig): WebstackLspService {
  return {
    ...createUnavailableService(config.providerId),
    async status() {
      return { providerId: config.providerId, servers: await Promise.all(SERVER_IDS.map(async id => {
        const server = config.servers[id]
        let available = false
        try {
          const spec = await resolveLaunch(id, config, process.cwd())
          const candidates = isAbsolute(spec.command) ? [spec.command] : (server.env.PATH ?? process.env.PATH ?? '').split(delimiter).filter(Boolean).map(dir => join(dir, spec.command))
          for (const path of candidates) { try { await access(path, constants.X_OK); available = true; break } catch {} }
          // Package manifests can survive an incomplete installation without their executable.
          if (available && server.mode === 'bundled') await access(spec.args[0]!, constants.R_OK)
        } catch { available = false }
        return { id, enabled: server.enabled && (id !== 'tailwind' || config.tailwind.enabled), available, source: server.mode, liveWorkspaces: 0, restarts: 0 }
      })) }
    },
  }
}
