// Time-zone maths for the time axis: the UTC offset of an IANA zone at an instant, and the calendar fields of an
// instant read in that zone. No allocation on the hot path: offsets come from a per-zone change table built once
// from Intl, so a pan over decades of bars makes no Intl call per bar.
// Ported and generalised from the host engine's exchange-time kernel (see PROVENANCE.md).

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Whole UTC hours per table block (about 24 weeks). */
const BLOCK_HOURS = 4096;
/** Intl is sampled once a week inside a block; a change between two samples is narrowed by binary search. */
const SAMPLE_HOURS = 168;

interface OffsetBlock { starts: number[]; offsets: number[] }

interface ZoneTable {
  tz: string;
  /** Fixed offset in ms (UTC), or NaN when the table must be read. */
  fixed: number;
  fmt: Intl.DateTimeFormat | null;
  blocks: Map<number, OffsetBlock>;
  /** The last answer's run of hours [from, to): consecutive bars almost always share it. */
  runFrom: number;
  runTo: number;
  runOffset: number;
}

const tables = new Map<string, ZoneTable>();

/** True when `tz` is a zone this runtime's Intl understands ('UTC' always is). */
export function isValidTimeZone(tz: string): boolean {
  if (tz === 'UTC') return true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The zone of the machine running the code. Read on call, never at import (SSR-safe). */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function tableFor(tz: string): ZoneTable {
  let t = tables.get(tz);
  if (!t) {
    const fixed = tz === 'UTC' || tz === 'Etc/UTC' || tz === 'GMT' ? 0 : NaN;
    t = {
      tz, fixed, blocks: new Map(), runFrom: 0, runTo: -1, runOffset: 0,
      fmt: Number.isNaN(fixed)
        ? new Intl.DateTimeFormat('en-US', {
          timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
          hour: 'numeric', minute: 'numeric', second: 'numeric',
        })
        : null,
    };
    tables.set(tz, t);
  }
  return t;
}

/** Offset at the start of whole UTC hour `hour`, read from Intl (slow). */
function intlOffsetAtHour(t: ZoneTable, hour: number): number {
  const start = hour * HOUR_MS;
  let year = 1970, month = 1, day = 1, h = 0, m = 0, s = 0;
  for (const part of (t.fmt as Intl.DateTimeFormat).formatToParts(start)) {
    const v = Number(part.value);
    switch (part.type) {
      case 'year': year = v; break;
      case 'month': month = v; break;
      case 'day': day = v; break;
      case 'hour': h = v; break;
      case 'minute': m = v; break;
      case 'second': s = v; break;
      default: break;
    }
  }
  return Date.UTC(year, month - 1, day, h, m, s) - start;
}

function buildBlock(t: ZoneTable, block: number): OffsetBlock {
  const first = block * BLOCK_HOURS;
  const last = first + BLOCK_HOURS - 1;
  const starts = [first];
  const offsets = [intlOffsetAtHour(t, first)];
  let lo = first;
  let loOff = offsets[0];
  for (let probe = Math.min(last, first + SAMPLE_HOURS); ; probe = Math.min(last, probe + SAMPLE_HOURS)) {
    const probeOff = intlOffsetAtHour(t, probe);
    while (loOff !== probeOff) {
      let l = lo;
      let r = probe;
      while (r - l > 1) {
        const mid = Math.floor((l + r) / 2);
        if (intlOffsetAtHour(t, mid) === loOff) l = mid; else r = mid;
      }
      lo = r;
      loOff = intlOffsetAtHour(t, r);
      starts.push(r);
      offsets.push(loOff);
    }
    lo = probe;
    loOff = probeOff;
    if (probe === last) break;
  }
  return { starts, offsets };
}

/**
 * UTC offset of zone `tz` at instant `epochMs`, in ms (Kolkata +19800000; New York -14400000 in summer,
 * -18000000 in winter). DST changes fall on whole UTC hours, so the offset is resolved per hour.
 * Honesty note: a change undone within one week (A -> B -> A between two samples) would be missed.
 */
export function zoneOffsetMs(tz: string, epochMs: number): number {
  const t = tableFor(tz);
  if (!Number.isNaN(t.fixed)) return t.fixed;
  const hour = Math.floor(epochMs / HOUR_MS);
  if (hour >= t.runFrom && hour < t.runTo) return t.runOffset;
  if (!Number.isFinite(hour)) return 0;
  const b = Math.floor(hour / BLOCK_HOURS);
  let block = t.blocks.get(b);
  if (!block) {
    try {
      block = buildBlock(t, b);
    } catch {
      return 0;
    }
    t.blocks.set(b, block);
  }
  const { starts, offsets } = block;
  let k = starts.length - 1;
  while (k > 0 && starts[k] > hour) k--;
  t.runFrom = starts[k];
  t.runTo = k + 1 < starts.length ? starts[k + 1] : (b + 1) * BLOCK_HOURS;
  t.runOffset = offsets[k];
  return offsets[k];
}

/** Whole days since 1970-01-01 in zone `tz`. */
export function zoneDayNumber(tz: string, epochMs: number): number {
  return Math.floor((epochMs + zoneOffsetMs(tz, epochMs)) / DAY_MS);
}

/** Minutes past local midnight in zone `tz`, 0..1439. */
export function zoneMinuteOfDay(tz: string, epochMs: number): number {
  const shifted = epochMs + zoneOffsetMs(tz, epochMs);
  return Math.floor((shifted - Math.floor(shifted / DAY_MS) * DAY_MS) / MINUTE_MS);
}

/** Days since 1970-01-01 of a civil date (Hinnant's days_from_civil). */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  return era * 146_097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719_468;
}

/** The civil date of a day number, packed as yyyymmdd (Hinnant's civil_from_days). No allocation. */
export function civilKeyFromDays(dayNum: number): number {
  const z = dayNum + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return year * 10_000 + month * 100 + day;
}

/** 0 = Sunday ... 6 = Saturday of a day number (1970-01-01 was a Thursday). */
export function weekdayOfDay(dayNum: number): number {
  return (((dayNum + 4) % 7) + 7) % 7;
}

/** Monday-based week id of a day number. */
export function weekKeyOfDay(dayNum: number): number {
  return dayNum - ((weekdayOfDay(dayNum) + 6) % 7);
}
