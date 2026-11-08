import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { UpdateBanner } from './components/common/UpdateBanner'
import { LiveSync } from './components/common/LiveSync'
import { RecoveryGate } from './components/common/RecoveryGate'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
      <UpdateBanner />
      <LiveSync />
      <RecoveryGate />
    </AuthProvider>
  </React.StrictMode>,
)
