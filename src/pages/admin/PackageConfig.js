// src/pages/admin/AdminPackageConfig.js
import React, { useEffect, useState } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';

const TABLE_NAME   = 'catering-package-dev';
const PK_NAME      = 'ConfigId';
const PK_VALUE     = 'packages';
const PAYLOAD_ATTR = 'Payload';

const defaultConfig = {
  trays: {
    thresholds: { small: 15, medium: 25, large: 35, xl: 50 },
    heavyBump: 5
  },
  packages: [
    {
      id:'pkg-basic',
      name:'Basic Package',
      priceLine:'Starting $8/person',
      slots: { appetizer:['A'], main:['A','A'], rice:['A'], bread:['A'], dessert:['A'] },
    },
    {
      id:'pkg-classic',
      name:'Classic Package',
      priceLine:'Starting $12/person',
      slots: { appetizer:['A'], main:['A','A','B'], rice:['B'], bread:['A'], dessert:['A'] },
    },
    {
      id:'pkg-premium',
      name:'Premium Package',
      priceLine:'Starting $15/person',
      slots: { appetizer:['A','B'], main:['A','B','C'], rice:['A','B'], bread:['A','B'], dessert:['A','B'] },
    },
  ]
};

const deepCopy = (obj) => JSON.parse(JSON.stringify(obj));

export default function AdminPackageConfig() {
  const [cfg, setCfg]         = useState(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState('');

  const buildClient = async () => {
    const session = await fetchAuthSession();
    const creds = session?.credentials;
    if (!creds?.accessKeyId) throw new Error('Missing AWS credentials');
    return new DynamoDBClient({
      region: 'us-east-2',
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      },
    });
  };

  const loadConfig = async () => {
    const db = await buildClient();
    const { Item } = await db.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: { [PK_NAME]: { S: PK_VALUE } },
    }));
    const payloadStr = Item?.[PAYLOAD_ATTR]?.S;
    if (payloadStr) {
      try {
        const json = JSON.parse(payloadStr);
        if (json?.trays && json?.packages) setCfg(json);
      } catch (e) {
        console.error('Bad JSON in config Payload:', e);
      }
    }
  };

  const saveConfig = async () => {
    const db = await buildClient();
    const payload = JSON.stringify(cfg, null, 2);
    await db.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: {
        [PK_NAME]:      { S: PK_VALUE },
        [PAYLOAD_ATTR]: { S: payload },
      },
    }));
  };

  useEffect(() => {
    (async () => {
      try { await loadConfig(); }
      catch (e) { console.error('Load config failed:', e); }
      finally { setLoading(false); }
    })();
  }, []);

  const updateThreshold = (name, val) =>
    setCfg(prev => ({ ...prev, trays: { ...prev.trays, thresholds: { ...prev.trays.thresholds, [name]: Number(val || 0) }}}));
  const updateHeavyBump = (val) =>
    setCfg(prev => ({ ...prev, trays: { ...prev.trays, heavyBump: Number(val || 0) }}));

  const updateSlot = (pkgIdx, course, slotIdx, value) => {
    setCfg(prev => {
      const next = deepCopy(prev);
      next.packages[pkgIdx].slots[course][slotIdx] = value.toUpperCase();
      return next;
    });
  };

  const addSlot = (pkgIdx, course) => {
    setCfg(prev => {
      const next = deepCopy(prev);
      next.packages[pkgIdx].slots[course].push('A');
      return next;
    });
  };

  const removeSlot = (pkgIdx, course, slotIdx) => {
    setCfg(prev => {
      const next = deepCopy(prev);
      next.packages[pkgIdx].slots[course].splice(slotIdx, 1);
      return next;
    });
  };

  const save = async () => {
    try {
      setSaving(true);
      setMsg('');
      await saveConfig();
      setMsg('Saved configuration.');
    } catch (e) {
      console.error('Save failed:', e);
      setMsg('Save failed: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-4 text-sm text-gray-300">Loading config…</div>;

  return (
    <div className="p-4 max-w-5xl text-white">
      <h1 className="text-2xl font-semibold text-[#F58735] mb-4">Package & Tray Configuration</h1>

      <section className="mb-6 rounded border border-[#3a3939] p-4 bg-[#232222]">
        <h2 className="text-lg font-semibold mb-2">Tray thresholds</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {['small','medium','large','xl'].map(k => (
            <label key={k} className="text-sm">
              <div className="text-gray-300 capitalize">{k} max guests</div>
              <input
                type="number"
                className="mt-1 w-full rounded bg-[#2c2a2a] border border-[#3a3939] px-3 py-2"
                value={cfg.trays.thresholds[k]}
                onChange={e => updateThreshold(k, e.target.value)}
              />
            </label>
          ))}
          <label className="text-sm">
            <div className="text-gray-300">Heavy appetite +guests</div>
            <input
              type="number"
              className="mt-1 w-full rounded bg-[#2c2a2a] border border-[#3a3939] px-3 py-2"
              value={cfg.trays.heavyBump}
              onChange={e => updateHeavyBump(e.target.value)}
            />
          </label>
        </div>
      </section>

      {cfg.packages.map((p, idx) => (
        <section key={p.id} className="mb-6 rounded border border-[#3a3939] p-4 bg-[#222222]">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-lg font-semibold text-[#F58735]">{p.name}</div>
              <div className="text-xs text-gray-400">{p.priceLine}</div>
            </div>
          </div>

          {['appetizer','main','rice','bread','dessert'].map(course => (
            <div key={course} className="mb-3">
              <div className="text-sm font-medium capitalize mb-2">{course}</div>
              <div className="flex flex-wrap gap-2">
                {p.slots[course].map((g, sidx) => (
                  <div key={sidx} className="flex items-center gap-2">
                    <select
                      value={g}
                      onChange={e => updateSlot(idx, course, sidx, e.target.value)}
                      className="bg-[#2c2a2a] border border-[#3a3939] rounded px-2 py-1"
                    >
                      {['A','B','C','D'].map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                    <button
                      onClick={() => removeSlot(idx, course, sidx)}
                      className="text-xs text-red-400 hover:text-red-200"
                    >
                      remove
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addSlot(idx, course)}
                  className="text-xs bg-[#2c2a2a] hover:bg-[#3a3939] border border-[#3a3939] rounded px-2 py-1"
                >
                  + add slot
                </button>
              </div>
            </div>
          ))}
        </section>
      ))}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="bg-[#F58735] hover:bg-orange-600 px-4 py-2 rounded disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save configuration'}
        </button>
        {msg && <span className="text-sm text-gray-300">{msg}</span>}
      </div>
    </div>
  );
}
