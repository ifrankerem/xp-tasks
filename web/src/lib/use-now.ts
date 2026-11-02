import { useEffect, useState } from 'react'

export function useNow() {
  const [, refresh] = useState(0)
  useEffect(() => {
    const update = () => refresh((version) => version + 1)
    document.addEventListener('visibilitychange', update)
    const timer = window.setInterval(update, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', update)
      clearInterval(timer)
    }
  }, [])
  return new Date()
}
