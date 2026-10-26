import { isoDay, rng, spreadDays, type Rng } from "./random";
import { repairPassThrough } from "./repair";
import type { SeedAlert, SeedCp, SeedTxn } from "./types";

/**
 * ALR-2026-000123 · Kestrel Trading Pvt Ltd (as in the design): Wire Structuring + Round Dollar +
 * Pattern of Funds. All names, accounts and banks are invented; risk countries use placeholder
 * codes from the config lists (XA, XB).
 *
 * Construction notes (so no rule fires by accident):
 * - Outgoing parties: Morrow and Pinewood throughout; every other payee only inside its own 8-day
 *   block, so no 7-day window has more than 4 distinct payees (funnel rule). Incoming: Harbourline
 *   and R. Menon throughout, minor customers in 13-day blocks.
 * - Only Pinewood's 7 planted wires are in the 9,000–9,999 band; other wires to one payee are ≥ 10,000
 *   and small domestic payments are ACH, so no split-payment window exists.
 * - Minor receipts (300–1,400) are always smaller than any payment (≥ 1,500), so no accidental pass-through.
 */

const START = "2026-07-01";
const CCY = "USD";

const cp = (name: string, account: string, bank: string, bankCountry: string, country: string, relationship: string | null, notes: string | null = null): SeedCp => ({
  name,
  account,
  bank,
  bankCountry,
  country,
  relationship,
  notes,
});

export const KESTREL_CPS = {
  harbourline: cp("Harbourline Logistics FZE", "AE070331234567892210", "Gulf Mercantile Bank", "AE", "AE", "Freight forwarder (stated)"),
  morrow: cp("Morrow Metals Ltd", "HK00488120338803", "Pacific Crown Bank", "HK", "HK", "Metals supplier (stated)"),
  aurelia: cp("Aurelia Holdings S.A.", "XB9930021775530", "Meridian Trust Bank", "XB", "XB", null, "No relationship stated by client"),
  pinewood: cp("Pinewood Textiles", "30012209871172", "Deccan Commercial Bank", "IN", "IN", null),
  velo: cp("Velo Commodities LLC", "XA4410098226091", "Northgate Bank", "XA", "XA", "Commodity broker (stated)"),
  menon: cp("R. Menon", "40031177223348", "Coastal Union Bank", "IN", "IN", "Individual – not stated"),
  saffron: cp("Saffron Freight Co.", "30098812004417", "Deccan Commercial Bank", "IN", "IN", "Freight"),
  orbis: cp("Orbis Trade Services MSB", "AE550990000123456000", "Gulf Mercantile Bank", "AE", "AE", "Payment agent (stated)"),
  bluecoast: cp("Bluecoast Shipping", "SG77123400998811", "Straits Harbour Bank", "SG", "SG", "Shipping"),
  own: { ...cp("Kestrel Trading Pvt Ltd", "50210009912", "Coastal Union Bank", "IN", "IN", "Client's own account"), own: true },
  // Minor payees (domestic, ACH).
  o1: cp("Shree Ganesh Scrap Traders", "30044455501", "Deccan Commercial Bank", "IN", "IN", "Scrap supplier"),
  o2: cp("Vasant Industrial Supplies", "30044455502", "Coastal Union Bank", "IN", "IN", "Consumables"),
  o3: cp("Konkan Transport Services", "30044455503", "Deccan Commercial Bank", "IN", "IN", "Local haulage"),
  // Minor customers (domestic receipts).
  i1: cp("Apex Foundry Works", "30055566601", "Coastal Union Bank", "IN", "IN", "Customer"),
  i2: cp("Bharat Alloy Castings", "30055566602", "Deccan Commercial Bank", "IN", "IN", "Customer"),
  i3: cp("Crescent Wire Products", "30055566603", "Coastal Union Bank", "IN", "IN", "Customer"),
  i4: cp("Delta Fabricators", "30055566604", "Deccan Commercial Bank", "IN", "IN", "Customer"),
  i5: cp("Everest Pipes & Tubes", "30055566605", "Coastal Union Bank", "IN", "IN", "Customer"),
  i6: cp("Falcon Auto Components", "30055566606", "Deccan Commercial Bank", "IN", "IN", "Customer"),
  i7: cp("Garuda Engineering", "30055566607", "Coastal Union Bank", "IN", "IN", "Customer"),
};

export function buildAlert123(): SeedAlert {
  const r: Rng = rng(123_2026);
  const C = KESTREL_CPS;
  const txns: Omit<SeedTxn, "txnId">[] = [];
  const add = (day: number, direction: "incoming" | "outgoing", amount: number, c: SeedCp, type: SeedTxn["type"], typeText: string, reference: string) =>
    txns.push({ date: isoDay(START, day), direction, amount: Math.round(amount * 100) / 100, currency: CCY, type, typeText, cp: c, reference });

  // Pattern of Funds: 6 pass-through pairs (Harbourline in → Morrow out within ≤ 3 days, within 2%).
  const ptCredits = [88_350.4, 94_618.25, 79_240.1, 101_305.6, 86_712.35, 92_453.3];
  const ptDebits = [87_000, 93_000, 78_000, 100_000, 85_000, 91_000];
  const ptDays = [5, 20, 33, 47, 61, 76];
  const ptLag = [2, 1, 3, 2, 1, 3];
  ptDays.forEach((d, i) => {
    add(d, "incoming", ptCredits[i], C.harbourline, "wire", "SWIFT", `INV-HL-26${String(410 + i)} freight settlement`);
    add(d + ptLag[i], "outgoing", ptDebits[i], C.morrow, "wire", "SWIFT", `PO-MM-${7710 + i} metal purchase`);
  });
  // Morrow: 3 further round payments (one non-round to hit the design total 842,500).
  [[10, 102_000], [57, 103_000], [88, 103_500]].forEach(([d, a], i) => add(d, "outgoing", a, C.morrow, "wire", "SWIFT", `PO-MM-${7720 + i} metal purchase`));

  // Harbourline: 6 more receipts and 2 payments (35,000 and 41,000) – total 1,284,000.
  const hlOut = [35_000, 41_000];
  const ptSum = ptCredits.reduce((s, x) => s + x, 0);
  const hlOtherTotal = 1_284_000 - ptSum - hlOut[0] - hlOut[1];
  const hlOtherDays = [12, 27, 40, 54, 68, 84];
  const hlOther = [118_400.55, 104_220.8, 109_870.15, 112_640.4, 107_315.9];
  hlOther.push(Math.round((hlOtherTotal - hlOther.reduce((s, x) => s + x, 0)) * 100) / 100);
  hlOtherDays.forEach((d, i) => add(d, "incoming", hlOther[i], C.harbourline, "wire", "TT", `HL refund / rebate ${i + 1}`));

  // Wire Structuring: 7 wires to Pinewood of 9,500–9,950 within 6 days (02–07 Aug), total 68,900.
  [[32, 9_900], [33, 9_950], [34, 9_800], [35, 9_500], [35, 9_850], [36, 9_950], [37, 9_950]].forEach(([d, a], i) =>
    add(d, "outgoing", a, C.pinewood, "wire", "Wire", `Advance ${i + 1} fabric order`),
  );
  // Pinewood: 15 more payments ≥ 10,000 (12 round, 3 non-round) – total 410,300.
  const pwDays = [3, 9, 15, 21, 26, 30, 42, 46, 52, 58, 64, 71, 77, 82, 89];
  const pwRound = [18_000, 22_000, 25_000, 20_000, 31_000, 19_000, 27_000, 24_000, 21_000, 26_000, 23_000, 28_000];
  const pwNon = [16_250.5, 14_480.25];
  const pwLast = 410_300 - 68_900 - pwRound.reduce((s, x) => s + x, 0) - pwNon.reduce((s, x) => s + x, 0);
  const pwAmounts = [...pwRound, ...pwNon, Math.round(pwLast * 100) / 100];
  pwDays.forEach((d, i) => add(d, "outgoing", pwAmounts[i], C.pinewood, "wire", "Wire", `Fabric order ${i + 1}`));

  // R. Menon: 6 receipts (non-round) and 5 round payments – total 168,400.
  const menonOut = [5_000, 6_000, 7_000, 5_000, 6_000];
  const menonInDays = [8, 23, 38, 53, 70, 86];
  const menonInBase = [22_410.35, 24_105.6, 20_880.9, 25_330.15, 23_760.4];
  const menonInTotal = 168_400 - menonOut.reduce((s, x) => s + x, 0);
  menonInBase.push(Math.round((menonInTotal - menonInBase.reduce((s, x) => s + x, 0)) * 100) / 100);
  menonInDays.forEach((d, i) => add(d, "incoming", menonInBase[i], C.menon, "ach", "NEFT", "Transfer"));

  // One-at-a-time payee blocks (8 days each).
  const block = (b: number) => [b * 8, b * 8 + 7] as const;
  const inBlock = (b: number, n: number) => spreadDays(r, n, ...block(b));
  // B0: O1 (11 small ACH), B1: Aurelia (6 round), B2: R. Menon out, B3: Saffron, B4: own, B5: O2, B6: Velo,
  // B7: Harbourline out, B8: Orbis, B9: O3, B10: Bluecoast.
  const smallOut = (b: number, c: SeedCp, n: number) => inBlock(b, n).forEach((d, i) => add(d, "outgoing", r.nonRound(1_500, 3_500), c, "ach", "NEFT", `Invoice ${c.name.split(" ")[0].toUpperCase()}-${300 + i}`));
  smallOut(0, C.o1, 11);
  const aureliaDays = inBlock(1, 6);
  [95_000, 100_000, 110_000, 98_000, 105_000, 90_000].forEach((a, i) => add(aureliaDays[i], "outgoing", a, C.aurelia, "wire", "SWIFT", "Consulting"));
  inBlock(2, 5).forEach((d, i) => add(d, "outgoing", menonOut[i], C.menon, "ach", "IMPS", "Payment"));
  const saffron = [24_310.2, 26_480.75, 23_905.4, 25_770.1, 26_115.3];
  saffron.push(Math.round((151_900 - saffron.reduce((s, x) => s + x, 0)) * 100) / 100);
  inBlock(3, 6).forEach((d, i) => add(d, "outgoing", saffron[i], C.saffron, "wire", "RTGS", `Freight bill SF-${880 + i}`));
  const ownDays = inBlock(4, 2);
  [40_000, 48_250].forEach((a, i) => add(ownDays[i], "outgoing", a, C.own, "internal", "Own account transfer", "Sweep to operating a/c"));
  smallOut(5, C.o2, 11);
  const veloDays = inBlock(6, 4);
  [50_000, 55_000, 52_000, 55_000].forEach((a, i) => add(veloDays[i], "outgoing", a, C.velo, "wire", "SWIFT", `Commodity margin ${i + 1}`));
  const hlOutDays = inBlock(7, 2);
  hlOut.forEach((a, i) => add(hlOutDays[i], "outgoing", a, C.harbourline, "wire", "SWIFT", `Freight advance HL-${i + 1}`));
  const orbisDays = inBlock(8, 3);
  [30_000, 32_000, 34_000].forEach((a, i) => add(orbisDays[i], "outgoing", a, C.orbis, "wire", "SWIFT", "Settlement on behalf of client"));
  smallOut(9, C.o3, 11);
  const blue = [14_820.6, 15_975.35, 16_210.9];
  blue.push(Math.round((61_400 - blue.reduce((s, x) => s + x, 0)) * 100) / 100);
  inBlock(10, 4).forEach((d, i) => add(d, "outgoing", blue[i], C.bluecoast, "wire", "SWIFT", `Ocean freight BC-${50 + i}`));

  // Minor customers: 198 receipts in 13-day blocks, 300–1,400 each.
  const customers = [C.i1, C.i2, C.i3, C.i4, C.i5, C.i6, C.i7];
  const perCustomer = [28, 28, 28, 28, 29, 28, 29];
  customers.forEach((c, k) => {
    const from = k * 13;
    const to = k === 6 ? 91 : from + 12;
    spreadDays(r, perCustomer[k], from, to).forEach((d, i) => add(d, "incoming", r.nonRound(300, 1_200), c, "ach", "NEFT", `Receipt ${c.name.split(" ")[0].toUpperCase()}/${i + 1}`));
  });

  // Hit the design's total in-period flow exactly (USD 4,142,880): spread the difference over minor receipts.
  const target = 4_142_880;
  const minor = txns.filter((t) => customers.includes(t.cp));
  const diff = target - txns.reduce((s, t) => s + t.amount, 0);
  const each = Math.trunc((diff / minor.length) * 100) / 100;
  minor.forEach((t) => (t.amount = Math.round((t.amount + each) * 100) / 100));
  const rest = Math.round((target - txns.reduce((s, t) => s + t.amount, 0)) * 100) / 100;
  minor[minor.length - 1].amount = Math.round((minor[minor.length - 1].amount + rest) * 100) / 100;

  // Move any receipt that accidentally pairs with a payment (only the 6 planted pairs may exist).
  repairPassThrough(txns, START, 91, (credit) => credit.cp === C.harbourline && ptCredits.includes(credit.amount));

  // History: 18 transactions in the 6 months before the period (prior 6-month total 3,426,600 → 2.4×).
  const history: Omit<SeedTxn, "txnId">[] = [];
  const histParties = [C.harbourline, C.morrow, C.pinewood, C.i1, C.i2, C.saffron];
  const histAmounts = Array.from({ length: 17 }, () => r.nonRound(150_000, 230_000));
  histAmounts.push(Math.round((3_426_600 - histAmounts.reduce((s, x) => s + x, 0)) * 100) / 100);
  spreadDays(r, 18, -181, -2).forEach((d, i) => {
    const c = histParties[i % histParties.length];
    const direction = c === C.morrow || c === C.pinewood || c === C.saffron ? "outgoing" : "incoming";
    history.push({ date: isoDay(START, d), direction, amount: histAmounts[i], currency: CCY, type: "wire", typeText: "SWIFT", cp: c, reference: "Prior period" });
  });

  const all = [...history, ...txns].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const withIds: SeedTxn[] = all.map((t, i) => ({ ...t, txnId: `TX-${889000 + i * 3}` }));

  return {
    seed: 123_2026,
    alertNumber: "ALR-2026-000123",
    alertDate: "2026-10-02",
    lookbackDays: 90,
    reviewStart: "2026-07-01",
    reviewEnd: "2026-09-30",
    client: {
      name: "Kestrel Trading Pvt Ltd",
      cif: "10048832",
      entityType: "Private company",
      incorporationDate: "2019-03-14",
      incorporationCountry: "IN",
      natureOfBusiness: "Import/export of industrial metals and scrap",
      industryCode: null,
      turnover: { amount: 6_000_000, currency: "USD" },
      expected: { monthlyVolume: 120, monthlyValue: 500_000, currency: "USD", countries: ["IN", "AE", "SG"], products: ["wires"] },
      accounts: [{ number: "50210004417", opened: "2019-04-02" }],
      riskRating: "High",
      pep: "No",
      sanctions: "No match",
      adverseMedia: "1 hit – 2024 customs dispute (closed)",
      priorAlerts: 2,
      priorSars: 0,
    },
    subAlerts: [
      { number: "ALR-2026-000123-01", scenario: "wire_structuring", ruleId: "WS-04", threshold: "USD 10,000", details: "5+ wires at 90–99.99% of USD 10,000 within 7 days", triggeringCount: 7, page: 2 },
      { number: "ALR-2026-000123-02", scenario: "round_dollar", ruleId: "RD-02", threshold: "40%", details: "40% or more of outgoing value in multiples of 1,000", triggeringCount: 41, page: 2 },
      { number: "ALR-2026-000123-03", scenario: "pattern_of_funds", ruleId: "PF-11", threshold: "±5%", details: "in-and-out within 3 days, ±5% amount", triggeringCount: 12, page: 3 },
    ],
    counterparties: Object.values(C),
    txns: withIds,
    malformed: [
      { excelRow: 118, cells: { Amount: "4.9OO.00" }, problem: "letter O in amount; 4.9 or 4,900 is ambiguous" },
      { excelRow: 241, cells: { Date: null }, problem: "missing date" },
    ],
    priorCases: [
      { alertNumber: "ALR-2025-000488", date: "2025-03-11", scenario: "Large Amount Transaction", outcome: "Closed – no further action", summary: "Single receipt of USD 240,000 from a scrap buyer; invoice and bill of lading provided." },
      { alertNumber: "ALR-2025-001207", date: "2025-11-20", scenario: "Round Dollar Transaction", outcome: "Closed – no further action", summary: "Round-amount payments to a metals supplier explained by fixed-price contracts." },
    ],
    rfi: {
      date: "2026-10-09",
      respondent: "Finance Manager, Kestrel Trading Pvt Ltd",
      items: [
        { question: "Explain the relationship with Harbourline Logistics FZE.", answer: "Harbourline is our freight forwarder for shipments to the Gulf. Some customers pay freight through them and they pass it on.", counterparty: "Harbourline Logistics FZE" },
        { question: "What were the payments to Aurelia Holdings S.A. for?", answer: "Consulting services for market entry. Contract not yet signed.", counterparty: "Aurelia Holdings S.A." },
        { question: "Why were seven payments of just under USD 10,000 made to Pinewood Textiles in August?", answer: "Advance payments for fabric bags, paid in parts as requested by the supplier.", counterparty: "Pinewood Textiles" },
      ],
      summary: "Client states Harbourline is its freight forwarder, Aurelia payments were for consulting without a signed contract, and Pinewood payments were split advances requested by the supplier.",
    },
    expected: {
      inPeriod: 312,
      excluded: 18,
      malformedRows: 2,
      findings: {
        wire_structuring: { matches: 7, subtypes: ["near_threshold", "split_payments"] },
        pattern_of_funds: { matches: 12, subtypes: ["pass_through", "volume_change"] },
        round_dollar: { matches: 41, subtypes: ["outgoing"] },
      },
      notFiring: [],
      // Large Amount also fires here (S8): 31 transactions of USD 50,000 or more.
    },
  };
}
