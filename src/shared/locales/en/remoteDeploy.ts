// "Deploy to my server": installing Yuki on the person's server over SSH.
import type { English } from '../types'

export default {
  deploy: 'Deploy to My Server',
  deployDescription:
    'All it takes is a cloud server’s IP and root password: this app installs Docker and Yuki over SSH, pairs, and opens the chat.',
  title: 'Deploy to My Server',
  notBundled: 'This development build has no deployment package; use a full test build.',
  checkEnvironment: 'Confirm and Check Server',
  environment: 'Server environment',
  system: 'System',
  memory: 'Memory',
  disk: 'Free disk',
  mebibytes: '{{value}} MiB',
  dockerInstalled: 'Docker is installed',
  dockerMissing: 'Docker is not installed',
  unsupportedSystem: 'Only x86_64 or arm64 Linux servers are supported.',
  installDocker: 'Install Docker',
  mirrorExplain:
    'Servers in mainland China often cannot reach Docker’s official source. Docker can be installed from a domestic mirror (Aliyun) instead; retry once you confirm.',
  mirrorRetry: 'Retry with Domestic Mirror',
  prepareImage: 'Next: Prepare Yuki Image',
  retryStep: 'Retry This Step',
  characterName: 'Yuki’s name',
  personName: 'Your name',
  preset: 'Service preset',
  sandbox: 'Yuki’s computer',
  sandboxDesktop: 'Full desktop you can watch and take over (about 3 GiB of memory)',
  sandboxHeadless: 'Headless browser (about 1 GiB)',
  sandboxLite: 'Terminal and files only (about 512 MiB)',
  sandboxRecommended:
    'Preselected for this server’s memory; choose a smaller one if memory is short.',
  start: 'Start Deployment',
  back: 'Back / Set Up Later',
  intro: 'Install Yuki on your Linux server and start chatting when it is done.',
  introDetails:
    'You need an x86_64 or arm64 Linux server (2 GiB of memory or more recommended) and root or an account with passwordless sudo. The server does not need to reach GitHub: this app uploads the installer and deployment package.',
  introSummary: 'What you need',
  summary: '{{os}} {{arch}} · {{memory}} MiB memory · {{disk}} MiB free disk',
  progress: {
    upload: 'Uploading the installer and deployment package',
    install:
      'Installing Yuki on the server; pulling images and starting Yuki’s computer can take a few minutes',
    pair: 'Creating your entry',
    connect: 'Opening the SSH tunnel and connecting',
  },
} satisfies English<'remoteDeploy'>
