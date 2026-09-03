import { fileURLToPath, pathToFileURL } from 'node:url'

export function pathToUri(filePath: string): string {
  return pathToFileURL(filePath).href
}

export function uriToPath(uri: string): string {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    throw new Error('invalid file URI')
  }
  if (url.protocol !== 'file:') throw new Error('only file URIs are supported')
  return fileURLToPath(url)
}
