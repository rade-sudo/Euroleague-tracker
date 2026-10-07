import { useEffect } from 'react'
import { api } from './api.js'

// Dugme "Nazad" (i poslije odjave) vraća stranicu iz keša pregledača bez ijednog poziva serveru.
// Zato je sakrivamo pri odlasku i ponovo učitavamo pri povratku; bez sesije /me vodi na prijavu.
// Pri povratku na tab provjeravamo sesiju, za slučaj odjave u drugom tabu ili isteka.
export function useSessionGuard() {
  useEffect(() => {
    function handlePageHide() {
      document.documentElement.style.visibility = 'hidden'
    }
    function handlePageShow(event) {
      if (event.persisted) window.location.reload()
    }
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') api('/me').catch(() => {})
    }
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('pageshow', handlePageShow)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('pageshow', handlePageShow)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])
}
