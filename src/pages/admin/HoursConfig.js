// Hours.js
import React, { useEffect, useMemo, useState } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

/* ================== Config ================== */
const REGION = 'us-east-2';
const HOURS_TABLE = 'catering-hours-dev';
const HOURS_PK = 'HOURS'; // single-row design

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LS_KEY = 'catering-hours-config-v2';

/** day -> two windows (open1/close1, open2/close2) + closed */
const defaultDay = (open1, close1, open2, close2, closed = false) => ({
  open1, close1, open2, close2, closed,
});

const DEFAULT_PICKUP = {
  Sun: defaultDay('12:00', '15:00', '18:00', '21:30'),
  Mon: defaultDay('11:00', '14:00', '17:30', '21:00'),
  Tue: defaultDay('11:00', '14:00', '17:30', '21:00'),
  Wed: defaultDay('11:00', '14:00', '17:30', '21:00'),
  Thu: defaultDay('11:00', '14:00', '17:30', '21:00'),
  Fri: defaultDay('11:00', '14:00', '18:00', '21:30'),
  Sat: defaultDay('12:00', '15:00', '18:00', '21:30'),
};

const DEFAULT_DELIVERY = {
  Sun: defaultDay('09:00', '16:00', '16:00', '21:30'),
  Mon: defaultDay('09:00', '16:00', '16:00', '21:00'),
  Tue: defaultDay('09:00', '16:00', '16:00', '21:00'),
  Wed: defaultDay('09:00', '16:00', '16:00', '21:00'),
  Thu: defaultDay('09:00', '16:00', '16:00', '21:00'),
  Fri: defaultDay('09:00', '16:00', '16:00', '21:30'),
  Sat: defaultDay('09:00', '16:00', '16:00', '21:30'),
};

/* ================== AWS Helpers ================== */
async function getDocClient() {
  const { credentials } = await fetchAuthSession();
  const base = new DynamoDBClient({ region: REGION, credentials });
  return DynamoDBDocumentClient.from(base, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

/* ================== Component ================== */
export default function Hours() {
  const [pickupHours, setPickupHours] = useState(DEFAULT_PICKUP);
  const [deliveryHours, setDeliveryHours] = useState(DEFAULT_DELIVERY);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  // Load: localStorage first (instant), then hydrate from DynamoDB.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.pickupHours) setPickupHours(parsed.pickupHours);
        if (parsed?.deliveryHours) setDeliveryHours(parsed.deliveryHours);
      }
    } catch {}
    (async () => {
      try {
        const doc = await getDocClient();
        const res = await doc.send(new GetCommand({
          TableName: HOURS_TABLE,
          Key: { PK: HOURS_PK },
        }));
        const item = res?.Item;
        if (item?.pickupHours) setPickupHours(item.pickupHours);
        if (item?.deliveryHours) setDeliveryHours(item.deliveryHours);
      } catch (e) {
        console.warn('[Hours] load from Dynamo failed:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Cache to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ pickupHours, deliveryHours }));
    } catch {}
  }, [pickupHours, deliveryHours]);

  const allValid = useMemo(() => validateAll(pickupHours) && validateAll(deliveryHours), [pickupHours, deliveryHours]);

  async function handleSave() {
    setMsg('');
    if (!allValid) {
      setMsg('Please fix invalid times before saving.');
      return;
    }
    setSaving(true);
    try {
      const doc = await getDocClient();
      await doc.send(new PutCommand({
        TableName: HOURS_TABLE,
        Item: {
          PK: HOURS_PK,
          updatedAt: new Date().toISOString(),
          pickupHours,
          deliveryHours,
        },
      }));
      setMsg('✅ Saved!');
    } catch (e) {
      console.error('[Hours] save failed:', e);
      setMsg('❌ Save failed. Check console and AWS permissions.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#2C2525] text-white p-6">
      <h1 className="text-2xl font-bold text-[#F58735] mb-6">Pickup & Delivery Hours</h1>

      {loading ? (
        <div className="text-neutral-300">Loading hours…</div>
      ) : (
        <>
          <div className="grid lg:grid-cols-2 gap-6">
            <SectionCard title="Pickup Hours">
              <HoursTable2
                hours={pickupHours}
                onChange={(dow, key, value) =>
                  setPickupHours(prev => ({ ...prev, [dow]: { ...prev[dow], [key]: value } }))
                }
              />
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setPickupHours(DEFAULT_PICKUP)}
                  className="bg-neutral-700 hover:bg-neutral-600 px-3 py-1 rounded text-sm"
                >
                  Reset Pickup Defaults
                </button>
              </div>
            </SectionCard>

            <SectionCard title="Delivery Hours">
              <HoursTable2
                hours={deliveryHours}
                onChange={(dow, key, value) =>
                  setDeliveryHours(prev => ({ ...prev, [dow]: { ...prev[dow], [key]: value } }))
                }
              />
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setDeliveryHours(DEFAULT_DELIVERY)}
                  className="bg-neutral-700 hover:bg-neutral-600 px-3 py-1 rounded text-sm"
                >
                  Reset Delivery Defaults
                </button>
              </div>
            </SectionCard>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !allValid}
              className={`px-4 py-2 rounded ${
                saving || !allValid ? 'bg-neutral-700 cursor-not-allowed' : 'bg-[#F58735] hover:bg-[#e4792d]'
              }`}
            >
              {saving ? 'Saving…' : 'Save Hours'}
            </button>
            {msg && <span className="text-sm text-neutral-300">{msg}</span>}
            {!allValid && <span className="text-sm text-red-300">Fix invalid times.</span>}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- Components ---------------- */
function SectionCard({ title, className = '', children }) {
  return (
    <div className={`bg-[#2E2424] border border-[#3A2D2D] rounded-lg p-4 ${className}`}>
      <div className="text-[#F58735] font-semibold mb-3">{title}</div>
      {children}
    </div>
  );
}

function HoursTable2({ hours, onChange }) {
  return (
    <div className="overflow-auto">
      <table className="w-full text-left">
        <thead className="text-[#F58735]">
          <tr>
            <th className="p-2">Day</th>
            <th className="p-2">Open 1</th>
            <th className="p-2">Close 1</th>
            <th className="p-2">Open 2</th>
            <th className="p-2">Close 2</th>
            <th className="p-2">Closed</th>
            <th className="p-2">Copy to…</th>
          </tr>
        </thead>
        <tbody>
          {DAYS.map((dow) => {
            const row = hours[dow] || defaultDay('10:00', '15:00', '17:00', '21:00', false);
            const { open1, close1, open2, close2, closed } = row;
            return (
              <tr key={dow} className="border-t border-[#3A2D2D]">
                <td className="p-2">{dow}</td>
                <td className="p-2">
                  <input
                    type="time"
                    value={open1 || ''}
                    onChange={(e) => onChange(dow, 'open1', e.target.value)}
                    className="bg-[#2C2525] border border-[#3A2D2D] rounded px-2 py-1"
                    disabled={closed}
                  />
                </td>
                <td className="p-2">
                  <input
                    type="time"
                    value={close1 || ''}
                    onChange={(e) => onChange(dow, 'close1', e.target.value)}
                    className="bg-[#2C2525] border border-[#3A2D2D] rounded px-2 py-1"
                    disabled={closed}
                  />
                </td>
                <td className="p-2">
                  <input
                    type="time"
                    value={open2 || ''}
                    onChange={(e) => onChange(dow, 'open2', e.target.value)}
                    className="bg-[#2C2525] border border-[#3A2D2D] rounded px-2 py-1"
                    disabled={closed}
                  />
                </td>
                <td className="p-2">
                  <input
                    type="time"
                    value={close2 || ''}
                    onChange={(e) => onChange(dow, 'close2', e.target.value)}
                    className="bg-[#2C2525] border border-[#3A2D2D] rounded px-2 py-1"
                    disabled={closed}
                  />
                </td>
                <td className="p-2">
                  <input
                    type="checkbox"
                    checked={!!closed}
                    onChange={(e) => onChange(dow, 'closed', e.target.checked)}
                    className="h-4 w-4"
                  />
                </td>
                <td className="p-2">
                  <CopyRowToButton
                    fromDow={dow}
                    onClone={(target) => {
                      onChange(target, 'open1', open1);
                      onChange(target, 'close1', close1);
                      onChange(target, 'open2', open2);
                      onChange(target, 'close2', close2);
                      onChange(target, 'closed', closed);
                    }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="text-xs text-neutral-400 mt-2">
        Leave the second window blank if you don’t offer dinner/lunch that day. Checking <b>Closed</b> ignores both windows.
      </div>
    </div>
  );
}

function CopyRowToButton({ fromDow, onClone }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="bg-neutral-700 hover:bg-neutral-600 px-2 py-1 rounded text-xs"
      >
        Copy…
      </button>
      {open && (
        <div className="absolute z-10 mt-1 bg-[#2C2525] border border-[#3A2D2D] rounded shadow p-2">
          <div className="text-xs text-neutral-300 mb-1">Copy {fromDow} to:</div>
          <div className="grid grid-cols-4 gap-1 max-w-[220px]">
            {DAYS.filter((d) => d !== fromDow).map((d) => (
              <button
                key={d}
                className="bg-[#2E2424] hover:bg-[#3a2a2a] px-2 py-1 rounded text-xs"
                onClick={() => { onClone(d); setOpen(false); }}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================== Validation ================== */
function validateAll(map) {
  try {
    return DAYS.every((dow) => {
      const r = map[dow];
      if (!r || r.closed) return true;
      const ok1 = validateWindow(r.open1, r.close1);
      const ok2 = validateWindow(r.open2, r.close2);
      // Allow one or two valid windows; both blank is allowed.
      return (ok1 || isBlankWindow(r.open1, r.close1)) && (ok2 || isBlankWindow(r.open2, r.close2));
    });
  } catch {
    return false;
  }
}
function isBlankWindow(open, close) {
  return !(open && close);
}
function validateWindow(open, close) {
  if (!open || !close) return false;
  const [oh, om] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  const start = oh * 60 + om;
  const end = ch * 60 + cm;
  return end > start;
}
