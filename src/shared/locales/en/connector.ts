import type { English } from '../types'

export default {
  problem: {
    native_daemon_start_failed:
      'The native service didn’t start. Check the chosen program and its own settings.',
    native_protocol_unsupported: 'The chosen program reports an incompatible protocol version.',
    native_session_error:
      'The native program refused to create or load the session. Check the program’s own settings.',
    connector_reload_required:
      'The existing Connector can’t apply changes live. Reload its settings in that service, then check again.',
    connector_catalog_unconfirmed:
      'Not yet confirmed that the running Connector applied the settings',
    invalid_server: 'Use https:// for a remote address; http:// is allowed only for this computer.',
    unknown: 'The local Connector operation isn’t confirmed. Reopen Settings to check.',
    connector_runtime_invalid:
      'The bundled Connector’s files are incomplete. Reinstall the full Yuki Desktop release.',
    connector_owner_mismatch:
      'This Connector belongs to another server or person. Its authorization won’t be overwritten; you can create a separate installation.',
    native_login_required: 'Sign in to the native Agent first, then check again.',
    native_not_installed:
      'The program is no longer where it was installed. Choose the native program again.',
    FileNotFoundError:
      'The native program or the session’s working location no longer exists. Check the installation or session.',
    native_owner_unavailable: 'Can’t reach the native Agent. Open it and try again.',
    native_diagnostic_failed:
      'The native diagnostic didn’t finish or isn’t supported by this version, so sign-in isn’t confirmed. See the program’s own diagnostics.',
    connector_server_unreachable:
      'Can’t reach the Yuki server. Check the connection and try again.',
    connector_runtime_unavailable:
      'This build has no bundled runtime. Install the full Yuki Desktop release.',
    connector_configuration_failed:
      'Settings weren’t saved. Choose the actual native program again.',
    connector_authorization_failed:
      'Computer authorization didn’t finish. Check the current Yuki connection and authorize again.',
    connector_server_error:
      'The server didn’t accept the Connector. Make sure the same Yuki address serves the /agents/v1/ HTTPS and WebSocket entries.',
    connector_other_person:
      'The server no longer offers this connection. Its identity and receipts are kept; you can create a new connection.',
    connector_runtime_platform:
      'This Connector doesn’t fit this system. Install the Desktop release for your platform.',
    connector_not_installed:
      'The Connector is no longer where it was. Prepare the bundled Connector again or choose an existing installation.',
    connector_existing_runtime_unavailable:
      'Found existing Connector data, but not the runtime it uses. Point to the installation in Advanced; its data and service are kept.',
    connector_failed:
      'The Connector operation didn’t finish. Check the connection, then continue with the steps shown.',
    connector_instance_missing:
      'These native settings no longer exist. Close the editor, then choose “Add Agent” to create new ones.',
    connector_update_required:
      'The Connector doesn’t support this yet. Update it first; its identity and history are kept.',
    connector_invalid_response:
      'Couldn’t read the Connector’s reply. Reopen Settings or update the Connector; settings are kept.',
  },
  stage: {
    server: 'Saving Connector address',
    prepare: 'Preparing runtime',
    authorize: 'Authorizing you',
    pair: 'Pairing computer',
    configure: 'Saving native settings',
    read: 'Reading Connector state',
    discover: 'Finding native programs',
    diagnose: 'Checking native status',
    'service-stop': 'Stopping local connection',
    'service-uninstall': 'Removing old startup service',
    'service-start': 'Starting local connection',
    'full-access': 'Full local access',
  },
  stageFailure: '{{stage}}: {{problem}}',
  unconfirmed: 'The operation isn’t confirmed. Reopen Settings to check.',
  state: {
    reading: 'Reading',
    notConnected: 'Not connected',
    otherYuki: 'Connected to another Yuki',
    updateRequired: 'Update required',
    existingFound: 'Existing connection found',
    authorizationLost: 'Authorization revoked',
    connectorProtocolUnsupported: 'Incompatible Connector protocol',
    protocolUnsupported: 'Incompatible protocol',
    restarting: 'Connector restarting',
    stopped: 'Local connection stopped',
    reconnecting: 'Disconnected, reconnecting',
    connected: 'Connected',
    unconfirmed: 'Connection not confirmed',
    restartPending: 'Waiting to restart',
    notRunning: 'Not running',
    runningUnreported: 'Running; connection not reported yet',
    running: 'Running',
    halted: 'Stopped',
    unknown: 'Unknown',
  },
  defaultAgent: {
    acp: 'My Agent',
    native: 'Local {{driver}}',
  },
  intro:
    'Let {{name}} use this computer’s commands, files and installed programs. Native Agents are optional.',
  protocolBehind:
    'This computer’s Connector uses protocol {{local}}; the server uses {{server}}. Update Yuki Desktop and its bundled Connector; identity and receipts are kept.',
  protocolAhead:
    'This computer’s Connector uses protocol {{local}}; the server uses {{server}}. Update the Yuki server to support protocol {{local}}; no re-pairing needed.',
  goUpdate: 'Go to Updates',
  section: {
    status: 'Status',
    permission: 'Permissions',
    agents: 'Local Agents (Optional)',
    technical: 'Technical Details',
  },
  readFailed: 'Can’t read the existing Connector. Check that its runtime is still in place.',
  admissionUnconfirmed:
    'Server acceptance isn’t confirmed: {{problem}} Check the server connection; the local connection can still be managed.',
  thisComputer: 'This Computer · {{label}}',
  otherYukiDescription:
    'This computer is connected to another Yuki; a computer connects to one Yuki at a time.',
  connectedTo: 'Connected to {{name}}',
  newConnection: 'New Connection',
  updateKeepData: 'Update, Keep Data',
  adoptKeepData: 'Use Bundled, Keep Data',
  useExisting: 'Use Existing',
  updated:
    'Connector updated with its identity, settings and history kept. It starts and quits with Desktop.',
  serverAddress: 'Connector Server Address',
  serverAddressDescription:
    'The address this computer connection uses, saved separately from desktop chat’s server address.',
  changeServer: 'Change Address',
  reuseExisting: 'Keep Existing Connection',
  reuseExistingDescription:
    'Keeps its installation, authorization and history; doesn’t re-pair or start/stop its service.',
  updateConnector: 'Update Connector',
  updateDescription:
    'This Connector is {{current}}; Desktop bundles {{bundled}}. Identity, settings and history are kept, no re-pairing needed.',
  currentVersionMissing: 'an unknown version',
  bundledVersionMissing: 'a newer version',
  paired:
    'Computer paired. Full access is off by default and can be turned on below; set up native Agents later.',
  computerName: 'Computer Name',
  computerNameLabel: 'Computer name',
  consent: 'Authorization',
  consentDescription:
    'Allow {{name}} ({{url}}) to connect to this computer as you. General operations are governed by full access; native Agents keep their own authorization.',
  consentLabel: 'I allow this Yuki to connect to this computer',
  connect: 'Connect This Computer',
  noYuki: 'No Yuki Connected',
  noYukiDescription: 'Connect a Yuki first, then authorize this computer. You can leave this page.',
  independentConnection: 'Independent Connection',
  independentDescription:
    'Managed by its own installation; doesn’t start or stop with Desktop. Switch to the bundled version to let Desktop manage it.',
  localConnection: 'Local Connection',
  localDescription:
    'Starts and quits with Desktop and stays connected while it’s in the tray. Started tasks follow their receipts.',
  authorizationLostBanner:
    'Authorization revoked: the server rejected this computer’s Connector credentials (for example, it was removed in Devices). The Connector stopped reconnecting; history is kept.',
  protocolUnsupportedBanner:
    'The Connector and server protocols are incompatible, so it stopped reconnecting. Update the older side; identity and receipts are kept.',
  linkStatus: 'Connection Status',
  lastReason: 'Last reason: {{reason}}',
  lastExit: 'Last Unexpected Exit',
  exitCode: 'Exit code {{code}}',
  exitSignal: 'Signal {{signal}}',
  autoRestart: 'Automatic Restart',
  autoRestartDescription:
    'If the Connector exits unexpectedly, Desktop restarts it after 1, 2, 4… seconds (up to 1 minute); the delay resets once it reaches the server. It doesn’t restart after you stop the connection or quit the app.',
  restarts_one: '{{count}} time',
  restarts_other: '{{count}} times',
  exportDiagnostics: 'Export Diagnostics',
  exportDiagnosticsDescription:
    'Includes connection state and the end of connector.log and connector-stderr.log, which may contain local paths. Review before sharing.',
  diagnosticsExported: 'Connector diagnostics exported.',
  serverSaved: 'Address saved. It’s used the next time the connection starts.',
  serverSheetBody:
    'Saves only this Connector’s address. Desktop chat’s connection is unchanged and the Connector isn’t started or stopped. The new address is used on next start.',
  fullAccess: 'Allow Full Local Access',
  fullAccessUnsupported:
    'The chosen Connector doesn’t offer full access yet. Update to the bundled Connector; the existing authorization is unchanged.',
  fullAccessDescription:
    'Allows Shell, file and local program operations. When off, no new general operations are accepted; receipts and stopping still work.',
  fullAccessOn:
    'Full access is on. It uses this OS account’s permissions without asking per command or folder.',
  fullAccessOff:
    'Full access is off. Started tasks must be stopped individually; native Agents keep their own authorization.',
  fullAccessOnCatalog:
    'Full access is on. It uses this OS account’s permissions without asking per command or folder. Cloud catalog sync isn’t confirmed: {{problem}}',
  fullAccessOffCatalog:
    'Full access is off. Started tasks must be stopped individually; native Agents keep their own authorization. Cloud catalog sync isn’t confirmed: {{problem}}',
  macPermission: {
    screen: {
      title: 'Screen Recording',
      description: 'Lets Yuki see this computer’s screen.',
      denied:
        'Lets Yuki see this computer’s screen. After allowing Yuki in System Settings, turn Local Connection off and on to check again.',
    },
    input: {
      title: 'Accessibility',
      description: 'Lets Yuki use the mouse and keyboard.',
      denied:
        'Lets Yuki use the mouse and keyboard. After allowing Yuki in System Settings, turn Local Connection off and on to check again.',
    },
  },
  allowed: 'Allowed',
  notAllowed: 'Not allowed',
  openSystemSettings: 'Open System Settings',
  agentNotAdmitted: 'Not yet accepted by the server',
  agentNotReady: '{{driver}} not ready: {{reason}}',
  noReason: 'no reason given',
  claudeFound: 'Claude Code found; sign-in and tasks are confirmed by its own results',
  nativeConnected: '{{driver}} connected',
  claudeOffline: 'Claude Code offline; found last time',
  nativeOffline: '{{driver}} offline; ready last time',
  agentDescription: '{{driver}} · {{status}}',
  edit: 'Edit',
  editName: 'Edit {{name}}',
  deleteName: 'Delete {{name}}',
  deleteEllipsis: 'Delete…',
  addAgentTitle: 'Add Local Agent',
  addAgentDescription: 'Choose an installed Codex, Claude Code or ACP-compatible program.',
  addAgent: 'Add Agent',
  claudeDiagnosed: 'Claude Code sign-in check passed; no model task has run yet.',
  nativeDiagnosed: 'Native handshake and account check passed; no model task has run yet.',
  notReady: 'Not ready ({{problem}}).',
  program: 'Program',
  checkReady: 'Check',
  revealProgram: 'Show Program',
  agentType: 'Agent Type',
  acpAgent: 'ACP-Compatible Agent',
  originalDriver: '{{driver}} (Original)',
  findInstalled: 'Find Installed {{name}}',
  programSource: 'Program Source',
  chooseExecutableOption: 'Choose an executable myself',
  found: 'Found {{name}}',
  displayName: 'Display Name',
  displayNameLabel: 'Agent display name',
  advancedProgram: 'Advanced: Choose the Native Program',
  chooseAcp: 'Choose an ACP-compatible program.',
  argumentsHeading: 'Launch Arguments (Optional)',
  argumentsHint:
    'One per field, as the program’s docs describe. Empty fields are passed too; remove ones you don’t need.',
  argument: 'Argument {{number}}',
  acpArgument: 'ACP argument {{number}}',
  removeAcpArgument: 'Remove ACP argument {{number}}',
  addArgument: 'Add Argument',
  notChosen: 'Not chosen',
  chooseProgram: 'Choose Program',
  notFound:
    'No installed {{driver}} found. Install it and sign in first, or choose the executable under Advanced.',
  savedCatalog: 'Settings saved; not yet confirmed that the connection applied them: {{problem}}.',
  saved: 'Settings saved. Native status is confirmed by the actual connection.',
  removedCatalog: 'Settings deleted; connection sync isn’t confirmed: {{problem}}.',
  removed: 'Agent settings deleted. The native program and its history are kept.',
  removeTitle: 'Delete Agent Settings?',
  removeConfirm: 'Delete',
  removeBody:
    'Deletes the local settings and new-task option for “{{label}}”. The native program, its files and history are kept.',
  troubleshooting: 'Troubleshooting',
  existingVersion: 'Existing Connector Version',
  notProvided: 'Not provided',
  existingIndependent: 'Existing Independent Connection',
  existingServerLink: 'Existing Server Connection',
  connectorVersion: 'Connector Version',
  versionProtocol: '{{version}} · Protocol {{protocol}}',
  existingData: 'Installation Data',
  notPaired: 'Not paired',
  serverProtocol: 'Server Connector Protocol',
  serverProtocolMissing: 'Not provided; update Yuki, then reopen Settings.',
  authorizationSource: 'Authorized By',
  currentOwner: 'You',
  ownerUnconfirmed: 'Not confirmed as you',
  serverAdmission: 'Server Acceptance',
  localRuntime: 'Local Environment',
  noShell: 'No default Shell reported',
  advancedInstallation: 'Advanced: Installation and Existing Connection',
  advancedInstallationDescription:
    'Choose the Python and data folder the existing Connector uses. Keeps its identity, settings and journal; doesn’t copy credentials or replace this installation’s Python.',
  existingPython: 'Existing Python Absolute Path',
  existingDataDirectory: 'Existing Data Folder',
  useExistingInstallation: 'Use Existing Installation',
  readAndUseExisting: 'Read and Use',
  advancedCode: 'Advanced: Manual Connector Code',
  advancedCodeDescription:
    'Accepts only a computer authorization code meant for the Connector; chat pairing codes won’t work. The field is cleared on submit.',
  manualServer: 'Server Address',
  manualServerLabel: 'Manual Connector server',
  computerCode: 'Authorization Code',
  manualCodeLabel: 'Manual Connector code',
  useManualCode: 'Use Connector Code',
  connectWithCode: 'Connect with Code',
  installGuide: 'Installation Guide',
  installGuideFor: '{{driver}} Install Guide',
  refresh: 'Refresh',
  statusLine: 'Status: {{status}}',
  pendingFlag: ' (awaiting later receipts)',
  tasks: {
    unconfirmed: 'The operation isn’t confirmed. Look up the original record again.',
    draft: 'The request is saved only on this computer ({{id}}) and hasn’t been submitted.',
    submitted: 'The request was sent; acceptance is still to be verified ({{id}}).',
    ended: 'The original request ended ({{id}}): {{problem}}',
    accepted:
      'Handed to {{name}} (request {{id}}). See the operation’s receipt for the native result.',
    verify: 'Verify Request',
    activity: 'This computer’s activity',
    native: 'Native Agent Tasks',
    terminals: 'Terminal Runs',
    heading: 'Native Tasks',
    intro:
      'Give a task directly, or pick an existing session to continue. The working location is optional; permissions follow the native settings. Stop Watching keeps the task; Cancel asks the native Agent to abort this run, though background programs it started may keep running. Native receipts are authoritative.',
    noAgents:
      'No native Agent is set up. You can add Codex, Claude or ACP under This Computer in Settings. Shell, file and program operations with full access are unaffected; past receipts remain below.',
    catalogUnknown:
      'The Agent list can’t be confirmed right now. Settings and the chosen session are kept; past receipts can still be viewed.',
    admittedAgents: 'Accepted Agents',
    agent: 'Task Agent',
    chooseAgent: 'Choose Agent',
    loadSessions: 'Load Sessions',
    moreSessions: 'More Sessions',
    session: 'Session',
    sessionLabel: 'Native session',
    newSession: 'New session (native defaults)',
    cwdSummary: 'Working Location (Optional)',
    cwdHint:
      'Uses the native default when empty. An existing session keeps its own working location.',
    cwd: 'Working Location',
    cwdPlaceholder: 'Optional',
    chooseFolder: 'Choose Folder',
    request: 'Request for Yuki',
    requestLabel: 'Native task request',
    run: 'Hand to Yuki',
    watch: 'Watch Session',
    operationsUnavailable: 'The operation list can’t be read right now.',
    operationDescription: 'Work {{work}} · {{status}}',
    viewReceipt: 'View Receipt',
    moreOperations: 'More Operations',
    operation: 'Operation {{id}}',
    queue: 'Queue in Session',
    steer: 'Steer Task',
    detach: 'Stop Watching',
    cancel: 'Request Cancel',
    refreshReceipt: 'Refresh Receipt',
    readingReceipt: 'Reading receipt…',
    receiptUnavailable: 'The receipt hasn’t finished loading. Refresh to try again.',
    resultUnconfirmed: ' (result not confirmed)',
    sessionOf: 'Session {{id}}',
    executionOf: 'Run {{id}}',
    unknownId: 'unknown',
    structuredReceipt: 'Structured Receipt',
    followUp: 'Request for This Task',
    moreProgress: 'Load More Progress',
  },
  terminals: {
    cancelUnconfirmed: 'The cancel receipt isn’t confirmed.',
    heading: 'Terminal Tasks on This Computer',
    intro:
      'See the runs Yuki started on this computer, their output and completion receipts. You can still read and stop them after full access is off.',
    directoryUnavailable: 'The terminal list can’t be read right now.',
    viewReceipt: 'View Receipt',
    more: 'More Terminal Tasks',
    run: 'Terminal Run {{id}}',
    moreOutput: 'Load More Output',
    resendStop: 'Resend Stop Request',
    stop: 'Stop Run',
    verifyStop: 'Verify Stop Request',
    refreshReceipt: 'Refresh Receipt',
    readingReceipt: 'Reading terminal receipt…',
    receiptUnavailable: 'The terminal receipt can’t be read right now.',
    unconfirmedFlag: ' (not confirmed)',
    exitCode: 'exit code {{code}}',
    outputUnavailable: 'The run’s state is kept, but its local output can’t be read right now.',
    cwd: 'Working location: {{cwd}}',
    outputLost:
      'Some output is beyond what this computer keeps; the run’s state and completion receipt are kept.',
    stopUnconfirmed:
      'Stop request {{id}}: result not confirmed; verify the original request. Whether the process ended follows the run’s own state.',
    stopPending:
      'Stop request {{id}}: accepted, awaiting its stop receipt. Whether the process ended follows the run’s own state.',
    stopReceipt:
      'Stop request {{id}}: receipt {{status}}. Whether the process ended follows the run’s own state.',
    stopReceiptRead:
      'Stop request {{id}}: receipt read. Whether the process ended follows the run’s own state.',
  },
  native: {
    question: 'Question from the native Agent',
    permission: 'Permission request from the native Agent',
    cwd: 'Working folder: {{cwd}}',
    additional: 'Extra permissions this command asks for',
    turnOnly: 'Only for this turn; it expires when the turn ends.',
    allowTurn: 'Allow This Turn',
    deny: 'Deny',
    choose: 'Choose',
    submitAnswers: 'Submit Answers',
    noOptions: 'This native request offers no replies. Handle it in the native program.',
    globPattern: 'Matching pattern: {{pattern}}',
    scope: {
      root: 'All folders',
      minimal: 'Native minimal folders',
      project_roots: 'Project root folders',
      tmpdir: 'System temporary folder',
    },
    access: {
      read: 'Read: {{path}}',
      write: 'Write: {{path}}',
      deny: 'Deny: {{path}}',
    },
    globDepth: 'Pattern scan depth: {{depth}}',
    networkAllowed: 'Network: allowed',
    networkUnchanged: 'Network: no new access',
  },
  local: {
    title: 'This Computer',
    unknownState: 'Can’t confirm this computer’s connection',
    notConnected: 'This computer isn’t connected to {{name}}',
    goSettings: 'Go to Settings',
    emptyDescription:
      'Once connected, {{name}} can run commands on this computer and use Codex, Claude Code or ACP-compatible Agents.',
    notAdmitted:
      'This computer’s connection isn’t accepted yet; your saved records can still be viewed.',
    authorizationLost:
      'Authorization revoked: the server rejected this computer’s Connector credentials. Your saved records can still be viewed.',
    restarting_one:
      'The local Connector exited unexpectedly and is restarting (restarted {{count}} time).',
    restarting_other:
      'The local Connector exited unexpectedly and is restarting (restarted {{count}} times).',
    viewDiagnostics: 'View Diagnostics',
    ownerStopped:
      'Stopped with “Stop”. Yuki won’t use the mouse, keyboard or browser. Ask Yuki to continue in chat, or press “Continue”.',
    browser: 'Yuki is using the browser.',
    background:
      'Yuki is working in a window in the background without touching your mouse or front window; it pauses while you use the same app.',
    computer: 'Yuki is using the computer; it pauses while you do and resumes when you stop.',
    stop: 'Stop',
  },
} satisfies English<'connector'>
