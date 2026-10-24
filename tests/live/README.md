# Live Codex UI acceptance

This directory is outside ordinary Playwright discovery. It runs a real paid Codex
turn only after an explicit invocation with `YUKI_REAL_CODEX_UI=1` and an actual
`YUKI_CODEX_BINARY`. The backend must be an explicitly selected isolated checkout;
it scripts Main's tool selection and uses real App, Work, external-agent service,
OS user service and the already logged-in native Codex owner.

```powershell
$env:YUKI_REAL_CODEX_UI = '1'
$env:YUKI_CODEX_BINARY = 'C:\actual\Codex\resources\codex.exe'
$env:YUKI_BACKEND_TEST_ROOT = 'D:\actual\isolated-backend-checkout'
$env:YUKI_BACKEND_TEST_PYTHON = 'D:\actual\test-venv\Scripts\python.exe'
$env:YUKI_E2E_OUTPUT = '.cache/codex-live-ui'
npm exec playwright test -- --config tests/live/playwright.config.ts
```

Build the reviewed source before running. The UI prepares its bundled runtime;
the user installs no Python or wheel and edits no PATH. Native authentication
files stay with Codex. The test does not modify global Codex
configuration or resume an existing user thread. It creates one new thread in a
temporary project and limits any naturally requested approval to its exact probe
command and directory.

Only the Electron directory chooser boundary returns the actual temporary folder
through an explicit adapter. The UI button, IPC, runtime installation, current
Person authorization, connector pairing, configuration, OS service, native RPC,
task result, filesystem and receipts remain real. This is not a manual native
file-dialog or normal installer acceptance claim.

During the one running probe it exits Desktop normally, disconnects only this
isolated backend's connector WebSocket, then reopens the original profile. It
reads the same operation and releases the probe's bounded file-notification gate;
it never submits the task again. Cleanup derives the exact service namespace from
its temporary data directory, removes only that service and archives only the
newly created native thread. Full traces are disabled to avoid exporting unrelated
native session titles. Evidence contains only this test's original IDs and bytes.

OS reboot, other OS services, public HTTPS/WSS ingress, installer/signing and
Release remain separate acceptance items.
