import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { Arch, getArtifactArchName } from 'builder-util'

export function artifactName(version, os, arch, ext) {
  return `Yuki-${version}-${os}-${getArtifactArchName(Arch[arch], ext)}.${ext}`
}
export async function hashFile(file, algorithm, encoding = 'hex') {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest(encoding)
}
