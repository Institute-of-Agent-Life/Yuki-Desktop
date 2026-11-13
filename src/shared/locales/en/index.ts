// English: the source keys, plus `_one` beside each counted `_other` key.
import common from './common'
import menu from './menu'
import tray from './tray'
import notifications from './notifications'
import dialogs from './dialogs'
import localBot from './localBot'
import time from './time'
import settings from './settings'
import ssh from './ssh'
import remoteDeploy from './remoteDeploy'

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
  ssh,
  remoteDeploy,
} satisfies Translation<'en'>
