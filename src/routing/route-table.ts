import type { ServerId } from '../config.js'
import type { ClassifiedFile } from './classifier.js'

export interface Route {
  primary: { server: ServerId; languageId: string }
  auxiliary?: { server: 'tailwind'; languageId: string }
}

const ROUTES: Record<ClassifiedFile['kind'], Route> = {
  blade: { primary: { server: 'phpantom', languageId: 'blade' }, auxiliary: { server: 'tailwind', languageId: 'html' } },
  php: { primary: { server: 'phpantom', languageId: 'php' } },
  typescript: { primary: { server: 'typescript', languageId: 'typescript' }, auxiliary: { server: 'tailwind', languageId: 'typescript' } },
  typescriptreact: { primary: { server: 'typescript', languageId: 'typescriptreact' }, auxiliary: { server: 'tailwind', languageId: 'typescriptreact' } },
  javascript: { primary: { server: 'typescript', languageId: 'javascript' }, auxiliary: { server: 'tailwind', languageId: 'javascript' } },
  javascriptreact: { primary: { server: 'typescript', languageId: 'javascriptreact' }, auxiliary: { server: 'tailwind', languageId: 'javascriptreact' } },
  svelte: { primary: { server: 'svelte', languageId: 'svelte' }, auxiliary: { server: 'tailwind', languageId: 'svelte' } },
  html: { primary: { server: 'html', languageId: 'html' }, auxiliary: { server: 'tailwind', languageId: 'html' } },
  css: { primary: { server: 'tailwind', languageId: 'css' } },
}

export function routeFor(file: ClassifiedFile): Route {
  const route = ROUTES[file.kind]
  return { primary: { ...route.primary }, ...(route.auxiliary ? { auxiliary: { ...route.auxiliary } } : {}) }
}
