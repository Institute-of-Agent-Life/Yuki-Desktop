import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { UpdateState } from '../../shared/updates'
import { unwrap } from '../queries/client'
const context = createContext<{ state?: UpdateState; error: string; reload(): Promise<void> }>({
  error: '',
  reload: async () => {},
})
export const useUpdates = () => useContext(context)
export function UpdateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UpdateState>()
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const reload = useCallback(async () => {
    const request = ++sequence.current
    try {
      const value = unwrap(await window.yuki.updates.state())
      if (request === sequence.current) {
        setState(value)
        setError('')
      }
    } catch {
      if (request === sequence.current) setError('無法讀取更新狀態。')
    }
  }, [])
  useEffect(() => {
    const unsubscribe = window.yuki.updates.onChange((value) => {
      sequence.current++
      setState(value)
      setError('')
    })
    void reload()
    return () => {
      sequence.current++
      unsubscribe()
    }
  }, [reload])
  return <context.Provider value={{ state, error, reload }}>{children}</context.Provider>
}
