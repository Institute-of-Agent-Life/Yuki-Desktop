// The home screen when no Yuki is connected.
import type { English } from '../types'

export default {
  title: {
    chat: 'Conversation',
    works: 'Work',
    files: 'Files & Results',
    computer: 'Computer',
    local: 'This Computer',
    about: 'About Yuki Desktop',
  },
  heading: {
    chat: 'Your Yuki Workspace',
    works: 'Work Appears Here',
    files: 'Files & Results Appear Here',
    computer: 'Yuki’s Computer Appears Here',
    local: 'This Computer',
    about: 'Yuki Desktop',
  },
  description: {
    chat: 'You can set up Yuki later. The workspace, local settings, and help are available now; connect to start a conversation.',
    works:
      'Once your Yuki is connected, you can see its real work, add to requests, and follow progress and results.',
    files:
      'Once your Yuki is connected, you can browse the original versions of files and results, compare them, and go back to the original message or work item.',
    computer:
      'Once your Yuki is connected, you can see her computer, take over, and hand control back to the original work.',
    local: 'Once Yuki is connected, you can let her use this computer.',
    about:
      'Talk with your own Yuki, check on her work, and let her use the coding agents on this computer. Her details appear once you connect.',
  },
  notConnected: 'No Yuki connected',
  inspectorEmpty: 'Once Yuki is connected, her work and files appear here.',
  connect: 'Connect Your Yuki',
  deploy: 'Set Up Yuki on This Computer',
  hint: 'You can set up connections any time from All Yukis in Settings.',
  help: 'Help',
} satisfies English<'home'>
