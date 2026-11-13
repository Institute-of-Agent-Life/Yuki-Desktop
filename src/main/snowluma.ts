import { quote, snowLumaCommand } from '../shared/snowluma'

/**
 * Enables SnowLuma on an SSH-managed server. `run` executes a POSIX sh script on that server and
 * resolves with its output (rejecting on a non-zero exit); `directory` is the deployment directory
 * holding `.env`, `docker-compose.yml` and `deploy/snowluma.sh`.
 */
export function enableSnowLumaOnServer(
  run: (script: string) => Promise<string>,
  directory: string,
  image: string,
) {
  return run(`cd ${quote(directory)}\n${snowLumaCommand(image)}`)
}
