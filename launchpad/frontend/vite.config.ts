import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import services from '../../services.json'

export default defineConfig({
  plugins: [react()],
  server: { port: services.services["launchpad-frontend"].port, host: '127.0.0.1' },
})
