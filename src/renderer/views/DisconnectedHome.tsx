import type { ReactNode } from 'react'
import { BriefcaseBusiness, Folder, MessageCircle, Monitor, Laptop, Snowflake } from 'lucide-react'
import { Button } from '../components/Controls'
import { Workspace } from '../components/Workspace'
import { PresenceCard } from '../components/PresenceCard'
import { useWorkspace } from '../state/workspace'
import { useTranslation } from '../i18n'
import styles from './DisconnectedHome.module.css'

export function DisconnectedHome({
  platform,
  connect,
  deploy,
  deployRemote,
  onSettings,
  help,
  roleSwitcher,
}: {
  platform: string
  connect(): void
  deploy(): void
  deployRemote(): void
  onSettings(): void
  help(): void
  roleSwitcher?: (trigger: ReactNode) => ReactNode
}) {
  const view = useWorkspace((state) => state.view)
  const { t } = useTranslation(['home', 'remoteDeploy'])
  // Settings has no page of its own here; it shows the conversation page.
  const page = view === 'settings' ? 'chat' : view
  const Icon =
    view === 'works'
      ? BriefcaseBusiness
      : view === 'files'
        ? Folder
        : view === 'computer'
          ? Monitor
          : view === 'local'
            ? Laptop
            : view === 'about'
              ? Snowflake
              : MessageCircle
  return (
    <Workspace
      name="Yuki Desktop"
      avatar={<Snowflake size={28} strokeWidth={1.5} aria-hidden="true" />}
      status={t('home:notConnected')}
      presence="offline"
      platform={platform}
      roleSwitcher={roleSwitcher?.(
        <PresenceCard
          name="Yuki Desktop"
          status={t('home:notConnected')}
          color="offline"
          avatar={<Snowflake size={28} strokeWidth={1.5} aria-hidden="true" />}
        />,
      )}
      onSettings={onSettings}
      toolbar={<strong className={styles.toolbarTitle}>{t(`home:title.${page}`)}</strong>}
      inspectorTitle={t('home:notConnected')}
      inspector={<p className={styles.inspectorEmpty}>{t('home:inspectorEmpty')}</p>}
    >
      <section className={styles.empty} aria-labelledby="disconnected-heading">
        <Icon className={styles.mark} size={40} strokeWidth={1.25} aria-hidden="true" />
        <h1 id="disconnected-heading">{t(`home:heading.${page}`)}</h1>
        <p className={styles.description}>{t(`home:description.${page}`)}</p>
        <div className={styles.actions}>
          <Button variant="primary" large onClick={connect}>
            {t('home:connect')}
          </Button>
          <Button large onClick={deploy}>
            {t('home:deploy')}
          </Button>
          <Button large onClick={deployRemote}>
            {t('remoteDeploy:deploy')}
          </Button>
        </div>
        <p className={styles.hint}>{t('home:hint')}</p>
        <Button variant="plain" onClick={help}>
          {t('home:help')}
        </Button>
      </section>
    </Workspace>
  )
}
