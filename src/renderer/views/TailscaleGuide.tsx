import { ArrowUpRight, Copy } from 'lucide-react'
import type { ApiReply } from '../../shared/api'
import { Button } from '../components/Controls'
import { unwrap } from '../queries/client'
import styles from './TailscaleGuide.module.css'

const serverGuide =
  'https://github.com/YuanYeYouTao/Yuki-QQbot/blob/main/docs/operations/tailscale-connection.zh-CN.md'
const serverCommand =
  'sudo tailscale serve --bg --https=<HTTPS連接埠> http://127.0.0.1:<Yuki宿主連接埠>'

export function TailscaleGuide({ onError }: { onError(message: string): void }) {
  const act = (request: Promise<ApiReply<unknown>>) => {
    onError('')
    void request.then(unwrap).catch((failure: Error) => onError(failure.message))
  }
  return (
    <details className={styles.guide} aria-label="Tailscale 連接說明">
      <summary>透過 Tailscale 連接</summary>
      <div className={styles.body}>
        <p>
          這台電腦和執行 Yuki 的伺服器加入可互通的 Tailscale 網路後，就能使用伺服器的 HTTPS 網址。
        </p>
        <ol>
          <li>
            <strong>準備這台電腦</strong>
            <p>安裝官方 Tailscale，開啟並登入，加入伺服器所在的網路。</p>
            <Button
              type="button"
              variant="plain"
              onClick={() => act(window.yuki.client.external('https://tailscale.com/download'))}
            >
              下載 Tailscale <ArrowUpRight size={14} />
            </Button>
          </li>
          <li>
            <strong>在執行 Yuki 的伺服器操作</strong>
            <p>請部署者依指南安裝、登入並發布 Yuki。先確認實際連接埠，保留伺服器已有的發布設定。</p>
            <Button
              type="button"
              variant="plain"
              onClick={() => act(window.yuki.client.external(serverGuide))}
            >
              伺服器接入指南 <ArrowUpRight size={14} />
            </Button>
            <p>以下是伺服器指令範本，請部署者先替換兩個連接埠，再到執行 Yuki 的伺服器操作。</p>
            <code>{serverCommand}</code>
            <Button
              type="button"
              variant="plain"
              onClick={() => act(window.yuki.client.copy(serverCommand))}
            >
              <Copy size={14} /> 複製伺服器指令範本
            </Button>
          </li>
          <li>
            <strong>使用原有欄位連接</strong>
            <p>
              填寫實際的 HTTPS 網址或貼上原配對連結，再依原流程確認
              Yuki。已有連線可從伺服器位址旁選擇「更改…」。
            </p>
          </li>
        </ol>
        <p>已有可用的伺服器位址或配對連結，可以直接繼續，不必先完成這份說明。</p>
      </div>
    </details>
  )
}
