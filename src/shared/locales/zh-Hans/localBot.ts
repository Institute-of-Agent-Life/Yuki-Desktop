// Deployment steps Main reports while it sets up Yuki on this computer.
import type { Chinese } from '../types'

export default {
  image: '准备本机 Yuki 镜像',
  configure: '保存模型与本机设置',
  initialize: '初始化 Yuki 与数据库',
  start: '启动本机 Yuki',
  connect: '创建本人入口并连接桌面',
} satisfies Chinese<'localBot'>
