import type { components, paths } from './admin-contract.gen'
import type { ApiReply } from './api'

export type ModelBundle = components['schemas']['ModelBundle']
export type ModelDocument = components['schemas']['ModelDocument']
export type ModelProfile = components['schemas']['ModelProfileDocument']
export type ModelControlResult = components['schemas']['ModelControlResult']
export type ModelTestInput =
  paths['/admin/v1/models/test']['post']['requestBody']['content']['application/json']
export type ModelTestResult = components['schemas']['ModelTestResult']
export type ModelDiscoverInput =
  paths['/admin/v1/models/discover']['post']['requestBody']['content']['application/json']
export type ModelDiscoverResult = components['schemas']['ModelDiscoverResult']
export type ModelStatsView = components['schemas']['ModelStatsView']
type ModelsBody = components['schemas']['ModelsBody']
export interface ModelApplyInput {
  requestId: ModelsBody['request_id']
  expectedRevision: ModelsBody['expected_revision']
  document: ModelsBody['document']
  apiKeys?: ModelsBody['api_keys']
}
export interface ModelsBridge {
  read(characterId: string): Promise<ApiReply<ModelBundle>>
  apply(characterId: string, input: ModelApplyInput): Promise<ApiReply<ModelControlResult>>
  test(characterId: string, input: ModelTestInput): Promise<ApiReply<ModelTestResult>>
  discover(characterId: string, input: ModelDiscoverInput): Promise<ApiReply<ModelDiscoverResult>>
  stats(characterId: string): Promise<ApiReply<ModelStatsView>>
}
