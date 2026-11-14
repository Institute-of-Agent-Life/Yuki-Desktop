// Native dialogs shown by Main. Default file names are data and stay out of here.
import type { Chinese } from '../types'

export default {
  quitControlTitle: '你正在控制 Yuki 的电脑',
  quitControlMessage: '你正在控制 {{names}} 的电脑',
  quitControlMessageOffline: '你上次仍在控制 {{names}} 的电脑',
  quitControlDetail: '保持控制时，需要用电脑的步骤会一直等待交回；其他步骤照常进行。',
  quitControlDetailOffline:
    '暂时无法连接确认；交回时会核对服务器当前的控制权。保持控制时，需要用电脑的步骤会一直等待交回；其他步骤照常进行。',
  returnAndQuit: '交回并退出',
  keepAndQuit: '保持控制并退出',
  cancel: '取消',
  returnUnconfirmed: '尚未确认交回，App 会保持打开。',
  returnUnconfirmedDetail: '请确认当前控制权或查证原请求，再决定是否退出。',
  closeFailed: '本机数据尚未完成关闭，请重新尝试退出 App。',
  openLinkTitle: '打开外部链接',
  openLinkMessage: '在浏览器打开 {{host}}？',
  open: '打开',
  exportConnectorDiagnostics: '导出连接器诊断',
  exportDiagnostics: '导出诊断记录',
  diagnostics: '诊断记录',
  exportRetiredHistory: '导出旧版操作记录',
  retiredHistory: '旧版操作记录',
  chooseAvatar: '选择头像图片',
  images: '图片',
  pngImages: 'PNG 图片',
  attachFiles: '附加文件',
  saveTo: '保存到…',
  saveAsFile: '保存为文件',
} satisfies Chinese<'dialogs'>
