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
    <div className="min-h-screen bg-[#2C2525] text-white p-4 md:p-6 pb-[env(safe-area-inset-bottom)] overflow-x-hidden">
      {/* Header */}
      <div className="md:absolute md:top-4 md:right-6 md:text-right mb-3 md:mb-0 flex items-center justify-between gap-3">
        <span className="text-sm md:text-base">Welcome Admin</span>
        <button
          onClick={() => { console.log('signout clicked'); signOut?.(); }}
          className="text-white bg-red-700 hover:bg-red-800 px-3 md:px-4 py-2 md:py-1 rounded text-sm font-medium"
        >
          Sign Out
        </button>
      </div>

      <h1 className="text-xl md:text-2xl font-bold text-[#F58735] mb-3 md:mb-4 mt-1 md:mt-10">
        India 101 ODC Pricing &amp; Orders
      </h1>

      {/* Tabs */}
      <div className="mb-4 border-b border-[#3A2D2D] -mx-2 md:mx-0">
        <div className="flex gap-2 overflow-x-auto no-scrollbar px-2 md:px-0">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`shrink-0 whitespace-nowrap px-3 md:px-4 py-2 rounded-t-md ${
                activeTab === tab
                  ? 'bg-[#2E2424] border-x border-t border-[#3A2D2D]'
                  : 'text-neutral-300 hover:text-white'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'Orders'                && <Orders />}
      {activeTab === 'Price Configuration'   && <PriceConfig {...props} />}
      {activeTab === 'Package Configuration' && <PackageConfig {...props} />}
      {activeTab === 'Hours Configuration'   && <HoursConfig />}
    </div>
  );
}
