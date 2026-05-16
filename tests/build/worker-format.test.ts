import { describe, expect, it } from 'vitest'
import viteConfig from '../../vite.config'

describe('worker bundle strategy', () => {
  it('uses ESM worker output so Vite can code-split heavy chunks', () => {
    const resolved =
      typeof viteConfig === 'function'
        ? viteConfig({ mode: 'production', command: 'build', isSsrBuild: false })
        : viteConfig
    expect(resolved.worker?.format).toBe('es')
  })
})
