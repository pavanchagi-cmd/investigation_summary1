/** Pure value parsers for the transaction normaliser (spec section 5). Never guess: the only repairs are the unambiguous amount typos in suggestAmountFix, which are shown to the analyst. */

export type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T>(problem: string): Parsed<T> => ({ ok: false, problem });

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

export type DayMonthOrder = "dmy" | "mdy" | "unknown" | "conflict";

function iso(y: number, m: number, d: number): Parsed<string> {
  if (m < 1 || m > 12) return fail(`month ${m} is not valid`);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d < 1 || d > days) return fail(`day ${d} is not valid for ${y}-${String(m).padStart(2, "0")}`);
  return ok(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
}

const SLASH = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/;

function fullYear(y: string) {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

/**
 * Looks at every slash/dot date in a column to decide whether it is day-first or month-first.
 * A value with a first part > 12 proves day-first; a second part > 12 proves month-first.
 */
export function detectDayMonthOrder(values: unknown[]): DayMonthOrder {
  let dmy = false;
  let mdy = false;
  for (const v of values) {
    if (typeof v !== "string") continue;
    const m = v.trim().match(SLASH);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12) dmy = true;
    if (b > 12) mdy = true;
  }
  if (dmy && mdy) return "conflict";
  if (dmy) return "dmy";
  if (mdy) return "mdy";
  return "unknown";
}

/** Excel serial date (1900 system) → ISO. Only 1990–2099 is accepted so stray numbers are not read as dates. */
function excelSerial(n: number): Parsed<string> {
  if (!Number.isFinite(n) || n < 32874 || n >= 73051) return fail(`"${n}" is not a date`);
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Parses DD/MM/YYYY, MM/DD/YYYY (when the column order is known), YYYY-MM-DD, DD-Mon-YY(YY),
 * "DD Mon YYYY", Date objects and Excel serials. Ambiguous day/month is a problem, not a guess.
 */
export function parseDateValue(raw: unknown, order: DayMonthOrder = "unknown"): Parsed<string> {
  if (raw == null || raw === "") return fail("missing date");
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return fail("invalid date");
    return iso(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate());
  }
  if (typeof raw === "number") return excelSerial(raw);
  const s = String(raw).trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,4})[-\s,]*(\d{2}|\d{4})$/))) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (!mon) return fail(`unknown month "${m[2]}"`);
    return iso(fullYear(m[3]), mon, +m[1]);
  }
  if ((m = s.match(SLASH))) {
    const a = +m[1];
    const b = +m[2];
    const y = fullYear(m[3]);
    if (order === "dmy") return iso(y, b, a);
    if (order === "mdy") return iso(y, a, b);
    if (order === "conflict") return fail(`"${s}": the column mixes day-first and month-first dates`);
    if (a === b) return iso(y, b, a);
    if (a > 12) return iso(y, b, a);
    if (b > 12) return iso(y, a, b);
    return fail(`"${s}": day and month are ambiguous`);
  }
  if (/^\d+(\.\d+)?$/.test(s)) return excelSerial(Number(s));
  return fail(`"${s}" is not a recognised date`);
}

/**
 * Amounts: strips thousands separators, spaces and a leading/trailing ISO currency code.
 * Letters inside the number (e.g. "4,9OO.00") are a problem. Returns a signed number.
 */
export function parseAmount(raw: unknown): Parsed<number> {
  if (raw == null || raw === "") return fail("missing amount");
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return fail("amount is not a number");
    return ok(Math.round(raw * 100) / 100);
  }
  let s = String(raw).trim();
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^[A-Z]{3}\s*/, "").replace(/\s*[A-Z]{3}$/, "").replace(/^[$€£₹]\s*/, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1).trim();
  }
  if (/[A-Za-z]/.test(s)) return fail(`amount "${String(raw)}" contains letters`);
  const cleaned = s.replace(/[,\s']/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return fail(`amount "${String(raw)}" is not a valid number`);
  const n = Number(cleaned);
  return ok(Math.round((negative ? -n : n) * 100) / 100);
}

/** Resolution reason on issues the parser corrected itself (shown so the analyst can verify). */
export const AUTO_CORRECTED_PREFIX = "Auto-corrected";

/**
 * Repairs an amount that failed to parse when the intended value is unambiguous: letter O/o for
 * zero, I/l for one, a doubled decimal point, or a stray ".00" after a two-place decimal
 * ("88.25.00"). Returns the corrected text, or null when a person has to decide.
 */
export function suggestAmountFix(raw: unknown): string | null {
  if (raw == null || typeof raw === "number") return null;
  const original = String(raw).trim();
  if (!/\d/.test(original) || !/^[\d.,\s'()$€£₹+\-OoIl]+$/.test(original)) return null;
  let s = original.replace(/[Oo]/g, "0").replace(/[Il]/g, "1");
  s = s.replace(/\.{2,}/g, ".");
  s = s.replace(/^(.*\d\.\d{1,2})\.0+$/, "$1");
  if (s === original || !parseAmount(s).ok) return null;
  return s;
}

const IN_WORDS = new Set(["in", "incoming", "credit", "cr", "c", "receipt", "inward", "inflow", "deposit", "received"]);
const OUT_WORDS = new Set(["out", "outgoing", "debit", "dr", "d", "payment", "outward", "outflow", "withdrawal", "paid", "sent"]);

export function parseDirection(raw: unknown): Parsed<"incoming" | "outgoing"> {
  if (raw == null || raw === "") return fail("missing direction");
  const s = String(raw).trim().toLowerCase();
  if (IN_WORDS.has(s)) return ok("incoming");
  if (OUT_WORDS.has(s)) return ok("outgoing");
  return fail(`direction "${String(raw)}" is not recognised`);
}

export type TxnType = "wire" | "ach" | "cash" | "cheque" | "card" | "internal";

const TYPE_SYNONYMS: Record<string, TxnType> = {
  wire: "wire", "wire transfer": "wire", swift: "wire", tt: "wire", "telegraphic transfer": "wire", mt103: "wire",
  rtgs: "wire", "international transfer": "wire", "outward remittance": "wire", "inward remittance": "wire",
  ach: "ach", neft: "ach", imps: "ach", eft: "ach", bacs: "ach", giro: "ach", upi: "ach", "direct debit": "ach",
  cash: "cash", "cash deposit": "cash", "cash withdrawal": "cash", atm: "cash",
  cheque: "cheque", check: "cheque", chq: "cheque", "cheque deposit": "cheque",
  card: "card", pos: "card", "debit card": "card", "credit card": "card",
  internal: "internal", "internal transfer": "internal", "book transfer": "internal", "own account transfer": "internal",
};

export function parseTxnType(raw: unknown): Parsed<TxnType | null> {
  if (raw == null || String(raw).trim() === "") return ok(null);
  const key = String(raw).trim().toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const t = TYPE_SYNONYMS[key];
  if (!t) return fail(`transaction type "${String(raw)}" is not recognised`);
  return ok(t);
}

export const ISO_CURRENCIES = new Set(
  "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWL".split(" "),
);

export function parseCurrency(raw: unknown): Parsed<string> {
  if (raw == null || String(raw).trim() === "") return fail("missing currency");
  const s = String(raw).trim().toUpperCase();
  if (!ISO_CURRENCIES.has(s)) return fail(`currency "${String(raw)}" is not an ISO 4217 code`);
  return ok(s);
}

const ISO2 = new Set(
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" "),
);

const COUNTRY_NAMES: Record<string, string> = {
  india: "IN", "united arab emirates": "AE", uae: "AE", "hong kong": "HK", singapore: "SG", "united states": "US",
  usa: "US", "united kingdom": "GB", uk: "GB", "great britain": "GB", germany: "DE", france: "FR", china: "CN",
  switzerland: "CH", netherlands: "NL", japan: "JP", australia: "AU", canada: "CA", malaysia: "MY",
  "saudi arabia": "SA", qatar: "QA", bahrain: "BH", oman: "OM", kuwait: "KW", "sri lanka": "LK", bangladesh: "BD",
};

/**
 * ISO 3166 alpha-2, or a user-assigned placeholder code (XA–XZ) used by the demo lists.
 * Empty values are allowed (returns null).
 */
export function parseCountry(raw: unknown): Parsed<string | null> {
  if (raw == null || String(raw).trim() === "") return ok(null);
  const s = String(raw).trim();
  const up = s.toUpperCase();
  if (/^[A-Z]{2}$/.test(up) && (ISO2.has(up) || /^X[A-Z]$/.test(up))) return ok(up);
  const byName = COUNTRY_NAMES[s.toLowerCase()];
  if (byName) return ok(byName);
  return fail(`country "${s}" is not an ISO 3166 code`);
}

export function cleanText(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}
