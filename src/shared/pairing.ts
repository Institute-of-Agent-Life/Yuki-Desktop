export function parsePairing(input: string): { code: string; server?: string } | null {
  const match = input.match(/yuki:\/\/pair\?[^\s<>"'`\u3000-\uFFFF]+/i)
  if (match) {
    try {
      const link = new URL(match[0]),
        code = link.searchParams.get('code') ?? ''
      return /^[A-Za-z0-9_-]{32}$/.test(code)
        ? { code, server: link.searchParams.get('server') ?? undefined }
        : null
    } catch {
      return null
    }
  }
  const code = input.split(/[^A-Za-z0-9_-]+/).find((token) => token.length === 32)
  return code ? { code } : null
}
