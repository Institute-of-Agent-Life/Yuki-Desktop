import { useQuery } from '@tanstack/react-query'
import type { ApiReply, Me } from '../../shared/api'
import { REQUIRED_API_REVISION } from '../../shared/api'
import errors from '../../shared/locales/zh-Hant/errors'
import sshSource from '../../shared/locales/zh-Hant/ssh'
import { t } from '../i18n'

export class ClientProblem extends Error {
  constructor(
    readonly code: string,
    readonly reason?: string,
    readonly details?: Extract<ApiReply<never>, { ok: false }>['details'],
  ) {
    super(reason && code === 'media_unavailable' ? mediaProblem(reason) : problemText(code))
  }
}
export function unwrap<T>(result: ApiReply<T>): T {
  if (!result.ok) throw new ClientProblem(result.code, result.reason, result.details)
  return result.value
}
export function useMe(id: string) {
  return useQuery({
    queryKey: [id, 'me'],
    queryFn: () => window.yuki.client.read<Me>(id, { kind: 'me' }).then(unwrap),
  })
}
function mediaProblem(reason: string) {
  return Object.hasOwn(errors.mediaReason, reason)
    ? t(`errors:mediaReason.${reason as keyof typeof errors.mediaReason}`)
    : t('errors:media_unavailable')
}
export function hidesPrivateData(error: unknown) {
  return (
    error instanceof ClientProblem &&
    ['unauthenticated', 'not_found', 'outbox_owner_mismatch', 'different_character'].includes(
      error.code,
    )
  )
}
// Error codes are snake_case keys of `errors`; its camelCase keys are its own words.
type Code = Exclude<keyof typeof errors, 'unknownCode' | 'notCompleted' | 'mediaReason'>
const known = (code: string): code is Code => /^[a-z_]+$/.test(code) && Object.hasOwn(errors, code)
const isSshProblem = (code: string): code is keyof typeof sshSource.problem =>
  Object.hasOwn(sshSource.problem, code)
export function problemText(code: string): string {
  if (code === 'server_upgrade_required')
    return t('errors:server_upgrade_required', { revision: REQUIRED_API_REVISION })
  if (known(code)) return t(`errors:${code}`)
  if (isSshProblem(code)) return t(`ssh:problem.${code}`)
  return t('errors:unknownCode', { code })
}
