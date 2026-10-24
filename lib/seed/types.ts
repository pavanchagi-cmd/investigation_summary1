export type SeedCp = {
  name: string;
  account: string;
  bank: string;
  bankCountry: string;
  /** Counterparty's own country (originator for incoming, beneficiary for outgoing). */
  country: string;
  relationship: string | null;
  notes: string | null;
  /** True for the client's own other accounts. */
  own?: boolean;
};

export type SeedTxn = {
  date: string;
  txnId: string;
  direction: "incoming" | "outgoing";
  amount: number;
  currency: string;
  /** Text written to the file's Type column (synonyms such as "SWIFT" exercise the mapper). */
  typeText: string;
  type: "wire" | "ach" | "cash" | "cheque" | "card" | "internal";
  cp: SeedCp;
  reference: string;
};

/** A deliberately malformed row inserted at a fixed spreadsheet row number. */
export type SeedMalformed = { excelRow: number; cells: Record<string, string | number | null>; problem: string };

export type SeedSubAlert = {
  number: string;
  scenario: "large_amount" | "pattern_of_funds" | "round_dollar" | "wire_structuring";
  ruleId: string;
  threshold: string;
  details: string;
  triggeringCount: number;
  page: number;
};

export type SeedPriorCase = { alertNumber: string; date: string; scenario: string; outcome: string; summary: string };

export type SeedRfi = {
  date: string;
  respondent: string;
  items: { question: string; answer: string; counterparty: string | null }[];
  summary: string;
};

export type SeedAlert = {
  seed: number;
  alertNumber: string;
  alertDate: string;
  lookbackDays: number;
  reviewStart: string;
  reviewEnd: string;
  client: {
    name: string;
    cif: string;
    entityType: string;
    incorporationDate: string;
    incorporationCountry: string;
    natureOfBusiness: string;
    industryCode: string | null;
    turnover: { amount: number; currency: string };
    expected: { monthlyVolume: number; monthlyValue: number; currency: string; countries: string[]; products: string[] };
    accounts: { number: string; opened: string }[];
    riskRating: string;
    pep: string;
    sanctions: string;
    adverseMedia: string;
    priorAlerts: number;
    priorSars: number;
  };
  subAlerts: SeedSubAlert[];
  counterparties: SeedCp[];
  txns: SeedTxn[];
  malformed: SeedMalformed[];
  priorCases: SeedPriorCase[];
  rfi: SeedRfi;
  /** Ground truth used by the unit tests (spec section 14). */
  expected: {
    inPeriod: number;
    excluded: number;
    malformedRows: number;
    findings: Partial<Record<"large_amount" | "pattern_of_funds" | "round_dollar" | "wire_structuring", { matches: number; subtypes: string[] }>>;
    notFiring: ("large_amount" | "pattern_of_funds" | "round_dollar" | "wire_structuring")[];
  };
};
