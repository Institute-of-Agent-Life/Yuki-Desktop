import type { components } from './admin-contract.gen'
import type { ApiReply } from './api'

export type PlatformsView = components['schemas']['PlatformsView']
export type PlatformView = components['schemas']['PlatformView']
export type PlatformHealth = components['schemas']['PlatformHealthView']
export type PlatformControlResult = components['schemas']['ModelControlResult']
type ApplyBody = components['schemas']['PlatformApplyBody']
export type PlatformKey = ApplyBody['platform']
/** The Client API revision that serves `/admin/v1/platforms`. */
export const PLATFORMS_API_REVISION = 11
export interface PlatformApplyInput {
  requestId: ApplyBody['request_id']
  expectedRevision: ApplyBody['expected_revision']
  platform: PlatformKey
  enabled: boolean
  settings: NonNullable<ApplyBody['settings']>
  secrets: NonNullable<ApplyBody['secrets']>
}
export interface PlatformsBridge {
  read(characterId: string): Promise<ApiReply<PlatformsView>>
  apply(characterId: string, input: PlatformApplyInput): Promise<ApiReply<PlatformControlResult>>
}
