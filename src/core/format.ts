// Text for numbers and times. House rules: a negative number shows the true minus U+2212, numbers have no
// grouping separators, and a value that rounds to zero carries no sign. Ported from the host's number formatter
// and time-axis spelling (PROVENANCE.md).

/** U+2212 MINUS SIGN: as wide as "+" in tabular figures, and read as "minus" by screen readers. */
export const MINUS_SIGN = '−';

/** Text with a leading hyphen-minus turned into the true minus; "-0.00" loses its sign. */
export function withMinus(text: string): string {
  if (text.charCodeAt(0) !== 45) return text;
  const body = text.slice(1);
  return /[1-9]/.test(body) ? MINUS_SIGN + body : body;
}

/** `value` with exactly `precision` decimals (0..10), no grouping, true minus. */
export function formatPrice(value: number, precision: number): string {
  if (!Number.isFinite(value)) return '';
  const p = Math.max(0, Math.min(10, Math.round(precision)));
  return withMinus(value.toFixed(p));
}

/** A percentage with sign: "+1.50%", "−2.00%", "0.00%". */
export function formatPercent(value: number, precision: number): string {
  if (!Number.isFinite(value)) return '';
  const body = Math.abs(value).toFixed(Math.max(0, Math.min(10, Math.round(precision))));
  const zero = !/[1-9]/.test(body);
  return `${zero ? '' : value < 0 ? MINUS_SIGN : '+'}${body}%`;
}

/** Decimals a minimum price move needs (0.01 -> 2, 0.25 -> 2, 5 -> 0). */
export function precisionOfMinMove(minMove: number): number {
  if (!(minMove > 0) || !Number.isFinite(minMove)) return 2;
  for (let d = 0; d <= 10; d++) {
    const scaled = minMove * Math.pow(10, d);
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9) return d;
  }
  return 10;
}

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export type DateOrder = 'day-month' | 'month-day';

export interface TimeTextOptions {
  /** 12-hour clock ("9:15 AM"); default is the 24-hour clock ("09:15"). */
  hours12?: boolean;
  /** "29 Sep" (default) or "Sep 29". */
  dateOrder?: DateOrder;
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

export function formatClock(hour: number, minute: number, hours12 = false): string {
  if (!hours12) return `${pad2(hour)}:${pad2(minute)}`;
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${pad2(minute)} ${hour < 12 ? 'AM' : 'PM'}`;
}

export function formatDayMonth(month: number, day: number, order: DateOrder = 'day-month'): string {
  const m = MONTH_NAMES[month - 1] ?? '';
  return order === 'month-day' ? `${m} ${day}` : `${day} ${m}`;
}

export const formatMonth = (month: number): string => MONTH_NAMES[month - 1] ?? '';

/**
 * The crosshair's full time stamp. Intraday: weekday, date and clock; daily and weekly: weekday and date;
 * monthly: month and year; yearly: the year.
 */
export function formatStamp(
  f: { year: number; month: number; day: number; minute: number; weekday: number },
  kind: 'intraday' | 'daily' | 'weekly' | 'monthly' | 'yearly',
  opts: TimeTextOptions = {},
): string {
  const month = MONTH_NAMES[f.month - 1] ?? '';
  if (kind === 'yearly') return String(f.year);
  if (kind === 'monthly') return `${month} ${f.year}`;
  const date = opts.dateOrder === 'month-day' ? `${month} ${pad2(f.day)} ${f.year}` : `${pad2(f.day)} ${month} ${f.year}`;
  const stamp = `${WEEKDAY_NAMES[f.weekday]} ${date}`;
  return kind === 'intraday' ? `${stamp} ${formatClock(Math.floor(f.minute / 60), f.minute % 60, opts.hours12)}` : stamp;
}

/**
 * A series' price format from what the caller gave: `minMove` alone sets the precision it needs (0.25 -> 2, 5 -> 0),
 * `precision` alone sets `minMove` to 10^-precision; both are kept as given. Bad numbers fall back to the defaults.
 */
export function resolvePriceFormat(given: { precision?: unknown; minMove?: unknown } | undefined): { precision: number; minMove: number } {
  const p = typeof given?.precision === 'number' && Number.isFinite(given.precision) && given.precision >= 0 ? Math.min(10, Math.round(given.precision)) : NaN;
  const m = typeof given?.minMove === 'number' && Number.isFinite(given.minMove) && given.minMove > 0 ? given.minMove : NaN;
  if (!Number.isNaN(p) && !Number.isNaN(m)) return { precision: p, minMove: m };
  if (!Number.isNaN(m)) return { precision: precisionOfMinMove(m), minMove: m };
  if (!Number.isNaN(p)) return { precision: p, minMove: Math.pow(10, -p) };
  return { precision: 2, minMove: 0.01 };
}
