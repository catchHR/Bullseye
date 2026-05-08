/**
 * Natural-language hints for common cron expressions (5-/6-field, Bull/node-cron).
 * Pure TS — no external cronstrue dependency.
 */
export function formatCronNaturalLanguage(expression: string | null | undefined): string {
  if (expression == null || String(expression).trim() === '') {
    return '';
  }
  const trimmed = String(expression).trim();

  const nicknames: Record<string, string> = {
    '@yearly': 'Once a year (Jan 1, 00:00)',
    '@annually': 'Once a year (Jan 1, 00:00)',
    '@monthly': 'Once a month (1st, 00:00)',
    '@weekly': 'Once a week (Sunday, 00:00)',
    '@daily': 'Once a day (00:00)',
    '@hourly': 'Every hour (at the start of each hour)',
  };
  const nicknameDescription = nicknames[trimmed];
  if (nicknameDescription !== undefined) {
    return nicknameDescription;
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 5) {
    const description = describeFiveFieldCron(parts[0], parts[1], parts[2], parts[3], parts[4]);
    if (description !== null) {
      return description;
    }
  }
  if (parts.length === 6) {
    const description = describeSixFieldCron(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]);
    if (description !== null) {
      return description;
    }
  }

  return trimmed;
}

function describeFiveFieldCron(
  minuteField: string,
  hourField: string,
  dayOfMonthField: string,
  monthField: string,
  dayOfWeekField: string,
): string | null {
  if (
    minuteField === '*' &&
    hourField === '*' &&
    dayOfMonthField === '*' &&
    monthField === '*' &&
    dayOfWeekField === '*'
  ) {
    return 'Every minute';
  }

  const minuteStep = minuteField.match(/^\*\/(\d+)$/);
  if (
    minuteStep &&
    hourField === '*' &&
    dayOfMonthField === '*' &&
    monthField === '*' &&
    dayOfWeekField === '*'
  ) {
    return `Every ${minuteStep[1]} minutes`;
  }

  if (
    minuteField === '0' &&
    hourField === '*' &&
    dayOfMonthField === '*' &&
    monthField === '*' &&
    dayOfWeekField === '*'
  ) {
    return 'Every hour (at minute 0)';
  }

  const hourStep = hourField.match(/^\*\/(\d+)$/);
  if (
    minuteField === '0' &&
    hourStep &&
    dayOfMonthField === '*' &&
    monthField === '*' &&
    dayOfWeekField === '*'
  ) {
    return `Every ${hourStep[1]} hours (at minute 0)`;
  }

  const hourRangeStep = hourField.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (
    minuteField === '0' &&
    hourRangeStep &&
    dayOfMonthField === '*' &&
    monthField === '*' &&
    dayOfWeekField === '*'
  ) {
    const rangeStart = Number.parseInt(hourRangeStep[1], 10);
    const rangeEnd = Number.parseInt(hourRangeStep[2], 10);
    const step = Number.parseInt(hourRangeStep[3], 10);
    if (rangeStart === 0 && rangeEnd === 23 && step === 1) {
      return 'Every hour at minute 0';
    }
    return `Every ${step} hour(s) between ${rangeStart}:00 and ${rangeEnd}:59 (at minute 0)`;
  }

  if (
    minuteField === '0' &&
    hourField === '0' &&
    dayOfMonthField === '*' &&
    monthField === '*' &&
    dayOfWeekField === '*'
  ) {
    return 'Daily at midnight';
  }

  const quartzNth = describeQuartzNthWeekdayOfMonth(
    minuteField,
    hourField,
    dayOfMonthField,
    monthField,
    dayOfWeekField,
  );
  if (quartzNth !== null) {
    return quartzNth;
  }

  const fixedMinuteHour =
    /^\d+$/.test(minuteField) &&
    /^\d+$/.test(hourField) &&
    dayOfMonthField === '*' &&
    monthField === '*' &&
    dayOfWeekField === '*';
  if (fixedMinuteHour) {
    return `Daily at ${padTime(hourField)}:${padTime(minuteField)}`;
  }

  const weeklyDowLabel = labelCronDayOfWeek(dayOfWeekField);
  if (
    /^\d+$/.test(minuteField) &&
    /^\d+$/.test(hourField) &&
    dayOfMonthField === '*' &&
    monthField === '*' &&
    weeklyDowLabel !== null
  ) {
    if (minuteField === '0' && hourField === '0') {
      return `Every ${weeklyDowLabel} at midnight`;
    }
    return `Every ${weeklyDowLabel} at ${padTime(hourField)}:${padTime(minuteField)}`;
  }

  return null;
}

function describeSixFieldCron(
  secondField: string,
  minuteField: string,
  hourField: string,
  dayOfMonthField: string,
  monthField: string,
  dayOfWeekField: string,
): string | null {
  if (
    secondField === '*' &&
    minuteField === '*' &&
    hourField === '*' &&
    dayOfMonthField === '*' &&
    monthField === '*' &&
    dayOfWeekField === '*'
  ) {
    return 'Every second';
  }

  const secondStep = secondField.match(/^\*\/(\d+)$/);
  if (
    secondStep &&
    minuteField === '*' &&
    hourField === '*' &&
    dayOfMonthField === '*' &&
    monthField === '*' &&
    dayOfWeekField === '*'
  ) {
    return `Every ${secondStep[1]} seconds`;
  }

  const tail = describeFiveFieldCron(minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField);
  if (tail !== null && secondField === '0') {
    return tail;
  }

  return null;
}

function padTime(value: string): string {
  const numberValue = Number.parseInt(value, 10);
  if (Number.isNaN(numberValue)) {
    return value;
  }
  return numberValue.toString().padStart(2, '0');
}

const CRON_DOW_BY_INDEX = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const CRON_DOW_ABBREV_TO_LABEL: Record<string, string> = {
  SUN: 'Sunday',
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
};

const NTH_WEEKDAY_OF_MONTH_ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth'] as const;

/** Cron weekday: 0–7 (0 and 7 = Sunday) or SUN–SAT. */
function labelCronDayOfWeek(dayOfWeekField: string): string | null {
  const numericMatch = dayOfWeekField.match(/^([0-7])$/);
  if (numericMatch !== null) {
    const value = Number.parseInt(numericMatch[1], 10);
    const index = value === 7 ? 0 : value;
    return CRON_DOW_BY_INDEX[index] ?? null;
  }
  const abbrevMatch = dayOfWeekField.match(/^(SUN|MON|TUE|WED|THU|FRI|SAT)$/i);
  if (abbrevMatch !== null) {
    return CRON_DOW_ABBREV_TO_LABEL[abbrevMatch[1].toUpperCase()] ?? null;
  }
  return null;
}

/** Quartz-style nth weekday of month: dom `?`, month every, dow `MON#3`, etc. */
function describeQuartzNthWeekdayOfMonth(
  minuteField: string,
  hourField: string,
  dayOfMonthField: string,
  monthField: string,
  dayOfWeekField: string,
): string | null {
  const nthMatch = dayOfWeekField.match(/^(MON|TUE|WED|THU|FRI|SAT|SUN)#([1-5])$/i);
  if (nthMatch === null) {
    return null;
  }
  if (dayOfMonthField !== '?') {
    return null;
  }
  const monthOk =
    monthField === '*' ||
    monthField === '1/1' ||
    monthField === '*/1' ||
    /^\*\/\d+$/.test(monthField);
  if (!monthOk) {
    return null;
  }
  if (!/^\d+$/.test(minuteField) || !/^\d+$/.test(hourField)) {
    return null;
  }
  const ordinalIndex = Number.parseInt(nthMatch[2], 10) - 1;
  const ordinal = NTH_WEEKDAY_OF_MONTH_ORDINAL[ordinalIndex];
  if (ordinal === undefined) {
    return null;
  }
  const weekdayLong = CRON_DOW_ABBREV_TO_LABEL[nthMatch[1].toUpperCase()];
  if (weekdayLong === undefined) {
    return null;
  }
  return `At ${padTime(hourField)}:${padTime(minuteField)} on the ${ordinal} ${weekdayLong} of each month`;
}
