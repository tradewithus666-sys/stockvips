import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './lib/AuthContext.jsx';
import { ToastProvider } from './lib/ToastContext.jsx';
import { LangProvider } from './lib/LangContext.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <LangProvider>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </LangProvider>
    </BrowserRouter>
  </React.StrictMode>
);
