import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { LOGIN_PATH } from './api.js'
import AccountPage from './AccountPage.jsx'
import App from './App.jsx'
import DrumPage from './DrumPage.jsx'
import Login from './Login.jsx'
import PlayersPage from './PlayersPage.jsx'
import StatsPage from './StatsPage.jsx'

const path = window.location.pathname.replace(/\/+$/, '') || '/'

function page() {
  if (path === LOGIN_PATH) return <Login />
  if (path === '/bubanj') return <DrumPage />
  if (path === '/igraci') return <PlayersPage />
  if (path === '/statistika') return <StatsPage />
  if (path === '/nalog') return <AccountPage />
  return <App />
}

createRoot(document.getElementById('root')).render(<StrictMode>{page()}</StrictMode>)
