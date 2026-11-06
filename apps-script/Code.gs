/**
 * Lab Instrument Booking — Google Apps Script web app
 * ===================================================
 * Backend: the Google Sheet this script is bound to (tabs: Instruments, Bookings, Settings).
 * Pages:   Index.html — instrument list, day schedules, booking form, cancel/release page
 *          Qr.html    — printable QR-code stickers, one per active instrument
 * Setup and deployment: see README.md.
 */

const SHEET_INSTRUMENTS = 'Instruments';
const SHEET_BOOKINGS = 'Bookings';
const SHEET_SETTINGS = 'Settings';
const TIME_STEP_MIN = 15; // start/end times can be chosen in these steps (timed instruments)

const INSTRUMENT_HEADERS = ['ID', 'Name', 'Category', 'SlotMinutes', 'MaxHours', 'MaxDaysAhead', 'Active', 'Location', 'Contact', 'Notes', 'Group', 'Photo', 'Manual'];
const BOOKING_HEADERS = ['BookingID', 'InstrumentID', 'Start', 'End', 'Name', 'Email', 'Purpose', 'Token', 'Status', 'CreatedAt', 'ChangedAt'];

const DEFAULT_SETTINGS = [
  ['LAB_NAME', 'My Lab', 'Shown in the page header and in emails'],
  ['ALLOWED_EMAIL_DOMAINS', '', 'Comma-separated, e.g. "your-institute.org, partner-university.de" (subdomains accepted). Empty = any address'],
  ['LAB_PIN', '', 'Optional shared PIN required to book. Empty = no PIN'],
  ['ADMIN_EMAIL', '', 'Optional: receives a copy of every booking and cancellation'],
  ['SHOW_NAMES', 'TRUE', 'TRUE = show booker names on the public schedule; FALSE = show "Booked" only'],
  ['RETENTION_DAYS', '180', 'Bookings that ended more than this many days ago are deleted automatically (daily, ~03:00)'],
  ['PUBLIC_URL', '', 'Optional short address that forwards to the web app including the query string (e.g. https://book.example.org). Used in QR codes and emails'],
  ['LOGO_URL', '', 'Optional logo for the page header (Google Drive image shared as "Anyone with the link", or any public https image URL). Empty = built-in logo'],
  ['FAVICON_URL', '', 'Optional browser-tab icon: a Google Drive image shared as "Anyone with the link", or any public https image URL'],
  ['PRIVACY_NOTE', 'Your name and email address are stored only to manage this booking and are deleted automatically after the retention period.', 'Shown below the booking form'],
];

// Example instruments, written to the Instruments tab the first time setup runs (only if that tab is empty).
// Replace them with your own, either here before running setup or directly in the sheet afterwards.
// [ID, Name, Category, SlotMinutes, MaxHours, MaxDaysAhead]
//   SlotMinutes  = suggested booking length (pre-filled; people can choose any length in 15-min steps).
//                  1440 = whole-day bookings (people pick dates, no times).
//   MaxHours     = longest allowed single booking.  MaxDaysAhead = how far in advance people can book.
// IDs are encoded in the QR codes: keep them stable once stickers are printed.
const DEFAULT_INSTRUMENTS = [
  ['plate-reader', 'Plate Reader', 'Analytics', 60, 8, 28],
  ['spectrophotometer', 'Spectrophotometer', 'Analytics', 30, 4, 28],
  ['confocal-microscope', 'Confocal Microscope', 'Microscopy', 120, 8, 28],
  ['stereomicroscope', 'Stereomicroscope', 'Microscopy', 60, 4, 28],
  ['thermocycler-1', 'Thermocycler 1', 'Molecular biology', 120, 24, 28],
  ['thermocycler-2', 'Thermocycler 2', 'Molecular biology', 120, 24, 28],
  ['qpcr', 'qPCR Cycler', 'Molecular biology', 120, 8, 28],
  ['incubator-1', 'Incubator 1', 'Incubators', 1440, 336, 90],
  ['incubator-2', 'Incubator 2', 'Incubators', 1440, 336, 90],
  ['clean-bench-1', 'Clean Bench 1', 'Clean benches & fume hoods', 60, 4, 14],
  ['fume-hood-1', 'Fume Hood 1', 'Clean benches & fume hoods', 60, 4, 14],
];

// ============================================================================
// Web app entry point
// ============================================================================

function doGet(e) {
  const p = (e && e.parameter) || {};
  const s = getSettings_();
  let tpl;
  if (p.page === 'qr') {
    tpl = HtmlService.createTemplateFromFile('Qr');
    tpl.data = toJs_({
      labName: s.LAB_NAME,
      baseUrl: baseUrl_(s),
      instruments: getInstruments_().filter(i => i.active)
        .map(i => ({ id: i.id, name: i.name, category: i.category, location: i.location, group: i.group })),
    });
  } else {
    tpl = HtmlService.createTemplateFromFile('Index');
    tpl.params = toJs_({ instrument: p.instrument || '', page: p.page || '', id: p.id || '', token: p.token || '' });
    tpl.labName = s.LAB_NAME;
    tpl.logoUrl = photoUrl_(s.LOGO_URL);
  }
  const out = tpl.evaluate()
    .setTitle(s.LAB_NAME + ' – Instrument booking')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  const fav = photoUrl_(s.FAVICON_URL);
  if (fav) {
    // Drive thumbnails get a fake ".png" suffix: Apps Script only accepts favicon URLs that look like images.
    const url = /drive\.google\.com\/thumbnail/.test(fav) ? fav.replace(/&sz=w\d+/, '&sz=w128') + '&.png' : fav;
    try { out.setFaviconUrl(url); } catch (e) { console.warn('Favicon not accepted: ' + e); }
  }
  return out;
}

// ============================================================================
// Sheet menu & setup
// ============================================================================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Booking')
    .addItem('Set up / repair', 'setup')
    .addItem('Show web app & QR links', 'showLinks')
    .addSeparator()
    .addItem('Delete expired bookings now', 'purgeOldBookings')
    .addToUi();
}

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  ss.setSpreadsheetTimeZone(Session.getScriptTimeZone());

  const ins = ensureSheet_(ss, SHEET_INSTRUMENTS, INSTRUMENT_HEADERS);
  ins.getRange(1, 12).setNote('Link to a photo: a Google Drive file shared as "Anyone with the link" (Viewer), or any public https image URL.');
  ins.getRange(1, 13).setNote('Link to the instrument manual (Google Drive, PDF, website …). Shown as a "Read the manual" button. Drive files must be shared so bookers can open them.');
  if (ins.getLastRow() < 2) {
    const rows = DEFAULT_INSTRUMENTS.map(r => r.concat([true, '', '', '', '', '', '']));
    ins.getRange(2, 1, rows.length, INSTRUMENT_HEADERS.length).setValues(rows);
    ins.getRange(2, 7, rows.length, 1).insertCheckboxes();
    ins.autoResizeColumns(1, INSTRUMENT_HEADERS.length);
  }

  const bk = ensureSheet_(ss, SHEET_BOOKINGS, BOOKING_HEADERS);
  ['C:D', 'J:K'].forEach(a => bk.getRange(a).setNumberFormat('yyyy-mm-dd hh:mm'));

  const st = ensureSheet_(ss, SHEET_SETTINGS, ['Key', 'Value', 'Description']);
  const existing = st.getDataRange().getValues().map(r => String(r[0]).trim());
  DEFAULT_SETTINGS.forEach(r => { if (existing.indexOf(r[0]) < 0) st.appendRow(r); });
  st.autoResizeColumns(1, 2);

  const hasTrigger = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'purgeOldBookings');
  if (!hasTrigger) ScriptApp.newTrigger('purgeOldBookings').timeBased().everyDays(1).atHour(3).create();

  ['Sheet1', 'Tabelle1'].forEach(n => {
    const sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
  ss.toast('Setup complete. Next: Deploy → New deployment → Web app.', 'Booking', 8);
}

function ensureSheet_(ss, name, headers) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

function showLinks() {
  const url = baseUrl_(getSettings_());
  const style = 'font-family:Arial,sans-serif;font-size:14px';
  const html = url
    ? `<p style="${style}">Booking page:<br><a href="${url}" target="_blank">${url}</a></p>
       <p style="${style}">QR stickers (print view):<br><a href="${url}?page=qr" target="_blank">${url}?page=qr</a></p>`
    : `<p style="${style}">The web app is not deployed yet. Use Deploy → New deployment → Web app first.</p>`;
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(560).setHeight(200), 'Booking links');
}

// ============================================================================
// Public API (called from the page via google.script.run)
// ============================================================================

function apiGetInstruments() {
  const s = getSettings_();
  const now = new Date();
  const today = fmt_(now, 'yyyy-MM-dd');
  const showNames = isTrue_(s.SHOW_NAMES);
  const live = getBookings_().filter(b => b.status === 'confirmed' && b.end > now).sort((a, b) => a.start - b.start);
  const instruments = getInstruments_().filter(i => i.active).map(i => {
    const mine = live.filter(b => b.instrumentId === i.id);
    const cur = mine.find(b => b.start <= now);
    const next = mine.find(b => b.start > now);
    return {
      id: i.id, name: i.name, category: i.category, location: i.location,
      group: i.group, groups: i.groups, photo: i.photo,
      busy: !!cur,
      until: cur ? shortDT_(cur.end, today) : '',
      by: cur && showNames ? cur.name : '',
      next: next ? shortDT_(next.start, today) : '',
    };
  });
  return { labName: s.LAB_NAME, today, instruments };
}

/** Schedule for nDays consecutive days (default 3) starting at dateStr ('yyyy-MM-dd', default today). */
function apiGetDay(instrumentId, dateStr, nDays) {
  const inst = getInstrument_(instrumentId);
  const s = getSettings_();
  const now = new Date();
  const today = fmt_(now, 'yyyy-MM-dd');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) dateStr = today;
  nDays = clampInt_(nDays, 3, 1, 7);
  const showNames = isTrue_(s.SHOW_NAMES);
  const mine = getBookings_()
    .filter(b => b.instrumentId === inst.id && b.status === 'confirmed')
    .sort((a, b) => a.start - b.start);

  const days = [];
  for (let k = 0; k < nDays; k++) {
    const ds = addDaysStr_(dateStr, k);
    const dayStart = parseLocal_(ds + 'T00:00');
    const dayEnd = parseLocal_(addDaysStr_(ds, 1) + 'T00:00');
    days.push({
      date: ds,
      label: fmt_(dayStart, 'EEE d MMM'),
      isToday: ds === today,
      past: ds < today,
      nowMin: ds === today ? minuteOfDay_(now) : null,
      blocks: mine.filter(b => b.start < dayEnd && b.end > dayStart).map(b => ({
        startMin: b.start <= dayStart ? 0 : minuteOfDay_(b.start),
        endMin: b.end >= dayEnd ? 1440 : minuteOfDay_(b.end),
        label: showNames ? b.name : 'Booked',
        time: shortDT_(b.start, ds) + ' – ' + shortDT_(b.end, ds),
      })),
    });
  }

  const upcoming = mine.filter(b => b.end > now).slice(0, 15).map(b => ({
    range: rangeLabel_(b.start, b.end),
    who: showNames ? b.name : '',
  }));

  const first = parseLocal_(dateStr + 'T00:00');
  const last = parseLocal_(addDaysStr_(dateStr, nDays - 1) + 'T00:00');
  return {
    labName: s.LAB_NAME,
    instrument: publicInst_(inst),
    date: dateStr,
    today,
    days,
    rangeLabel: fmt_(first, 'EEE d MMM') + ' – ' + fmt_(last, 'EEE d MMM yyyy'),
    upcoming,
    pinRequired: !!String(s.LAB_PIN || '').trim(),
    domains: domainList_(s.ALLOWED_EMAIL_DOMAINS),
    privacyNote: s.PRIVACY_NOTE || '',
  };
}

function apiBook(p) {
  p = p || {};
  const s = getSettings_();
  const inst = getInstrument_(p.instrumentId);
  const name = clean_(p.name, 80);
  const email = clean_(p.email, 120).toLowerCase();
  const purpose = clean_(p.purpose, 200);

  if (name.length < 2) throw new Error('Please enter your name.');
  const domains = domainList_(s.ALLOWED_EMAIL_DOMAINS);
  if (!email && domains.length) throw new Error('Please enter your email address.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please enter a valid email address, or leave the field empty.');
  if (email && domains.length) {
    const dom = email.split('@')[1];
    if (!domains.some(d => dom === d || dom.endsWith('.' + d))) {
      throw new Error('Please use an email address ending in: ' + domains.map(d => '@' + d).join(', '));
    }
  }
  const pin = String(s.LAB_PIN || '').trim();
  if (pin && String(p.pin || '').trim() !== pin) throw new Error('Wrong lab PIN.');

  const start = parseLocal_(p.start);
  const end = parseLocal_(p.end);
  const now = new Date();
  const slot = inst.slotMinutes;
  if (end <= start) throw new Error('The end must be after the start.');
  if (slot >= 1440) {
    if (minuteOfDay_(start) || minuteOfDay_(end)) throw new Error('This instrument is booked in whole days.');
  } else {
    // SlotMinutes is only the suggested (default) booking length; times are free in TIME_STEP_MIN steps.
    if (minuteOfDay_(start) % TIME_STEP_MIN || minuteOfDay_(end) % TIME_STEP_MIN) {
      throw new Error(`Start and end times must be in ${TIME_STEP_MIN}-minute steps (e.g. 9:00, 9:15, 9:30).`);
    }
  }
  if (start.getTime() < now.getTime() - Math.min(slot, 30) * 60000) throw new Error('This time is in the past.');
  if (start.getTime() > now.getTime() + inst.maxDaysAhead * 86400000) {
    throw new Error(`${inst.name} can be booked at most ${inst.maxDaysAhead} days ahead.`);
  }
  if ((end - start) / 3600000 > inst.maxHours + 1.01) { // +1 h tolerance for DST days
    throw new Error(`The maximum booking length for ${inst.name} is ${hoursText_(inst.maxHours)}.`);
  }

  const showNames = isTrue_(s.SHOW_NAMES);
  let booking;
  const lock = acquireLock_();
  try {
    const clash = getBookings_().find(b =>
      b.instrumentId === inst.id && b.status === 'confirmed' && b.start < end && b.end > start);
    if (clash) {
      throw new Error(`${inst.name} is already booked ${rangeLabel_(clash.start, clash.end)}` +
        (showNames ? ` by ${clash.name}` : '') + '.');
    }
    booking = { id: newId_(), token: newToken_(), instrumentId: inst.id, start, end, name, email, purpose };
    ss_().getSheetByName(SHEET_BOOKINGS).appendRow([
      booking.id, inst.id, start, end, safeCell_(name), safeCell_(email), safeCell_(purpose),
      booking.token, 'confirmed', now, '',
    ]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  const manageUrl = manageUrl_(booking, s);
  const range = rangeLabel_(start, end);
  const mailTo = email || String(s.ADMIN_EMAIL || '').trim(); // no email given: only the admin copy
  const mailed = !!mailTo && sendMail_(
    mailTo,
    `Booked: ${inst.name}, ${range}`,
    mailHtml_('Your booking is confirmed', [
      ['Instrument', inst.name], ['When', range], ['Name', name],
      ['Purpose', purpose || '–'], ['Location', inst.location || '–'], ['Reference', booking.id],
    ], manageUrl, 'Change or cancel booking', s),
    s,
    [Utilities.newBlob(ics_(booking, inst, manageUrl), 'text/calendar', 'booking.ics')]
  );
  return { ok: true, id: booking.id, range, mailed: !!email && mailed, manageUrl, email };
}

/**
 * Usage statistics for the statistics page.
 * days: 30, 90 or 180 (default 30). Bookings are removed after RETENTION_DAYS (default 180).
 * Counts confirmed bookings whose start falls in the period (upcoming ones included).
 * The user ranking only includes bookings made with an email address (identified by email, shown by the
 * most recently used name), so typos in names do not create duplicates. Emails are never returned.
 */
function apiGetStats(days) {
  const s = getSettings_();
  const showNames = isTrue_(s.SHOW_NAMES);
  days = [30, 90, 180].indexOf(Number(days)) >= 0 ? Number(days) : 30;
  const now = new Date();
  const from = days ? new Date(now.getTime() - days * 86400000) : null;
  const instruments = getInstruments_().filter(i => i.active);
  const byInst = {};
  instruments.forEach(i => {
    byInst[i.id] = { id: i.id, name: i.name, category: i.category, group: i.group,
                     daily: i.slotMinutes >= 1440, bookings: 0, hours: 0 };
  });
  const users = {};
  let total = 0, hours = 0, first = null, noEmail = 0;
  getBookings_()
    .filter(b => b.status === 'confirmed' && (!from || b.start >= from))
    .forEach(b => {
      const h = Math.max(0, (b.end - b.start) / 3600000);
      total++; hours += h;
      if (!first || b.start < first) first = b.start;
      const inst = byInst[b.instrumentId] || (byInst[b.instrumentId] = {
        id: b.instrumentId, name: b.instrumentId + ' (removed)', category: '', group: '', daily: false, bookings: 0, hours: 0 });
      inst.bookings++; inst.hours += h;
      const key = String(b.email || '').trim().toLowerCase();
      if (!key) { noEmail++; return; }
      const u = users[key] || (users[key] = { name: b.name, bookings: 0, hours: 0, instruments: {}, last: b.start });
      u.bookings++; u.hours += h; u.instruments[b.instrumentId] = true;
      if (b.start >= u.last) { u.last = b.start; u.name = b.name; } // show the most recently used spelling
    });
  const round1 = x => Math.round(x * 10) / 10;
  const userList = Object.keys(users).map(k => users[k])
    .sort((a, b) => b.bookings - a.bookings || b.hours - a.hours)
    .map(u => ({ name: u.name, bookings: u.bookings, hours: round1(u.hours), instruments: Object.keys(u.instruments).length }));
  return {
    labName: s.LAB_NAME,
    days,
    since: first ? fmt_(first, 'dd.MM.yyyy') : '',
    retentionDays: parseInt(s.RETENTION_DAYS, 10) || 180,
    showNames,
    totals: {
      bookings: total,
      hours: round1(hours),
      users: userList.length,
      withoutEmail: noEmail,
      instrumentsUsed: Object.keys(byInst).filter(k => byInst[k].bookings > 0).length,
      instruments: instruments.length,
    },
    users: showNames ? userList.slice(0, 15) : [],
    instruments: Object.keys(byInst).map(k => byInst[k]).map(i => Object.assign(i, { hours: round1(i.hours) })),
  };
}

function apiGetBooking(id, token) {
  const b = findBooking_(id, token);
  const inst = getInstruments_().find(i => i.id === b.instrumentId);
  const now = new Date();
  return {
    id: b.id,
    instrumentId: b.instrumentId,
    instrumentName: inst ? inst.name : b.instrumentId,
    range: rangeLabel_(b.start, b.end),
    name: b.name,
    purpose: b.purpose,
    status: b.status,
    ongoing: b.status === 'confirmed' && b.start <= now && b.end > now,
    canCancel: b.status === 'confirmed' && b.end > now,
  };
}

/** Cancels a future booking, or — if it is already running — releases the remaining time. */
function apiCancel(id, token) {
  const s = getSettings_();
  let b, inst, result;
  const lock = acquireLock_();
  try {
    b = findBooking_(id, token);
    if (b.status !== 'confirmed') throw new Error('This booking has already been cancelled.');
    const now = new Date();
    if (b.end <= now) throw new Error('This booking has already ended.');
    inst = getInstruments_().find(i => i.id === b.instrumentId) ||
      { id: b.instrumentId, name: b.instrumentId, slotMinutes: 30, location: '' };
    const sh = ss_().getSheetByName(SHEET_BOOKINGS);
    if (b.start < now) {
      const newEnd = ceilToSlot_(now, Math.min(inst.slotMinutes, TIME_STEP_MIN));
      if (newEnd >= b.end) throw new Error('Nothing to release – the booking ends with the current slot anyway.');
      sh.getRange(b.row, 4).setValue(newEnd);
      sh.getRange(b.row, 11).setValue(now);
      b.end = newEnd;
      result = { action: 'shortened', range: rangeLabel_(b.start, newEnd) };
    } else {
      sh.getRange(b.row, 9).setValue('cancelled');
      sh.getRange(b.row, 11).setValue(now);
      result = { action: 'cancelled', range: rangeLabel_(b.start, b.end) };
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  const shortened = result.action === 'shortened';
  const cancelTo = b.email || String(s.ADMIN_EMAIL || '').trim();
  if (cancelTo) sendMail_(
    cancelTo,
    `${shortened ? 'Released' : 'Cancelled'}: ${inst.name}, ${result.range}`,
    mailHtml_(shortened ? 'Remaining time released' : 'Your booking was cancelled', [
      ['Instrument', inst.name], [shortened ? 'Now booked' : 'Was booked', result.range],
      ['Name', b.name], ['Reference', b.id],
    ], shortened ? manageUrl_(b, s) : '', 'View booking', s),
    s
  );
  return result;
}

// ============================================================================
// Maintenance
// ============================================================================

function purgeOldBookings() {
  const s = getSettings_();
  const days = Math.max(1, parseInt(s.RETENTION_DAYS, 10) || 180);
  const cutoff = new Date(Date.now() - days * 86400000);
  let removed = 0;
  const lock = acquireLock_();
  try {
    const sh = ss_().getSheetByName(SHEET_BOOKINGS);
    const last = sh.getLastRow();
    if (last >= 2) {
      const range = sh.getRange(2, 1, last - 1, BOOKING_HEADERS.length);
      const rows = range.getValues();
      const keep = rows.filter(r => !(r[3] instanceof Date && r[3] < cutoff));
      removed = rows.length - keep.length;
      if (removed) {
        // Re-protect free-text cells so names like "=..." are never written back as formulas.
        keep.forEach(r => { [4, 5, 6].forEach(c => { r[c] = safeCell_(r[c]); }); });
        range.clearContent();
        if (keep.length) sh.getRange(2, 1, keep.length, BOOKING_HEADERS.length).setValues(keep);
      }
    }
  } finally {
    lock.releaseLock();
  }
  try { ss_().toast(`${removed} expired booking(s) deleted.`, 'Booking', 5); } catch (e) { /* no UI in triggers */ }
  return removed;
}

// ============================================================================
// Data access
// ============================================================================

function ss_() {
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { /* not bound in this context */ }
  if (!ss) {
    const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    if (!id) throw new Error('Not set up yet: open the sheet and run Booking → Set up / repair.');
    ss = SpreadsheetApp.openById(id);
  }
  return ss;
}

function getSettings_() {
  const out = {};
  DEFAULT_SETTINGS.forEach(r => { out[r[0]] = String(r[1]); });
  const sh = ss_().getSheetByName(SHEET_SETTINGS);
  if (sh) {
    sh.getDataRange().getValues().slice(1).forEach(r => {
      const k = String(r[0] || '').trim();
      if (k) out[k] = String(r[1] === null || r[1] === undefined ? '' : r[1]).trim();
    });
  }
  return out;
}

function getInstruments_() {
  const sh = ss_().getSheetByName(SHEET_INSTRUMENTS);
  if (!sh) throw new Error('Not set up yet: open the sheet and run Booking → Set up / repair.');
  return sh.getDataRange().getValues().slice(1)
    .filter(r => String(r[0]).trim())
    .map(r => ({
      id: String(r[0]).trim(),
      name: String(r[1] || r[0]).trim(),
      category: String(r[2] || 'Other').trim(),
      slotMinutes: clampInt_(r[3], 30, 5, 1440),
      maxHours: Number(r[4]) > 0 ? Number(r[4]) : 8,
      maxDaysAhead: clampInt_(r[5], 28, 1, 730),
      active: !(r[6] === false || /^(false|no|nein|0)$/i.test(String(r[6]).trim())),
      location: String(r[7] || '').trim(),
      contact: String(r[8] || '').trim(),
      notes: String(r[9] || '').trim(),
      groups: groupList_(r[10]),
      group: groupList_(r[10]).join(', '),
      photo: photoUrl_(r[11]),
      manual: /^https?:\/\//i.test(String(r[12] || '').trim()) ? String(r[12]).trim() : '',
    }));
}

function getInstrument_(id) {
  const inst = getInstruments_().find(i => i.id === String(id || '').trim());
  if (!inst || !inst.active) throw new Error('Unknown or inactive instrument.');
  return inst;
}

function publicInst_(i) {
  return {
    id: i.id, name: i.name, category: i.category, slotMinutes: i.slotMinutes, maxHours: i.maxHours,
    maxDaysAhead: i.maxDaysAhead, location: i.location, contact: i.contact, notes: i.notes,
    group: i.group, photo: i.photo, manual: i.manual,
    daily: i.slotMinutes >= 1440,
  };
}

function getBookings_() {
  const sh = ss_().getSheetByName(SHEET_BOOKINGS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, BOOKING_HEADERS.length).getValues()
    .map((r, i) => ({
      row: i + 2,
      id: String(r[0]),
      instrumentId: String(r[1]),
      start: new Date(r[2]),
      end: new Date(r[3]),
      name: String(r[4]),
      email: String(r[5]),
      purpose: String(r[6]),
      token: String(r[7]),
      status: String(r[8]).trim().toLowerCase(),
    }))
    .filter(b => b.id && !isNaN(b.start.getTime()) && !isNaN(b.end.getTime()));
}

function findBooking_(id, token) {
  const b = getBookings_().find(x => x.id === String(id || ''));
  if (!b || !token || b.token !== String(token)) throw new Error('Booking not found, or the link is invalid.');
  return b;
}

function acquireLock_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('The booking system is busy – please try again in a moment.');
  return lock;
}

// ============================================================================
// Email
// ============================================================================

function sendMail_(to, subject, htmlBody, s, attachments) {
  const opts = { to, subject, htmlBody, name: s.LAB_NAME + ' booking' };
  if (String(s.ADMIN_EMAIL || '').trim()) opts.bcc = String(s.ADMIN_EMAIL).trim();
  if (attachments && attachments.length) opts.attachments = attachments;
  try {
    MailApp.sendEmail(opts);
    return true;
  } catch (e) {
    console.error('Mail failed: ' + e);
    return false;
  }
}

function mailHtml_(heading, rows, linkUrl, linkText, s) {
  const tr = rows.map(([k, v]) =>
    `<tr><td style="padding:3px 14px 3px 0;color:#66717d">${esc_(k)}</td><td style="padding:3px 0">${esc_(v)}</td></tr>`).join('');
  const link = linkUrl
    ? `<p style="margin:20px 0 8px"><a href="${esc_(linkUrl)}" style="background:#1f3966;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">${esc_(linkText)}</a></p>
       <p style="color:#66717d;font-size:12px;margin:0">Keep this email: the button above is the only way to change or cancel this booking.</p>`
    : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1d2329;max-width:520px">
    <h2 style="font-size:18px;margin:0 0 12px">${esc_(heading)}</h2>
    <table style="border-collapse:collapse">${tr}</table>${link}
    <p style="color:#66717d;font-size:12px;margin-top:24px">${esc_(s.LAB_NAME)} · Instrument booking</p></div>`;
}

function ics_(b, inst, url) {
  const u = d => Utilities.formatDate(d, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
  const e = t => String(t || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lab instrument booking//EN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + b.id + '@lab-booking',
    'DTSTAMP:' + u(new Date()),
    'DTSTART:' + u(b.start),
    'DTEND:' + u(b.end),
    'SUMMARY:' + e(inst.name + ' (booked)'),
    inst.location ? 'LOCATION:' + e(inst.location) : null,
    'DESCRIPTION:' + e('Change or cancel: ' + url),
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

function baseUrl_(s) {
  const pub = String(s.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (pub) return pub;
  let url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
  // Workspace returns a domain-specific URL (script.google.com/a/<domain>/macros/...),
  // which fails for people outside the domain. Use the public form instead.
  return url.replace(/^https:\/\/script\.google\.com\/a\/[^/]+\/macros\//, 'https://script.google.com/macros/')
            .replace(/\/dev$/, '/exec');
}

function manageUrl_(b, s) {
  return baseUrl_(s) + '?page=manage&id=' + encodeURIComponent(b.id) + '&token=' + encodeURIComponent(b.token);
}

// ============================================================================
// Helpers
// ============================================================================

function tz_() { return Session.getScriptTimeZone(); }
function fmt_(d, pattern) { return Utilities.formatDate(d, tz_(), pattern); }

function parseLocal_(str) {
  str = String(str || '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str)) throw new Error('Invalid date or time.');
  const d = Utilities.parseDate(str, tz_(), "yyyy-MM-dd'T'HH:mm");
  if (!d || isNaN(d.getTime())) throw new Error('Invalid date or time.');
  return d;
}

function minuteOfDay_(d) { return Number(fmt_(d, 'H')) * 60 + Number(fmt_(d, 'm')); }

function addDaysStr_(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function hhmm_(min) {
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}

function ceilToSlot_(d, slot) {
  const day = fmt_(d, 'yyyy-MM-dd');
  const exact = minuteOfDay_(d) + d.getSeconds() / 60;
  const m = Math.ceil(exact / slot) * slot;
  return m >= 1440 ? parseLocal_(addDaysStr_(day, 1) + 'T00:00') : parseLocal_(day + 'T' + hhmm_(m));
}

/** Short date-time label relative to a reference day ('yyyy-MM-dd'). */
function shortDT_(d, refDay) {
  if (fmt_(d, 'HH:mm') === '00:00' && fmt_(new Date(d.getTime() - 1), 'yyyy-MM-dd') === refDay) return '24:00';
  return fmt_(d, 'yyyy-MM-dd') === refDay ? fmt_(d, 'HH:mm') : fmt_(d, 'EEE dd.MM. HH:mm');
}

function rangeLabel_(a, b) {
  const lastMoment = new Date(b.getTime() - 1);
  const sameDay = fmt_(a, 'yyyy-MM-dd') === fmt_(lastMoment, 'yyyy-MM-dd');
  if (minuteOfDay_(a) === 0 && minuteOfDay_(b) === 0) { // whole days
    return sameDay
      ? fmt_(a, 'EEE dd.MM.yyyy') + ' (all day)'
      : fmt_(a, 'EEE dd.MM.') + ' – ' + fmt_(lastMoment, 'EEE dd.MM.yyyy');
  }
  return sameDay
    ? fmt_(a, 'EEE dd.MM.yyyy, HH:mm') + '–' + (minuteOfDay_(b) === 0 ? '24:00' : fmt_(b, 'HH:mm'))
    : fmt_(a, 'EEE dd.MM. HH:mm') + ' – ' + fmt_(b, 'EEE dd.MM. HH:mm');
}

/**
 * Turns a photo reference from the sheet into an embeddable image URL.
 * Accepts Google Drive share links (file/d/<id>/..., open?id=<id>, uc?id=<id>),
 * a bare Drive file ID, or any other https image URL. Drive files must be shared
 * as "Anyone with the link".
 */
/** Splits a Group cell into separate groups: "Group A, Group B" or "A; B" or one per line. */
function groupList_(v) {
  const seen = {};
  return String(v || '').split(/[,;\n]+/).map(x => x.trim()).filter(x => x && !seen[x.toLowerCase()] && (seen[x.toLowerCase()] = true));
}

function photoUrl_(v) {
  v = String(v || '').trim();
  if (!v) return '';
  const m = v.match(/drive\.google\.com\/(?:file\/d\/|open\?(?:.*&)?id=|uc\?(?:.*&)?id=|thumbnail\?(?:.*&)?id=)([\w-]{20,})/) ||
            v.match(/^([\w-]{25,})$/);
  if (m) return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1200';
  return /^https:\/\//i.test(v) ? v : '';
}

function minText_(m) { return m % 60 === 0 ? hoursText_(m / 60) : m > 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; }
function slotText_(m) { return m % 60 === 0 ? (m / 60) + '-hour' : m + '-minute'; }
function hoursText_(h) { return h >= 24 && h % 24 === 0 ? (h / 24) + (h === 24 ? ' day' : ' days') : h + ' h'; }

function clampInt_(v, def, min, max) {
  const n = parseInt(v, 10);
  return isNaN(n) ? def : Math.min(max, Math.max(min, n));
}

function isTrue_(v) { return /^(true|yes|ja|1)$/i.test(String(v).trim()); }

function domainList_(v) {
  return String(v || '').split(/[,;\s]+/).map(x => x.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
}

function clean_(v, max) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Prevents spreadsheet formula injection from free-text fields. */
function safeCell_(v) {
  v = String(v === null || v === undefined ? '' : v);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function esc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toJs_(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function newId_() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = '';
  for (let i = 0; i < 4; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return 'B' + fmt_(new Date(), 'yyMMdd') + '-' + r;
}

function newToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 40);
}
