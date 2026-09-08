import { describe, expect, it } from 'vitest'
import { classifyFile } from '../../src/routing/classifier.js'
import { routeFor } from '../../src/routing/route-table.js'

describe('route table', () => {
  it('assigns Blade to PHPantom blade mode and Tailwind html mode', () => {
    const file = classifyFile('resources/views/show.blade.php')
    expect(file).toBeDefined()
    expect(routeFor(file!)).toEqual({ primary: { server: 'phpantom', languageId: 'blade' }, auxiliary: { server: 'tailwind', languageId: 'html' } })
  })

  it('uses TypeScript Language Server for JavaScript and CSS server with auxiliary Tailwind for CSS', () => {
    expect(routeFor(classifyFile('src/app.jsx')!)).toMatchObject({ primary: { server: 'typescript', languageId: 'javascriptreact' } })
    expect(routeFor(classifyFile('src/app.css')!)).toEqual({ primary: { server: 'css', languageId: 'css' }, auxiliary: { server: 'tailwind', languageId: 'css' } })
  })
})
