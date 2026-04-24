import { describe, expect, it } from 'vitest'
import { resolveSidecarCommand } from '../../../src/main/paths'

describe('resolveSidecarCommand', () => {
  it('spawns the CLI from the dev repo when dev=true', () => {
    const cmd = resolveSidecarCommand({
      platform: 'linux',
      resourcesPath: '/unused',
      dev: true,
      devRepoPath: '/home/user/sanctum',
    })

    expect(cmd.command).toBe('sanctum')
    expect(cmd.args).toEqual(['serve', '--port', '0', '--token-stdin'])
    expect(cmd.cwd).toBe('/home/user/sanctum')
  })

  it('falls back to ../sanctum when SANCTUM_DEV_REPO is unset', () => {
    const cmd = resolveSidecarCommand({
      platform: 'linux',
      resourcesPath: '/unused',
      dev: true,
      devRepoPath: undefined,
    })

    expect(cmd.cwd).toBe('../sanctum')
  })

  it('points at the packaged onedir binary in production on macOS', () => {
    const cmd = resolveSidecarCommand({
      platform: 'darwin',
      resourcesPath: '/Applications/Sanctum.app/Contents/Resources',
      dev: false,
      devRepoPath: undefined,
    })

    expect(cmd.command).toBe('/Applications/Sanctum.app/Contents/Resources/sidecar/sanctum-sidecar')
    expect(cmd.cwd).toBeUndefined()
  })

  it('appends .exe on Windows', () => {
    const cmd = resolveSidecarCommand({
      platform: 'win32',
      resourcesPath: 'C:\\Program Files\\Sanctum\\resources',
      dev: false,
      devRepoPath: undefined,
    })

    expect(cmd.command).toMatch(/sanctum-sidecar\.exe$/)
  })

  it('sets the airgap env in both modes', () => {
    const dev = resolveSidecarCommand({
      platform: 'linux',
      resourcesPath: '/x',
      dev: true,
      devRepoPath: undefined,
    })
    const prod = resolveSidecarCommand({
      platform: 'linux',
      resourcesPath: '/x',
      dev: false,
      devRepoPath: undefined,
    })

    for (const cmd of [dev, prod]) {
      expect(cmd.env.HF_HUB_OFFLINE).toBe('1')
      expect(cmd.env.TRANSFORMERS_OFFLINE).toBe('1')
      expect(cmd.env.PYTHONUNBUFFERED).toBe('1')
    }
  })
})
