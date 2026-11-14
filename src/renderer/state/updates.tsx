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
const context = createContext<{ state?: UpdateState; failed: boolean; reload(): Promise<void> }>({
  failed: false,
  reload: async () => {},
})
export const useUpdates = () => useContext(context)
export function UpdateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UpdateState>()
  const [failed, setFailed] = useState(false)
  const sequence = useRef(0)
  const reload = useCallback(async () => {
    const request = ++sequence.current
    try {
      const value = unwrap(await window.yuki.updates.state())
      if (request === sequence.current) {
        setState(value)
        setFailed(false)
      }
    } catch {
      if (request === sequence.current) setFailed(true)
    }
  }, [])
  useEffect(() => {
    const unsubscribe = window.yuki.updates.onChange((value) => {
      sequence.current++
      setState(value)
      setFailed(false)
    })
    void reload()
    return () => {
      sequence.current++
      unsubscribe()
    }
  }, [reload])
  return <context.Provider value={{ state, failed, reload }}>{children}</context.Provider>
}
