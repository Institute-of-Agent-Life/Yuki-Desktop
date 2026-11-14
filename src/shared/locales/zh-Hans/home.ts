import type { Chinese } from '../types'

// The home screen when no Yuki is connected.
export default {
  title: {
    chat: '对话',
    works: '工作',
    files: '文件与成果',
    computer: '电脑',
    local: '这台电脑',
    about: '关于 Yuki Desktop',
  },
  heading: {
    chat: '你的 Yuki 工作区',
    works: '工作会显示在这里',
    files: '文件与成果会显示在这里',
    computer: 'Yuki 的电脑会显示在这里',
    local: '这台电脑',
    about: 'Yuki Desktop',
  },
  description: {
    chat: 'Yuki 可以稍后再设置。你现在就能使用工作区、本机设置和说明；连接后即可开始对话。',
    works: '连接你的 Yuki 后，可以查看真实工作、补充要求，并跟进原本的进度与结果。',
    files: '连接你的 Yuki 后，可以浏览文件与成果的原版本、比较内容，并返回原始消息或工作。',
    computer: '连接你的 Yuki 后，可以查看她的电脑、接手操作，再交回原工作。',
    local: '连接 Yuki 后，可以让她使用这台电脑。',
    about: '与自己的 Yuki 对话、查看工作，也可以让她使用本机的编程 Agent。连接后会显示她的数据。',
  },
  notConnected: '尚未连接 Yuki',
  inspectorEmpty: '连接 Yuki 后，可以在这里查看原工作与文件。',
  connect: '连接已有 Yuki',
  deploy: '在本机部署 Yuki',
  hint: '随时可以从设置中的“所有 Yuki”继续配置连接。',
  help: '使用说明',
} satisfies Chinese<'home'>
