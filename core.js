(function (root) {
  const pad = n => String(n).padStart(2, '0');
  const clock = (date = new Date()) => ({
    day: [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-'),
    time: pad(date.getHours()) + ':' + pad(date.getMinutes())
  });
  const minutes = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;
  const timeAt = value => value < 0 || value >= 1440 || !Number.isFinite(value)
    ? '' : pad(Math.floor(value / 60)) + ':' + pad(value % 60);
  const meter = value => /^\d{1,9}(\.\d)?$/.test(String(value))
    ? Math.round(Number(value) * 10) : NaN;
  const siteKey = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const journalKey = j => JSON.stringify([j.day, j.machineId, siteKey(j.site)]);
  const findJournal = (journals, identity) => journals.find(j => !j.deleted && journalKey(j) === journalKey(identity));
  const listed = (journals, year, month, newest) => journals
    .filter(j => !j.deleted && j.day.startsWith(year + '-' + month))
    .sort((a, b) => (newest ? -1 : 1) * (a.day.localeCompare(b.day) ||
      a.created - b.created || a.id.localeCompare(b.id)));
  function validateSegment(segment) {
    const start = minutes(segment.start), end = minutes(segment.end);
    const first = meter(segment.first), last = meter(segment.last);
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw Error('開始・終了時刻を確認してください。');
    if (end <= start) throw Error('終了は同じ日の開始より後にしてください。日をまたぐ場合は日ごとに記録してください。');
    if (!Number.isFinite(first) || !Number.isFinite(last)) throw Error('アワメーターを小数第1位までで入力してください。');
    if (last < first) throw Error('終了アワーは開始アワー以上にしてください。');
  }
  function totals(journal) {
    const parts = journal.parts.map(p => ({
      mins: minutes(p.end) - minutes(p.start),
      tenths: meter(p.last) - meter(p.first)
    }));
    const mins = parts.reduce((sum, p) => sum + p.mins, 0);
    const tenths = parts.reduce((sum, p) => sum + p.tenths, 0);
    const machineRate = journal.rates.machine === null ? null :
      journal.rates.machine + (journal.tsurui ? journal.rates.extra : 0);
    const machineFee = machineRate === null ? null : Math.round(machineRate * tenths / 10);
    const operatorFee = journal.rates.operator === null ? null : Math.round(journal.rates.operator * mins / 60);
    return { parts, mins, tenths, machineRate, machineFee, operatorFee,
      total: machineFee === null || operatorFee === null ? null : machineFee + operatorFee };
  }
  const api = { clock, minutes, timeAt, meter, journalKey, findJournal, listed, validateSegment, totals };
  if (typeof module === 'object') module.exports = api;
  else root.Hour = api;
})(this);
