import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { LOGIN_PATH } from './api.js'
import AccountPage from './AccountPage.jsx'
import App from './App.jsx'
import CashPage from './CashPage.jsx'
import DrumPage from './DrumPage.jsx'
// FANTASY ISKLJUČEN dok ne ide live; bez ovog importa Fantasy fajlovi ne ulaze u build.
// import FantasyPage from './FantasyPage.jsx'
import FormaPage from './FormaPage.jsx'
import InstallPrompt from './InstallPrompt.jsx'
import Login from './Login.jsx'
import PlayersPage from './PlayersPage.jsx'
import { setupPwa } from './pwa.js'
import StatsPage from './StatsPage.jsx'

const path = window.location.pathname.replace(/\/+$/, '') || '/'

setupPwa()

function page() {
  if (path === LOGIN_PATH) return <Login />
  if (path === '/bubanj') return <DrumPage />
  if (path === '/igraci') return <PlayersPage />
  if (path === '/statistika') return <StatsPage />
  if (path === '/nalog') return <AccountPage />
  if (path === '/kasa') return <CashPage />
  // FANTASY ISKLJUČEN: if (path === '/fantasy') return <FantasyPage />
  if (path === '/forma') return <FormaPage />
  return <App />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {page()}
    {path !== LOGIN_PATH && <InstallPrompt />}
  </StrictMode>,
)
