import React, { useMemo, useState } from 'react';

/* expects { item, onAdd(sizeKey, qty, unitPrice, { spiceLevel }) } */
export default function TrayCard({ item, onAdd }) {
  const sizes = useMemo(
    () =>
      [
        { key: 'SmallTray',      label: 'Small',  price: Number(item.SmallTray) },
        { key: 'MediumTray',     label: 'Medium', price: Number(item.MediumTray) },
        { key: 'LargeTray',      label: 'Large',  price: Number(item.LargeTray) },
        { key: 'ExtraLargeTray', label: 'XL',     price: Number(item.ExtraLargeTray) },
      ].filter((s) => !!s.price),
    [item]
  );

  const isPerPiece = item.Type === 'pc';
  const showSpice = (item.Category || '').toLowerCase() === 'main course';

  // Non-Veg detection (by name keywords)
  const nonVeg = useMemo(() => {
    const name = String(item.Item || '').toLowerCase();
    const tokens = ['chicken','goat','lamb','fish','prawn','murg','mutton','murgh','ghost','maans','macchi','sea food','shrimp'];
    return tokens.some(t => name.includes(t));
  }, [item]);

  const [size, setSize] = useState(isPerPiece ? 'per-piece' : (sizes[0]?.key ?? ''));
  const [spice, setSpice] = useState('Medium'); // Mild | Medium | Spicy (default Medium)

  // ---- Quantity: keep string for input, derive number for logic ----
  const [qtyStr, setQtyStr] = useState('1');
  const qtyNum = useMemo(() => {
    const n = Number(qtyStr);
    if (!Number.isFinite(n)) return 0;
    return Math.floor(n);
  }, [qtyStr]);

  const unit = useMemo(() => {
    if (isPerPiece) return Number(item.SalePrice) || 0;
    return Number(item[size]) || 0;
  }, [isPerPiece, item, size]);

  const canAdd = useMemo(() => {
    if (qtyNum < 1) return false;
    if (!isPerPiece && !size) return false;
    if (!unit || Number.isNaN(unit)) return false;
    return true;
  }, [qtyNum, isPerPiece, size, unit]);

  // --- Qty handlers (mobile-friendly) ---
  const clamp = (n) => (n < 1 ? 1 : n);
  const handleQtyChange = (e) => {
    const raw = e.target.value;

    // Allow empty string while typing (so backspace clears)
    if (raw === '') { setQtyStr(''); return; }

    // Accept only digits
    if (!/^\d+$/.test(raw)) return;

    // Normalize: remove leading zeros
    const normalized = String(parseInt(raw, 10));
    setQtyStr(normalized);
  };
  const handleQtyBlur = () => {
    if (qtyStr === '' || !/^\d+$/.test(qtyStr)) { setQtyStr('1'); return; }
    const n = clamp(parseInt(qtyStr, 10));
    setQtyStr(String(n));
  };
  const inc = () => {
    const n = clamp(qtyNum || 0) + 1;
    setQtyStr(String(n));
  };
  const dec = () => {
    const n = clamp((qtyNum || 1) - 1);
    setQtyStr(String(n));
  };

  return (
    <div className="bg-[#2c2a2a] rounded-lg p-4 shadow h-full flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">{item.Item}</h3>
          {item.Description ? (
            <p className="text-sm text-gray-300 mt-1">{item.Description}</p>
          ) : (
            <p className="text-sm text-gray-400" />
          )}
        </div>
        {nonVeg && (
          <span className="ml-2 shrink-0 text-[11px] uppercase tracking-wide bg-red-500/20 text-red-300 border border-red-400/40 rounded px-2 py-0.5">
            Non-Veg
          </span>
        )}
      </div>

      {/* Price & Size selector */}
      <div className="mt-3">
        {isPerPiece ? (
          <p className="text-green-400 font-semibold">
            Per&nbsp;Piece: ${Number(item.SalePrice || 0).toFixed(2)}
          </p>
        ) : (
          <div>
            <div className="text-sm mb-2">Tray Size:</div>
            <div className="flex flex-wrap gap-2">
              {sizes.map((s) => {
                const active = size === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSize(s.key)}
                    className={[
                      "px-3 py-1 rounded-full text-sm border transition",
                      active
                        ? "bg-[#F58735] border-[#F58735] text-black"
                        : "bg-[#3a3939] border-[#4a4949] text-white hover:bg-[#4a4949]"
                    ].join(' ')}
                    aria-pressed={active}
                  >
                    {s.label} — ${s.price.toFixed(2)}
                  </button>
                );
              })}
            </div>
            {size && (
              <div className="mt-2 text-xs text-gray-300">
                Selected: <span className="font-semibold">${unit.toFixed(2)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Spice level (Main Course only) */}
      {showSpice && (
        <div className="mt-4">
          <div className="text-sm mb-2">Spice Level:</div>
          <div className="flex gap-2">
            {['Mild', 'Medium', 'Spicy'].map((lvl) => {
              const active = spice === lvl;
              return (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setSpice(lvl)}
                  className={[
                    "px-3 py-1 rounded-full text-sm border transition",
                    active
                      ? "bg-[#F58735] border-[#F58735] text-black"
                      : "bg-[#3a3939] border-[#4a4949] text-white hover:bg-[#4a4949]"
                  ].join(' ')}
                  aria-pressed={active}
                >
                  {lvl}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Quantity (mobile-friendly stepper) */}
      <div className="mt-4">
        <div className="text-sm mb-2">Qty:</div>
        <div className="inline-flex items-stretch rounded overflow-hidden border border-[#4a4949]">
          <button
            type="button"
            onClick={dec}
            className="px-3 py-1 bg-[#3a3939] text-white hover:bg-[#4a4949] active:opacity-80"
            aria-label="Decrease quantity"
          >
            −
          </button>
          <input
            // Use text + numeric hints for the best mobile keypad & free editing
            type="text"
            inputMode="numeric"
            pattern="\d*"
            min="1"
            value={qtyStr}
            onChange={handleQtyChange}
            onBlur={handleQtyBlur}
            onFocus={(e) => e.target.select()}
            className="w-16 text-center bg-white text-black px-2 py-1 outline-none"
            aria-label="Quantity"
          />
          <button
            type="button"
            onClick={inc}
            className="px-3 py-1 bg-[#3a3939] text-white hover:bg-[#4a4949] active:opacity-80"
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>
      </div>

      {/* Footer pinned to bottom */}
      <div className="mt-auto pt-3">
        <div className="flex justify-end">
          <button
            disabled={!canAdd}
            onClick={() =>
              onAdd(size, Math.max(1, qtyNum), unit, showSpice ? { spiceLevel: spice } : {})
            }
            className={[
              "px-4 py-2 rounded text-sm",
              canAdd
                ? "bg-[#F58735] hover:bg-orange-600 text-black"
                : "bg-[#4a4949] text-gray-300 cursor-not-allowed"
            ].join(' ')}
            title={!canAdd ? "Please select options and quantity" : "Add to cart"}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
