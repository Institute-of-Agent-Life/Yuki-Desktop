// Deployment steps Main reports while it sets up Yuki on this computer.
export default {
  image: '準備本機 Yuki 映像',
  configure: '儲存模型與本機設定',
  initialize: '初始化 Yuki 與資料庫',
  start: '啟動本機 Yuki',
  connect: '建立本人入口並連接桌面',
} as const
