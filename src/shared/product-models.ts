/** Client view types for optional product features. This file declares no server routes. */
export interface ProductModels {
  schemas: {
    Accent: {
      /** Dark */
      dark: string
      /** Light */
      light: string
    }
    Activity: {
      /** Conversation Id */
      conversation_id: string
      /**
       * Evidence
       * @enum {string}
       */
      evidence: 'executing' | 'insufficient'
      /** Revision */
      revision: number
      /** Sources */
      sources: ProductModels['schemas']['ActivitySource'][]
      /** Step Kind */
      step_kind: string | null
    }
    ActivitySource: {
      /** Kind */
      kind: string
      /** Origin */
      origin: string
      /** Started At */
      started_at: string
    }
    ArtifactItem: {
      /** Artifact Id */
      artifact_id: string
      /** Conversation Id */
      conversation_id: string
      /** Created At */
      created_at: string
      /** Media Type */
      media_type: string
      /** Name */
      name: string
      /** Published Path */
      published_path: string | null
      ref: ProductModels['schemas']['ArtifactReference']
      /** Size */
      size: number | null
      /** Version */
      version: string
      /** Work Id */
      work_id: string | null
    }
    ArtifactPage: {
      /** Items */
      items: ProductModels['schemas']['ArtifactItem'][]
      /** Next Cursor */
      next_cursor: string | null
    }
    ArtifactReference: {
      /** Event Id */
      event_id: number
      /** Part Index */
      part_index: number
    }
    Attachment: {
      /** Artifact Id */
      artifact_id?: string | null
      /** Attachment Index */
      attachment_index: number
      /**
       * Availability
       * @enum {string}
       */
      availability: 'available' | 'expired' | 'not_readable'
      /** Expires At */
      expires_at: string | null
      /** Filename */
      filename?: string | null
      /** Kind */
      kind: string
      /** Media Id */
      media_id?: string | null
      /** Mime Type */
      mime_type?: string | null
      /** Size */
      size?: number | null
      /** Version */
      version?: string | null
    } & {
      [key: string]: unknown
    }
    AutomationPage: {
      /** Items */
      items: ProductModels['schemas']['AutomationView'][]
    }
    AutomationView: {
      /** Automation Id */
      automation_id: number
      /** Conversation Id */
      conversation_id: string | null
      /** Next Run At */
      next_run_at: string | null
      /** Replay */
      replay?: boolean | null
      /** Revision */
      revision: string
      /** Schedule Text */
      schedule_text: string
      /**
       * State
       * @enum {string}
       */
      state: 'active' | 'paused' | 'completed' | 'cancelled' | 'failed' | 'blocked'
      /** Title */
      title: string
    }
    Avatar: {
      /** Sha256 */
      sha256: string
      /** Sizes */
      sizes: {
        [key: string]: string
      }
    }
    Binding: {
      /** Binding Id */
      binding_id: string
      /** Display Name */
      display_name: string
      /** Platform */
      platform: string
      /** Source Person Id */
      source_person_id: string
      /** Status */
      status: string
    }
    CharacterCapabilities: {
      environment: ProductModels['schemas']['EnvironmentCapabilities']
      /** Plugins */
      plugins: ProductModels['schemas']['PluginCapability'][]
    }
    CharacterEnvironment: {
      /** Control */
      control: {
        [key: string]: ProductModels['schemas']['JsonValue']
      } | null
      /**
       * Display
       * @enum {string}
       */
      display: 'running' | 'stopped' | 'starting' | 'unavailable'
      /** Generation */
      generation: string | null
      /** Help Requested */
      help_requested: boolean | null
      /**
       * State
       * @enum {string}
       */
      state: 'running' | 'stopped' | 'unavailable'
    }
    CharacterMine: {
      /** Live Conversations */
      live_conversations: string[]
      /** Works */
      works: {
        [key: string]: number
      }
    }
    CharacterProfile: {
      accent: ProductModels['schemas']['Accent']
      avatar: ProductModels['schemas']['CurrentAvatar'] | null
      /** Avatar Revision */
      avatar_revision: number
      /** Bio */
      bio: string
      default_avatar: ProductModels['schemas']['Avatar'] | null
      /** Display Name */
      display_name: string
      /** Id */
      id: string
      /** Replay */
      replay?: boolean | null
      /** Revision */
      revision: number
      /** Slug */
      slug: string
      viewer: ProductModels['schemas']['Viewer']
    }
    CharacterStatus: {
      environment: ProductModels['schemas']['CharacterEnvironment']
      mine: ProductModels['schemas']['CharacterMine']
      /** Observed At */
      observed_at: string
      /** Revision */
      revision: number
    }
    ChildWork: {
      /** Goal */
      goal: string
      /** Revision */
      revision: number
      /** State */
      state: string
      /** Work Id */
      work_id: string
    }
    ComputerControlView: {
      /** Device Id */
      device_id?: string | null
      /** Device Label */
      device_label?: string | null
      /** Device Online */
      device_online?: boolean | null
      /**
       * Holder
       * @enum {string}
       */
      holder: 'none' | 'agent' | 'human'
      /** Lease Id */
      lease_id?: string | null
      /** Since */
      since?: string | null
      /** Work Id */
      work_id?: string | null
    }
    ComputerFile: {
      /**
       * Kind
       * @enum {string}
       */
      kind: 'directory' | 'file' | 'link'
      /** Mtime */
      mtime: number
      /** Name */
      name: string
      /** Size */
      size: number
    }
    ComputerFiles: {
      /** Items */
      items: ProductModels['schemas']['ComputerFile'][]
      /** Next Cursor */
      next_cursor: string | null
      /** Path */
      path: string
    }
    ComputerHelp: {
      /**
       * Kind
       * @enum {string}
       */
      kind: 'help' | 'wait_control'
      /** Note */
      note: string | null
      /** Since */
      since: string
      /** Wait Id */
      wait_id: string
      /** Work Id */
      work_id: string | null
    }
    ComputerResources: {
      /** Cpus */
      cpus: number
      /** Memory Mib */
      memory_mib: number
    }
    ComputerResult: {
      /** At */
      at?: string | null
      /** By */
      by?:
        | {
            [key: string]: ProductModels['schemas']['JsonValue']
          }
        | string
        | null
      control?: ProductModels['schemas']['ComputerControlView'] | null
      /** Display */
      display?: ('running' | 'stopped' | 'starting' | 'unavailable') | null
      /** Note */
      note?: string | null
      /** Replay */
      replay?: boolean | null
    }
    ComputerTab: {
      /**
       * Ownership
       * @enum {string}
       */
      ownership: 'work' | 'unknown'
      /** Target Id */
      target_id: string
      /** Title */
      title: string
      /** Url Host */
      url_host: string
      /** Work Id */
      work_id: string | null
      /** Work State */
      work_state: string | null
    }
    ComputerView: {
      control: ProductModels['schemas']['ComputerControlView'] | null
      /**
       * Display
       * @enum {string}
       */
      display: 'running' | 'stopped' | 'starting' | 'unavailable'
      /**
       * Environment
       * @enum {string}
       */
      environment: 'running' | 'stopped' | 'unavailable'
      /** Help Requests */
      help_requests: ProductModels['schemas']['ComputerHelp'][]
      resources: ProductModels['schemas']['ComputerResources'] | null
      /** Revision */
      revision: number
      /** Tabs */
      tabs: ProductModels['schemas']['ComputerTab'][]
      /** Tabs Available */
      tabs_available: boolean
    }
    ConversationCondition: {
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'conversation'
    }
    CurrentAvatar: {
      /** Revision */
      revision: number
      /** Sha256 */
      sha256: string
      /** Sizes */
      sizes: {
        [key: string]: string
      }
      /** Updated At */
      updated_at: string
    }
    Device: {
      /**
       * Created At
       * Format: date-time
       */
      created_at: string
      /** Device Id */
      device_id: string
      /** Label */
      label: string
      /** Revoked At */
      revoked_at: string | null
    }
    DisplayTicket: {
      /** Expires At */
      expires_at: string
      /** Ticket */
      ticket: string
      /** Ws Path */
      ws_path: string
    }
    Entry: {
      /** Binding Id */
      binding_id: string
      /** Conversation Id */
      conversation_id: string
      /** Display Name */
      display_name: string
      /** Generation */
      generation: number
      /** Latest Event Id */
      latest_event_id: number | null
      /** Platform */
      platform: string
      /** Revision */
      revision: number
      /** Status */
      status: string
    }
    Envelope_CharacterProfile_: {
      data: ProductModels['schemas']['CharacterProfile']
    }
    Envelope_EventsPage_: {
      data: ProductModels['schemas']['EventsPage']
    }
    Envelope_Home_: {
      data: ProductModels['schemas']['Home']
    }
    Envelope_Me_: {
      data: ProductModels['schemas']['Me']
    }
    Envelope_MessageResult_: {
      data: ProductModels['schemas']['MessageResult']
    }
    Envelope_Meta_: {
      data: ProductModels['schemas']['Meta']
    }
    Envelope_OriginalRequest_: {
      data: ProductModels['schemas']['OriginalRequest']
    }
    Envelope_PairResult_: {
      data: ProductModels['schemas']['PairResult']
    }
    Envelope_UploadResult_: {
      data: ProductModels['schemas']['UploadResult']
    }
    Envelope_WorkCancelResult_: {
      data: ProductModels['schemas']['WorkCancelResult']
    }
    Envelope_WorkView_: {
      data: ProductModels['schemas']['WorkView']
    }
    EnvironmentCapabilities: {
      /** Desktop */
      desktop: boolean
      /** Tools */
      tools: ProductModels['schemas']['EnvironmentTool'][]
    }
    EnvironmentTool: {
      /** Name */
      name: string
      /** Version */
      version: string
    }
    EventsPage: {
      /** Generation */
      generation: number
      /** Has More */
      has_more: boolean
      /** Items */
      items: ProductModels['schemas']['PublicEvent'][]
      /** Latest Event Id */
      latest_event_id: number | null
      /** Next After */
      next_after: number
      /** Next Before */
      next_before: number | null
      /** Revision */
      revision: number
    }
    ExecutorConfig: {
      /** Executor Id */
      executor_id: string
      /** Grants */
      grants: ProductModels['schemas']['Grant'][]
      /** Grants Digest */
      grants_digest: string
      /** Paused */
      paused: boolean
      /** Revision */
      revision: number
    }
    ExecutorCreated: {
      /** Created At */
      created_at: string
      /** Executor Id */
      executor_id: string
      /** Label */
      label: string
      /** Platform */
      platform: string
      /** Replay */
      replay: boolean
      /** Token */
      token?: string | null
    }
    ExecutorOperation: {
      /** Acknowledged At */
      acknowledged_at: string | null
      /** Capability */
      capability: string
      /** Created At */
      created_at: string
      /** Dispatched At */
      dispatched_at: string | null
      /** Level */
      level: ('confirmed' | 'submitted') | null
      /** Observation */
      observation: {
        [key: string]: unknown
      } | null
      /** Op Id */
      op_id: string
      /** Params */
      params: {
        [key: string]: unknown
      }
      /** Result */
      result: {
        [key: string]: unknown
      }
      /** Settled At */
      settled_at: string | null
      /**
       * State
       * @enum {string}
       */
      state:
        | 'registered'
        | 'dispatched'
        | 'acknowledged'
        | 'awaiting_user'
        | 'succeeded'
        | 'failed'
        | 'unknown'
    }
    ExecutorSyncItem: {
      /** Id */
      id: string
      /** Revision */
      revision: number
    }
    ExecutorView: {
      /** Claimed */
      claimed: boolean
      /** Executor Id */
      executor_id: string
      /** Grants */
      grants: ProductModels['schemas']['Grant'][]
      /** Grants Digest */
      grants_digest: string
      /** Label */
      label: string
      /** Last Seen At */
      last_seen_at: string | null
      /** Online */
      online: boolean
      /** Paused */
      paused: boolean
      /** Platform */
      platform: string
      /** Revision */
      revision: number
    }
    Grant: {
      /** Capability */
      capability: string
      scope?: ProductModels['schemas']['Scope'] | null
    }
    Home: {
      /** Entries */
      entries: ProductModels['schemas']['Entry'][]
      main: ProductModels['schemas']['Entry']
      /** Snapshot At */
      snapshot_at: string
      /** Works */
      works: ProductModels['schemas']['WorkView'][]
    }
    JsonValue: unknown
    LinkCode: {
      /** Code */
      code: string | null
      /** Code Id */
      code_id: string
      /** Expires At */
      expires_at: string
      /** Replay */
      replay: boolean
      /** Request Id */
      request_id?: string | null
    }
    Me: {
      /** Binding Id */
      binding_id: string
      /** Bindings */
      bindings: ProductModels['schemas']['Binding'][]
      /** Conversation Id */
      conversation_id: string
      /** Devices */
      devices: ProductModels['schemas']['Device'][]
      /** Display Name */
      display_name: string
      /** Person Id */
      person_id: string
      /** Platform */
      platform: string
      /** Presence Id */
      presence_id: string | null
      /** Request Conversation Id */
      request_conversation_id: string | null
      /** Request Person Id */
      request_person_id: string
      /** Request Scope */
      request_scope: string
      /** Source Person Id */
      source_person_id: string
      /** Thread Id */
      thread_id: string | null
    }
    MemoryDetail: {
      /** Confidence */
      confidence: number
      /** Evidence */
      evidence: ProductModels['schemas']['MemoryEvidenceView'][]
      /** Evidence Count */
      evidence_count: number
      /** Fact Id */
      fact_id: number
      /** Key */
      key: string
      /**
       * Kind
       * @enum {string}
       */
      kind: 'fact' | 'preference' | 'episode'
      /** Revision */
      revision: string
      /** Text */
      text: string
      /** Updated At */
      updated_at: string
    }
    MemoryEvidenceView: {
      /** Conversation Id */
      conversation_id: string
      /** Event Id */
      event_id: number
      /** Excerpt */
      excerpt: string
    }
    MemoryFactView: {
      /** Confidence */
      confidence: number
      /** Evidence Count */
      evidence_count: number
      /** Fact Id */
      fact_id: number
      /** Key */
      key: string
      /**
       * Kind
       * @enum {string}
       */
      kind: 'fact' | 'preference' | 'episode'
      /** Revision */
      revision: string
      /** Text */
      text: string
      /** Updated At */
      updated_at: string
    }
    MemoryPage: {
      /** Items */
      items: ProductModels['schemas']['MemoryFactView'][]
      /** Next Cursor */
      next_cursor: string | null
    }
    MessageBody: {
      /**
       * Attachments
       * @default []
       */
      attachments: string[]
      /**
       * Request Id
       * Format: uuid4
       */
      request_id: string
      /** Text */
      text: string
    }
    MessageResult: {
      /** Conversation Id */
      conversation_id: string
      /** Event Id */
      event_id: number
      /** Replay */
      replay: boolean
    }
    Meta: {
      /** Api Revision */
      api_revision: number
      character: ProductModels['schemas']['PublicCharacter']
      min_client: ProductModels['schemas']['MinimumClient']
      /** Server Version */
      server_version: string
    }
    MinimumClient: {
      /** Android */
      android: string | null
      /** Desktop */
      desktop: string
    }
    OperationPage: {
      /** Items */
      items: ProductModels['schemas']['ExecutorOperation'][]
      /** Next Cursor */
      next_cursor: string | null
    }
    OriginalRequest: {
      /** Conversation Id */
      conversation_id?: string | null
      /** Event Id */
      event_id?: number | null
      /** Found */
      found: boolean
      /** Operation Kind */
      operation_kind?: string | null
      /** Payload Hash */
      payload_hash?: string | null
      /** Problem */
      problem?: {
        [key: string]: ProductModels['schemas']['JsonValue']
      } | null
      /** Problem Code */
      problem_code?: string | null
      result?: ProductModels['schemas']['JsonValue']
      /** Result Event Ids */
      result_event_ids?: number[] | null
      /** Status */
      status?: string | null
      /** Target */
      target?: string | null
      turn?: ProductModels['schemas']['TurnResult'] | null
      work?: ProductModels['schemas']['RequestWork'] | null
    }
    OwnedRunCondition: {
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'owned_run'
      /**
       * Run Kind
       * @enum {string}
       */
      run_kind: 'terminal' | 'acp' | 'help_request' | 'wait_control' | 'other'
    }
    PairResult: {
      /** Device Id */
      device_id: string
      /** Token */
      token: string
    }
    PluginCapability: {
      /** Description */
      description: string
      /** Id */
      id: string
      /** Name */
      name: string
    }
    PluginEventCondition: {
      /** Event Type */
      event_type: string
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'plugin_event'
      /** Plugin Id */
      plugin_id: string
    }
    ProactiveRoute: {
      /** Binding Id */
      binding_id: string | null
      /** Paused */
      paused: boolean
      /** Platform */
      platform: string | null
      /** Replay */
      replay?: boolean | null
      /** Revision */
      revision: number
    }
    PublicCharacter: {
      accent: ProductModels['schemas']['Accent']
      /** Avatar Url */
      avatar_url: string | null
      /** Display Name */
      display_name: string
      /** Id */
      id: string
    }
    PublicEvent: {
      /** Attachments */
      attachments: ProductModels['schemas']['Attachment'][]
      /** Author Kind */
      author_kind: string
      /** Binding Id */
      binding_id: string
      /** Conversation Id */
      conversation_id: string
      /** Created At */
      created_at: string
      /** Direction */
      direction: string
      /** Display Text */
      display_text?: string | null
      /** Event Id */
      event_id: number
      /** Origin */
      origin: string
      /** Platform */
      platform: string
      /** Text */
      text: string
      transcript?: ProductModels['schemas']['Transcript'] | null
      /** Work Ids */
      work_ids?: string[]
    } & {
      [key: string]: unknown
    }
    PublicStep: {
      /** Artifacts */
      artifacts: ProductModels['schemas']['StepArtifact'][]
      /** Category */
      category: string
      /** Created At */
      created_at: string
      /** Label */
      label: string
      /**
       * Record
       * @enum {string}
       */
      record: 'prepared' | 'accepted' | 'failed' | 'unknown'
      /**
       * Status
       * @enum {string}
       */
      status: 'recorded' | 'running' | 'succeeded' | 'failed' | 'unknown'
      /** Step Id */
      step_id: string
      /** Updated At */
      updated_at: string
    }
    RequestWork: {
      /** Active */
      active: boolean
      /** Reason */
      reason: string | null
      /** Revision */
      revision: number
      /** State */
      state: string
      /** Work Id */
      work_id: string
    } & {
      [key: string]: unknown
    }
    Scope: {
      /** Alias */
      alias: string
      /** Digest */
      digest: string
    }
    StepArtifact: {
      /** Artifact Id */
      artifact_id: string
      /** Version */
      version: string
    }
    SyncHint: {
      /** Activity */
      activity: ProductModels['schemas']['Activity'][]
      /** Character Revision */
      character_revision: number
      /**
       * Computer Revision
       * @default null
       */
      computer_revision: number | null
      /** Conversations */
      conversations: ProductModels['schemas']['Entry'][]
      /** Executors */
      executors?: ProductModels['schemas']['ExecutorSyncItem'][]
      /** Works */
      works: ProductModels['schemas']['WorkHint'][]
    }
    TimeDueCondition: {
      /** Due At */
      due_at: string
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'time_due'
    }
    Transcript: {
      /**
       * State
       * @enum {string}
       */
      state: 'available' | 'none'
      /** Text */
      text?: string | null
    }
    TurnResult: {
      outcome?: ProductModels['schemas']['JsonValue']
      /** State */
      state: string
    }
    UploadResult: {
      /** Expires At */
      expires_at: number
      /** Filename */
      filename: string
      /** Kind */
      kind: string
      /** Media Id */
      media_id: string
      /** Replay */
      replay: boolean
      /** Sha256 */
      sha256: string
      /** Size */
      size: number
    }
    Viewer: {
      /** Is Owner */
      is_owner: boolean
    }
    WorkBudget: {
      /** Model Limit */
      model_limit: number | null
      /** Models */
      models: number
      /** Root Id */
      root_id: string
      /** Tool Limit */
      tool_limit: number | null
      /** Tools */
      tools: number
    }
    WorkCancelResult: {
      /** Replay */
      replay: boolean
      /** Revision */
      revision: number
      /** State */
      state: string
      /** Work Id */
      work_id: string
    }
    WorkHint: {
      /** Revision */
      revision: number
      /**
       * Steps Token
       * @default null
       */
      steps_token: string | null
      /** Work Id */
      work_id: string
    }
    WorkPage: {
      /** Next Before */
      next_before: string | null
      /** Works */
      works: ProductModels['schemas']['WorkView'][]
    }
    WorkResult: {
      /** Artifacts */
      artifacts: {
        [key: string]: ProductModels['schemas']['JsonValue']
      }[]
      /** Conversation Id */
      conversation_id: string
      /** Event Id */
      event_id: number
      /** Text */
      text: string
    }
    WorkSource: {
      /** Binding Id */
      binding_id: string | null
      /** Conversation Id */
      conversation_id: string
      /** Display Name */
      display_name: string
      /** Kind */
      kind: string
      /** Platform */
      platform: string | null
      /** Space Id */
      space_id: string | null
    }
    WorkSteps: {
      /** Children */
      children: ProductModels['schemas']['ChildWork'][]
      /** Next After */
      next_after: string | null
      /** Steps */
      steps: ProductModels['schemas']['PublicStep'][]
      /** Steps Token */
      steps_token: string
      wait: ProductModels['schemas']['WorkWait'] | null
      /** Work Revision */
      work_revision: number
    }
    WorkView: {
      budget: ProductModels['schemas']['WorkBudget']
      /** Child Count */
      child_count: number
      /** Conversation Id */
      conversation_id: string
      /** Generation */
      generation: number
      /** Goal */
      goal: string
      /**
       * Help Requested
       * @default false
       */
      help_requested: boolean
      /** Reason */
      reason?: string | null
      result_delivery: ProductModels['schemas']['WorkSource']
      /** Results */
      results: ProductModels['schemas']['WorkResult'][]
      /** Revision */
      revision: number
      source: ProductModels['schemas']['WorkSource']
      /**
       * State
       * @enum {string}
       */
      state:
        | 'queued'
        | 'running'
        | 'waiting_external'
        | 'waiting_user'
        | 'suspended'
        | 'completed'
        | 'failed'
        | 'cancelled'
      /** Step Count */
      step_count?: number | null
      /** Steps Token */
      steps_token?: string | null
      /** Trigger Event Id */
      trigger_event_id?: number | null
      /** Updated At */
      updated_at: number
      wait?: ProductModels['schemas']['WorkWait'] | null
      /** Waiting Kind */
      waiting_kind: string | null
      waiting_question: ProductModels['schemas']['WorkResult'] | null
      /** Work Id */
      work_id: string
    } & {
      [key: string]: unknown
    }
    WorkWait: {
      /** Conditions */
      conditions: (
        | ProductModels['schemas']['TimeDueCondition']
        | ProductModels['schemas']['ConversationCondition']
        | ProductModels['schemas']['PluginEventCondition']
        | ProductModels['schemas']['OwnedRunCondition']
      )[]
      /** Deadline At */
      deadline_at: string | null
      /**
       * Mode
       * @enum {string}
       */
      mode: 'any' | 'all'
      /** Since */
      since: string
    }
  }
}
