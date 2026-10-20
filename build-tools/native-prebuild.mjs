import { readFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import { Arch } from 'builder-util'

export async function inspectPrebuild(file, platform, arch) {
  const bytes = await readFile(file)
  let machine
  if (platform === 'darwin' && bytes.readUInt32LE(0) === 0xfeedfacf)
    machine =
      bytes.readUInt32LE(4) === 0x0100000c
        ? 'arm64'
        : bytes.readUInt32LE(4) === 0x01000007
          ? 'x64'
          : undefined
  else if (
    platform === 'linux' &&
    bytes.subarray(0, 4).toString('hex') === '7f454c46' &&
    bytes[4] === 2 &&
    bytes[5] === 1
  )
    machine =
      bytes.readUInt16LE(18) === 183 ? 'arm64' : bytes.readUInt16LE(18) === 62 ? 'x64' : undefined
  else if (platform === 'win32' && bytes.subarray(0, 2).toString() === 'MZ') {
    const header = bytes.readUInt32LE(0x3c)
    if (bytes.subarray(header, header + 4).toString('hex') === '50450000')
      machine =
        bytes.readUInt16LE(header + 4) === 0xaa64
          ? 'arm64'
          : bytes.readUInt16LE(header + 4) === 0x8664
            ? 'x64'
            : undefined
  }
  if (
    machine !== arch ||
    !bytes.includes(Buffer.from('napi_register_module_v1')) ||
    !bytes.includes(Buffer.from('node_api_module_get_api_version_v1'))
  )
    throw Error(`Missing matching Node-API prebuild: ${platform}/${arch}`)
}
export async function checkNativePrebuild(context) {
  const version = JSON.parse(
    await readFile(new URL('../node_modules/better-sqlite3/package.json', import.meta.url), 'utf8'),
  ).version
  const pin = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    .dependencies['better-sqlite3']
  if (version !== pin)
    throw Error('Installed SQLite differs from the fixed package version; run npm ci')
  const platform = context.electronPlatformName,
    arch = Arch[context.arch]
  await inspectPrebuild(
    fileURLToPath(
      new URL(`../node_modules/better-sqlite3/prebuilds/${platform}-${arch}.node`, import.meta.url),
    ),
    platform,
    arch,
  )
}
