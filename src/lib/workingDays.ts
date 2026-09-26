/**
 * Working-day helpers for the employee attendance calendar.
 * Timezone: Asia/Kolkata.
 * Monday-Saturday are working days; Sunday is the weekly off.
 * Holidays are supplied by the database and override normal working days.
 */

export interface HolidayItem {
  id: string;
  name: string;
  date: string;
  description?: string;
  mandatory?: boolean;
  isWorkingDay?: boolean;
}

export function getKolkataDateString(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatKolkataTime(date = new Date(), includeSeconds = false): string {
  return date.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {}),
    hour12: true,
  });
}

export function classifyDay(
  dateStr: string,
  holidays: HolidayItem[] = []
): {
  type: 'sunday_off' | 'holiday' | 'saturday_working' | 'weekday_working';
  label: string;
  isWorkingDay: boolean;
  holidayName?: string;
} {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const dayOfWeek = dateObj.getDay();
  const holiday = holidays.find((h) => h.date === dateStr && h.isWorkingDay !== true);

  if (holiday) {
    return {
      type: 'holiday',
      label: `Holiday: ${holiday.name}`,
      isWorkingDay: false,
      holidayName: holiday.name,
    };
  }

  if (dayOfWeek === 0) {
    return { type: 'sunday_off', label: 'Weekly Off (Sunday)', isWorkingDay: false };
  }

  if (dayOfWeek === 6) {
    return { type: 'saturday_working', label: 'Working Day (Saturday)', isWorkingDay: true };
  }

  return { type: 'weekday_working', label: 'Working Day', isWorkingDay: true };
}

export function getMonthlyWorkingDaysCount(
  year: number,
  month: number,
  holidays: HolidayItem[] = []
): {
  totalDays: number;
  workingDays: number;
  sundays: number;
  holidayCount: number;
} {
  const daysInMonth = new Date(year, month, 0).getDate();
  let workingDays = 0;
  let sundays = 0;
  let holidayCount = 0;

  for (let d = 1; d <= daysInMonth; d += 1) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const classification = classifyDay(dateStr, holidays);
    if (classification.type === 'sunday_off') sundays += 1;
    else if (classification.type === 'holiday') holidayCount += 1;
    else workingDays += 1;
  }

  return { totalDays: daysInMonth, workingDays, sundays, holidayCount };
}
