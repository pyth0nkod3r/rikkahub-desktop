/**
 * Zero-dependency robust 5-field Cron and Interval Expression Parser
 * Supports:
 * - Standard 5 fields: minute (0-59), hour (0-23), day of month (1-31), month (1-12), day of week (0-7, 0&7=Sun)
 * - Wildcards (*), steps (/step), ranges (start-end), lists (val1,val2)
 * - Aliases: @yearly, @annually, @monthly, @weekly, @daily, @midnight, @hourly
 * - Relative intervals: @every 30s, @every 15m, @every 2h, @every 1d
 */

export interface ParsedCron {
  isInterval: boolean;
  intervalMs?: number;
  minutes?: Set<number>;
  hours?: Set<number>;
  daysOfMonth?: Set<number>;
  months?: Set<number>;
  daysOfWeek?: Set<number>;
}

const ALIASES: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

const DAY_NAMES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function parseField(
  raw: string,
  min: number,
  max: number,
  nameMap?: Record<string, number>,
): Set<number> {
  const result = new Set<number>();
  const parts = raw.split(",");

  for (const part of parts) {
    const trimmed = part.trim().toLowerCase();
    if (!trimmed) continue;

    // Check for step: */15 or 1-30/5
    const slashIdx = trimmed.indexOf("/");
    let rangePart = trimmed;
    let step = 1;

    if (slashIdx !== -1) {
      rangePart = trimmed.slice(0, slashIdx);
      const stepStr = trimmed.slice(slashIdx + 1);
      step = parseInt(stepStr, 10);
      if (isNaN(step) || step < 1) {
        throw new Error(`Invalid step in cron field: '${trimmed}'`);
      }
    }

    let start = min;
    let end = max;

    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [sStr, eStr] = rangePart.split("-");
      start = nameMap && nameMap[sStr] !== undefined ? nameMap[sStr] : parseInt(sStr, 10);
      end = nameMap && nameMap[eStr] !== undefined ? nameMap[eStr] : parseInt(eStr, 10);
      if (isNaN(start) || isNaN(end) || start > end || start < min || end > max) {
        throw new Error(`Invalid range in cron field: '${rangePart}'`);
      }
    } else {
      const val = nameMap && nameMap[rangePart] !== undefined ? nameMap[rangePart] : parseInt(rangePart, 10);
      if (isNaN(val) || val < min || val > max) {
        // Special case for day-of-week 7 (Sunday = 0)
        if (max === 6 && val === 7) {
          result.add(0);
          continue;
        }
        throw new Error(`Invalid value in cron field: '${rangePart}'`);
      }
      start = val;
      // If step was specified on a single number e.g. 5/10, start at val, end at max
      end = slashIdx !== -1 ? max : val;
    }

    for (let i = start; i <= end; i += step) {
      // For day of week, 7 maps to 0
      if (max === 6 && i === 7) {
        result.add(0);
      } else {
        result.add(i);
      }
    }
  }

  return result;
}

export function parseCronExpression(expression: string): ParsedCron {
  const trimmed = expression.trim();
  if (!trimmed) {
    throw new Error("Empty cron expression");
  }

  // Handle @every <n><s|m|h|d>
  if (trimmed.startsWith("@every ")) {
    const durationStr = trimmed.slice(7).trim();
    const match = durationStr.match(/^(\d+)\s*(s|m|h|d)$/i);
    if (!match) {
      throw new Error(`Invalid @every duration format: '${durationStr}'. Expected e.g. '30s', '15m', '2h', '1d'.`);
    }
    const val = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    let mult = 1000;
    if (unit === "s") mult = 1000;
    else if (unit === "m") mult = 60 * 1000;
    else if (unit === "h") mult = 3600 * 1000;
    else if (unit === "d") mult = 86400 * 1000;

    return {
      isInterval: true,
      intervalMs: val * mult,
    };
  }

  // Handle aliases
  const standardExpr = ALIASES[trimmed.toLowerCase()] || trimmed;

  const fields = standardExpr.split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Cron expression must have 5 fields, got ${fields.length} in '${expression}'`);
  }

  const [minStr, hourStr, domStr, monStr, dowStr] = fields;

  return {
    isInterval: false,
    minutes: parseField(minStr, 0, 59),
    hours: parseField(hourStr, 0, 23),
    daysOfMonth: parseField(domStr, 1, 31),
    months: parseField(monStr, 1, 12, MONTH_NAMES),
    daysOfWeek: parseField(dowStr, 0, 6, DAY_NAMES),
  };
}

/**
 * Calculates the next trigger timestamp (unix ms) at or after `fromMs`.
 * Default searches up to 5 years in advance.
 */
export function computeNextRunMs(
  expression: string,
  fromMs: number = Date.now(),
): number {
  const parsed = parseCronExpression(expression);

  if (parsed.isInterval && parsed.intervalMs) {
    return fromMs + parsed.intervalMs;
  }

  // Round up fromMs to the next whole minute
  let t = new Date(fromMs);
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);

  const maxDate = new Date(fromMs + 5 * 365 * 24 * 3600 * 1000);

  while (t <= maxDate) {
    const month = t.getMonth() + 1; // 1-12
    if (!parsed.months!.has(month)) {
      // Advance to next month 1st 00:00
      t.setMonth(t.getMonth() + 1, 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }

    const dayOfMonth = t.getDate();
    const dayOfWeek = t.getDay(); // 0-6 (0=Sun)

    if (!parsed.daysOfMonth!.has(dayOfMonth) || !parsed.daysOfWeek!.has(dayOfWeek)) {
      // Advance to next day 00:00
      t.setDate(t.getDate() + 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }

    const hour = t.getHours();
    if (!parsed.hours!.has(hour)) {
      // Advance to next hour 00
      t.setHours(t.getHours() + 1, 0, 0, 0);
      continue;
    }

    const minute = t.getMinutes();
    if (!parsed.minutes!.has(minute)) {
      t.setMinutes(t.getMinutes() + 1, 0, 0);
      continue;
    }

    // Found match
    return t.getTime();
  }

  throw new Error(`No matching schedule date found within 5 years for cron '${expression}'`);
}
