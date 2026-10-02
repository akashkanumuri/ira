export interface HolidayItem {
  id: string;
  name: string;
  date: string;
  description?: string;
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

export function getKolkataDayName(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
  });
}

export function classifyDay(dateStr: string, holidays: HolidayItem[] = []) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const dayOfWeek = dateObj.getDay();
  const holiday = holidays.find((h) => h.date === dateStr);

  if (holiday) {
    return {
      type: 'holiday' as const,
      label: `Holiday: ${holiday.name}`,
      isWorkingDay: false,
      holidayName: holiday.name,
    };
  }

  if (dayOfWeek === 0) {
    return { type: 'sunday_off' as const, label: 'Weekly Off (Sunday)', isWorkingDay: false };
  }

  if (dayOfWeek === 6) {
    return { type: 'saturday_working' as const, label: 'Working Day (Saturday)', isWorkingDay: true };
  }

  return { type: 'weekday_working' as const, label: 'Working Day', isWorkingDay: true };
}

export function getMonthlyWorkingDaysCount(year: number, month: number, holidays: HolidayItem[] = []) {
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
