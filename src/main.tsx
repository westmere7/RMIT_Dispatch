import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { DialogProvider } from './components/Dialog';
import { ThemeProvider } from './lib/theme';
import { AuthProvider } from './store/auth';
import { SettingsProvider } from './store/settings';
import { SpacesProvider } from './store/spaces';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';

// Auth sits above Settings (settings are per account), and Settings above
// Theme (the theme is one of those settings).
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <SettingsProvider>
        <ThemeProvider>
          <DialogProvider>
            <SpacesProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </SpacesProvider>
          </DialogProvider>
        </ThemeProvider>
      </SettingsProvider>
    </AuthProvider>
  </React.StrictMode>,
);
