import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import type { CharacterCommand, CharacterCommandItem, Profile } from '../../shared/api'
import { Banner, Button, TextField } from '../components/Controls'
import { problemText, unwrap } from '../queries/client'
import { CharacterAvatar } from '../components/CharacterAvatar'
import styles from './About.module.css'

export function About({
  id,
  profile,
  editSoul,
}: {
  id: string
  profile: Profile
  editSoul(): void
}) {
  const query = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const commands = useQuery({
    queryKey: [id, 'character-commands'],
    queryFn: () => window.yuki.client.characterCommands(id).then(unwrap),
  })
  const refresh = async () => {
    await Promise.all(
      ['character', 'character-commands', 'events'].map((key) =>
        query.invalidateQueries({ queryKey: [id, key] }),
      ),
    )
  }
  const run = async (command: CharacterCommand) => {
    setBusy(true)
    setError('')
    try {
      const item = unwrap(await window.yuki.client.characterCommand(id, command))
      await refresh()
      if (item.problem || item.state !== 'result')
        setError(
          item.state !== 'result'
            ? '送出結果尚未確認。請查證原請求；內容已保留在這台電腦。'
            : problemText(item.problem!),
        )
      return item
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作未完成。')
      return undefined
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={styles.about}>
      <div className={styles.inner}>
        <header className={styles.hero}>
          <div className={styles.portrait}>
            <CharacterAvatar size={200} />
          </div>
          <div className={styles.introduction}>
            <div className={styles.name}>
              <h1>{profile.display_name}</h1>
              {profile.viewer.is_owner && !editing && (
                <Button variant="plain" aria-label="編輯角色資料" onClick={() => setEditing(true)}>
                  <Pencil size={14} />
                  編輯
                </Button>
              )}
            </div>
            {editing && profile.viewer.is_owner ? (
              <ProfileEditor
                key={profile.id}
                profile={profile}
                busy={busy}
                save={run}
                close={() => setEditing(false)}
                refresh={refresh}
              />
            ) : (
              <>
                <p>{profile.bio}</p>
                {profile.viewer.is_owner && (
                  <div className={styles.heroActions}>
                    <Button onClick={editSoul}>編輯提示詞</Button>
                  </div>
                )}
              </>
            )}
          </div>
        </header>
        {error && <Banner status="failed">{error}</Banner>}
        {commands.data
          ?.filter((item) => item.state !== 'result' && item.command.kind === 'profile')
          .map((item) => (
            <div key={item.requestId} className={styles.pending} role="status">
              <span>角色資料變更：結果尚未確認</span>
              <Button
                loading={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const result = unwrap(
                      await window.yuki.client.verifyCharacterCommand(id, item.requestId),
                    )
                    setError(
                      result.problem
                        ? problemText(result.problem)
                        : result.state === 'result'
                          ? ''
                          : '原請求仍在處理中。',
                    )
                    await refresh()
                  } catch (error) {
                    setError(error instanceof Error ? error.message : '無法查證原請求。')
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                查證原請求
              </Button>
            </div>
          ))}
      </div>
    </div>
  )
}

type Run = (command: CharacterCommand) => Promise<CharacterCommandItem | undefined>
function ProfileEditor({
  profile,
  busy,
  save,
  close,
  refresh,
}: {
  profile: Profile
  busy: boolean
  save: Run
  close: () => void
  refresh: () => Promise<void>
}) {
  // Capture the document shown when editing began. A remote refresh cannot change this CAS baseline.
  const [base] = useState(profile)
  const [name, setName] = useState(base.display_name)
  const [bio, setBio] = useState(base.bio)
  const [light, setLight] = useState(base.accent.light)
  const [dark, setDark] = useState(base.accent.dark)
  const [conflict, setConflict] = useState(false)
  return (
    <form
      className={styles.editor}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          event.stopPropagation()
          close()
        }
      }}
      onSubmit={async (event) => {
        event.preventDefault()
        const result = await save({
          kind: 'profile',
          expectedRevision: base.revision,
          displayName: name,
          bio,
          accent: { light, dark },
        })
        if (result?.state === 'result' && !result.problem) close()
        else setConflict(result?.problem === 'version_conflict')
      }}
    >
      <label>
        名稱
        <TextField autoFocus value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        簡介
        <textarea value={bio} onChange={(event) => setBio(event.target.value)} />
      </label>
      <div className={styles.colors}>
        <label>
          淺色外觀
          <input type="color" value={light} onChange={(event) => setLight(event.target.value)} />
        </label>
        <label>
          深色外觀
          <input type="color" value={dark} onChange={(event) => setDark(event.target.value)} />
        </label>
      </div>
      {conflict && (
        <Banner status="waiting">角色資料已更新。你的輸入仍保留，儲存仍使用編輯前的版本。</Banner>
      )}
      <div className={styles.actions}>
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            void refresh()
            close()
          }}
        >
          {conflict ? '放棄並重新讀取' : '取消'}
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          儲存
        </Button>
      </div>
    </form>
  )
}
