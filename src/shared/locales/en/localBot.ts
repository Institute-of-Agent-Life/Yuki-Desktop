// Deploying Yuki on this computer: the page, and the steps Main reports while it sets Yuki up.
import type { English } from '../types'

export default {
  image: 'Preparing the local Yuki image',
  configure: 'Saving model and local settings',
  initialize: 'Initializing Yuki and its database',
  start: 'Starting local Yuki',
  snowluma: 'Restarting local Yuki with SnowLuma',
  connect: 'Creating your entry and connecting the desktop',
  title: 'Set Up Yuki on This Computer',
  description:
    'Docker is required (on macOS: Docker Desktop, OrbStack, or Colima). Yuki and its data are kept in the folder you choose. Models can be a remote service or a local one you already run; none is included, and QQ or other chat platforms aren’t needed to start.',
  failed: 'Local setup didn’t finish.',
  dockerMissing: 'Install or start Docker first, using Linux containers.',
  dockerHelp: 'Install Guide',
  notBundled:
    'This development build doesn’t include the local deployment resources. Use a full test package.',
  directory: 'Data and deployment folder',
  chooseDirectory: 'Choose Folder',
  characterName: 'Yuki’s name',
  personName: 'Your name',
  preset: 'Service preset',
  presetNeedsDocker: 'Presets are read from the deployment image and need Docker',
  localhost:
    'localhost for a model on this computer becomes host.docker.internal so the container can reach it; the service must accept connections from there.',
  sandbox: 'Yuki’s computer',
  sandboxProfile: {
    desktop: 'Full desktop: watch and take over (about 3 GiB memory)',
    headless: 'Headless browser (about 1 GiB)',
    lite: 'Terminal and files only (about 512 MiB)',
  },
  port: 'Local port',
  configuredRunning:
    'Settings and data already exist; the original Yuki and your entry will be used. The service is running.',
  configuredStopped:
    'Settings and data already exist; the original Yuki and your entry will be used. The service isn’t started.',
  later: 'Back / Set Up Later',
  recheck: 'Check Again',
  startAndConnect: 'Start and Connect',
  begin: 'Start Setup',
  repair: 'Pair Again and Connect',
  stop: 'Stop Local Service',
  footnote:
    'Closing the desktop window doesn’t delete data. Yuki’s computer (terminal, browser, and desktop) is installed too.',
} satisfies English<'localBot'>
