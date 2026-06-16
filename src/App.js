import React, { useEffect, useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { signOut as amplifySignOut, fetchAuthSession } from 'aws-amplify/auth';
import { uploadData } from 'aws-amplify/storage';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

import AdminDashboard from './pages/admin/AdminDashboard';
import RequireAdmin from './components/RequireAdmin';
import { ENDPOINTS } from './config/endpoints';
// OLD: import CustomerWizard from './pages/CustomerWizard';
import IndexChooser   from './pages/index';
import OrderTrays     from './pages/OrderTrays';
import OrderPackage   from './pages/OrderPackage';
import Checkout from './pages/Checkout';
import Payment from './pages/Payment';
import ThankYou from './pages/ThankYou';

import SignIn from './pages/SignIn';





function AppContent() {
  const [userSession, setUserSession] = useState(null);
  const [products, setProducts] = useState({});
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  const fetchData = async () => {
    const url = ENDPOINTS.getProducts;
    try {
      const response = await fetch(url);
      const data = await response.json();
      setProducts(data);
    } catch (error) {
      console.error('Error fetching data:', error);
      setProducts({});
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // The admin console has its own hostname (admin.india101.com). When the app is
  // opened on that host at the root, send the user straight to /admin.
  useEffect(() => {
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    if (host.startsWith('admin.') && location.pathname === '/') {
      navigate('/admin', { replace: true });
    }
  }, [location.pathname, navigate]);

  const handleSignOut = async () => {
    try {
      console.log('🔓 Signing out from AdminDashboard');
      await amplifySignOut();
      navigate('/');
    } catch (err) {
      console.error('Sign-out error', err);
    }
  };

  const handleFileUpload = async (file) => {
    console.log('📁 Uploading file:', file.name);
    try {
      setUploading(true);
      const key = `admin/price-sheets/${file.name}`;
      const result = await uploadData({
        key,
        data: file,
        options: { contentType: file.type },
      }).result;

      console.log('✅ Upload success:', result);
      setMessage('Upload successful!');
      await fetchData();
    } catch (err) {
      console.error('❌ Upload failed', err);
      setMessage('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Routes>
      {/* New 3-page customer flow */}
      <Route path="/" element={<IndexChooser />} />
      <Route path="/signin" element={<SignIn />} />

      <Route path="/OrderTrays" element={<OrderTrays />} />
      <Route path="/OrderPackage" element={<OrderPackage />} />

      {/* Keep both to be safe with existing links */}
      <Route path="/checkout" element={<Checkout />} />
      <Route path="/Checkout" element={<Checkout />} />

      <Route path="/payment" element={<Payment />} />
      <Route path="/thank-you" element={<ThankYou />} />

      {/* Admin route with original props preserved */}
      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminDashboard
              user={userSession}
              signOut={handleSignOut}
              products={products}
              handleRefresh={fetchData}
              uploading={uploading}
              handleFileUpload={handleFileUpload}
              message={message}
              setMessage={setMessage}
            />
          </RequireAdmin>
        }
      />
    </Routes>
  );
}

export default function App() {
  // NOTE: Do NOT wrap with <BrowserRouter> here if index.js already does.
  return <AppContent />;
}
