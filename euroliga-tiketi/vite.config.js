import { cpSync } from 'node:fs'
import { basename } from 'node:path'
import process from 'node:process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Poslije builda dist/ sadrži sve što ide na server: aplikaciju, .htaccess i PHP API.
// config.local.php (lozinka baze) se nikad ne kopira; na serveru se pravi ručno.
function copyApi() {
  return {
    name: 'copy-api',
    apply: 'build',
    closeBundle() {
      cpSync('api', 'dist/api', {
        recursive: true,
        filter: (source) => basename(source) !== 'config.local.php',
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), copyApi()],
  server: {
    // PHP API (npm run api) radi na portu 8000 i koristi MySQL iz Laragona.
    // API_TARGET omogućava da se testira drugi API, npr. nad test bazom.
    proxy: {
      '/api': process.env.API_TARGET ?? 'http://127.0.0.1:8000',
    },
  },
})
