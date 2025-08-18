import React, { useState } from 'react';

/* expects { item, onAdd(sizeKey, qty, unitPrice) } */
export default function TrayCard({ item, onAdd }) {
  const sizes = [
    { key: 'SmallTray',      label: 'Small',  price: item.SmallTray },
    { key: 'MediumTray',     label: 'Medium', price: item.MediumTray },
    { key: 'LargeTray',      label: 'Large',  price: item.LargeTray },
    { key: 'ExtraLargeTray', label: 'XL',     price: item.ExtraLargeTray },
  ].filter((s) => s.price);

  const [size, setSize] = useState(sizes[0]?.key ?? '');
  const [qty, setQty]   = useState(1);
  const unit =
    item.Type === 'pc' ? Number(item.SalePrice) : Number(item[size]);

  return (
    <div className="bg-[#2c2a2a] rounded-lg p-4 shadow">
      <h3 className="text-lg font-bold">{item.Item}</h3>
      <p className="text-sm text-gray-400 mb-1"></p>

      {item.Type === 'pc' ? (
        <p className="text-green-400 font-semibold mb-3">
          Per&nbsp;Piece: ${item.SalePrice}
        </p>
      ) : (
        <label className="block mb-3 text-sm">
          Tray&nbsp;Size:&nbsp;
          <select
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className="px-2 py-1 rounded text-black"
          >
            {sizes.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} – ${s.price}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block mb-4 text-sm">
        Qty:&nbsp;
        <input
          type="number"
          min="1"
          value={qty}
          onChange={(e) => setQty(Math.max(1, +e.target.value))}
          className="w-20 px-2 py-1 rounded text-black"
        />
      </label>
    <div className="flex justify-end">
      <button
        onClick={() => onAdd(size || 'per-piece', qty, unit)}
        className="bg-[#F58735] hover:bg-orange-600 px-3 py-1 rounded text-sm"
      >
        Add
      </button>
      </div>
    </div>
  );
}
