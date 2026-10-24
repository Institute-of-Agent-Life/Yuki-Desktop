import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
const { values } = parseArgs({
  options: {
    backend: { type: 'string' },
    output: { type: 'string', default: '.cache/connector-runtime' },
  },
})
if (!values.backend) throw new Error('Pass --backend with the explicit backend checkout path')
const source = resolve(values.backend, 'packages/yuki-agent-connector')
const result = spawnSync(
  'uv',
  [
    'run',
    '--frozen',
    '--project',
    source,
    'python',
    join(source, 'scripts/build_runtime.py'),
    '--output',
    resolve(values.output),
    '--cache',
    resolve('.cache/connector-downloads'),
  ],
  { stdio: 'inherit', shell: false, windowsHide: true },
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
