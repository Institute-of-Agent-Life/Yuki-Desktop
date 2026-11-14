import type { English } from '../types'

export default {
  quitControlTitle: "You're controlling Yuki's computer",
  quitControlMessage: "You're controlling {{names}}'s computer",
  quitControlMessageOffline: "You were last controlling {{names}}'s computer",
  quitControlDetail:
    'While you keep control, steps that need the computer wait for you to return it; other steps continue.',
  quitControlDetailOffline:
    "This can't be confirmed right now; returning control checks who holds it on the server. While you keep control, steps that need the computer wait for you to return it; other steps continue.",
  returnAndQuit: 'Return and Quit',
  keepAndQuit: 'Keep Control and Quit',
  cancel: 'Cancel',
  returnUnconfirmed: 'Return not confirmed yet. The app stays open.',
  returnUnconfirmedDetail:
    'Check who holds control now or verify the original request before quitting.',
  closeFailed: "Local data hasn't finished closing. Try quitting the app again.",
  openLinkTitle: 'Open External Link',
  openLinkMessage: 'Open {{host}} in your browser?',
  open: 'Open',
  exportConnectorDiagnostics: 'Export Connector Diagnostics',
  exportDiagnostics: 'Export Diagnostics',
  diagnostics: 'Diagnostics',
  exportRetiredHistory: 'Export Earlier Operation Records',
  retiredHistory: 'Earlier Operation Records',
  chooseAvatar: 'Choose Avatar Image',
  images: 'Images',
  pngImages: 'PNG Images',
  attachFiles: 'Attach Files',
  saveTo: 'Save To…',
  saveAsFile: 'Save as File',
} satisfies English<'dialogs'>
