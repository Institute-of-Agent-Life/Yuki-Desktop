import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
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
if (result.status !== 0) process.exit(result.status ?? 1)
// Which backend built this runtime: packaging checks it against contracts/source.json.
const output = resolve(values.output)
writeFileSync(
  output + '.source.json',
  JSON.stringify({
    commit: execFileSync('git', ['-C', resolve(values.backend), 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    version: JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8')).version,
  }) + '\n',
)
