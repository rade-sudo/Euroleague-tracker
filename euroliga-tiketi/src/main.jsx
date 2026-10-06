import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { LOGIN_PATH } from './api.js'
import App from './App.jsx'
import Login from './Login.jsx'

const isLoginPage = window.location.pathname.replace(/\/+$/, '') === LOGIN_PATH

createRoot(document.getElementById('root')).render(
  <StrictMode>{isLoginPage ? <Login /> : <App />}</StrictMode>,
)
