const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

/**
 * POSIX sh run in a server's Yuki deployment directory: the same .env edit the local deployment
 * makes (`snowLumaEnvironment`), then Compose recreates the Bot and starts SnowLuma. Shown to the
 * operator for a server reached only by URL; an SSH-managed server runs it as is.
 */
export function snowLumaServerScript(image: string) {
  return [
    'set -eu',
    `image=${quote(image.trim())}`,
    `get() { sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '"'; }`,
    `put() { if grep -q "^$1=" .env; then sed "s|^$1=.*|$1=$2|" .env > .env.next && cat .env.next > .env && rm .env.next; else printf '%s=%s\\n' "$1" "$2" >> .env; fi; }`,
    'profiles=$(get COMPOSE_PROFILES)',
    'case ",$profiles," in *,snowluma,*) ;; *) put COMPOSE_PROFILES "${profiles:+$profiles,}snowluma" ;; esac',
    'put SNOWLUMA_IMAGE "$image"',
    'put SNOWLUMA_VNC_HOST snowluma',
    'for key in ONEBOT_ACCESS_TOKEN SNOWLUMA_VNC_PASSWORD; do',
    `  case "$(get $key)" in ''|replace-with-*) put "$key" "$(od -An -N24 -tx1 /dev/urandom | tr -d ' \\n')" ;; esac`,
    'done',
    'docker compose up -d bot snowluma',
  ].join('\n')
}
