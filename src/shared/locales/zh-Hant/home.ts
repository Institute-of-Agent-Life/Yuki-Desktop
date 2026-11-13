// The home screen when no Yuki is connected.
export default {
  title: {
    chat: '對話',
    works: '工作',
    files: '檔案與成果',
    computer: '電腦',
    local: '這台電腦',
    about: '關於 Yuki Desktop',
  },
  heading: {
    chat: '你的 Yuki 工作區',
    works: '工作會顯示在這裡',
    files: '檔案與成果會顯示在這裡',
    computer: 'Yuki 的電腦會顯示在這裡',
    local: '這台電腦',
    about: 'Yuki Desktop',
  },
  description: {
    chat: 'Yuki 可以稍後再設定。你現在就能使用工作區、本機設定和說明；連接後即可開始對話。',
    works: '連接你的 Yuki 後，可以查看真實工作、補充要求，並跟進原本的進度與結果。',
    files: '連接你的 Yuki 後，可以瀏覽檔案與成果的原版本、比較內容，並返回原始訊息或工作。',
    computer: '連接你的 Yuki 後，可以查看她的電腦、接手操作，再交回原工作。',
    local: '連接 Yuki 後，可以讓她使用這台電腦。',
    about: '與自己的 Yuki 對話、查看工作，也可以讓她使用本機的編程 Agent。連接後會顯示她的資料。',
  },
  notConnected: '尚未連接 Yuki',
  inspectorEmpty: '連接 Yuki 後，可以在這裡查看原工作與檔案。',
  connect: '連接已有 Yuki',
  deploy: '在本機部署 Yuki',
  hint: '隨時可以從設定中的「所有 Yuki」繼續配置連線。',
  help: '使用說明',
} as const
