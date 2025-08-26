// PriceConfig.js
import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { fetchAuthSession } from 'aws-amplify/auth';
import {
  DynamoDBClient,
  PutItemCommand,
  DeleteItemCommand,
  ScanCommand,
  QueryCommand,            // <-- NEW
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'; // <-- UPDATED

const REGION = 'us-east-2';
const CUSTOMER_PRICING_TABLE = 'catering-customer-pricing';
const ADMIN_TABLE = 'catering-dev'; // <-- NEW

export default function Configuration({
  user,
  signOut,
  products = {},
  handleRefresh,
  handleFileUpload,
  uploading,
  message,
  setMessage,
}) {
  const fileInputRef = useRef(null);
  const [showConfig, setShowConfig] = useState(false);
  const [sortBy, setSortBy] = useState('ItemName');
  const [margin, setMargin] = useState(150);

  // Tray Config
  const [traySizes, setTraySizes] = useState([
    { name: 'Small Tray', oz: 80, min: 20, max: 40 },
    { name: 'Medium Tray', oz: 120, min: 50, max: 80 },
    { name: 'Large Tray', oz: 220, min: 80, max: 150 },
    { name: 'Extra Large Tray', oz: 340, min: 125, max: 250 },
  ]);

  // Per-piece minimum
  const [minPcPrice, setMinPcPrice] = useState(1.0);

  // Helpers
  const updateTray = (idx, key, value) => {
    const next = [...traySizes];
    next[idx][key] = parseFloat(value) || 0;
    setTraySizes(next);
  };

  const calculateTrayPrices = (sale, tray) => {
    const actual = sale * tray.oz;
    let set = actual;
    if (actual < tray.min) set = tray.min;
    else if (actual > tray.max) set = tray.max;
    else set = Math.ceil(actual / 10) * 10;
    return { actual: actual.toFixed(2), set: set.toFixed(2) };
  };

  const calcPcPrice = (sale) => {
    const price = sale < minPcPrice ? minPcPrice : Math.ceil(sale);
    return price.toFixed(2);
  };

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    console.log('📁 Selected file:', file.name);
    handleFileUpload(file); // pass only the file
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // --- Description helpers ---
  const getDescriptionFromItem = (item) =>
    (item?.Description ?? item?.description ?? '').toString();

  // Pull all ADMIN items from catering-dev and build a map: "Category#Group#ItemName" -> Description
  const fetchAdminDescriptionMap = async (client) => {
    const map = new Map();

    // Query PK = 'ADMIN'
    const resp = await client.send(
      new QueryCommand({
        TableName: ADMIN_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': { S: 'ADMIN' } },
      })
    );

    (resp.Items || []).forEach((av) => {
      const it = unmarshall(av);
      const sk = it.SK || `${it.Category}#${it.Group}#${it.ItemName}`;
      if (sk && typeof it.Description === 'string' && it.Description.trim()) {
        map.set(sk, it.Description.trim());
      }
    });

    // In case of pagination
    let lastKey = resp.LastEvaluatedKey;
    while (lastKey) {
      const next = await client.send(
        new QueryCommand({
          TableName: ADMIN_TABLE,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': { S: 'ADMIN' } },
          ExclusiveStartKey: lastKey,
        })
      );
      (next.Items || []).forEach((av) => {
        const it = unmarshall(av);
        const sk = it.SK || `${it.Category}#${it.Group}#${it.ItemName}`;
        if (sk && typeof it.Description === 'string' && it.Description.trim()) {
          map.set(sk, it.Description.trim());
        }
      });
      lastKey = next.LastEvaluatedKey;
    }

    return map;
  };

  // Build data rows for Excel + DynamoDB
  const buildPricingPayload = (descriptionMap) => {
    const rows = [];
    Object.entries(products).forEach(([category, items]) => {
      items.forEach((item) => {
        const cost = Number(item.UnitPrice || 0);
        const saleOneOz = cost * (1 + margin / 100);
        const type = (item.Type || '').toLowerCase();

        // Prefer description from products; else fallback to admin-table map
        const sk = `${category}#${item.Group}#${item.ItemName}`;
        const description =
          getDescriptionFromItem(item) || descriptionMap.get(sk) || '';

        if (type === 'pc') {
          rows.push({
            USER: 'USER',
            Item: item.ItemName,
            Category: category,
            Type: 'pc',
            Group: item.Group,
            SalePrice: parseFloat(calcPcPrice(saleOneOz)),
            Description: description, // <-- include on deploy
          });
        } else if (type === 'oz') {
          const trayCols = {};
          traySizes.forEach((tray) => {
            const { set } = calculateTrayPrices(saleOneOz, tray);
            trayCols[tray.name.replace(/\s+/g, '')] = +set;
          });
          rows.push({
            USER: 'USER',
            Item: item.ItemName,
            Category: category,
            Type: 'oz',
            Group: item.Group,
            Description: description, // <-- include on deploy
            ...trayCols,
          });
        }
      });
    });
    return rows;
  };

  // Excel Export (unchanged — still omits Description from the sheet)
  const handleExportExcel = () => {
    // Note: Export stays as-is per your request; no Description column
    const data = []; // we don't need the description for the Excel
    const tmpRows = buildPricingPayload(new Map()); // build without needing a real map
    tmpRows.forEach((r) => {
      // Strip Description for export
      const { Description, ...rest } = r;
      data.push(rest);
    });

    const header = ['Category','Item','Type','Group','SalePrice', ...traySizes.map(t=>t.name.replace(/\s+/g,''))];
    const rows = data.map(r => header.map(h => r[h] ?? ''));
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pricing');
    XLSX.writeFile(wb, 'pricing-export.xlsx');
  };

  // Deploy to DynamoDB
  const handleDeployPricing = async () => {
    try {
      const { credentials } = await fetchAuthSession();
      if (!credentials) throw new Error('No AWS creds');

      const client = new DynamoDBClient({
        region: REGION,
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          sessionToken: credentials.sessionToken,
        },
      });

      // 1) Build a map of descriptions from catering-dev in case products[] items lack it
      const descriptionMap = await fetchAdminDescriptionMap(client);

      // 2) Build new records (with Description included)
      const newItems = buildPricingPayload(descriptionMap);
      const newKeys  = new Set(newItems.map((i) => i.Item));

      // 3) Get existing records
      const existing = await client.send(
        new ScanCommand({
          TableName: CUSTOMER_PRICING_TABLE,
          ProjectionExpression: '#u, #i',
          ExpressionAttributeNames: { '#u': 'USER', '#i': 'Item' },
          FilterExpression: '#u = :u',
          ExpressionAttributeValues: { ':u': { S: 'USER' } },
        })
      );

      const toDelete = (existing.Items || [])
        .map((it) => it.Item.S)
        .filter((name) => !newKeys.has(name));

      // 4) Delete obsolete rows
      await Promise.all(
        toDelete.map((itemName) =>
          client.send(
            new DeleteItemCommand({
              TableName: CUSTOMER_PRICING_TABLE,
              Key: marshall({ USER: 'USER', Item: itemName }),
            })
          )
        )
      );

      // 5) Write / overwrite current rows (now includes Description)
      await Promise.all(
        newItems.map((record) =>
          client.send(
            new PutItemCommand({
              TableName: CUSTOMER_PRICING_TABLE,
              Item: marshall(record),
            })
          )
        )
      );

      alert('✅ Updated Pricing deployed');
    } catch (err) {
      console.error(err);
      alert('❌ Deploy failed – see console');
    }
  };

  const sortedCategories = Object.entries(products);

  return (
    <>
      {/* Action bar */}
      <div className="flex items-center gap-6 flex-wrap mb-6">
        <button onClick={handleRefresh} className="bg-[#F58735] hover:bg-orange-600 text-white px-4 py-2 rounded text-sm">🔄 Refresh</button>
        <label className="text-sm font-medium">Margin %:
          <input type="number" value={margin} onChange={e=>setMargin(parseFloat(e.target.value)||0)} className="ml-2 w-24 px-2 py-1 rounded text-black"/>
        </label>
        <label className="text-sm font-medium">Sort by:
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)} className="ml-2 px-2 py-1 text-black rounded">
            <option value="ItemName">Item Name</option>
            <option value="Group">Group</option>
            <option value="Type">Type</option>
            <option value="SalePrice">Sale Price</option>
          </select>
        </label>
        <button onClick={()=>setShowConfig(true)} className="bg-[#F58735] hover:bg-orange-600 text-white px-4 py-2 rounded text-sm">⚙️ Config</button>
        <div className="flex gap-2 ml-auto">
          <button onClick={handleExportExcel} className="bg-green-700 hover:bg-green-800 text-white px-4 py-2 rounded text-sm">📤 Export</button>
          <button onClick={handleDeployPricing} className="bg-red-700 hover:bg-red-800 text-white font-bold px-4 py-2 rounded text-sm">🚀 Deploy Pricing</button>
        </div>
      </div>

      {/* Upload */}
      <div className="mb-6">
        <label className="block mb-2 text-sm font-medium text-white">Upload new <code>PriceSet.csv</code></label>
        <input ref={fileInputRef} type="file" accept=".csv" onChange={onFileChange} className="block text-white bg-[#2E2424] border border-[#F58735] rounded px-2 py-1"/>
        {uploading && <p className="text-sm text-orange-300 mt-2">Uploading…</p>}
        {message && <p className="text-sm text-[#F58735] mt-2">{message}</p>}
      </div>

      {/* Product tables */}
      <div className="grid gap-6">
        {sortedCategories.map(([category, items])=>{
          const sortedItems=[...items].sort((a,b)=>{
            if(sortBy==='SalePrice'){
              const sa=a.UnitPrice*(1+margin/100);
              const sb=b.UnitPrice*(1+margin/100);
              return sa-sb;
            }
            return (a[sortBy]||'').localeCompare(b[sortBy]||'');
          });
          return(
            <div key={category} className="bg-[#2E2424] rounded-lg shadow p-4">
              <h2 className="text-lg font-semibold text-[#F58735] mb-2">{category}</h2>
              <div className="max-h-[600px] overflow-y-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-[#2E2424] text-[#F58735] sticky top-0 z-10">
                    <tr>
                      <th className="p-2">Item</th>
                      <th className="p-2">Group</th>
                      <th className="p-2">Type</th>
                      <th className="p-2">Cost Price (1oz)</th>
                      <th className="p-2">Sale Price (1oz)</th>
                      {traySizes.map(tray=>(
                        <React.Fragment key={tray.name}>
                          <th className="p-2">{tray.name}<br/>Actual</th>
                          <th className="p-2">{tray.name}<br/>Set</th>
                        </React.Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedItems.map(item=>{
                      const cost=Number(item.UnitPrice||0);
                      const saleBase=cost*(1+margin/100);
                      const type=(item.Type||'').toLowerCase();
                      return(
                        <tr key={item.ItemName} className="border-b border-[#3A2D2D]">
                          <td className="p-2">{item.ItemName}</td>
                          <td className="p-2">{item.Group}</td>
                          <td className="p-2 lowercase">{item.Type}</td>
                          <td className="p-2">{cost.toFixed(2)}</td>
                          <td className="p-2">{type==='pc'?calcPcPrice(saleBase):saleBase.toFixed(2)}</td>
                          {traySizes.map(tray=>{
                            const {actual,set}=calculateTrayPrices(saleBase,tray);
                            return(
                              <React.Fragment key={tray.name}>
                                <td className="p-2">{actual}</td>
                                <td className="p-2">{set}</td>
                              </React.Fragment>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      {/* Config Modal */}
      {showConfig && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#2E2424] p-8 rounded-lg w-full max-w-lg shadow-xl">
            <h3 className="text-xl font-semibold text-[#F58735] mb-6 text-center">
              Price Configuration
            </h3>

            {/* Per-piece minimum */}
            <div className="flex items-center gap-4 mb-8">
              <label className="text-sm font-medium shrink-0 w-32">
                Per-Piece Min ($):
              </label>
              <input
                type="number"
                step="0.01"
                value={minPcPrice}
                onChange={(e) => setMinPcPrice(parseFloat(e.target.value) || 0)}
                className="flex-1 px-3 py-1 rounded text-black"
              />
            </div>

            {/* Tray rows */}
            <div className="space-y-6">
              {traySizes.map((tray, idx) => (
                <div key={tray.name} className="grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-3 font-medium">{tray.name}</div>

                  <div className="col-span-3 flex items-center gap-1">
                    <span className="text-xs">oz</span>
                    <input
                      type="number"
                      value={tray.oz}
                      onChange={(e) => updateTray(idx, 'oz', e.target.value)}
                      className="w-full px-2 py-1 rounded text-black"
                    />
                  </div>

                  <div className="col-span-3 flex items-center gap-1">
                    <span className="text-xs">Min ($)</span>
                    <input
                      type="number"
                      step="0.01"
                      value={tray.min}
                      onChange={(e) => updateTray(idx, 'min', e.target.value)}
                      className="w-full px-2 py-1 rounded text-black"
                    />
                  </div>

                  <div className="col-span-3 flex items-center gap-1">
                    <span className="text-xs">Max ($)</span>
                    <input
                      type="number"
                      step="0.01"
                      value={tray.max}
                      onChange={(e) => updateTray(idx, 'max', e.target.value)}
                      className="w-full px-2 py-1 rounded text-black"
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="flex justify-end mt-10">
              <button
                onClick={() => setShowConfig(false)}
                className="bg-[#F58735] hover:bg-orange-600 text-white px-6 py-2 rounded text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
