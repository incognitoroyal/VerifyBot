/** Minimal User-Agent parsing — enough for a moderation log, no dependency. */
const parse = (ua = '') => {
  const raw = String(ua);

  let os = 'Unknown';
  if (/Windows NT 10/i.test(raw)) os = 'Windows 10/11';
  else if (/Windows NT/i.test(raw)) os = 'Windows';
  else if (/CrOS/i.test(raw)) os = 'ChromeOS';
  else if (/Android ([\d.]+)/i.test(raw)) os = `Android ${raw.match(/Android ([\d.]+)/i)[1]}`;
  else if (/(iPhone|iPad|iPod)/i.test(raw)) os = 'iOS';
  else if (/Mac OS X ([\d_]+)/i.test(raw)) {
    os = `macOS ${raw.match(/Mac OS X ([\d_]+)/i)[1].replace(/_/g, '.')}`;
  } else if (/Linux/i.test(raw)) os = 'Linux';

  let browser = 'Unknown';
  if (/Edg\//i.test(raw)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(raw)) browser = 'Opera';
  else if (/Firefox\/([\d.]+)/i.test(raw)) {
    browser = `Firefox ${raw.match(/Firefox\/([\d.]+)/i)[1].split('.')[0]}`;
  } else if (/Chrome\/([\d.]+)/i.test(raw)) {
    browser = `Chrome ${raw.match(/Chrome\/([\d.]+)/i)[1].split('.')[0]}`;
  } else if (/Version\/([\d.]+).*Safari/i.test(raw)) {
    browser = `Safari ${raw.match(/Version\/([\d.]+)/i)[1].split('.')[0]}`;
  } else if (/Safari/i.test(raw)) browser = 'Safari';

  let device = 'Desktop';
  if (/iPad/i.test(raw)) device = 'Tablet';
  else if (/iPhone|iPod/i.test(raw)) device = 'Phone';
  else if (/Android/i.test(raw) && /Mobile/i.test(raw)) device = 'Phone';
  else if (/Android/i.test(raw)) device = 'Tablet';
  else if (/Mobile/i.test(raw)) device = 'Phone';

  return { os, browser, device };
};

const describe = (ua) => {
  const { os, browser, device } = parse(ua);
  return `${browser} • ${os} (${device})`;
};

module.exports = { parse, describe };
