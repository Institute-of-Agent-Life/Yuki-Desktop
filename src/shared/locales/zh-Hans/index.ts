// Simplified Chinese: converted from the source with OpenCC (tw2sp), wording reviewed.
import common from './common'
import menu from './menu'
import tray from './tray'
import notifications from './notifications'
import dialogs from './dialogs'
import localBot from './localBot'
import time from './time'
import settings from './settings'
import platforms from './platforms'

import type { Translation } from '../types'

export default {
  common,
  menu,
  tray,
  notifications,
  dialogs,
  localBot,
  time,
  settings,
  platforms,
} satisfies Translation<'zh-Hans'>
