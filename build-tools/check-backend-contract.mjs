import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

const backend = process.env.YUKI_BACKEND_TEST_ROOT
const python = process.env.YUKI_BACKEND_TEST_PYTHON
if (!backend || !python) throw Error('Select the checked-out backend and its Python explicitly')
const temporary = await mkdtemp(join(tmpdir(), 'yuki-backend-contract-'))
try {
  for (const api of ['client', 'admin']) {
    const output = join(temporary, `${api}-openapi.json`)
    const exported = spawnSync(
      python,
      [
        '-c',
        `import sys; from pathlib import Path; from yuki.${api}_api.openapi import export_openapi; export_openapi(Path(sys.argv[1]))`,
        output,
      ],
      {
        cwd: resolve(backend),
        env: { ...process.env, PYTHONPATH: [join(backend, 'src'), backend].join(delimiter) },
        stdio: 'inherit',
        shell: false,
        windowsHide: true,
      },
    )
    if (exported.error) throw exported.error
    if (exported.status !== 0)
      throw Error(`The selected backend could not export its ${api} contract`)
    const [actual, expected] = await Promise.all([
      readFile(output),
      readFile(`contracts/${api}-api.openapi.json`),
    ])
    if (!actual.equals(expected))
      throw Error(`The pinned backend and Desktop ${api} contract differ`)
    console.log(`The pinned backend reproduces the Desktop ${api} contract`)
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}
