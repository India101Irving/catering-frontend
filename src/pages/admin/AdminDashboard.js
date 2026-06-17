// AdminDashboard.js
import React, { useEffect, useState } from 'react';
import Orders from './Orders';
import PriceConfig from './PriceConfig';
import HoursConfig from './HoursConfig';
import PackageConfig from './PackageConfig';
import WhatsCooking from './WhatsCooking';
import Communications from './Communications';
import Wordmark from '../../components/ui/Wordmark';

const TABS = [
  { id: 'Orders', label: 'Orders' },
  { id: 'Price Configuration', label: 'Pricing' },
  { id: 'Package Configuration', label: 'Packages' },
  { id: 'Hours Configuration', label: 'Hours' },
  { id: "What's Cooking", label: "What's Cooking" },
  { id: 'Communications', label: 'Communications' },
];

export default function AdminDashboard(props) {
  const { signOut } = props;
  const [activeTab, setActiveTab] = useState('Orders');

  useEffect(() => {
    console.log('✅ AdminDashboard loaded');
  }, [signOut]);

  return (
    <div className="min-h-screen bg-[color:var(--page)] text-white pb-[env(safe-area-inset-bottom)] overflow-x-hidden">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-[color:var(--line)] bg-[color:var(--page)]/95 backdrop-blur supports-[backdrop-filter]:bg-[color:var(--page)]/80">
        <div className="mx-auto max-w-[1400px] px-4 md:px-6 h-16 flex items-center justify-between gap-4">
          <Wordmark sub="Catering" />
          <button onClick={() => signOut?.()} className="ui-btn-outline ui-btn-sm">
            Sign out
          </button>
        </div>

        {/* Tabs */}
        <div className="mx-auto max-w-[1400px] px-2 md:px-6">
          <div className="flex gap-1 overflow-x-auto no-scrollbar pb-2">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`ui-tab ${activeTab === tab.id ? 'ui-tab-active' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-[1400px] px-4 md:px-6 py-5 md:py-7 fade-in">
        {activeTab === 'Orders' && <Orders />}
        {activeTab === 'Price Configuration' && <PriceConfig {...props} />}
        {activeTab === 'Package Configuration' && <PackageConfig {...props} />}
        {activeTab === 'Hours Configuration' && <HoursConfig />}
        {activeTab === "What's Cooking" && <WhatsCooking />}
        {activeTab === 'Communications' && <Communications />}
      </main>
    </div>
  );
}
