export default {
  intro: '讓 Yuki 在聊天平台收發訊息。憑據只保存在這個 Yuki 的伺服器上，密鑰不會再顯示。',
  adminOnly: '只有 Yuki 的管理員可以設定聊天平台',
  readOnly:
    '伺服器目前無法寫入設定目錄（webui-config），暫時不能儲存。請在伺服器上檢查這個目錄的寫入權限。',
  revisionUnavailable:
    '這個 Yuki 的 Client API revision 為 {{revision}}，平台設定需要 {{required}} 以上。請先升級 Yuki。',
  name: {
    telegram: 'Telegram',
    feishu: '飛書',
    lark: 'Lark',
    qq: 'QQ',
  },
  status: {
    disabled: '未啟用',
    connected: '已連線',
    connecting: '正在連線',
    failed: '連線錯誤',
  },
  lastSuccess: '最近成功：{{time}}',
  accounts: '目前帳號：{{accounts}}',
  lastError: '最近錯誤：{{reason}}',
  enable: '啟用 {{name}}',
  field: {
    botToken: 'Bot Token',
    appId: 'App ID',
    appSecret: 'App Secret',
    qqAppId: 'AppID',
    qqAppSecret: 'AppSecret',
    sandbox: '沙箱',
    sandboxDescription: '機器人審核上線前只能在沙箱聯調，上線後取消。',
  },
  saved: '已儲存',
  keepSaved: '留空則保留已儲存的值',
  save: '儲存',
  removeCredentials: '移除憑據',
  applied: '已儲存並套用。',
  savedPendingRestart: '已儲存，重新啟動 Yuki 後生效。',
  notApplied: '設定未能套用，請重新讀取後再試。',
  conflict: '設定已在其他地方變更，未覆蓋。',
  reload: '重新載入',
  pending: '平台設定等待確認',
  pendingDescription: '結果尚未確認，會以原請求查詢，不會建立新請求。',
  verify: '重新確認',
  platformCode: '平台錯誤碼：{{code}}',
  preflightFailed: '平台拒絕了新的憑據，原本的連線沒有變動。',
  problem: {
    validation_error: '憑據要成對填寫；啟用前要填好全部欄位。',
    operation_unavailable: '伺服器目前無法寫入設定，尚未儲存。',
    capability_denied: '只有 Yuki 的管理員可以設定聊天平台。',
    other: '操作未完成（{{code}}）。',
  },
  errors: {
    telegram_rejected:
      'Telegram 拒絕了這個 Bot Token。請在 BotFather 核對，或用 /revoke 換一個新的。',
    telegram_transport_unknown:
      '伺服器連不到 Telegram（api.telegram.org）。請確認伺服器的網路或代理設定。',
    telegram_invalid_response: 'Telegram 的回應無法辨識，請稍後再試。',
    feishu_rejected:
      '開放平台拒絕了這組 App ID 與 App Secret。請核對應用憑據，並確認應用屬於所選的飛書或 Lark。',
    feishu_transport_unknown: '伺服器連不到開放平台。請確認伺服器的網路或代理設定。',
    feishu_invalid_response: '開放平台的回應無法辨識，請稍後再試。',
    feishu_invalid_token_response: '開放平台的回應無法辨識，請稍後再試。',
    feishu_invalid_identity: '讀不到機器人身分。請確認應用已啟用機器人能力並已發布。',
    feishu_websocket_rejected:
      '長連線被拒絕。請在開放平台的事件訂閱選擇「使用長連線接收事件」，發布應用後再儲存一次。',
    feishu_websocket_handshake_failed: '長連線沒有建立成功，請確認網路後再儲存一次。',
    feishu_reconnect_exhausted: '長連線多次重連失敗，已停止。請確認網路後再儲存一次。',
    connection_closed: '平台關閉了連線，正在重新連線。',
    qq_official_credentials_rejected:
      'QQ 開放平台拒絕了這組 AppID 與 AppSecret。請核對，並確認伺服器的出口 IP 已加入白名單。',
    qq_official_token_unreachable: '伺服器連不到 QQ 開放平台。請確認伺服器的網路或代理設定。',
    qq_official_transport_unknown: '伺服器連不到 QQ 開放平台。請確認伺服器的網路或代理設定。',
    qq_official_invalid_token_response: 'QQ 開放平台的回應無法辨識，請稍後再試。',
    qq_official_invalid_response: 'QQ 開放平台的回應無法辨識，請稍後再試。',
    qq_official_rejected: 'QQ 開放平台拒絕了請求。',
    other: '連線錯誤（{{category}}）',
  },
  guide: {
    telegram: '取得 Bot Token',
    feishu: '取得飛書應用憑據',
    lark: '取得 Lark 應用憑據',
    qqOfficial: '取得 AppID 與 AppSecret',
  },
  telegramSteps: {
    create:
      '在 Telegram 打開 @BotFather，傳送 /newbot，依提示填寫顯示名稱與以 bot 結尾的使用者名稱。',
    token:
      'BotFather 回覆的 token（形如 123456789:AA…）就是這個 Bot 的全部控制權，只貼在這裡；外洩時在 BotFather 用 /revoke 換一個新的。',
    privacy:
      '要讓 Bot 在群組看到一般訊息：向 BotFather 傳送 /setprivacy，選這個 Bot 再選 Disable，然後把 Bot 移出群組再重新加入。只私聊不必改。',
    webhook:
      '這個 Bot 設定過 webhook（例如以前接過別的服務）時，Yuki 收不到訊息，要先刪除：用 getWebhookInfo 檢查，url 不為空就呼叫 deleteWebhook。',
    single: '同一個 token 同一時間只能由一個程式收訊息，其他程式也在用時兩邊會互相擠掉。',
  },
  feishuSteps: {
    create: '在{{console}}建立企業自建應用，啟用「機器人」能力。',
    scope: '設定應用的可用範圍，讓要使用 Yuki 的人能打開機器人，並把機器人加入目標群組。',
    events:
      '在「事件與回呼」選擇「使用長連線接收事件」，訂閱 im.message.receive_v1，不需要公網回呼位址。',
    permissions:
      '申請權限：單聊 im:message.p2p_msg:readonly、群內 @ im:message.group_at_msg:readonly、群內一般訊息 im:message.group_msg、以機器人傳送 im:message:send_as_bot、讀取訊息與資源 im:message:readonly、上傳 im:resource。',
    publish: '建立版本並發布，等組織管理員審核通過；之後改權限也要重新發布。',
    credentials:
      '在「憑證與基礎資訊」複製 App ID 與 App Secret 填到下方。飛書與 Lark 的應用不能混用。',
  },
  feishuConsole: '飛書開放平台（open.feishu.cn）',
  larkConsole: 'Lark 開放平台（open.larksuite.com）',
  qqSteps: {
    register: '用 QQ 登入 QQ 開放平台（q.qq.com），完成開發者註冊與認證，建立「QQ 機器人」。',
    credentials:
      '在機器人的開發設定取得 AppID 與 AppSecret。AppSecret 只在產生時顯示，重設後舊的立即失效。',
    whitelist: '開發設定要求 IP 白名單時，加入伺服器的出口公網 IP。',
    sandbox: '上線前只能在沙箱聯調：把測試用的 QQ 號與群加入沙箱範圍，並勾選下方「沙箱」。',
    release: '聯調完成後在開放平台提交審核、發布上線，再到這裡取消「沙箱」。',
  },
  qqMode: 'QQ 接入方式',
  qqOfficial: '官方 Bot',
  snowluma: 'SnowLuma',
  qqOfficialDescription: '經 QQ 開放平台的官方機器人接入，不需要 QQ 帳號登入，也不需要公網位址。',
  limitsTitle: '官方 Bot 的限制',
  limits: {
    mentions:
      '群裡預設只收到 @ 機器人的訊息。群主把「機器人可獲取的群聊訊息範圍」改為「獲取群內全部訊息」後，Yuki 才看得到一般聊天、自然插話。',
    proactive:
      '群裡不能主動發訊息：每則群訊息都要回覆群裡已收到的一則訊息，一則都沒收到過的群無法送出。',
    window:
      '回覆有時間窗口與次數限制：單聊約 60 分鐘、群聊約 5 分鐘，超出時這次傳送記為失敗，不會重試或改發別處。',
    identity: '官方 Bot 給的是 openid，與 SnowLuma 的 QQ 號互不相通，不會自動合併為同一個人。',
  },
  snowlumaDescription:
    'SnowLuma 以一個 QQ 帳號登入接入。它的設定在部署目錄的 .env，由 Docker Compose 讀取，要重建容器才會生效。SnowLuma 上游已停止維護，Yuki 不提供映像，請填你自己能拉取的映像。',
  snowlumaStatus: 'SnowLuma 連線',
  qqLogin: 'QQ 登入',
  qqLoginDescription: '在電腦視窗的 QQ 畫面掃碼登入。',
  openQQLogin: '開啟 QQ 登入',
  qqLoginUnavailable: '伺服器沒有設定 SNOWLUMA_VNC_HOST，「QQ 登入」暫時不可用。',
  image: 'SnowLuma 映像',
  imagePlaceholder: 'registry.example.com/you/snowluma:tag',
  enableLocal: '在這台電腦啟用',
  enableLocalDescription:
    '寫入本機部署的 .env（加入 snowluma、映像、QQ 畫面位址並產生 token 與密碼），再重新啟動 Yuki 與 SnowLuma。',
  enabledLocal: 'SnowLuma 已啟動。Yuki 重新連上後，就能從「QQ 登入」掃碼。',
  serverCommands:
    '這個 Yuki 不在這台電腦上。請在伺服器的 Yuki 部署目錄（有 .env 與 docker-compose.yml 的目錄）執行：',
  copyCommands: '複製指令',
  copied: '已複製。',
  elsewhere:
    'SnowLuma 部署在別處時，不必執行上面的指令：在 Yuki 的 .env 填 SNOWLUMA_VNC_HOST、SNOWLUMA_VNC_PORT（預設 5900）與 SNOWLUMA_VNC_PASSWORD，讓 SnowLuma 的反向 WebSocket 連到 Yuki 的 /onebot/v11/snowluma/ws 並使用同一個 ONEBOT_ACCESS_TOKEN，再重建 Bot。',
} as const
