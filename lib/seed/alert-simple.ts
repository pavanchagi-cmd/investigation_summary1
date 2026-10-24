import { isoDay, rng, spreadDays } from "./random";
import { repairPassThrough } from "./repair";
import type { SeedAlert, SeedCp, SeedTxn } from "./types";

/**
 * ALR-2026-000101 (Large Amount), -000102 (Pattern of Funds), -000103 (Round Dollar).
 * Same construction rules as ALR-2026-000123 so only the planted scenario fires:
 * - minor receipts (≤ 1,400) are always smaller than payments (≥ 1,600): no accidental pass-through;
 * - incoming customers in 13-day blocks and payees in 8-day blocks: ≤ 4 parties per 7 days;
 * - no wires in the 9,000–9,999 band and no wires under 10,000 to one payee: no structuring;
 * - transactions outside the period are dated after it, so the volume test uses the KYC value.
 */

const START = "2026-07-01";
type Planned = Omit<SeedTxn, "txnId">;

function cp(name: string, account: string, bank: string, country: string, relationship: string | null): SeedCp {
  return { name, account, bank, bankCountry: country, country, relationship, notes: null };
}

type Spec = {
  seed: number;
  alertNumber: string;
  client: SeedAlert["client"];
  subAlert: SeedAlert["subAlerts"][number];
  /** Extra planted transactions (day offsets in the period). */
  planted: (add: (day: number, dir: "incoming" | "outgoing", amount: number, c: SeedCp, type: SeedTxn["type"], typeText: string, ref: string) => void) => void;
  plantedCredit?: (t: Planned) => boolean;
  /** Fraction of payee payments that are round thousands. */
  roundOutShare: number;
  expected: SeedAlert["expected"];
  priorCases: SeedAlert["priorCases"];
  rfi: SeedAlert["rfi"];
  idBase: number;
  extraCps: SeedCp[];
  historyRange: [number, number];
  /** Amount range of the out-of-period rows (sets the "client average" for the large-amount test). */
  historyAmount: [number, number];
};

function buildSimple(spec: Spec): SeedAlert {
  const r = rng(spec.seed);
  const txns: Planned[] = [];
  const add = (day: number, direction: "incoming" | "outgoing", amount: number, c: SeedCp, type: SeedTxn["type"], typeText: string, reference: string) =>
    txns.push({ date: isoDay(START, day), direction, amount: Math.round(amount * 100) / 100, currency: "USD", type, typeText, cp: c, reference });

  const tag = spec.alertNumber.slice(-3);
  const customers = Array.from({ length: 7 }, (_, k) =>
    cp(`${["Amber", "Birch", "Cedar", "Dune", "Ember", "Fern", "Grove"][k]} Retail ${tag}`, `3006${tag}${k}001`, k % 2 ? "Deccan Commercial Bank" : "Coastal Union Bank", "IN", "Customer"),
  );
  const payees = Array.from({ length: 10 }, (_, k) =>
    cp(`${["Harbor", "Indigo", "Juniper", "Kite", "Lotus", "Maple", "Nimbus", "Opal", "Pebble", "Quartz"][k]} Supplies ${tag}`, `3007${tag}${k}002`, k % 2 ? "Coastal Union Bank" : "Deccan Commercial Bank", "IN", "Supplier"),
  );

  // Receipts: 7 customers in 13-day blocks, 26 each, 400–1,400.
  customers.forEach((c, k) => {
    const from = k * 13;
    const to = k === 6 ? 91 : from + 12;
    spreadDays(r, 26, from, to).forEach((d, i) => add(d, "incoming", r.nonRound(400, 1_400), c, "ach", "NEFT", `Receipt ${i + 1}`));
  });
  // Payments: 10 payees in 8-day blocks (one block idle), 9 each, 1,600–8,000 ACH.
  payees.forEach((c, k) => {
    const b = k < 5 ? k : k + 1;
    spreadDays(r, 9, b * 8, b * 8 + 7).forEach((d, i) =>
      add(d, "outgoing", r.next() < spec.roundOutShare ? r.round(2_000, 8_000) : r.nonRound(1_600, 8_000), c, "ach", "NEFT", `Bill ${c.name.split(" ")[0]}-${i + 1}`),
    );
  });
  spec.planted(add);
  repairPassThrough(txns, START, 91, spec.plantedCredit ?? (() => false));

  // 18 rows after the period (excluded by the review-period filter).
  const history: Planned[] = spreadDays(r, 18, spec.historyRange[0], spec.historyRange[1]).map((d, i) => {
    const incoming = i % 2 === 0;
    const c = incoming ? customers[i % 7] : payees[i % 10];
    return {
      date: isoDay(START, d),
      direction: incoming ? "incoming" : "outgoing",
      amount: r.nonRound(spec.historyAmount[0], spec.historyAmount[1]),
      currency: "USD",
      type: "ach",
      typeText: "NEFT",
      cp: c,
      reference: "After review period",
    };
  });

  const all = [...txns, ...history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    seed: spec.seed,
    alertNumber: spec.alertNumber,
    alertDate: "2026-10-02",
    lookbackDays: 92,
    reviewStart: "2026-07-01",
    reviewEnd: "2026-09-30",
    client: spec.client,
    subAlerts: [spec.subAlert],
    counterparties: [...customers, ...payees, ...spec.extraCps],
    txns: all.map((t, i) => ({ ...t, txnId: `TX-${spec.idBase + i * 7}` })),
    malformed: [
      { excelRow: 57, cells: { Amount: "1,2O5.40" }, problem: "letter O in amount" },
      { excelRow: 190, cells: { Date: null }, problem: "missing date" },
    ],
    priorCases: spec.priorCases,
    rfi: spec.rfi,
    expected: spec.expected,
  };
}

const baseClient = (over: Partial<SeedAlert["client"]>): SeedAlert["client"] => ({
  name: "",
  cif: "",
  entityType: "Private company",
  incorporationDate: "2015-01-01",
  incorporationCountry: "IN",
  natureOfBusiness: "",
  industryCode: null,
  turnover: { amount: 4_000_000, currency: "USD" },
  expected: { monthlyVolume: 100, monthlyValue: 400_000, currency: "USD", countries: ["IN"], products: ["NEFT", "wires"] },
  accounts: [],
  riskRating: "Medium",
  pep: "No",
  sanctions: "No match",
  adverseMedia: "None",
  priorAlerts: 0,
  priorSars: 0,
  ...over,
});

export function buildAlert101(): SeedAlert {
  const buyer = cp("Ironclad Engineering Ltd", "GB29XYZB40051512345678", "Thames Merchant Bank", "GB", "Customer (stated)");
  const vendor = cp("Precision Lathe Systems", "30071019988710", "Deccan Commercial Bank", "IN", "Equipment vendor");
  return buildSimple({
    seed: 101_2026,
    alertNumber: "ALR-2026-000101",
    idBase: 510_000,
    client: baseClient({
      name: "Northwind Castings Pvt Ltd",
      cif: "10031107",
      incorporationDate: "2012-08-21",
      natureOfBusiness: "Manufacture of ferrous castings for pumps and valves",
      industryCode: "C2451",
      accounts: [{ number: "50210001101", opened: "2012-09-10" }],
    }),
    subAlert: { number: "ALR-2026-000101-01", scenario: "large_amount", ruleId: "LA-01", threshold: "USD 50,000", details: "Single transaction of USD 50,000 or more, or above 3x the client average", triggeringCount: 2, page: 2 },
    planted: (add) => {
      add(44, "incoming", 64_500.35, buyer, "wire", "SWIFT", "Order IE-2291 pump housings"); // ≥ threshold
      add(63, "outgoing", 31_250.75, vendor, "wire", "RTGS", "CNC lathe deposit"); // > 3× average, below threshold
    },
    roundOutShare: 0.2,
    extraCps: [buyer, vendor],
    historyRange: [93, 104],
    historyAmount: [5_000, 11_000],
    priorCases: [{ alertNumber: "ALR-2024-000210", date: "2024-06-04", scenario: "Large Amount Transaction", outcome: "Closed – no further action", summary: "Export receipt supported by invoice and shipping bill." }],
    rfi: {
      date: "2026-10-08",
      respondent: "Accounts Head, Northwind Castings Pvt Ltd",
      items: [
        { question: "What was the receipt of USD 64,500 from Ironclad Engineering Ltd for?", answer: "Export order IE-2291 for pump housings, invoice attached.", counterparty: "Ironclad Engineering Ltd" },
        { question: "What was the payment of USD 31,250 to Precision Lathe Systems for?", answer: "Deposit on a CNC lathe; purchase order attached.", counterparty: "Precision Lathe Systems" },
      ],
      summary: "Client explains both large transactions as a documented export order and an equipment deposit.",
    },
    expected: { inPeriod: 274, excluded: 18, malformedRows: 2, findings: { large_amount: { matches: 2, subtypes: ["over_threshold", "over_average_multiple"] } }, notFiring: ["pattern_of_funds", "round_dollar", "wire_structuring"] },
  });
}

export function buildAlert102(): SeedAlert {
  const src = cp("Orchid Exports FZE", "AE12034500011223344556", "Gulf Mercantile Bank", "AE", "Customer (stated)");
  const dst = cp("Bayline Traders Ltd", "HK00399812004321", "Pacific Crown Bank", "HK", "Supplier (stated)");
  const credits = [31_420.55, 38_910.2, 42_305.75, 35_660.1, 44_180.4, 33_745.9];
  const debits = [30_985.1, 38_350.65, 41_620.3, 35_140.85, 43_390.15, 33_210.45]; // within 2%
  const days = [6, 21, 37, 52, 66, 81];
  const lag = [1, 3, 2, 1, 2, 3];
  return buildSimple({
    seed: 102_2026,
    alertNumber: "ALR-2026-000102",
    idBase: 620_000,
    client: baseClient({
      name: "Larkspur Commodities Pvt Ltd",
      cif: "10052219",
      incorporationDate: "2017-02-03",
      natureOfBusiness: "Wholesale trading of agricultural commodities",
      industryCode: "G4620",
      riskRating: "High",
      expected: { monthlyVolume: 110, monthlyValue: 600_000, currency: "USD", countries: ["IN", "AE"], products: ["NEFT", "wires"] },
      accounts: [{ number: "50210001102", opened: "2017-03-01" }],
    }),
    subAlert: { number: "ALR-2026-000102-01", scenario: "pattern_of_funds", ruleId: "PF-11", threshold: "±5%", details: "in-and-out within 3 days, ±5% amount", triggeringCount: 12, page: 2 },
    planted: (add) => {
      days.forEach((d, i) => {
        add(d, "incoming", credits[i], src, "wire", "SWIFT", `Sales contract OE-${40 + i}`);
        add(d + lag[i], "outgoing", debits[i], dst, "wire", "SWIFT", `Purchase BT-${70 + i}`);
      });
    },
    plantedCredit: (t) => t.cp.name === src.name && credits.includes(t.amount),
    roundOutShare: 0.2,
    extraCps: [src, dst],
    historyRange: [93, 104],
    historyAmount: [18_000, 26_000],
    priorCases: [],
    rfi: {
      date: "2026-10-07",
      respondent: "Director, Larkspur Commodities Pvt Ltd",
      items: [{ question: "Why are receipts from Orchid Exports FZE paid on to Bayline Traders Ltd within days?", answer: "Back-to-back trade: we buy from Bayline and sell to Orchid.", counterparty: "Orchid Exports FZE" }],
      summary: "Client describes the flows as back-to-back trades; no contracts were provided.",
    },
    expected: { inPeriod: 284, excluded: 18, malformedRows: 2, findings: { pattern_of_funds: { matches: 12, subtypes: ["pass_through"] } }, notFiring: ["large_amount", "round_dollar", "wire_structuring"] },
  });
}

export function buildAlert103(): SeedAlert {
  return buildSimple({
    seed: 103_2026,
    alertNumber: "ALR-2026-000103",
    idBase: 730_000,
    client: baseClient({
      name: "Marigold Wholesale Pvt Ltd",
      cif: "10060331",
      incorporationDate: "2014-11-17",
      natureOfBusiness: "Wholesale distribution of household goods",
      industryCode: "G4649",
      accounts: [{ number: "50210001103", opened: "2014-12-02" }],
    }),
    subAlert: { number: "ALR-2026-000103-01", scenario: "round_dollar", ruleId: "RD-02", threshold: "40%", details: "40% or more of outgoing transactions in multiples of 1,000", triggeringCount: 53, page: 2 },
    planted: () => {},
    roundOutShare: 0.55,
    extraCps: [],
    historyRange: [93, 104],
    historyAmount: [5_000, 11_000],
    priorCases: [],
    rfi: {
      date: "2026-10-06",
      respondent: "Proprietor, Marigold Wholesale Pvt Ltd",
      items: [{ question: "Why are many supplier payments in exact thousands?", answer: "Suppliers ask for advances in round amounts; balances settled later.", counterparty: null }],
      summary: "Client says round payments are supplier advances.",
    },
    expected: { inPeriod: 272, excluded: 18, malformedRows: 2, findings: { round_dollar: { matches: 53, subtypes: ["outgoing"] } }, notFiring: ["large_amount", "pattern_of_funds", "wire_structuring"] },
  });
}
