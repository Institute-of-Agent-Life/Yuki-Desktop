import { useSessionActive } from '../state/workspace'
import { useEffect, useRef, useState } from 'react'
import { Button, Banner } from '../components/Controls'
import { unwrap } from '../queries/client'
import styles from './VoiceRecorder.module.css'
import { useTranslation } from '../i18n'

export function VoiceRecorder({
  id,
  done,
  cancel,
  finish,
}: {
  id: string
  done(): void
  cancel(): void
  finish: { current: (() => void) | undefined }
}) {
  // The recording reads its messages through `i18n`, which a language switch keeps, so it goes on.
  const { t, i18n } = useTranslation(['media'])
  const active = useSessionActive()
  const visible = useRef(active)
  visible.current = active
  useEffect(() => {
    if (!active) {
      if (finish.current) finish.current()
      else cancel()
    }
  }, [active, cancel, finish])
  const [seconds, setSeconds] = useState(0),
    [levels, setLevels] = useState<number[]>([]),
    [error, setError] = useState(''),
    canceled = useRef(false)
  useEffect(() => {
    let stream: MediaStream | undefined,
      recorder: MediaRecorder | undefined,
      context: AudioContext | undefined,
      animation = 0,
      disposed = false
    const abort = () => {
      canceled.current = true
      recorder?.stop()
      cancel()
    }
    const keyboard = (event: KeyboardEvent) => {
      if (visible.current && event.key === 'Escape') {
        event.preventDefault()
        abort()
      }
    }
    window.addEventListener('keydown', keyboard)
    void (async () => {
      unwrap(await window.yuki.client.microphone())
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (disposed) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 64
      context.createMediaStreamSource(stream).connect(analyser)
      const samples = new Uint8Array(analyser.frequencyBinCount),
        started = performance.now()
      let last = 0
      const draw = () => {
        if (performance.now() - last > 80) {
          analyser.getByteTimeDomainData(samples)
          setLevels(Array.from(samples, (value) => Math.abs(value - 128) / 128))
          setSeconds(Math.floor((performance.now() - started) / 1000))
          last = performance.now()
        }
        animation = requestAnimationFrame(draw)
      }
      draw()
      const mimeType = 'audio/webm;codecs=opus'
      if (!MediaRecorder.isTypeSupported(mimeType)) throw new Error(i18n.t('media:noOpus'))
      recorder = new MediaRecorder(stream, { mimeType })
      const chunks: BlobPart[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      recorder.onstop = () => {
        stream?.getTracks().forEach((track) => track.stop())
        cancelAnimationFrame(animation)
        void context?.close()
        if (!canceled.current && !disposed)
          void new Blob(chunks, { type: mimeType })
            .arrayBuffer()
            .then((bytes) => window.yuki.client.record(id, new Uint8Array(bytes)))
            .then(unwrap)
            .then(done)
            .catch((error) => setError(error.message))
      }
      recorder.onerror = () => {
        setError(i18n.t('media:recordingInterrupted'))
        abort()
      }
      recorder.start()
      finish.current = () => {
        if (recorder?.state === 'recording') recorder.stop()
      }
    })().catch((error) => {
      stream?.getTracks().forEach((track) => track.stop())
      void context?.close()
      setError(error instanceof Error ? error.message : i18n.t('media:noMicrophone'))
    })
    return () => {
      disposed = true
      canceled.current = true
      finish.current = undefined
      window.removeEventListener('keydown', keyboard)
      cancelAnimationFrame(animation)
      if (recorder?.state === 'recording') recorder.stop()
      stream?.getTracks().forEach((track) => track.stop())
      if (context?.state !== 'closed') void context?.close()
    }
  }, [id, done, cancel, finish, i18n])
  return (
    <div className={styles.recording}>
      {error ? (
        <Banner status="failed">{error}</Banner>
      ) : (
        <>
          <span role="status">
            {t('media:recording', {
              time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
            })}
          </span>
          <div className={styles.wave} aria-label={t('media:microphoneLevel')}>
            {levels.map((value, index) => (
              <i key={index} style={{ height: `${Math.max(2, value * 32)}px` }} />
            ))}
          </div>
        </>
      )}
      <Button
        variant="plain"
        onClick={() => {
          canceled.current = true
          cancel()
        }}
      >
        {t('media:cancelRecording')}
      </Button>
      {!error && <Button onClick={() => finish.current?.()}>{t('media:finishRecording')}</Button>}
    </div>
  )
}
