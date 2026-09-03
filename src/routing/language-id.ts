import type { ClassifiedFile } from './classifier.js'
import type { Route } from './route-table.js'

export function primaryLanguageId(route: Route): string {
  return route.primary.languageId
}

export function languageIdForServer(route: Route, server: string): string | null {
  if (route.primary.server === server) return route.primary.languageId
  if (route.auxiliary?.server === server) return route.auxiliary.languageId
  return null
}

export function classifyLanguage(file: ClassifiedFile, route: Route, server: string): string | null {
  return languageIdForServer(route, server) ?? (file.kind === 'blade' && server === 'tailwind' ? 'html' : null)
}
