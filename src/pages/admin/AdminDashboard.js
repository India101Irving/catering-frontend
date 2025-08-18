// AdminDashboard.js
import React, { useEffect, useState } from 'react';
import Orders from './Orders';
import PriceConfig from './PriceConfig';
import HoursConfig from './HoursConfig';
import PackageConfig from './PackageConfig';

const TABS = ['Orders', 'Price Configuration', 'Package Configuration', 'Hours Configuration'];

export default function AdminDashboard(props) {
  const { signOut } = props;
  const [activeTab, setActiveTab] = useState('Orders');

  useEffect(() => {
    console.log('✅ AdminDashboard loaded');
    console.log('👀 signOut prop is:', typeof signOut);
  }, [signOut]);

  return (
    <div className="min-h-screen bg-[#2C2525] text-white p-6 overflow-x-hidden">
      {/* Header */}
      <div className="absolute top-4 right-6 text-right">
        <span> Welcome Admin </span>
        <button
          onClick={() => { console.log('signout clicked'); signOut?.(); }}
          className="text-white bg-red-700 hover:bg-red-800 px-4 py-1 rounded text-sm font-medium"
        >
          Sign Out
        </button>
      </div>

      <h1 className="text-2xl font-bold text-[#F58735] mb-4">
        India 101 ODC Pricing & Orders
      </h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b border-[#3A2D2D]">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-t-md ${
              activeTab === tab
                ? 'bg-[#2E2424] border-x border-t border-[#3A2D2D]'
                : 'text-neutral-300 hover:text-white'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Orders'         && <Orders />}
      {activeTab === 'Price Configuration'  && <PriceConfig {...props} />}
      {activeTab === 'Package Configuration' && <PackageConfig {...props} />}
      {activeTab === 'Hours Configuration'          && <HoursConfig />}
    </div>
  );
}
