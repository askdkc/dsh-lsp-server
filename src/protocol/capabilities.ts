export type StandardOperation = 'goToDefinition' | 'findReferences' | 'goToImplementation' | 'hover'

export function supportsOperation(capabilities: Record<string, unknown>, operation: StandardOperation): boolean {
  if (operation === 'goToDefinition') return capabilities.definitionProvider === true || isProvider(capabilities.definitionProvider)
  if (operation === 'findReferences') return capabilities.referencesProvider === true || isProvider(capabilities.referencesProvider)
  if (operation === 'goToImplementation') return capabilities.implementationProvider === true || isProvider(capabilities.implementationProvider)
  return capabilities.hoverProvider === true || isProvider(capabilities.hoverProvider)
}

function isProvider(value: unknown): boolean {
  return typeof value === 'object' && value !== null || value === true
}

export function defaultServerRequest(method: string, params: unknown): unknown {
  if (method === 'workspace/configuration') {
    return Array.isArray(params) ? params.map(() => null) : []
  }
  if (method === 'window/workDoneProgress/create' || method === 'client/registerCapability' || method === 'client/unregisterCapability') return null
  if (method === 'workspace/applyEdit') return { applied: false, failureReason: 'read-only provider' }
  return null
}
