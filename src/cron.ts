export interface CronSets {
  minute: number[];
  hour: number[];
  dom: number[];
  month: number[];
  dow: number[];
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const DOW_NAMES: Record<string, number> = {
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

function parseBound(
  raw: string,
  field: string,
  min: number,
  max: number,
  names?: Record<string, number>,
): number {
  const trimmed = raw.trim().toLowerCase();
  const named = names?.[trimmed];
  if (named !== undefined) return named;
  if (!/^\d+$/.test(trimmed))
    throw new Error(`Invalid ${field} value "${raw}" in cron expression`);
  const value = Number(trimmed);
  if (value < min || value > max)
    throw new Error(
      `${field} value ${String(value)} out of range ${String(min)}-${String(max)} in cron expression`,
    );
  return value;
}

function parseCronField(
  raw: string,
  field: string,
  min: number,
  max: number,
  names?: Record<string, number>,
): number[] {
  if (raw.length === 0)
    throw new Error(`Empty ${field} field in cron expression`);
  const values = new Set<number>();
  for (const part of raw.split(",")) {
    if (part.length === 0)
      throw new Error(`Empty ${field} item in cron expression "${raw}"`);
    const [rangePart = "", stepPart] = part.split("/", 2);
    if (
      stepPart !== undefined &&
      (!/^\d+$/.test(stepPart) || Number(stepPart) < 1)
    ) {
      throw new Error(`Invalid step "/${stepPart}" in ${field} field`);
    }
    const step = stepPart === undefined ? 1 : Number(stepPart);
    let lo: number;
    let hi: number;
    if (rangePart === "*") {
      lo = min;
      hi = max;
    } else if (rangePart.includes("-")) {
      const pieces = rangePart.split("-");
      if (pieces.length !== 2)
        throw new Error(`Invalid range "${rangePart}" in ${field} field`);
      const [loPart = "", hiPart = ""] = pieces;
      lo = parseBound(loPart, field, min, max, names);
      hi = parseBound(hiPart, field, min, max, names);
      if (lo > hi)
        throw new Error(`Descending range "${rangePart}" in ${field} field`);
    } else {
      lo = parseBound(rangePart, field, min, max, names);
      hi = stepPart === undefined ? lo : max;
    }
    for (let v = lo; v <= hi; v += step) {
      values.add(field === "dow" && v === 7 ? 0 : v);
    }
  }
  return [...values].toSorted((a, b) => a - b);
}

export function parseCron(expression: string): CronSets {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5)
    throw new Error(
      `Expected 5-field cron expression, got ${String(fields.length)} fields: "${expression}"`,
    );
  const [minute = "", hour = "", dom = "", month = "", dow = ""] = fields;
  return {
    minute: parseCronField(minute, "minute", 0, 59),
    hour: parseCronField(hour, "hour", 0, 23),
    dom: parseCronField(dom, "day of month", 1, 31),
    month: parseCronField(month, "month", 1, 12, MONTH_NAMES),
    dow: parseCronField(dow, "dow", 0, 7, DOW_NAMES),
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function fmtList(values: number[]): string {
  return values.map((v) => pad2(v)).join(",");
}

export function cronToOnCalendar(sets: CronSets): string[] {
  const timePart = `${fmtList(sets.hour)}:${fmtList(sets.minute)}:00`;
  const months = sets.month.length === 12 ? "*" : fmtList(sets.month);
  const doms = sets.dom.length === 31 ? "*" : fmtList(sets.dom);
  const dows =
    sets.dow.length === 7
      ? ""
      : `${sets.dow.map((d) => DOW_LABELS[d]).join(",")} `;
  if (sets.dow.length === 7) return [`*-${months}-${doms} ${timePart}`];
  if (sets.dom.length === 31 && sets.month.length === 12)
    return [`${dows}*-*-* ${timePart}`];
  // cron fires when BOTH day-of-month and day-of-week are restricted (OR semantics)
  return [
    `${dows}*-${months}-* ${timePart}`,
    `*-${months}-${doms} ${timePart}`,
  ];
}

export function describeCron(sets: CronSets): string {
  const timeDesc =
    sets.minute.length === 1 && sets.hour.length === 1
      ? `at ${pad2(sets.hour[0] ?? 0)}:${pad2(sets.minute[0] ?? 0)}`
      : `at minute ${sets.minute.join(",")} of hour ${sets.hour.join(",")}`;
  const isDowAll = sets.dow.length === 7;
  const isDomAll = sets.dom.length === 31;
  let dayDesc: string;
  if (isDowAll && isDomAll) dayDesc = "every day";
  else if (isDowAll) dayDesc = `on day ${sets.dom.join(",")} of the month`;
  else if (isDomAll)
    dayDesc = `on ${sets.dow.map((d) => DOW_LABELS[d]).join(",")}`;
  else
    dayDesc = `on ${sets.dow.map((d) => DOW_LABELS[d]).join(",")} or day ${sets.dom.join(",")}`;
  const monthDesc =
    sets.month.length === 12 ? "" : ` in month ${sets.month.join(",")}`;
  return `${timeDesc} ${dayDesc}${monthDesc}`;
}
