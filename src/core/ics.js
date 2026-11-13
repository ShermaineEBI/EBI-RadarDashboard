// The calendar as an iCalendar (.ics) file (RFC 5545) the viewer downloads and imports into
// Google Calendar or another calendar app. Nothing is sent anywhere: the file is made in the
// browser and saved by the viewer. Dates only (the records hold no times), so every item is an
// all-day event. UIDs come from the item ids, which are stable, so the same item keeps the same
// UID when the file is made again from an updated workbook. The clock is never read: DTSTAMP is
// the reporting date.

import { isIsoDate, addDays } from './dates.js';
import { tr } from '../i18n/i18n.js';

const CRLF = '\r\n';
const MAX_OCTETS = 75;

// TEXT values: backslash, semicolon, comma and line breaks are escaped.
export function escapeText(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

// Lines longer than 75 octets (UTF-8) are folded: CRLF plus one space, never inside a character.
export function foldLine(line) {
  const enc = new TextEncoder();
  const parts = [];
  let current = '', size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = parts.length ? MAX_OCTETS - 1 : MAX_OCTETS; // continuation lines start with a space
    if (size + n > limit) { parts.push(current); current = ''; size = 0; }
    current += ch; size += n;
  }
  parts.push(current);
  return parts.join(CRLF + ' ');
}

const icsDate = d => d.replace(/-/g, '');
const uidPart = s => String(s).replace(/[^A-Za-z0-9._:-]/g, '-');

// items: from buildCalendarItems(). AI suggestions not accepted yet are not appointments, so
// they are left out. typeLabel(type) names the item type (payment, followup, completion, task,
// entry). reminderHour: a reminder at that hour on the day (calendar apps may use their own
// default notifications instead).
export function buildIcs(items, { calendarName, reportingDate, uidPrefix = 'dashboard', typeLabel = t => t, reminderHour = 9 }) {
  if (!isIsoDate(reportingDate)) throw new Error('buildIcs needs the reporting date (YYYY-MM-DD)');
  const stamp = `${icsDate(reportingDate)}T000000Z`;
  const events = items.filter(it => !it.suggested && isIsoDate(it.date));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Business Dashboard Starter//Calendar export//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];
  for (const it of events) {
    const pastDeadline = it.kind === 'deadline' && it.overdue;
    const summary = `${pastDeadline ? '! ' : ''}${it.title}`.replace(/\s+/g, ' ').trim();
    const description = [
      typeLabel(it.type),
      pastDeadline ? tr('Past deadline: before the reporting date {0}.', reportingDate) : '',
      it.owner ? tr('Owner: {0}', it.owner) : '',
      it.note || '',
      tr('From your business dashboard, reporting date {0}.', reportingDate),
    ].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uidPart(uidPrefix)}.${uidPart(it.id)}@business-dashboard-starter`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(it.date)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(it.date, 1))}`,
      `SUMMARY:${escapeText(summary)}`,
      `DESCRIPTION:${escapeText(description)}`,
      `CATEGORIES:${escapeText(typeLabel(it.type))}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(summary)}`,
      `TRIGGER;RELATED=START:PT${reminderHour}H`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return { text: lines.map(foldLine).join(CRLF) + CRLF, count: events.length };
}
