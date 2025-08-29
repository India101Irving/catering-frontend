import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Amplify } from 'aws-amplify';
import awsExports from './aws-exports';
import App from './App';
import './index.css';

// Keep your existing Amplify configuration style
Amplify.configure(awsExports);

// ✅ Set a default tab title for the whole app
if (typeof document !== 'undefined') {
  document.title = 'India 101 Catering';
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
