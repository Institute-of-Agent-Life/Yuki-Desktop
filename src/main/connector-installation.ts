import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, mkdir, readFile, readlink, rename, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { ApiError } from './api/client'
import type { LocalStore } from './store'

export interface ConnectorRuntime {
  directory: string
  executable: string
  arguments: string[]
  version: string
  protocol: number
  build: string
}
export interface ConnectorInstallation {
  dataDirectory: string
  runtime: ConnectorRuntime
  managed: boolean
}
export interface RuntimeManifest {
  version: string
  protocol: number
  platform: string
  arch: string
  executable: string
  arguments: string[]
  files: { path: string; sha256?: string; link?: string }[]
}
const preference = 'agent-connector-installation'
export class ConnectorInstallations {
  constructor(
    readonly root: string,
    readonly bundledRuntime: string,
    readonly store: Pick<LocalStore, 'get' | 'set'>,
  ) {}
  selected() {
    return this.store.get<ConnectorInstallation>(preference)
  }
  select(installation: ConnectorInstallation) {
    this.store.set(preference, installation)
  }
  selectIfCurrent(installation: ConnectorInstallation, expected: ConnectorInstallation | null) {
    if (isDeepStrictEqual(this.selected() ?? null, expected)) this.select(installation)
  }
  async manifest(): Promise<RuntimeManifest | undefined> {
    try {
      return JSON.parse(await readFile(join(this.bundledRuntime, 'manifest.json'), 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      if (error instanceof SyntaxError) throw new ApiError('connector_runtime_invalid')
      throw error
    }
  }
  async bundled(): Promise<ConnectorRuntime | undefined> {
    const manifest = await this.manifest()
    if (!manifest) return undefined
    // Read-only management uses installed app code; install() verifies new runtime copies.
    return {
      directory: this.bundledRuntime,
      executable: resolve(this.bundledRuntime, manifest.executable),
      arguments: manifest.arguments,
      version: manifest.version,
      protocol: manifest.protocol,
      build: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    }
  }
  private async validate(manifest: RuntimeManifest) {
    if (manifest.platform !== process.platform || manifest.arch !== process.arch)
      throw new ApiError('connector_runtime_platform')
    const source = this.bundledRuntime
    const executable = resolve(source, manifest.executable)
    if (
      isAbsolute(manifest.executable) ||
      relative(source, executable) === '..' ||
      relative(source, executable).startsWith('..' + sep)
    )
      throw new ApiError('connector_runtime_invalid')
    try {
      for (const file of manifest.files) {
        const path = resolve(source, file.path)
        if (
          isAbsolute(file.path) ||
          relative(source, path) === '..' ||
          relative(source, path).startsWith('..' + sep)
        )
          throw new ApiError('connector_runtime_invalid')
        if (file.link !== undefined) {
          if ((await readlink(path)) !== file.link) throw new ApiError('connector_runtime_invalid')
        } else {
          const hash = createHash('sha256')
          for await (const chunk of createReadStream(path)) hash.update(chunk)
          if (hash.digest('hex') !== file.sha256) throw new ApiError('connector_runtime_invalid')
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new ApiError('connector_runtime_invalid')
      throw error
    }
  }
  async install(
    separate = false,
    selected: ConnectorInstallation | null = this.selected() ?? null,
  ): Promise<ConnectorInstallation> {
    const previous = separate ? undefined : (selected ?? undefined)
    const manifest = await this.manifest()
    if (!manifest) throw new ApiError('connector_runtime_unavailable')
    const source = this.bundledRuntime
    // The manifest is part of the signed Desktop payload. Validate bytes before executing them.
    await this.validate(manifest)
    const build = createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
    const runtimeDirectory = join(this.root, 'runtimes', `${manifest.version}-${build}`)
    try {
      await stat(runtimeDirectory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await mkdir(dirname(runtimeDirectory), { recursive: true })
      const staging = `${runtimeDirectory}-${randomUUID()}.pending`
      await cp(source, staging, { recursive: true, verbatimSymlinks: true })
      await rename(staging, runtimeDirectory)
    }
    const executable = resolve(runtimeDirectory, manifest.executable)
    if (
      isAbsolute(manifest.executable) ||
      relative(runtimeDirectory, executable).startsWith('..' + sep)
    )
      throw new ApiError('connector_runtime_invalid')
    const installation: ConnectorInstallation = {
      managed: true,
      dataDirectory: previous?.dataDirectory ?? join(this.root, 'installations', randomUUID()),
      runtime: {
        directory: runtimeDirectory,
        executable,
        arguments: manifest.arguments,
        version: manifest.version,
        protocol: manifest.protocol,
        build,
      },
    }
    // Selection is local installation metadata; credentials remain solely in Connector config.
    this.selectIfCurrent(installation, selected)
    return installation
  }
}
