// Reaching a Yuki over SSH: the shared form, the transport setting and its problems.
import type { English } from '../types'

export default {
  connectOverSsh: 'Connect over SSH',
  address: 'SSH address',
  addressHint: 'For example root@203.0.113.10; without a user name, root is used.',
  port: 'SSH port',
  auth: 'Sign in with',
  authPassword: 'Password',
  authKey: 'Key file',
  authAgent: 'ssh-agent',
  password: 'SSH password',
  keyPath: 'Key file',
  chooseKey: 'Choose…',
  passphrase: 'Key passphrase',
  passphraseHint: 'Leave empty if the key has no passphrase.',
  directory: 'Yuki deployment directory',
  directoryHint: 'Where Yuki is installed on the server; ~ is the signed-in account’s home.',
  secretStored: 'The password is kept only in this computer’s system keychain.',
  checkHost: 'Check host',
  fingerprint: 'Host fingerprint',
  fingerprintKnown: 'The same fingerprint this computer remembered before.',
  confirmConnect: 'Confirm fingerprint and connect',
  forgetHost: 'Forget this host’s old fingerprint',
  limitations:
    'Over SSH, this app keeps the tunnel open: while the app is not running, this computer’s Connector is offline too. If Yuki should be able to use this computer at any time, turn on Open at Login, or use a Tailscale or HTTPS address instead. The mobile app cannot connect this way.',
  transport: 'Connection method',
  transportDirect: 'Direct · {{address}}',
  transportSsh: 'Over SSH · {{user}}@{{host}}',
  change: 'Change…',
  changeTransportTitle: 'Change connection method',
  direct: 'Direct',
  overSsh: 'Over SSH',
  server: 'Server address',
  confirmDirect: 'Confirm and connect',
  back: 'Back',
  cancel: 'Cancel',
  connectorNotMoved:
    'The connection method changed, but the Connector address was not updated: {{reason}}',
  manage: 'Server management',
  upgrade: 'Upgrade Yuki on the server',
  upgradeDescription:
    'Uploads the Yuki {{version}} installer and deployment package that come with this app and runs them again in the same directory; settings and data are kept.',
  upgraded: 'Yuki on the server has been upgraded.',
  logs: 'View server logs',
  logsTitle: 'Server logs',
  close: 'Close',
  serverOutput: 'Server output',
  help: 'About connecting over SSH',
  connectOverSshDescription:
    'Uses the server’s SSH login to get the pairing code and open an encrypted tunnel; no public address needed.',
  fingerprintFirst:
    'First connection: compare it with ssh-keygen -lf on the server. If it ever changes, the connection is refused.',
  changeTransportDescription:
    'Still the same Yuki and your own entry; the credential, conversation and Connector address are kept or moved along.',
  manageDescription: 'Upgrade or read logs over the same SSH login.',
  problem: {
    ssh_host_key_changed:
      'This host’s fingerprint differs from the first connection, so the connection was refused. If the server really was reinstalled, forget the old fingerprint under Connection method and confirm again; otherwise someone may be impersonating the server.',
    ssh_host_key_unknown:
      'This host’s fingerprint has not been confirmed. Check the host again under Connection method.',
    ssh_authentication_failed: 'The SSH login was refused. Check the user name, password or key.',
    ssh_unreachable:
      'Cannot reach this host over SSH. Check the address, port and network; it reconnects by itself once they are back.',
    ssh_failed: 'The SSH connection did not complete.',
    ssh_local_port_in_use: 'Another program is using the local port fixed for this connection.',
    remote_sudo_password_required:
      'This account needs a password for sudo, which is not supported. Use root, or allow this account sudo without a password.',
    remote_deployment_not_found:
      'No Yuki deployment (.env) was found in this directory. Check the deployment directory.',
    remote_pairing_failed: 'Pairing on the server did not complete.',
    remote_upload_failed: 'The upload to the server did not complete.',
    remote_install_failed: 'The installer did not complete on the server.',
    remote_image_pull_failed:
      'The server could not pull the Docker image. Configure a Docker registry mirror for the server: add it to registry-mirrors in /etc/docker/daemon.json, then run systemctl restart docker. Retry this step once it is configured.',
    remote_docker_install_failed: 'Installing Docker did not complete.',
    remote_bundle_mismatch:
      'The installer and deployment package in this app do not match; please reinstall the app.',
  },
} satisfies English<'ssh'>
