import { rename, copyFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

export async function installLinuxLauncher(context) {
  if (context.electronPlatformName !== 'linux') return
  const executable = join(context.appOutDir, 'yuki')
  await rename(executable, join(context.appOutDir, 'yuki-bin'))
  await copyFile(
    fileURLToPath(new URL('../resources/linux/yuki-launcher.sh', import.meta.url)),
    executable,
  )
  await chmod(executable, 0o755)
}
