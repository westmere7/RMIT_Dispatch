import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { DialogProvider } from './components/Dialog';
import { ThemeProvider } from './lib/theme';
import { AuthProvider } from './store/auth';
import { SpacesProvider } from './store/spaces';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <DialogProvider>
        <AuthProvider>
          <SpacesProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </SpacesProvider>
        </AuthProvider>
      </DialogProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
