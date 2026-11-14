import { ArrowUpRight, Copy } from 'lucide-react'
import type { ApiReply } from '../../shared/api'
import { Button } from '../components/Controls'
import { unwrap } from '../queries/client'
import { useTranslation } from '../i18n'
import styles from './TailscaleGuide.module.css'

const serverGuide =
  'https://github.com/YuanYeYouTao/Yuki-QQbot/blob/main/docs/operations/tailscale-connection.zh-CN.md'

export function TailscaleGuide({ onError }: { onError(message: string): void }) {
  const { t } = useTranslation(['pairing'])
  const serverCommand = t('pairing:tailscale.command')
  const act = (request: Promise<ApiReply<unknown>>) => {
    onError('')
    void request.then(unwrap).catch((failure: Error) => onError(failure.message))
  }
  return (
    <details className={styles.guide} aria-label={t('pairing:tailscale.label')}>
      <summary>{t('pairing:tailscale.summary')}</summary>
      <div className={styles.body}>
        <p>{t('pairing:tailscale.intro')}</p>
        <ol>
          <li>
            <strong>{t('pairing:tailscale.computerTitle')}</strong>
            <p>{t('pairing:tailscale.computer')}</p>
            <Button
              type="button"
              variant="plain"
              onClick={() => act(window.yuki.client.external('https://tailscale.com/download'))}
            >
              {t('pairing:tailscale.download')} <ArrowUpRight size={14} />
            </Button>
          </li>
          <li>
            <strong>{t('pairing:tailscale.serverTitle')}</strong>
            <p>{t('pairing:tailscale.server')}</p>
            <Button
              type="button"
              variant="plain"
              onClick={() => act(window.yuki.client.external(serverGuide))}
            >
              {t('pairing:tailscale.guide')} <ArrowUpRight size={14} />
            </Button>
            <p>{t('pairing:tailscale.commandIntro')}</p>
            <code>{serverCommand}</code>
            <Button
              type="button"
              variant="plain"
              onClick={() => act(window.yuki.client.copy(serverCommand))}
            >
              <Copy size={14} /> {t('pairing:tailscale.copyCommand')}
            </Button>
          </li>
          <li>
            <strong>{t('pairing:tailscale.connectTitle')}</strong>
            <p>{t('pairing:tailscale.connect')}</p>
          </li>
        </ol>
        <p>{t('pairing:tailscale.skip')}</p>
      </div>
    </details>
  )
}
