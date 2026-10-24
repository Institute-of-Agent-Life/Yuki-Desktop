import { spawnSync } from 'node:child_process'

for (const [command, args] of [
  ['ldconfig', ['-p']],
  ['dpkg-query', ['--show', 'libnotify4']],
  [
    'gdbus',
    [
      'call',
      '--session',
      '--dest',
      'org.freedesktop.DBus',
      '--object-path',
      '/org/freedesktop/DBus',
      '--method',
      'org.freedesktop.DBus.NameHasOwner',
      'org.freedesktop.Notifications',
    ],
  ],
  [
    'gdbus',
    [
      'call',
      '--session',
      '--dest',
      'org.freedesktop.DBus',
      '--object-path',
      '/org/freedesktop/DBus',
      '--method',
      'org.freedesktop.DBus.ListActivatableNames',
    ],
  ],
]) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  const stdout = result.stdout ?? ''
  console.log(
    JSON.stringify({
      command: [command, ...args],
      status: result.status,
      stdout:
        command === 'ldconfig'
          ? stdout.split('\n').filter((line) => line.includes('libnotify'))
          : stdout.trim(),
      stderr: result.stderr?.trim(),
      error: result.error?.message,
    }),
  )
}
