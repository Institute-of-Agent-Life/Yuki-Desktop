import { randomBytes } from 'node:crypto'
import { snowLumaServerScript } from '../shared/snowluma'

/**
 * The deployment `.env` with SnowLuma enabled: its Compose profile, the operator's own image and
 * the bundled display host; a missing or placeholder OneBot token and VNC password are generated,
 * real ones stay. `snowLumaServerScript` makes the same edit on a server.
 */
export function snowLumaEnvironment(env: string, image: string) {
  let text = env
  const get = (key: string) =>
    [...text.matchAll(new RegExp(`^${key}=(.*)$`, 'gm'))].at(-1)?.[1]!.replaceAll('"', '') ?? ''
  const put = (key: string, value: string) => {
    const line = new RegExp(`^${key}=.*$`, 'gm')
    text = line.test(text)
      ? text.replace(line, `${key}=${value}`)
      : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${key}=${value}\n`
  }
  const profiles = get('COMPOSE_PROFILES')
  if (!`,${profiles},`.includes(',snowluma,'))
    put('COMPOSE_PROFILES', profiles ? `${profiles},snowluma` : 'snowluma')
  put('SNOWLUMA_IMAGE', image.trim())
  put('SNOWLUMA_VNC_HOST', 'snowluma')
  for (const key of ['ONEBOT_ACCESS_TOKEN', 'SNOWLUMA_VNC_PASSWORD']) {
    const value = get(key)
    if (!value || value.startsWith('replace-with-')) put(key, randomBytes(24).toString('hex'))
  }
  return text
}

/**
 * Enables SnowLuma on an SSH-managed server. `run` executes a POSIX sh script on that server and
 * resolves with its output (rejecting on a non-zero exit); `directory` is the deployment directory
 * holding `.env` and `docker-compose.yml`.
 */
export function enableSnowLumaOnServer(
  run: (script: string) => Promise<string>,
  directory: string,
  image: string,
) {
  return run(`cd '${directory.replaceAll("'", `'\\''`)}'\n${snowLumaServerScript(image)}`)
}
