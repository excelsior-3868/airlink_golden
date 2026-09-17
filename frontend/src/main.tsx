import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import { BrandingProvider } from './lib/branding'
import PwaUpdater from './components/PwaUpdater'
import InstallPrompt from './components/InstallPrompt'
import BottomDock from './components/BottomDock'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <BrandingProvider>
          <App />
          <BottomDock>
            <InstallPrompt />
            <PwaUpdater />
          </BottomDock>
        </BrandingProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
