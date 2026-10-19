import { useEffect, useRef, useState } from 'react'
import { Button, Banner } from '../components/Controls'
import { unwrap } from '../queries/client'
import styles from './VoiceRecorder.module.css'

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
      if (event.key === 'Escape') {
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
      if (!MediaRecorder.isTypeSupported(mimeType))
        throw new Error('這台電腦目前無法錄製 Opus 語音。')
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
        setError('錄音中斷，請重新開始。')
        abort()
      }
      recorder.start()
      finish.current = () => {
        if (recorder?.state === 'recording') recorder.stop()
      }
    })().catch((error) => {
      stream?.getTracks().forEach((track) => track.stop())
      void context?.close()
      setError(error instanceof Error ? error.message : '無法使用麥克風。')
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
  }, [id, done, cancel, finish])
  return (
    <div className={styles.recording}>
      {error ? (
        <Banner status="failed">{error}</Banner>
      ) : (
        <>
          <span role="status">
            錄音 {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
          </span>
          <div className={styles.wave} aria-label="麥克風音量">
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
        取消錄音
      </Button>
      {!error && <Button onClick={() => finish.current?.()}>結束錄音</Button>}
    </div>
  )
}
