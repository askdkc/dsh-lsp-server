import { describe, expect, it } from 'vitest'
import { StderrTail } from '../../src/runtime/process-lifecycle.js'

describe('process lifecycle bounds', () => {
  it('retains only the configured stderr tail', () => {
    const tail = new StderrTail(4)
    tail.append(Buffer.from('abcdef'))
    expect(tail.text()).toBe('cdef')
  })
})
