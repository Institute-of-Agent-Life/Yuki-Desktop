import type { English } from '../types'

export default {
  docker_unavailable:
    "Docker wasn't found, or its engine isn't running. Install or start Docker, then check again.",
  docker_linux_required: 'Switch Docker to Linux containers, then continue the deployment.',
  local_port_in_use:
    'This local port is already in use. Choose another port; nothing else needs to be stopped.',
  local_image_unavailable:
    "The Yuki image hasn't finished downloading. Check the network and Docker's image source, then try again.",
  local_deployment_failed:
    "Setting up or starting the local deployment didn't finish. The directory is kept; check Docker and the model settings, then continue.",
  local_existing_deployment:
    'This directory already holds a deployment or data. Connect to that service, or choose another directory for a new deployment; the existing data is untouched.',
  local_installation_exists:
    'Another local deployment is being managed. Go back to it first; to reach another service, use “Connect to an Existing Yuki”.',
  local_bot_not_bundled:
    "This build doesn't include the deployment resources. Use the full desktop test package.",
  local_bot_not_configured: 'No local deployment is chosen yet. Finish setting it up first.',
  local_pairing_code_unavailable:
    "The original pairing code was issued and can't be read back. Request a new pairing explicitly, then continue.",
  connector_authorization_unconfirmed:
    "The computer authorization code's result isn't confirmed yet. Check the original authorization first; authorize again if you need a new code.",
  feature_unavailable: "The connected server doesn't offer this feature yet.",
  logout_pending:
    "Finish logging out of this Yuki and choosing what to do with this computer's data first.",
  unsupported_image: "This image can't be read. Choose a PNG, JPEG or WebP image.",
  image_dimensions: "The image size doesn't fit. Crop it again to 1024 × 1024 pixels.",
  invalid_server: 'Enter a complete http or https server address.',
  invalid_response: 'The server’s response is incomplete. Make sure this is a Yuki server.',
  client_api_unavailable:
    "This address doesn't offer the desktop connection API. Check the address or update Yuki.",
  transport_unknown:
    "Couldn't get a response from the server. Check the address and network; with a VPN or Tailscale, restore that network first. Connections over SSH recover by themselves. Content on this computer is kept.",
  unauthenticated: 'This device’s credential is no longer valid. Pair again.',
  credentials_unavailable: "The system keychain can't be read right now. Unlock it and try again.",
  invalid_code: 'The link code is invalid, used or expired. Get a new one.',
  link_code_invalid: 'The link code is invalid, used or expired. Get a new one.',
  not_found: "The original item can't be read or verified; its original text is kept.",
  request_conflict:
    "This request's original receipt differs from what's on this computer, so it won't be sent again.",
  version_conflict: 'The data was updated on another device. Reload it.',
  precondition_failed: 'The state has changed. Reload it.',
  unavailable: "The server can't accept this right now; nothing was written.",
  unknown: "The result isn't confirmed yet. Check the original receipt.",
  internal_failure:
    'Something went wrong while processing; the original message and receipt are kept.',
  owner_required: "You don't have permission for this right now.",
  forbidden: "You don't have permission for this right now.",
  outbox_owner_mismatch: 'The original entry no longer belongs to you, so sending was stopped.',
  different_person:
    "This Yuki's original connection belongs to someone else. Handle that connection's data on this computer first.",
  server_upgrade_required: 'The server needs an upgrade (api_revision ≥ {{revision}}).',
  different_character: 'This address is a different Yuki. Check the original Yuki’s new address.',
  client_upgrade_required: 'This server needs a newer desktop app. Update first.',
  validation_error: 'Check what you entered.',
  control_held: 'Another device has taken over the computer.',
  media_unavailable: "The attachment's content isn't available right now.",
  upload_pending:
    "The attachment hasn't finished uploading; its content is still on this computer.",
  content_hash_mismatch: "The attachment's content failed verification; it wasn't shown or saved.",
  local_file_missing: "It hasn't been saved to this computer, or the saved file was moved.",
  open_failed:
    "The system can't open this file. Save it to this computer first and choose an app to open it.",
  microphone_denied:
    "Microphone access is off. Allow Yuki to use the microphone in the system's settings.",
  operation_unavailable:
    "The server can't save settings right now. Make sure its deployment directory is writable, then save again.",
  unknownCode: "The operation didn't complete ({{code}}).",
  notCompleted: "The operation didn't complete.",
  mediaReason: {
    expired: 'Expired',
    cleaned: 'Cleaned up',
    source_unavailable: "Can't be fetched from the original platform",
    source_changed: 'The original attachment changed. Reload the message.',
  },
} satisfies English<'errors'>
