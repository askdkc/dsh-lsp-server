import { describe, expect, it } from 'vitest'
import { classifyFile } from '../../src/routing/classifier.js'

describe('classifyFile', () => {
  it('prioritizes blade over php and normalizes case', () => {
    expect(classifyFile('resources\\Views\\Show.BLADE.PHP')).toMatchObject({ kind: 'blade', suffix: '.blade.php' })
    expect(classifyFile('src/foo.PHP')).toMatchObject({ kind: 'php' })
  })

  it('handles TypeScript declarations and rejects dotfiles/extensions missing', () => {
    expect(classifyFile('/src/index.d.ts')).toMatchObject({ kind: 'typescript', suffix: '.ts' })
    expect(classifyFile('/src/.env')).toBeUndefined()
    expect(classifyFile('/src/README')).toBeUndefined()
  })

  it('supports custom blade suffixes with longest-suffix precedence', () => {
    expect(classifyFile('views/card.template.php', ['.template.php'])).toMatchObject({ kind: 'blade', suffix: '.template.php' })
  })
})
