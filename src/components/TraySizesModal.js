import React from "react";

// Update these paths to your project (e.g. src/assets/trays/*.png)
import SmallTrayImg from "../assets/trays/SmallTray.png";
import MediumTrayImg from "../assets/trays/MediumTray.png";
import LargeTrayImg from "../assets/trays/LargeTray.png";
import ExtraLargeTrayImg from "../assets/trays/ExtraLargeTray.png";

const DEFAULT_CAPS = {
  SmallTray:       { label: "Small Tray",       serves: "10-15 guests" },
  MediumTray:      { label: "Medium Tray",      serves: "20-25 guests" },
  LargeTray:       { label: "Large Tray",       serves: "30-35 guests" },
  ExtraLargeTray:  { label: "Extra Large Tray", serves: "40-50 guests" },
};

export default function TraySizesModal({
  open,
  onClose,
  capacities = DEFAULT_CAPS,
  images,
}) {
  if (!open) return null;

  const data = [
    { key: "SmallTray",      img: images?.SmallTray      || SmallTrayImg },
    { key: "MediumTray",     img: images?.MediumTray     || MediumTrayImg },
    { key: "LargeTray",      img: images?.LargeTray      || LargeTrayImg },
    { key: "ExtraLargeTray", img: images?.ExtraLargeTray || ExtraLargeTrayImg },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#262525] border border-[#3a3939] rounded-2xl p-5 md:p-6 w-[min(960px,92vw)] shadow-xl">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-lg md:text-xl font-semibold text-[#F58735]">
            Tray sizes & typical servings
          </h3>
          <button
            onClick={onClose}
            className="text-gray-300 hover:text-white text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {data.map(({ key, img }) => (
            <div
              key={key}
              className="rounded-xl overflow-hidden bg-[#1f1f1f] border border-[#3a3939]"
            >
              <div className="aspect-[4/3] bg-black/10 overflow-hidden">
                <img
                  src={img}
                  alt={`${capacities[key]?.label || key} photo`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="p-3">
                <div className="font-semibold">
                  {capacities[key]?.label || key}
                </div>
                <div className="text-sm text-gray-300 mt-1">
                  Typical for{" "}
                  <span className="font-medium">
                    {capacities[key]?.serves || "varied dishes"}
                  </span>
                </div>
                <div className="text-xs text-gray-400 mt-2">
                  Actual servings vary by dish (dry vs. curry, bone-in vs.
                  boneless, sides, etc.).
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer row with disclaimer + close button */}
        <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-xs text-gray-400 leading-snug max-w-3xl text-center sm:text-left">
            India 101 does not guarantee that the tray sizes you order will be sufficient
            for your event. Our estimates are based on typical consumption and your exact
            tray requirements may vary according to the number of items ordered or your
            event details.
          </p>
          <button
            onClick={onClose}
            className="bg-[#F58735] hover:bg-orange-600 px-4 py-2 rounded shrink-0"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
