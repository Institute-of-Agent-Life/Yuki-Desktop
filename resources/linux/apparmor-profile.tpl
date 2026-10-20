abi <abi/4.0>,
include <tunables/global>

# The launcher delegates to this Electron executable. Keep user namespaces scoped to it.
profile "${executable}" "/opt/${sanitizedProductName}/${executable}-bin" flags=(unconfined) {
  userns,
  include if exists <local/${executable}>
}
