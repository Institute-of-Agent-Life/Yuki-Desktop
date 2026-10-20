import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const run = promisify(execFile)
/** Explicit operator command: submits signed DMGs to Apple, then staples before checksums. */
export async function finalizeMac(directory, profile) {
  if (process.platform !== 'darwin' || !profile)
    throw Error('Requires macOS and the approved notarytool keychain profile')
  const files = (await readdir(directory)).filter((name) =>
    /^Yuki-.+-mac-(arm64|x64)\.dmg$/.test(name),
  )
  if (!files.length) throw Error('No desktop DMGs')
  for (const name of files) {
    const file = join(directory, name)
    await run('codesign', ['--verify', '--strict', file])
    const { stdout } = await run('xcrun', [
      'notarytool',
      'submit',
      file,
      '--keychain-profile',
      profile,
      '--wait',
      '--output-format',
      'json',
    ])
    if (JSON.parse(stdout).status !== 'Accepted')
      throw Error(`Notarization was not accepted: ${name}`)
    await run('xcrun', ['stapler', 'staple', file])
    await run('xcrun', ['stapler', 'validate', file])
    await run('spctl', [
      '--assess',
      '--type',
      'open',
      '--context',
      'context:primary-signature',
      file,
    ])
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, profile] = process.argv.slice(2)
  if (!directory || !profile)
    throw Error('Usage: finalize-mac.mjs SIGNED_BUILD_DIRECTORY APPROVED_NOTARY_PROFILE')
  await finalizeMac(resolve(directory), profile)
  console.log('Signed DMGs notarized, stapled and assessed; now prepare upload checksums.')
}
