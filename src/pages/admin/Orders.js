// Orders.js — admin orders table: filter/sort, expandable detail, payment status,
// Excel + kitchen-PDF export. Pure helpers live in ordersHelpers.js; presentational
// pieces in OrdersUI.js.
import React, { useEffect, useMemo, useState } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import {
  normalizeOrder, inferPaid, inferPaidFromStatus, getCanonicalStatus, parseMaybeDate,
  mergePayment, formatDateTime, toExportAddress, toExportJSON, toFixedNumber, capitalizeFirst,
  splitDayLabel, stringifyPaymentForCell, formatAddress, buildLinesRows, parseAddOns,
  parseAgentReferenceCode, parseDiscountCode, buildSpiceAndNotesRows, currency,
} from './ordersHelpers';
import {
  Th, Td, AnimatedExpand, DetailCard, renderLines, renderContact, renderAccounting,
  renderAddOns, renderCodes, renderPaymentCard, renderStatusBadge, renderPaymentTail,
} from './OrdersUI';

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
    const marginTop = 40;
    const marginBottom = 40;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const usable = pageHeight - marginTop - marginBottom;

    /*
     * Draws ONE order onto doc `d` at vertical scale `s` (font sizes, paddings
     * and header offsets all scale by s). Returns the bottom Y of the content.
     * Every order is forced onto a single page: we first measure the natural
     * height on a tall scratch page (no auto-pagination), then pick s so it
     * fits within one letter page. Items render in 2 compact columns so big
     * menus stay large before any shrink kicks in.
     */
    const drawOrder = (d, o, s) => {
      const pw = d.internal.pageSize.getWidth();
      const Y = (base) => marginTop + (base - marginTop) * s; // compress offsets below the top margin
      const gap = 18 * s;

      const methodLabel = capitalizeFirst((o.method || o.type || '').toString());
      const { day, rest } = splitDayLabel(o.when);
      const paymentText = `Payment: ${stringifyPaymentForCell(o.payment) || '-'}`;
      const placedAtText = `Placed At: ${formatDateTime(o.placedAt)}`;

      // Row 1: order id (left) + method (right, short — never the long date)
      d.setTextColor(0);
      d.setFont(undefined, 'bold');
      d.setFontSize(18 * s);
      d.text(`Order ${o.orderId || ''}`, marginX, Y(40));
      if (methodLabel) {
        d.setFontSize(13 * s);
        const mW = d.getTextWidth(methodLabel);
        d.text(methodLabel, pw - marginX - mW, Y(40));
      }

      // Row 2: placed-at (left) + payment (right)
      d.setFont(undefined, 'normal');
      d.setFontSize(11 * s);
      d.text(placedAtText, marginX, Y(58));
      const payWidth = d.getTextWidth(paymentText);
      const minPayX = marginX + d.getTextWidth(placedAtText) + 16 * s;
      d.text(paymentText, Math.max(pw - marginX - payWidth, minPayX), Y(58));

      d.setDrawColor(150);
      d.setLineWidth(0.5);
      d.line(marginX, Y(68), pw - marginX, Y(68));

      // Prominent day-of-week band: weekday large on its own line, date/time beneath.
      let headerBottomBase = 84;
      if (day || rest) {
        d.setFont(undefined, 'bold');
        d.setFontSize(26 * s);
        d.text(day || rest, marginX, Y(98));
        let bandBase = 98;
        if (day && rest) {
          d.setFont(undefined, 'normal');
          d.setFontSize(13 * s);
          d.text(rest, marginX, Y(120));
          bandBase = 120;
        }
        headerBottomBase = bandBase + 18;
      }

      let y = Y(headerBottomBase);

      const sharedStyles = { fontSize: 10 * s, cellPadding: 6 * s, overflow: 'linebreak' };
      const darkHead = { fillColor: [33, 33, 33], textColor: 255 };

      // Customer details
      autoTable(d, {
        startY: y,
        head: [['Customer Details', '']],
        body: [
          ['Name', o.customerName || ''],
          ['Email', o.customerEmail || ''],
          ['Phone', o.phone || ''],
          ['Address', formatAddress(o.address)],
        ],
        styles: sharedStyles,
        headStyles: { fillColor: [245, 135, 53], textColor: 0 },
        columnStyles: { 0: { cellWidth: 140 }, 1: { cellWidth: pw - marginX * 2 - 140 } },
        margin: { left: marginX, right: marginX },
        tableWidth: 'wrap',
      });
      y = d.lastAutoTable.finalY + gap;

      // Items — compact "qty× name (size)" strings laid out in 2 columns so a
      // large menu stays readable and fits without shrinking as aggressively.
      const compact = buildLinesRows(o.lines).map(([name, size, qty]) => {
        const q = (qty !== '' && qty != null) ? `${qty}× ` : '';
        const sz = size ? `  (${size})` : '';
        return `${q}${name}${sz}`;
      });
      const colW = (pw - marginX * 2) / 2;
      const half = Math.max(1, Math.ceil(compact.length / 2));
      const itemBody = [];
      for (let i = 0; i < half; i++) itemBody.push([compact[i] || '', compact[half + i] || '']);
      autoTable(d, {
        startY: y,
        head: [[{ content: 'Items', colSpan: 2 }]],
        body: compact.length ? itemBody : [['-', '']],
        styles: { ...sharedStyles, fontStyle: 'bold' },
        headStyles: { ...darkHead, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: colW }, 1: { cellWidth: colW } },
        margin: { left: marginX, right: marginX },
        tableWidth: 'wrap',
      });
      y = d.lastAutoTable.finalY + gap;

      // Additional details (add-ons + codes)
      const { raitaLabel, warmersLabel, utensilsLabel } = parseAddOns(o.addOns);
      const agentCode = parseAgentReferenceCode(o.codes);
      const discountCode = parseDiscountCode(o.codes);
      autoTable(d, {
        startY: y,
        head: [['Additional Details', ' ']],
        body: [
          ['AddOns - Raita, Papad & Pickle', raitaLabel || '-'],
          ['AddOns - Warmers & Serving Spoons', warmersLabel || '-'],
          ['AddOns - Plates, Utensils & Napkins', utensilsLabel || '-'],
          ['Codes - Agent Reference', agentCode || '-'],
          ['Codes - Discount Code', discountCode || '-'],
        ],
        styles: sharedStyles,
        headStyles: darkHead,
        columnStyles: { 0: { cellWidth: 200 }, 1: { cellWidth: pw - marginX * 2 - 200 } },
        margin: { left: marginX, right: marginX },
        tableWidth: 'wrap',
      });
      y = d.lastAutoTable.finalY + gap;

      // Spice & Notes (includes Special Request)
      const spiceRows = buildSpiceAndNotesRows(o);
      autoTable(d, {
        startY: y,
        head: [['Spice & Notes', ' ']],
        body: spiceRows.length ? spiceRows : [['Spice', '-']],
        styles: sharedStyles,
        headStyles: darkHead,
        columnStyles: { 0: { cellWidth: 200 }, 1: { cellWidth: pw - marginX * 2 - 200 } },
        margin: { left: marginX, right: marginX },
        tableWidth: 'wrap',
      });

      return d.lastAutoTable.finalY;
    };

    pick.forEach((o, idx) => {
      // Measure natural height on a very tall page so nothing paginates.
      // (14400pt is jsPDF's max page dimension — far beyond any real order.)
      const scratch = new jsPDF({ unit: 'pt', format: [pageWidth, 14400] });
      const naturalBottom = drawOrder(scratch, o, 1);
      const naturalHeight = naturalBottom - marginTop;
      // Scale down only if needed; 0.97 keeps a little breathing room.
      const s = Math.min(1, (usable / naturalHeight) * 0.97);

      if (idx > 0) doc.addPage();
      drawOrder(doc, o, s);
    });

    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    doc.save(`kitchen-orders-${ts}.pdf`);
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="ui-card flex flex-wrap items-center gap-2">
        {/* Sort */}
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-400 mr-1">Sort</span>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="ui-select w-auto"
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
          className="ui-btn-outline ui-btn-sm"
          title="Toggle ascending/descending"
        >
          {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
        </button>

        <span className="mx-1 h-6 w-px bg-[color:var(--line)]" />

        {/* Filters */}
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-400 mr-1">Filter</span>
        <select
          value={filterMethod}
          onChange={(e) => setFilterMethod(e.target.value)}
          className="ui-select w-auto"
          title="Method"
        >
          <option value="all">Method: All</option>
          <option value="pickup">Pickup</option>
          <option value="delivery">Delivery</option>
        </select>
        <select
          value={filterPayMethod}
          onChange={(e) => setFilterPayMethod(e.target.value)}
          className="ui-select w-auto"
          title="Payment Method"
        >
          <option value="all">Payment: All</option>
          <option value="card">Card</option>
          <option value="cash">Cash</option>
        </select>
        <select
          value={filterPayStatus}
          onChange={(e) => setFilterPayStatus(e.target.value)}
          className="ui-select w-auto"
          title="Payment Status"
        >
          <option value="all">Status: All</option>
          <option value="paid">Paid</option>
          <option value="pending">Pending</option>
          <option value="refunded">Refunded</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button onClick={clearFilters} className="ui-btn-ghost ui-btn-sm">
          Clear
        </button>

        {/* Exports */}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={exportExcel} className="ui-btn-outline">
            Export Excel
          </button>
          <button
            disabled={!anyChecked}
            onClick={exportSelectedToPDF}
            className="ui-btn-primary"
          >
            Export PDF for Kitchen
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-auto border border-[#3a3636] rounded-lg">
        <table className="w-full min-w-[1250px] text-left">
          <thead className="bg-[#2a2727] text-[#F58735] sticky top-0 z-10">
            <tr className="text-sm">
              <th className="p-2 border-b border-[#3a3636]">
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
                    className={`border-b border-[#3a3636] cursor-pointer ${isOpen ? 'bg-[#2a2727]' : 'odd:bg-[#2a2727] even:bg-[#2a2727]'} hover:bg-[#333030]`}
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
