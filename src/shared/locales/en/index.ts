// English: the source keys, plus `_one` beside each counted `_other` key.
import common from './common'
import menu from './menu'
import tray from './tray'
import notifications from './notifications'
import dialogs from './dialogs'
import localBot from './localBot'
import time from './time'
import settings from './settings'
import errors from './errors'
import platforms from './platforms'
import ssh from './ssh'
import remoteDeploy from './remoteDeploy'
import connector from './connector'
import conversation from './conversation'
import computer from './computer'
import media from './media'
import about from './about'
import soul from './soul'
import avatar from './avatar'
import works from './works'
import files from './files'
import models from './models'
import connection from './connection'
import devices from './devices'
import pairing from './pairing'
import updates from './updates'
import workspace from './workspace'
import home from './home'
import presence from './presence'

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
  errors,
  platforms,
  ssh,
  remoteDeploy,
  connector,
  conversation,
  computer,
  media,
  about,
  soul,
  avatar,
  works,
  files,
  models,
  connection,
  devices,
  pairing,
  updates,
  workspace,
  home,
  presence,
} satisfies Translation<'en'>
