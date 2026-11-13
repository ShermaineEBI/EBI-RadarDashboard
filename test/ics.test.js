// "Download for Google Calendar": the calendar as an iCalendar (.ics) file (RFC 5545). The file
// is made in the browser and saved by the viewer; these tests check that it is well formed,
// that every calendar item becomes one all-day event with a stable UID, and that it never
// depends on the computer clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { baselineBriefInput } from './support/training.js';
import { buildIcs, escapeText, foldLine } from '../src/core/ics.js';
import { setLocale } from '../src/i18n/i18n.js';

setLocale('en');
const { calendar, scenario } = baselineBriefInput('betterspace-b2b', 'day1', 'en');
const options = { calendarName: 'BetterSpace B2B', reportingDate: scenario.reportingDate, uidPrefix: 'betterspace-b2b' };

// Undo folding and split into lines, as a calendar app reads the file.
const unfold = text => text.replace(/\r\n /g, '').split('\r\n').filter(Boolean);
const unescape = s => s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c));
const events = text => {
  const out = [];
  let current = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') current = {};
    else if (line === 'END:VEVENT') { out.push(current); current = null; }
    else if (current && !current.inAlarm) {
      if (line === 'BEGIN:VALARM') current.inAlarm = true;
      else { const i = line.indexOf(':'); current[line.slice(0, i)] = line.slice(i + 1); }
    } else if (current && line === 'END:VALARM') current.inAlarm = false;
  }
  return out;
};

test('the calendar file is well formed: CRLF lines of at most 75 octets, one VCALENDAR', () => {
  const { text } = buildIcs(calendar, options);
  assert.ok(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(text.endsWith('END:VCALENDAR\r\n'));
  assert.doesNotMatch(text.replace(/\r\n/g, ''), /[\r\n]/, 'only CRLF line breaks');
  for (const line of text.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.equal((text.match(/BEGIN:VEVENT/g) || []).length, (text.match(/END:VEVENT/g) || []).length);
  assert.equal((text.match(/BEGIN:VALARM/g) || []).length, (text.match(/END:VALARM/g) || []).length);
});

test('every calendar item becomes one all-day event on its date, with a unique UID', () => {
  const { text, count } = buildIcs(calendar, options);
  const evs = events(text);
  assert.equal(count, calendar.length);
  assert.equal(evs.length, calendar.length);
  assert.equal(new Set(evs.map(e => e.UID)).size, evs.length, 'UIDs are unique');
  calendar.forEach((it, i) => {
    const e = evs[i];
    assert.equal(e['DTSTART;VALUE=DATE'], it.date.replace(/-/g, ''));
    assert.equal(e.UID, `betterspace-b2b.${it.id}@business-dashboard-starter`);
    assert.equal(unescape(e.SUMMARY), `${it.kind === 'deadline' && it.overdue ? '! ' : ''}${it.title}`.replace(/\s+/g, ' ').trim(), 'a past deadline shows "!"');
    assert.equal(e.DTSTAMP, '20260830T000000Z', 'stamped with the reporting date, not the clock');
  });
  const pay = evs[calendar.findIndex(i => i.id === 'payment:BS-031')];
  assert.match(unescape(pay.SUMMARY), /BS-031 RM 3,360/);
});

test('the same item keeps its UID when the file is made again from the updated workbook', () => {
  const day2 = baselineBriefInput('betterspace-b2b', 'day2', 'en');
  const uids = items => new Set(events(buildIcs(items, { ...options, reportingDate: day2.scenario.reportingDate }).text).map(e => e.UID));
  const a = uids(calendar), b = uids(day2.calendar);
  const shared = calendar.filter(i => day2.calendar.some(j => j.id === i.id));
  assert.ok(shared.length > 0);
  for (const it of shared) {
    const uid = `betterspace-b2b.${it.id}@business-dashboard-starter`;
    assert.ok(a.has(uid) && b.has(uid), uid);
  }
});

test('AI suggestions not accepted yet are left out; tasks and notes carry owner and note', () => {
  const items = [
    { id: 'payment_follow_up:BS-001', date: '2026-08-30', kind: 'task', type: 'task', title: 'Task: Chase BS-001', owner: 'Mei', note: 'Call before noon' },
    { id: 'rule:X', date: '2026-08-31', kind: 'task', type: 'task', suggested: true, title: 'Task (not accepted yet): X' },
    { id: 'n-1', date: '2026-09-02', kind: 'entry', type: 'entry', title: 'Stock count', note: 'Line 1\nLine 2' },
  ];
  const { text, count } = buildIcs(items, { ...options, typeLabel: t => ({ task: 'Accepted task', entry: 'Your note' })[t] });
  const evs = events(text);
  assert.equal(count, 2);
  assert.deepEqual(evs.map(e => unescape(e.SUMMARY)), ['Task: Chase BS-001', 'Stock count']);
  assert.match(unescape(evs[0].DESCRIPTION), /^Accepted task\nOwner: Mei\nCall before noon\n/);
  assert.match(unescape(evs[1].DESCRIPTION), /Line 1\nLine 2/);
  assert.equal(evs[1]['DTEND;VALUE=DATE'], '20260903', 'an all-day event ends the next day');
});

test('text is escaped and long Chinese lines fold without splitting a character', () => {
  assert.equal(escapeText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  const title = '跟进 Demo Bright Company 006 的账户信息，并确认付款日期；备注：' + '长'.repeat(60);
  const { text } = buildIcs([{ id: 'n-2', date: '2026-08-30', kind: 'entry', type: 'entry', title }], options);
  for (const line of text.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75);
  assert.equal(unescape(events(text)[0].SUMMARY), title);
  assert.equal(foldLine('short'), 'short');
});

test('the calendar file does not read the computer clock', () => {
  const RealDate = Date;
  const before = buildIcs(calendar, options).text;
  class FrozenDate extends RealDate { constructor(...a) { super(...(a.length ? a : ['2031-02-03T04:05:06Z'])); } static now() { return new RealDate('2031-02-03T04:05:06Z').getTime(); } }
  globalThis.Date = FrozenDate;
  try { assert.equal(buildIcs(calendar, options).text, before); } finally { globalThis.Date = RealDate; }
  assert.throws(() => buildIcs(calendar, { ...options, reportingDate: '' }));
});
