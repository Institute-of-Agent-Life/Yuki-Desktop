const previewTypes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  heic: 'image/heic',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  pdf: 'application/pdf',
  py: 'text/plain',
  js: 'text/javascript',
  ts: 'text/plain',
  yaml: 'text/plain',
  yml: 'text/plain',
  log: 'text/plain',
}
export const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`
export function previewMime(filename: string, declared?: string | null) {
  return (
    declared ??
    previewTypes[filename.split('.').at(-1)?.toLowerCase() ?? ''] ??
    'application/octet-stream'
  )
}
