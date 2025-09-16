// Orders.js — show spice + comments in UI and PDF; keep Payment as 6th card; add Pending/Refunded/Cancelled buttons
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

const REGION = 'us-east-2';
const ORDERS_TABLE =
  process.env.REACT_APP_ORDERS_TABLE ||
  process.env.VITE_ORDERS_TABLE ||
  'catering-orders-dev';

export default function Orders() {
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');

  // Sort + Filter
  const [sortBy, setSortBy] = useState('when');
  const [sortDir, setSortDir] = useState('desc');
  const [filterMethod, setFilterMethod] = useState('all');
  const [filterPayMethod, setFilterPayMethod] = useState('all');
  const [filterPayStatus, setFilterPayStatus] = useState('all');

  // Row selection + expand
  const [selected, setSelected] = useState(() => new Set());
  const [expanded, setExpanded] = useState(() => new Set());

  // Optimistic mark-as-paid
  const [optimisticPaid, setOptimisticPaid] = useState(() => new Map()); // orderId -> true/false

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const { credentials } = await fetchAuthSession();
        if (!credentials) throw new Error('No AWS credentials from Amplify session');

        const ddbClient = new DynamoDBClient({
          region: REGION,
          credentials: {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            sessionToken: credentials.sessionToken,
          },
        });
        const docClient = DynamoDBDocumentClient.from(ddbClient);

        const all = [];
        let ExclusiveStartKey;
        do {
          const resp = await docClient.send(
            new ScanCommand({
              TableName: ORDERS_TABLE,
              ExclusiveStartKey,
            })
          );
          (resp.Items || []).forEach((it) => all.push(normalizeOrder(it)));
          ExclusiveStartKey = resp.LastEvaluatedKey;
        } while (ExclusiveStartKey);

        if (mounted) setOrders(all);
      } catch (e) {
        console.error('[Orders] load error', e);
        if (mounted) setError('Failed to load orders. Check IAM permissions and table name.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  /* ---------- Filtering + Sorting ---------- */
  const filteredSorted = useMemo(() => {
    const arr = orders.filter((o) => {
      if (filterMethod !== 'all') {
        const m = (o.method || o.type || '').toLowerCase();
        if (m !== filterMethod) return false;
      }
      if (filterPayMethod !== 'all') {
        const pm = (o.paymentMethod || o.payment?.method || '').toLowerCase();
        if (pm !== filterPayMethod) return false;
      }
      if (filterPayStatus !== 'all') {
        const ps = (o.paymentStatus || (inferPaid(o) ? 'paid' : 'pending')).toLowerCase();
        if (ps !== filterPayStatus) return false;
      }
      return true;
    });

    const getVal = (o) => {
      switch (sortBy) {
        case 'when': return parseMaybeDate(o.when) ?? 0;
        case 'placedAt': return parseMaybeDate(o.placedAt) ?? 0;
        case 'grandTotal': return Number(o.grandTotal) || 0;
        case 'method': return (o.method || o.type || '').toLowerCase();
        case 'paymentMethod': return (o.paymentMethod || o.payment?.method || '').toLowerCase();
        case 'paymentStatus': {
          const ps = o.paymentStatus || (inferPaid(o) ? 'paid' : 'pending');
          return String(ps).toLowerCase();
        }
        case 'customerName': return (o.customerName || '').toLowerCase();
        case 'orderId': return (o.orderId || '').toLowerCase();
        default: return parseMaybeDate(o.when) ?? 0;
      }
    };

    arr.sort((a, b) => {
      const av = getVal(a);
      const bv = getVal(b);
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return arr;
  }, [orders, sortBy, sortDir, filterMethod, filterPayMethod, filterPayStatus]);

  const allChecked = selected.size && selected.size === filteredSorted.length;
  const anyChecked = selected.size > 0;

  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(filteredSorted.map((o) => o.orderId)));
  };
  const toggleRowCheck = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleExpand = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const clearFilters = () => {
    setFilterMethod('all');
    setFilterPayMethod('all');
    setFilterPayStatus('all');
  };

  /* ---------- Mark as Paid (for cash/unpaid) ---------- */
const markOrderAsPaid = async (order) => {
  try {
    setOptimisticPaid((m) => new Map(m).set(order.orderId, true));

    const { credentials } = await fetchAuthSession();
    if (!credentials) throw new Error('No AWS credentials from Amplify session');

    const ddbClient = new DynamoDBClient({
      region: REGION,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });

    // ✅ drop undefineds automatically
    const docClient = DynamoDBDocumentClient.from(ddbClient, {
      marshallOptions: { removeUndefinedValues: true },
    });

    await docClient.send(new UpdateCommand({
      TableName: ORDERS_TABLE,
      Key: { orderId: order.orderId },
      UpdateExpression: `
        SET paymentStatus = :paid,
            paidAt = :ts,
            payment = if_not_exists(payment, :p0),
            paymentMethod = if_not_exists(paymentMethod, :pm)
      `,
      ExpressionAttributeValues: {
        ':paid': 'paid',
        ':ts': new Date().toISOString(),
        ':p0': { method: order.paymentMethod || 'cash', status: 'manual', markedPaid: true },
        ':pm': order.paymentMethod || 'cash',
      },
    }));

    setOrders((prev) =>
      prev.map((o) =>
        o.orderId === order.orderId
          ? {
              ...o,
              paymentStatus: 'paid',
              paymentMethod: o.paymentMethod || 'cash',
              paidAt: new Date().toISOString(),
              payment: mergePayment(o.payment, { method: o.paymentMethod || 'cash', status: 'manual', markedPaid: true }),
            }
          : o
      )
    );
  } catch (e) {
    console.error('Mark as paid failed:', e);
    setOptimisticPaid((m) => new Map(m).set(order.orderId, false));
    alert('Failed to mark order as paid. Check IAM permissions and table key.');
  }
};

/* ---------- Update Payment Status (Pending / Refunded / Cancelled / Paid) ---------- */
const updatePaymentStatus = async (order, status) => {
  // normalize & validate
  const s = String(status || '').toLowerCase();
  const allowed = new Set(['paid', 'pending', 'refunded', 'cancelled']);
  if (!allowed.has(s)) {
    console.warn('[updatePaymentStatus] invalid status:', status);
    alert('Invalid payment status.');
    return;
  }

  try {
    const { credentials } = await fetchAuthSession();
    if (!credentials) throw new Error('No AWS credentials from Amplify session');

    const ddbClient = new DynamoDBClient({
      region: REGION,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });

    // drop undefined values during marshalling
    const docClient = DynamoDBDocumentClient.from(ddbClient, {
      marshallOptions: { removeUndefinedValues: true },
    });

    const nowIso = new Date().toISOString();

    await docClient.send(new UpdateCommand({
      TableName: ORDERS_TABLE,
      Key: { orderId: order.orderId },
      UpdateExpression: 'SET paymentStatus = :s, paidAt = :ts, payment = :p',
      ExpressionAttributeValues: {
        ':s': s,                           // ✅ always defined
        ':ts': nowIso,
        ':p': mergePayment(order.payment, {
          status: s,
          markedPaid: s === 'paid',
        }),
      },
    }));

    // keep optimistic map in sync
    setOptimisticPaid((m) => {
      const n = new Map(m);
      if (s !== 'paid') n.delete(order.orderId);
      else n.set(order.orderId, true);
      return n;
    });

    // update local state so main row badge changes immediately
    setOrders((prev) =>
      prev.map((o) =>
        o.orderId === order.orderId
          ? {
              ...o,
              paymentStatus: s,
              paidAt: nowIso,
              payment: mergePayment(o.payment, { status: s, markedPaid: s === 'paid' }),
            }
          : o
      )
    );
  } catch (e) {
    console.error('Update payment status failed:', e);
    alert(`Failed to update payment status: ${e?.name || 'Error'}`);
  }
};

  /* ---------- Export: Excel (unchanged) ---------- */
  const exportExcel = () => {
    const headers = [
      'placedAt','orderId','customerName','customerEmail','phone','address',
      'when','method','type','paymentMethod','paymentStatus','payment',
      'addOnFee','deliveryFee','cartTotal','discount',
      'subtotal','tax','salesTaxRate',
      'grandTotal',
      'lines','addOns','codes'
    ];

    const rows = filteredSorted.map((o) => {
      const row = {
        placedAt: formatDateTime(o.placedAt),
        orderId: o.orderId,
        customerName: o.customerName || '',
        customerEmail: o.customerEmail || '',
        phone: o.phone || '',
        address: toExportAddress(o.address),
        when: formatDateTime(o.when),
        method: o.method || o.type || '',
        type: o.type || '',
        paymentMethod: o.paymentMethod || o.payment?.method || '',
        paymentStatus: o.paymentStatus || (inferPaid(o) ? 'paid' : 'pending'),
        payment: toExportJSON(o.payment),
        addOnFee: toFixedNumber(o.addOnFee),
        deliveryFee: toFixedNumber(o.deliveryFee),
        cartTotal: toFixedNumber(o.cartTotal),
        discount: toFixedNumber(o.discount),
        subtotal: toFixedNumber(o.subtotal),
        tax: toFixedNumber(o.tax),
        salesTaxRate: toFixedNumber(o.salesTaxRate),
        grandTotal: toFixedNumber(o.grandTotal),
        lines: toExportJSON(o.lines),
        addOns: toExportJSON(o.addOns),
        codes: toExportJSON(o.codes),
      };
      return headers.map((h) => row[h] ?? '');
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Orders');
    const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    XLSX.writeFile(wb, `orders-export-${ts}.xlsx`);
  };

  /* ---------- Export: Kitchen PDF (adds Spice & Notes) ---------- */
  const exportSelectedToPDF = () => {
    const pick = filteredSorted.filter((o) => selected.has(o.orderId));
    if (!pick.length) return;

    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const marginX = 40;
    let page = 0;

    pick.forEach((o) => {
      if (page > 0) doc.addPage();
      page += 1;

      const methodLabel = capitalizeFirst((o.method || o.type || '').toString());
      const whenLabel = formatDateTime(o.when);
      const rightText = `${methodLabel}${methodLabel && whenLabel ? ' – ' : ''}${whenLabel}`;
      const paymentText = `Payment: ${stringifyPaymentForCell(o.payment) || '-'}`;
      const placedAtText = `Placed At: ${formatDateTime(o.placedAt)}`;

      doc.setFontSize(18);
      doc.setFont(undefined, 'bold');
      doc.text(`Order ${o.orderId || ''}`, marginX, 40);

      doc.setFontSize(11);
      doc.setFont(undefined, 'normal');
      doc.text(placedAtText, marginX, 58);

      doc.setFontSize(18);
      doc.setFont(undefined, 'bold');
      const pageWidth = doc.internal.pageSize.getWidth();
      const rightWidth = doc.getTextWidth(rightText);
      const rightX = pageWidth - marginX - rightWidth;
      doc.text(rightText, Math.max(rightX, marginX), 40);

      doc.setFontSize(11);
      doc.setFont(undefined, 'normal');
      const payWidth = doc.getTextWidth(paymentText);
      const payX = pageWidth - marginX - payWidth;
      doc.text(paymentText, Math.max(payX, marginX), 58);

      doc.setDrawColor(150);
      doc.setLineWidth(0.5);
      doc.line(marginX, 68, pageWidth - marginX, 68);

      const customerRows = [
        ['Name', o.customerName || ''],
        ['Email', o.customerEmail || ''],
        ['Phone', o.phone || ''],
        ['Address', formatAddress(o.address)],
      ];
      autoTable(doc, {
        startY: 84,
        head: [['Customer Details', '']],
        body: customerRows,
        styles: { fontSize: 10, cellPadding: 6, overflow: 'linebreak' },
        headStyles: { fillColor: [245, 135, 53], textColor: 0 },
        columnStyles: {
          0: { cellWidth: 140 },
          1: { cellWidth: pageWidth - marginX * 2 - 140 },
        },
        margin: { left: marginX, right: marginX },
        tableWidth: 'wrap',
      });

      const yAfterCustomer = doc.lastAutoTable?.finalY ?? 84;
      const linesRows = buildLinesRows(o.lines);
      autoTable(doc, {
        startY: yAfterCustomer + 18,
        head: [['Items', 'Size', 'Qty']],
        body: linesRows.length ? linesRows : [['-', '-', '-']],
        styles: { fontSize: 10, cellPadding: 6 },
        headStyles: { fillColor: [33, 33, 33], textColor: 255 },
        columnStyles: {
          0: { cellWidth: pageWidth - marginX * 2 - 180 },
          1: { cellWidth: 120 },
          2: { cellWidth: 60 },
        },
        margin: { left: marginX, right: marginX },
        tableWidth: 'wrap',
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 0) {
            data.cell.styles.fontStyle = 'bold';
          }
        }
      });

      const yAfterLines = doc.lastAutoTable?.finalY ?? (yAfterCustomer + 18);
      const { raitaLabel, warmersLabel, utensilsLabel } = parseAddOns(o.addOns);
      const agentCode = parseAgentReferenceCode(o.codes);
      const discountCode = parseDiscountCode(o.codes);

      autoTable(doc, {
        startY: yAfterLines + 18,
        head: [['Additional Details', ' ']],
        body: [
          ['AddOns - Raita, Papad & Pickle', raitaLabel || '-'],
          ['AddOns - Warmers & Serving Spoons', warmersLabel || '-'],
          ['AddOns - Plates, Utensils & Napkins', utensilsLabel || '-'],
          ['Codes - Agent Reference', agentCode || '-'],
          ['Codes - Discount Code', discountCode || '-'],
        ],
        styles: { fontSize: 10, cellPadding: 6 },
        headStyles: { fillColor: [33, 33, 33], textColor: 255 },
        columnStyles: {
          0: { cellWidth: 200 },
          1: { cellWidth: pageWidth - marginX * 2 - 200 },
        },
        margin: { left: marginX, right: marginX },
        tableWidth: 'wrap',
      });

      // ---- Spice & Notes (includes Special Request) ----
      const spiceRows = buildSpiceAndNotesRows(o);
      autoTable(doc, {
        startY: (doc.lastAutoTable?.finalY ?? (yAfterLines + 18)) + 18,
        head: [['Spice & Notes', ' ']],
        body: spiceRows.length ? spiceRows : [['Spice', '-']],
        styles: { fontSize: 10, cellPadding: 6 },
        headStyles: { fillColor: [33, 33, 33], textColor: 255 },
        columnStyles: {
          0: { cellWidth: 200 },
          1: { cellWidth: pageWidth - marginX * 2 - 200 },
        },
        margin: { left: marginX, right: marginX },
        tableWidth: 'wrap',
      });
    });

    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    doc.save(`kitchen-orders-${ts}.pdf`);
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {/* Sorters */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-neutral-300">Sort by</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm"
          >
            <option value="when">Pickup/Delivery Date</option>
            <option value="placedAt">Order Date</option>
            <option value="grandTotal">Grand Total</option>
            <option value="method">Method</option>
            <option value="paymentMethod">Payment Method</option>
            <option value="paymentStatus">Payment Status</option>
            <option value="customerName">Name</option>
            <option value="orderId">Order Id</option>
          </select>
          <button
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            className="px-3 py-2 rounded border border-neutral-700 bg-neutral-800 text-sm"
            title="Toggle ascending/descending"
          >
            {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-neutral-300">Filter:</span>
          <select
            value={filterMethod}
            onChange={(e) => setFilterMethod(e.target.value)}
            className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm"
            title="Method"
          >
            <option value="all">Method: All</option>
            <option value="pickup">Pickup</option>
            <option value="delivery">Delivery</option>
          </select>
          <select
            value={filterPayMethod}
            onChange={(e) => setFilterPayMethod(e.target.value)}
            className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm"
            title="Payment Method"
          >
            <option value="all">Payment: All</option>
            <option value="card">Card</option>
            <option value="cash">Cash</option>
          </select>
        <select
  value={filterPayStatus}
  onChange={(e) => setFilterPayStatus(e.target.value)}
  className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm"
  title="Payment Status"
>
  <option value="all">Status: All</option>
  <option value="paid">Paid</option>
  <option value="pending">Pending</option>
  <option value="refunded">Refunded</option>
  <option value="cancelled">Cancelled</option>
</select>
          <button
            onClick={clearFilters}
            className="px-3 py-2 rounded bg-neutral-700 hover:bg-neutral-600 text-sm"
          >
            Clear
          </button>

          <button
            onClick={exportExcel}
            className="ml-auto px-4 py-2 rounded bg-blue-700 hover:bg-blue-600"
          >
            Export Excel
          </button>
          <button
            disabled={!anyChecked}
            onClick={exportSelectedToPDF}
            className={`px-4 py-2 rounded ${
              anyChecked ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-neutral-700 text-neutral-400 cursor-not-allowed'
            }`}
          >
            Export PDF for Kitchen
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-auto border border-[#3A2D2D] rounded-lg">
        <table className="w-full min-w-[1250px] text-left">
          <thead className="bg-[#2E2424] text-[#F58735] sticky top-0 z-10">
            <tr className="text-sm">
              <th className="p-2 border-b border-[#3A2D2D]">
                <input type="checkbox" className="h-4 w-4" checked={!!allChecked} onChange={toggleAll} />
              </th>
              <Th>Placed At</Th>
              <Th>Order Id</Th>
              <Th>Name</Th>
              <Th>Method</Th>
              <Th>When</Th>
              <Th className="text-right">Grand Total</Th>
              <Th>Payment</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody className="text-[13px]">
            {loading && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-neutral-400">Loading orders…</td></tr>
            )}
            {!loading && error && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-red-400">{error}</td></tr>
            )}
            {!loading && !error && !filteredSorted.length && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-neutral-400">No orders yet.</td></tr>
            )}

            {!loading && !error && filteredSorted.map((o) => {
              const isOpen = expanded.has(o.orderId);
              const paid = inferPaidFromStatus(o, optimisticPaid.get(o.orderId));

              const displayMethod = capitalizeFirst(o.method || o.type);
              const paymentMethod = capitalizeFirst(o.paymentMethod || o.payment?.method || (typeof o.payment === 'string' ? o.payment : ''));

              return (
                <React.Fragment key={o.orderId}>
                  <tr
                    className={`border-b border-[#3A2D2D] cursor-pointer ${isOpen ? 'bg-[#2C2626]' : 'odd:bg-[#2E2424] even:bg-[#2C2424]'} hover:bg-[#3a2f2f]`}
                    onClick={(e) => {
                      const tag = e.target?.tagName?.toLowerCase();
                      if (tag === 'input' || tag === 'button' || tag === 'a') return;
                      toggleExpand(o.orderId);
                    }}
                  >
                    <td className="p-2 align-middle">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selected.has(o.orderId)}
                        onChange={() => toggleRowCheck(o.orderId)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select order ${o.orderId}`}
                      />
                    </td>
                    <Td className="py-2.5 font-semibold text-[14px]">{formatDateTime(o.placedAt)}</Td>
                    <Td className="py-2.5 font-semibold text-[14px]">{o.orderId}</Td>
                    <Td className="py-2.5 font-semibold text-[14px] truncate max-w-[220px]" title={o.customerName}>{o.customerName}</Td>
                    <Td className="py-2.5 text-[14px]">{displayMethod}</Td>
                    <Td className="py-2.5 text-[14px]">{formatDateTime(o.when)}</Td>
                    <Td className="py-2.5 text-right text-[14px] font-extrabold">{currency(o.grandTotal)}</Td>
                    <Td className="py-2.5 text-[14px]">
                      {paymentMethod ? capitalizeFirst(paymentMethod) : '-'}
                      {renderPaymentTail(o.payment)}
                    </Td>
                    {/* Status (uses canonical status, updates live) */}
<Td className="py-2.5">
  {renderStatusBadge(getCanonicalStatus(o, optimisticPaid.get(o.orderId)))}
</Td>
                  </tr>

                  {/* Expandable details */}
                  <AnimatedExpand open={isOpen} colSpan={9}>
                    <div className="grid gap-4 md:grid-cols-3">
                      <DetailCard title="Items">
                        {renderLines(o.lines)}
                      </DetailCard>

                      <DetailCard title="Contact">
                        {renderContact(o)}
                      </DetailCard>

                      <DetailCard title="Accounting">
                        {renderAccounting(o)}
                      </DetailCard>

                      <DetailCard title="AddOns">
                        {renderAddOns(o.addOns)}
                      </DetailCard>

                      <DetailCard title="Codes">
                        {renderCodes(o.codes)}
                      </DetailCard>

                      {/* 6th card: Payment (status + Mark Paid + New status buttons) */}
                     <DetailCard title="Payment">
  {renderPaymentCard(o,
    /* paid: */ inferPaidFromStatus(o, optimisticPaid.get(o.orderId)),
    /* onMarkPaid: */ () => updatePaymentStatus(o, 'paid'),
    /* updater: */ updatePaymentStatus
  )}
</DetailCard>

                    </div>
                  </AnimatedExpand>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ===== Animated container for the expand row ===== */
function AnimatedExpand({ open, colSpan, children }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const measure = () => {
      const child = el.firstElementChild;
      setHeight(open ? (child?.scrollHeight || 0) : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, children]);

  return (
    <tr className="bg-[#221A1A]">
      <td colSpan={colSpan} className="px-4 py-0">
        <div
          ref={ref}
          style={{ maxHeight: height, opacity: open ? 1 : 0, transition: 'max-height 260ms ease, opacity 200ms ease' }}
          className="overflow-hidden"
        >
          <div className="py-4">{children}</div>
        </div>
      </td>
    </tr>
  );
}

/* ===== UI helpers ===== */
function Th({ children, className = '' }) {
  return <th className={`px-2 py-2 border-b border-[#3A2D2D] font-semibold ${className}`}>{children}</th>;
}
function Td({ children, className = '' }) {
  return <td className={`px-2 align-middle ${className}`}>{children ?? ''}</td>;
}
function DetailCard({ title, children }) {
  return (
    <div className="bg-[#2E2424] border border-[#3A2D2D] rounded-lg p-3">
      <div className="text-[#F58735] font-semibold mb-2">{title}</div>
      <div className="text-neutral-100 text-sm">{children}</div>
    </div>
  );
}

/* ===== Formatting helpers ===== */
function parseMaybeDate(v) {
  if (!v) return null;
  if (typeof v === 'number') return v; // epoch ms
  const d = new Date(v);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}
function formatDateTime(v) {
  const t = parseMaybeDate(v);
  if (!t) return '';
  return new Date(t).toLocaleString();
}
function currency(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(num);
  } catch {
    return `$${num.toFixed(2)}`;
  }
}
function stringifyPaymentForCell(p) {
  const obj = parsePayment(p);
  if (!obj) return '';

  const method = obj.method ? capitalizeFirst(obj.method) : '';
  const brand  = obj.brand ? capitalizeFirst(obj.brand) : '';
  const last4  = obj.last4 ? `•••• ${obj.last4}` : '';
  const status = obj.status ? capitalizeFirst(obj.status) : '';

  const left = [method, brand, last4].filter(Boolean).join(' ').trim();
  return status ? `${left || method || ''} (${status})` : (left || method || '');
}

function formatAddress(addr) {
  if (!addr) return '';
  if (typeof addr === 'object') {
    const { line1, addr1, street, line2, addr2, city, state, zip, postalCode } = addr;
    const parts = [
      line1 || addr1 || street,
      line2 || addr2,
      city,
      [state, zip || postalCode].filter(Boolean).join(' ')
    ].filter(Boolean);
    return parts.join(', ');
  }
  try {
    const asObj = JSON.parse(addr);
    if (asObj && typeof asObj === 'object') return formatAddress(asObj);
  } catch {}
  return String(addr).replace(/"/g, '').replace(/\s+/g, ' ').trim();
}
function toExportAddress(addr) {
  if (!addr) return '';
  if (typeof addr === 'object') return formatAddress(addr);
  try {
    const asObj = JSON.parse(addr);
    if (asObj && typeof asObj === 'object') return formatAddress(asObj);
  } catch {}
  return String(addr).replace(/"/g,'').replace(/\s+/g,' ').trim();
}
function toExportJSON(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}
function toFixedNumber(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num : '';
}
function capitalizeFirst(s) {
  const str = (s || '').toString();
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/* ===== Case-insensitive key access ===== */
function getAny(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (k in obj) return obj[k];
  }
  const lower = Object.fromEntries(Object.keys(obj).map(k => [k.toLowerCase(), obj[k]]));
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v !== undefined) return v;
  }
  return undefined;
}
function toLowerSafely(v) {
  return (v == null) ? '' : String(v).trim().toLowerCase();
}

/* ===== Payment parsing & UI helpers ===== */
function parsePayment(p) {
  if (!p) return null;
  if (typeof p === 'object') return p;

  if (typeof p === 'string') {
    const s = p.trim();
    // Try JSON first
    try {
      const obj = JSON.parse(s);
      if (obj && typeof obj === 'object') return obj;
    } catch {}

    // Parse plain string like "cash" or "card visa ••••1234 paid"
    const lower = s.toLowerCase();

    const out = { raw: s };

    // method
    if (/\bcash\b/.test(lower)) out.method = 'cash';
    else if (/\bcard\b/.test(lower)) out.method = 'card';

    // status
    if (/\b(paid|succeed(?:ed)?|captured|approved)\b/.test(lower)) out.status = 'succeeded';
    else if (/\b(pending|unpaid)\b/.test(lower)) out.status = 'pending';

    // brand
    const brandMatch = lower.match(/\b(visa|mastercard|amex|american express|discover|diners|jcb)\b/);
    if (brandMatch) {
      out.brand = brandMatch[1] === 'american express' ? 'amex' : brandMatch[1];
    }

    // last4 (•••• 1234 / **** 1234 / XX 1234)
    const last4Match = s.match(/(?:\u2022|•|\*|X){2,}\s?(\d{4})\b/i);
    if (last4Match) out.last4 = last4Match[1];

    // If it's exactly "cash" or "card", set method explicitly even if above missed
    if (!out.method && (lower === 'cash' || lower === 'card')) out.method = lower;

    return out;
  }

  return { raw: String(p) };
}

function renderPaymentTail(p) {
  const obj = parsePayment(p);
  if (!obj || typeof obj !== 'object') return null;
  const parts = [];
  if (obj.brand) parts.push(capitalizeFirst(obj.brand));
  if (obj.last4) parts.push(`•••• ${obj.last4}`);
  if (obj.status) parts.push(capitalizeFirst(obj.status));
  return parts.length ? <span className="text-neutral-300 ml-1 text-xs">({parts.join(' ')})</span> : null;
}

function renderPaymentCard(o, paid, onMarkPaid, doUpdateStatus) {
  const pm = capitalizeFirst(o.paymentMethod || parsePayment(o.payment)?.method || '');
  const status = getCanonicalStatus(o, paid);

  return (
    <div className="space-y-3">
      {/* Payment method */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-neutral-300">Method:</span>
        <span className="font-medium">{pm || '-'}</span>
        {renderPaymentTail(o.payment)}
      </div>

      {/* Current status badge */}
      <div className="flex flex-wrap gap-2">
        {renderStatusBadge(status)}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {!paid && (pm.toLowerCase() === 'cash') && (
          <button
            onClick={(e) => { e.stopPropagation(); onMarkPaid(); }}
            className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm"
          >
            Mark Paid
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); doUpdateStatus(o, 'pending'); }}
          className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-sm"
        >
          Pending
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); doUpdateStatus(o, 'refunded'); }}
          className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm"
        >
          Refunded
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); doUpdateStatus(o, 'cancelled'); }}
          className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-sm"
        >
          Cancelled
        </button>
      </div>
    </div>
  );
}


/* ===== Contact / Accounting renderers ===== */
function renderContact(o) {
  return (
    <div className="space-y-1">
      <div>Name: <span className="font-medium">{o.customerName || '-'}</span></div>
      <div>Email: <span className="font-medium break-all">{o.customerEmail || '-'}</span></div>
      <div>Phone: <span className="font-medium">{o.phone || '-'}</span></div>
      <div>Address: <span className="font-medium">{formatAddress(o.address) || '-'}</span></div>
      {o.specialRequest ? (
        <div className="mt-2">
          Special Request: <span className="font-medium">{o.specialRequest}</span>
        </div>
      ) : null}
      {Array.isArray(o.spiceSelections) && o.spiceSelections.length ? (
        <div className="mt-2">
          <div className="text-neutral-300">Spice Preferences:</div>
          <ul className="list-disc ml-5">
            {o.spiceSelections.map((s, i) => (
              <li key={i}>
                <span className="font-medium">{s.name}</span>
                {s.size ? <span className="text-neutral-300"> ({s.size})</span> : null}
                <span className="text-neutral-300"> — {s.spiceLevel || 'Medium'}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
function renderAccounting(o) {
  const salesTaxPct = Number.isFinite(o.salesTaxRate) && o.salesTaxRate > 0 ? ` (${(o.salesTaxRate * 100).toFixed(2)}%)` : '';
  const method = capitalizeFirst(o.method || o.type || '');
  return (
    <div className="space-y-2">
      <Row label="Method" value={method} />
      <Row label="Cart Total" value={currency(o.cartTotal)} />
      <Row label="Add-on Fee" value={currency(o.addOnFee)} />
      <Row label="Delivery Fee" value={currency(o.deliveryFee)} />
      <Row label="Discount" value={currency(o.discount)} />
      <Row label="Subtotal" value={currency(o.subtotal)} />
      <Row label={`Tax${salesTaxPct}`} value={currency(o.tax)} />
      <div className="border-t border-[#3A2D2D] pt-2 flex items-center justify-between">
        <div className="text-sm">Grand Total</div>
        <div className="text-base font-semibold">{currency(o.grandTotal)}</div>
      </div>
    </div>
  );
}
function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="text-neutral-300">{label}</div>
      <div className="text-neutral-100">{value ?? '-'}</div>
    </div>
  );
}

/* ===== Lines/addOns/codes helpers ===== */
function renderLines(lines) {
  if (!lines) return <div>-</div>;
  let arr = lines;
  if (!Array.isArray(arr)) {
    try {
      const parsed = JSON.parse(lines);
      if (Array.isArray(parsed)) arr = parsed;
      else return <div>{String(lines).replace(/"/g, '')}</div>;
    } catch {
      return <div>{String(lines).replace(/"/g, '')}</div>;
    }
  }
  if (!arr.length) return <div>-</div>;
  const norm = arr.map(normalizeLineItem);
  return (
    <div className="space-y-3">
      {norm.map((ln, idx) => (
        <div key={idx} className="border border-[#3A2D2D] rounded-md p-2">
          <div className="text-base font-semibold">
            {ln.itemName || 'Item'}
            {ln.spiceLevel ? (
              <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full border border-[#F58735]/60 text-[#F58735] align-middle">
                Spice: {ln.spiceLevel}
              </span>
            ) : null}
          </div>
          {(ln.size || ln.qty || ln.qty === 0) && (
            <div className="text-xs text-neutral-300 mt-1">
              {!/^\s*package\s*$/i.test(ln.size) && ln.size ? <span>Tray Size: {ln.size}</span> : null}
              {!/^\s*package\s*$/i.test(ln.size) && (ln.qty || ln.qty === 0) ? <span> • </span> : null}
              {!/package/i.test(ln.size) && (ln.qty || ln.qty === 0) ? <span>Qty: {ln.qty}</span> : null}
            </div>
          )}

          {!!ln.children?.length && (
            <div className="mt-2 pl-3 border-l border-[#3A2D2D] space-y-1">
              {ln.children.map((c, ci) => (
                <div key={ci} className="text-sm">
                  • <span className="font-medium">{c.itemName}</span>
                  {c.size ? <span className="text-neutral-300"> — {c.size}</span> : null}
                  {c.qty || c.qty === 0 ? <span className="text-neutral-300"> × {c.qty}</span> : null}
                  {c.spiceLevel ? <span className="text-neutral-300"> • Spice: {c.spiceLevel}</span> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
function normalizeLineItem(raw) {
  const PACKAGE_RE = /^(.*?)\s*(?:—|–|-)\s*\[(.*)\]\s*$/; // robust: em/en/hyphen dashes

  // A) If the raw line is a plain string
  if (typeof raw === 'string') {
    const m = raw.match(PACKAGE_RE);
    if (m) {
      const parent = safe(m[1]);
      const itemsStr = m[2] || '';
      const children = itemsStr
        .split(/\s*,\s*/)
        .filter(Boolean)
        .map(parseChildDetailFromString);
      return { itemName: parent, size: '', qty: '', children };
    }
    return { itemName: safe(raw), size: '', qty: '' };
  }

  // B) Non-object fallback
  if (!raw || typeof raw !== 'object') {
    return { itemName: safe(raw), size: '', qty: '' };
  }

  // C) Object line
  const itemNameRaw = safe(raw.name || raw.item || raw.title || raw.packageName || '');
  const size = safe(raw.size || raw.tray || raw.traySize || raw.option || '');
  const qty  = raw.qty ?? raw.quantity ?? raw.count ?? '';
  const spiceLevel = normalizeSpice(raw.SpiceLevel || raw.spiceLevel || raw.spice);

  let children = [];

  // C1) If the object's name contains the "Package — [ ... ]" pattern, parse it
  const m = itemNameRaw.match(PACKAGE_RE);
  let itemName = itemNameRaw;
  if (m) {
    itemName = safe(m[1]);
    const itemsStr = m[2] || '';
    children = children.concat(
      itemsStr
        .split(/\s*,\s*/)
        .filter(Boolean)
        .map(parseChildDetailFromString)
    );
  }

  // C2) Also support structured child arrays on the object
  const mapChild = (t) => {
    if (typeof t === 'string') return parseChildDetailFromString(t);
    return {
      itemName: safe(t.name || t.item || t.title || ''),
      size:     safe(t.size || t.tray || t.traySize || t.option || ''),
      qty:      t.qty ?? t.quantity ?? t.count ?? '',
      spiceLevel: normalizeSpice(t.SpiceLevel || t.spiceLevel || t.spice),
    };
  };

  if (Array.isArray(raw.trays))      children = children.concat(raw.trays.map(mapChild));
  if (Array.isArray(raw.items))      children = children.concat(raw.items.map(mapChild));
  if (Array.isArray(raw.components)) children = children.concat(raw.components.map(mapChild));

  return { itemName, size, qty, spiceLevel, children };
}

// Parse strings like "Mix Pakora — SmallTray × 1" or "Puri — per-piece × 15"
function parseChildDetailFromString(s) {
  const str = safe(s);
  const m = str.match(/^(.*?)\s*(?:—|–|-)\s*(.*)$/);
  const itemName = safe(m ? m[1] : str);
  const right    = m ? m[2] : '';
  if (!right) return { itemName, size: '', qty: '' };

  const qtyMatch = right.match(/(?:×|x)\s*(\d+)\s*$/i);
  const qty = qtyMatch ? Number(qtyMatch[1]) : '';
  const size = safe(right.replace(/\s*(?:×|x)\s*\d+\s*$/i, ''));
  return { itemName, size, qty };
}

/* Build rows for Items table in PDF */
function buildLinesRows(lines) {
  if (!lines) return [];
  let arr = lines;
  if (!Array.isArray(arr)) {
    try {
      const parsed = JSON.parse(lines);
      if (Array.isArray(parsed)) arr = parsed;
      else return [[String(lines).replace(/"/g, ''), '', '']];
    } catch {
      return [[String(lines).replace(/"/g, ''), '', '']];
    }
  }
  const rows = [];
  const pushRow = (name, size, qty) => rows.push([safe(name || 'Item'), safe(size || ''), String(qty ?? '')]);
  arr.forEach((ln) => {
    const n = normalizeLineItem(ln);
    pushRow(n.itemName, n.size, n.qty);
    if (Array.isArray(n.children) && n.children.length) {
      n.children.forEach((c) => pushRow(`— ${c.itemName}`, c.size, c.qty));
    }
  });
  return rows;
}

function parseAddOns(addOns) {
  let warmers = null;
  let utensils = null;
  let raita = null;

  const coerceBool = (v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return /^(true|yes|y|1)$/i.test(v.trim());
    return null;
  };

  if (addOns == null) {
    return {
      raitaLabel: '-',
      warmersLabel: '-',
      utensilsLabel: '-',
    };
  }

  try {
    if (typeof addOns === 'string') {
      const parsed = JSON.parse(addOns);
      if (parsed && typeof parsed === 'object') addOns = parsed;
    }
  } catch {}

  if (typeof addOns === 'object' && addOns) {
    raita   = coerceBool(addOns.raitaPapadPickle ?? addOns.raita ?? addOns.raitaPapad ?? addOns.condiments);
    warmers = coerceBool(addOns.warmers ?? addOns.Warmers);
    utensils= coerceBool(addOns.utensils ?? addOns.Utensils ?? addOns.cutlery);
  }

  return {
    raitaLabel:   raita   == null ? '-' : (raita   ? 'Yes' : 'No'),
    warmersLabel: warmers == null ? '-' : (warmers ? 'Yes' : 'No'),
    utensilsLabel:utensils== null ? '-' : (utensils? 'Yes' : 'No'),
  };
}

function renderAddOns(addOns) {
  const { raitaLabel, warmersLabel, utensilsLabel } = parseAddOns(addOns);
  return (
    <div className="space-y-1">
      <div>Raita, Papad & Pickle: <span className="font-medium">{raitaLabel}</span></div>
      <div>Warmers & Serving Spoons: <span className="font-medium">{warmersLabel}</span></div>
      <div>Plates, Utensils & Napkins: <span className="font-medium">{utensilsLabel}</span></div>
    </div>
  );
}

function parseAgentReferenceCode(codes) {
  const clean = (v) => (v == null ? '' : String(v).replace(/"/g, '').trim());
  const extract = (obj) =>
    clean(
      obj.agentRef ??
      obj.agentReferenceCode ??
      obj.reference ??
      obj.code ??
      obj.refCode ??
      ''
    );
  if (!codes) return '';
  if (typeof codes === 'string') {
    try {
      const obj = JSON.parse(codes);
      if (obj && typeof obj === 'object') return extract(obj);
      return clean(codes);
    } catch { return clean(codes); }
  }
  if (Array.isArray(codes)) {
    for (const c of codes) {
      if (!c) continue;
      if (typeof c === 'string') {
        try {
          const obj = JSON.parse(c);
          if (obj && typeof obj === 'object') {
            const v = extract(obj);
            if (v) return v;
          } else if (c.trim()) {
            return clean(c);
          }
        } catch { if (c.trim()) return clean(c); }
      } else if (typeof c === 'object') {
        const v = extract(c);
        if (v) return v;
      }
    }
    return '';
  }
  if (typeof codes === 'object') return extract(codes);
  return clean(codes);
}
function parseDiscountCode(codes) {
  const clean = (v) => (v == null ? '' : String(v).replace(/"/g, '').trim());
  const extract = (obj) =>
    clean(
      obj.discountCode ??
      obj.discount ??
      obj.coupon ??
      obj.promo ??
      obj.promoCode ??
      obj.discCode ??
      ''
    );
  if (!codes) return '';
  if (typeof codes === 'string') {
    try {
      const obj = JSON.parse(codes);
      if (obj && typeof obj === 'object') return extract(obj);
      const m = codes.match(/(discount|coupon|promo( ?code)?)\W*([\w-]+)/i);
      return m ? clean(m[3]) : '';
    } catch {
      const m = codes.match(/(discount|coupon|promo( ?code)?)\W*([\w-]+)/i);
      return m ? clean(m[3]) : '';
    }
  }
  if (Array.isArray(codes)) {
    for (const c of codes) {
      if (!c) continue;
      if (typeof c === 'string') {
        try {
          const obj = JSON.parse(c);
          if (obj && typeof obj === 'object') {
            const v = extract(obj);
            if (v) return v;
          } else {
            const m = c.match(/(discount|coupon|promo( ?code)?)\W*([\w-]+)/i);
            if (m) return clean(m[3]);
          }
        } catch {
          const m = c.match(/(discount|coupon|promo( ?code)?)\W*([\w-]+)/i);
          if (m) return clean(m[3]);
        }
      } else if (typeof c === 'object') {
        const v = extract(c);
        if (v) return v;
      }
    }
    return '';
  }
  if (typeof codes === 'object') return extract(codes);
  return '';
}
function renderCodes(codes) {
  const agent = parseAgentReferenceCode(codes);
  const discount = parseDiscountCode(codes);
  return (
    <div className="space-y-1">
      <div>Agent Reference Code: <span className="font-medium">{agent || '-'}</span></div>
      <div>Discount Code: <span className="font-medium">{discount || '-'}</span></div>
    </div>
  );
}

/* ===== Misc helpers ===== */
function safe(s) { return (s == null) ? '' : String(s).replace(/"/g, '').trim(); }
function mergePayment(oldP, patch) {
  const base = parsePayment(oldP) || {};
  return { ...base, ...patch };
}

/* ===== Spice & Notes helpers ===== */
function normalizeSpice(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return undefined;
  if (s.startsWith('mild')) return 'Mild';
  if (s.startsWith('spic')) return 'Spicy';
  return 'Medium';
}
function parseJSONMaybe(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  if (typeof v !== 'string') return null;
  try { return JSON.parse(v); } catch { return null; }
}
function coerceSpiceSelections(any) {
  const raw = parseJSONMaybe(any) ?? any;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((s) => ({
        name: safe(s?.name ?? s?.item ?? s?.title ?? ''),
        size: safe(s?.size ?? s?.tray ?? s?.traySize ?? ''),
        qty:  Number(s?.qty ?? s?.quantity ?? s?.count ?? 0) || undefined,
        spiceLevel: normalizeSpice(s?.spiceLevel ?? s?.SpiceLevel ?? s?.spice),
      }))
      .filter((s) => s.name && s.spiceLevel);
  }
  return [];
}

/* ===== Paid inference ===== */
function inferPaidFromStatus(o, optimistic) {
  if (optimistic === true) return true;
  const ps = toLowerSafely(o.paymentStatus);
  if (ps === 'paid') return true;
  if (ps === 'pending') return false;
  return inferPaid(o, optimistic);
}
function inferPaid(o, optimistic) {
  if (optimistic === true) return true;
  const p = parsePayment(o.payment);
  if (!p) return false;
  if (typeof p === 'object') {
    if (p.markedPaid) return true;
    if (/^(succeeded|paid|captured)$/i.test(String(p.status || ''))) return true;
    if (String(p.method || '').toLowerCase() === 'cash') return false;
  } else if (typeof p === 'string') {
    return /paid|succeed|success|approved/i.test(p);
  }
  return false;
}

/* ===== Canonical payment status & badge ===== */
function getCanonicalStatus(o, optimistic) {
  // If we just optimistically marked as paid
  if (optimistic === true) return 'paid';

  const raw = toLowerSafely(o.paymentStatus);
  if (raw === 'paid' || raw === 'pending' || raw === 'refunded' || raw === 'cancelled') {
    return raw;
  }
  // Fallback to inference for legacy rows
  return inferPaid(o, optimistic) ? 'paid' : 'pending';
}

function renderStatusBadge(status) {
  const s = String(status || '').toLowerCase();
  const base = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs border';
  if (s === 'paid') {
    return <span className={`${base} bg-emerald-700/30 text-emerald-300 border-emerald-700/60`}>Paid</span>;
  }
  if (s === 'pending') {
    return <span className={`${base} bg-amber-700/30 text-amber-300 border-amber-700/60`}>Pending</span>;
  }
  if (s === 'refunded') {
    return <span className={`${base} bg-blue-700/30 text-blue-300 border-blue-700/60`}>Refunded</span>;
  }
  if (s === 'cancelled') {
    return <span className={`${base} bg-red-700/30 text-red-300 border-red-700/60`}>Cancelled</span>;
  }
  // default
  return <span className={`${base} bg-neutral-700/30 text-neutral-300 border-neutral-700/60`}>{s || '-'}</span>;
}


/* ===== Normalizer (add specialRequest + spiceSelections) ===== */
function normalizeOrder(it = {}) {
  const cartTotal = asNum(it.cartTotal);
  const deliveryFee = asNum(it.deliveryFee);
  const addOnFee = asNum(it.addOnFee);
  const discount = asNum(it.discount);
  const subtotal = Number.isFinite(it.subtotal) ? asNum(it.subtotal) : (cartTotal + deliveryFee + addOnFee - discount);
  const tax = asNum(it.tax);
  const salesTaxRate = asNum(it.salesTaxRate);

  const phone = getAny(it, ['phone', 'Phone', 'customerPhone', 'contactPhone']) || '';

  // Payment parsing first
  const paymentParsed = parsePayment(it.payment);

  // paymentStatus (many styles); if missing, infer from parsed payment
  const rawPaymentStatus = getAny(it, ['paymentStatus','payment_status','PaymentStatus']) || '';
  let paymentStatus = toLowerSafely(rawPaymentStatus);
  if (!paymentStatus) {
    const inferred = toLowerSafely(paymentParsed?.status);
    if (inferred) paymentStatus = (inferred === 'succeeded') ? 'paid' : inferred;
  }

  // paymentMethod; if missing, fall back to parsed payment or raw string
  const rawPaymentMethod = getAny(it, ['paymentMethod','payment_method','PaymentMethod']) || '';
  let paymentMethod = toLowerSafely(rawPaymentMethod);
  if (!paymentMethod) {
    paymentMethod = toLowerSafely(paymentParsed?.method || (typeof it.payment === 'string' ? it.payment : ''));
  }

  // Prefer top-level special request if present; otherwise from nested customer object
  const topLevelSpecial = safe(
    getAny(it, [
      'specialRequest','special_request','special','notes','note','comment','comments','specialInstructions','specialInstruction'
    ]) || ''
  );

  let customerObj = getAny(it, ['customer','Customer']) ?? null;
  customerObj = parseJSONMaybe(customerObj) ?? customerObj ?? {};
  const nestedSpecial =
    safe(
      getAny(customerObj, [
        'specialRequest','special_request','special','notes','note','comment','comments','specialInstructions','specialInstruction'
      ]) || ''
    );
    
      // Allow a top-level fallback too (some legacy payloads store it flat)
  const specialRequest =
    nestedSpecial ||
    safe(
      getAny(it, [
        'specialRequest','special_request','special',
        'notes','note','comment','comments',
        'specialInstructions','specialInstruction'
      ]) || ''
    );

  // ---- Spice selections: prefer explicit field; else derive from lines ----
  let spiceSelections = coerceSpiceSelections(getAny(it, ['spiceSelections','SpiceSelections']));
  if (!spiceSelections.length) {
    const rawLines = parseJSONMaybe(it.lines) ?? it.lines;
    if (Array.isArray(rawLines)) {
      const derived = rawLines
        .map((l) => ({
          name: safe(l?.name || l?.item || l?.title || ''),
          size: safe(l?.size || l?.tray || l?.traySize || ''),
          spiceLevel: normalizeSpice(l?.spiceLevel || l?.SpiceLevel || l?.spice),
          qty: Number(l?.qty ?? l?.quantity ?? l?.count ?? 0) || undefined,
        }))
        .filter((x) => x.name && x.spiceLevel);
      if (derived.length) spiceSelections = derived;
    }
  }

  return {
    orderId: String(it.orderId ?? ''),
    addOnFee,
    addOns: it.addOns ?? null,
    address: it.address ?? '',
    cartTotal,
    codes: it.codes ?? null,
    customerEmail: it.customerEmail ?? '',
    customerName: it.customerName ?? '',
    phone,
    deliveryFee,
    discount,
    subtotal,
    tax,
    salesTaxRate,
    grandTotal: asNum(it.grandTotal),
    lines: it.lines ?? null,
    method: it.method ?? '',
    type: it.type ?? '',
    when: it.when ?? '',
    placedAt: it.placedAt ?? '',

    paymentStatus,
    paymentMethod,
    payment: paymentParsed ?? it.payment ?? null,
    paidAt: it.paidAt ?? null,
    amountCents: asNum(it.amountCents),
    currency: it.currency ?? 'usd',
    stripeSessionId: it.stripeSessionId ?? '',
    stripePaymentIntentId: it.stripePaymentIntentId ?? '',
    stripeChargeId: it.stripeChargeId ?? '',

    // NEW: ensure these are always present on the normalized shape
    specialRequest,
    spiceSelections,
  };
}

function asNum(v) {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ---------- PDF helper for “Spice & Notes” ---------- */
function buildSpiceAndNotesRows(o) {
  const rows = [];
  if (o.specialRequest) rows.push(['Special Request', o.specialRequest]);

  if (Array.isArray(o.spiceSelections) && o.spiceSelections.length) {
    o.spiceSelections.forEach((s) => {
      const left = `Spice — ${safe(s.name)}${s.size ? ` (${safe(s.size)})` : ''}`;
      rows.push([left, s.spiceLevel || 'Medium']);
    });
  }
  return rows;
}


