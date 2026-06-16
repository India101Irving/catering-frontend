import React from 'react';

/**
 * INDIA | 101 wordmark — matches the public portal's brand lockup
 * (orange INDIA · thin divider rule · orange 101 on charcoal).
 */
export default function Wordmark({ className = '', sub }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className="font-display text-xl md:text-2xl font-semibold tracking-wide leading-none">
        <span className="text-brand">INDIA</span>
        <span className="mx-2 inline-block h-5 w-px align-middle bg-brand/70" />
        <span className="text-brand">101</span>
      </span>
      {sub && (
        <span className="hidden sm:inline text-xs font-medium uppercase tracking-[0.2em] text-neutral-400 border-l border-[color:var(--line)] pl-3">
          {sub}
        </span>
      )}
    </div>
  );
}
