const HEAD = {
  store: '同期台帳',
  journals: ['日誌ID','作業日','機械','作業先','鶴居加算','作業時間合計(h)','アワー合計(h)','基本機械単価','鶴居加算単価','適用機械単価','適用オペレーター単価','機械使用料','オペレーター料','合計金額','同期版'],
  parts: ['作業ID','日誌ID','順番','作業日','開始時刻','終了時刻','開始アワー','終了アワー','作業時間(h)','稼働時間(h)']
};

// スプレッドシートに紐づくスクリプトのエディタから一度だけ実行します。
function setup() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!sheet) throw Error('対象シートの「拡張機能 → Apps Script」から設定してください。');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID',sheet.getId());
  if (!props.getProperty('HOUR_LAB_KEY')) {
    props.setProperty('HOUR_LAB_KEY',Utilities.getUuid() + Utilities.getUuid());
  }
  tab_(sheet,HEAD.store,['日誌ID','同期データ']);
  tab_(sheet,'日誌',HEAD.journals);
  tab_(sheet,'作業明細',HEAD.parts);
}
function tab_(book, name, headers) {
  const sheet = book.getSheetByName(name) || book.insertSheet(name);
  if (!sheet.getLastRow()) {
    sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}
function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() {
  return json_({service:'HOUR LAB',version:1});
}
function doPost(event) {
  let lock;
  try {
    const raw = event.postData.contents;
    if (raw.length > 10000000) return json_({ok:false,error:'送信データが上限を超えました。'});
    const request = JSON.parse(raw);
    const props = PropertiesService.getScriptProperties();
    const secret = props.getProperty('HOUR_LAB_KEY');
    if (!secret || !equal_(request.key,secret)) return json_({ok:false,error:'接続キーを確認してください。'});
    if (!Array.isArray(request.changes)) throw Error('送信形式を確認してください。');
    lock = LockService.getScriptLock();
    lock.waitLock(20000);
    const book = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
    const store = tab_(book,HEAD.store,['日誌ID','同期データ']);
    const rows = store.getLastRow() - 1;
    const records = rows ? store.getRange(2,1,rows,2).getValues()
      .filter(row=>row[0]).map(row=>JSON.parse(row[1])) : [];
    const result = apply_(records,request.changes);
    if (result.changed) {
      const replacement = records.map(j=>[j.id,JSON.stringify(j)]);
      write_(store,replacement,2);
      SpreadsheetApp.flush();
    }
    if (result.changed || request.changes.length || props.getProperty('HOUR_LAB_PROJECTED') !== '1') {
      props.deleteProperty('HOUR_LAB_PROJECTED');
      project_(book,records);
      SpreadsheetApp.flush();
      props.setProperty('HOUR_LAB_PROJECTED','1');
    }
    return json_({ok:true,ack:result.ack,conflicts:result.conflicts,records});
  } catch (error) {
    return json_({ok:false,error:error.message === 'INVALID' ? '記録の形式を確認してください。' :
      '同期処理に失敗しました。再度お試しください。'});
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}
function equal_(a,b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i=0;i<b.length;i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const id_ = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const str_ = (value,length) => typeof value === 'string' && value.trim().length > 0 && value.length <= length;
const num_ = (value,min,max) => Number.isSafeInteger(value) && value >= min && value <= max;
const rate_ = value => value === null || num_(value,0,1000000);
const clock_ = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  ? Number(value.slice(0,2))*60+Number(value.slice(3)) : NaN;
const meter_ = value => /^\d{1,9}(\.\d)?$/.test(value) ? Math.round(Number(value)*10) : NaN;
function key_(j) {
  return JSON.stringify([j.day,j.machineId,j.site.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase()]);
}
function clean_(j) {
  if (!j || !id_(j.id) || !id_(j.machineId) || !id_(j.mutation) ||
      !num_(j.version,0,Number.MAX_SAFE_INTEGER-1) || !num_(j.created,0,Number.MAX_SAFE_INTEGER) ||
      typeof j.deleted !== 'boolean' || typeof j.tsurui !== 'boolean' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(j.day) || !Number.isFinite(Date.parse(j.day)) ||
      new Date(j.day).toISOString().slice(0,10) !== j.day ||
      !str_(j.machine,100) || !str_(j.site,100) || !j.rates || !rate_(j.rates.machine) ||
      !rate_(j.rates.operator) || !num_(j.rates.extra,0,1000000) ||
      !Array.isArray(j.parts) || (j.deleted ? j.parts.length !== 0 : j.parts.length === 0)) {
    throw Error('INVALID');
  }
  const ids = new Set();
  let previous = 0;
  const parts = j.parts.map(p=>{
    if (!p) throw Error('INVALID');
    const start = clock_(p.start), end = clock_(p.end), first = meter_(p.first), last = meter_(p.last);
    if (!id_(p.id) || ids.has(p.id) || !(start >= previous && end > start && last >= first)) throw Error('INVALID');
    previous = end;
    ids.add(p.id);
    return {id:p.id,start:p.start,end:p.end,first:String(p.first),last:String(p.last)};
  });
  const result = {id:j.id,day:j.day,machineId:j.machineId,machine:j.machine,site:j.site,
    tsurui:j.tsurui,rates:{machine:j.rates.machine,operator:j.rates.operator,extra:j.rates.extra},
    parts,created:j.created,version:j.version,deleted:j.deleted,mutation:j.mutation,dirty:false};
  if (JSON.stringify(result).length > 45000) throw Error('INVALID');
  return result;
}
function apply_(records, changes) {
  // Validate the whole batch before mutating the canonical records.
  const incoming = changes.map(clean_);
  const byId = new Map(records.map((j,i)=>[j.id,i]));
  const active = new Map(records.filter(j=>!j.deleted).map(j=>[key_(j),j]));
  const ack = [], conflicts = [];
  let changed = false;
  for (const j of incoming) {
    const index = byId.get(j.id);
    const old = records[index];
    if (old && old.mutation === j.mutation) {
      ack.push({id:j.id,version:old.version});
      continue;
    }
    const occupied = !j.deleted && active.get(key_(j));
    if ((old?.version ?? 0) !== j.version || (occupied && occupied.id !== j.id)) {
      conflicts.push({id:j.id,remote:occupied && occupied.id !== j.id ? occupied : old ?? null});
      continue;
    }
    if (old && !old.deleted) active.delete(key_(old));
    j.version += 1;
    if (index === undefined) {
      byId.set(j.id,records.length);
      records.push(j);
    } else records[index] = j;
    if (!j.deleted) active.set(key_(j),j);
    ack.push({id:j.id,version:j.version});
    changed = true;
  }
  return {ack,conflicts,changed};
}
function write_(sheet, rows, width) {
  const existing = sheet.getLastRow() - 1;
  if (rows.length + 1 > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(),rows.length + 1 - sheet.getMaxRows());
  }
  if (rows.length) sheet.getRange(2,1,rows.length,width).setValues(rows);
  if (existing > rows.length) sheet.getRange(rows.length+2,1,existing-rows.length,width).clearContent();
}
function safeCell_(value) {
  return typeof value === 'string' && /^[=+@\-]/.test(value.trimStart()) ? "'" + value : value;
}
function project_(book, records) {
  const journals = [], parts = [];
  for (const j of records.filter(item=>!item.deleted).sort((a,b)=>a.day.localeCompare(b.day) || a.created-b.created)) {
    let mins = 0, tenths = 0;
    j.parts.forEach((p,i)=>{
      const duration = clock_(p.end)-clock_(p.start), runtime = meter_(p.last)-meter_(p.first);
      mins += duration;
      tenths += runtime;
      parts.push([p.id,j.id,i+1,j.day,p.start,p.end,Number(p.first),Number(p.last),duration/60,runtime/10]);
    });
    const extra = j.tsurui ? j.rates.extra : 0;
    const machine = j.rates.machine === null ? null : j.rates.machine + extra;
    const operator = j.rates.operator;
    const machineFee = machine === null ? '' : Math.round(machine*tenths/10);
    const operatorFee = operator === null ? '' : Math.round(operator*mins/60);
    journals.push([j.id,j.day,safeCell_(j.machine),safeCell_(j.site),j.tsurui,mins/60,tenths/10,
      j.rates.machine ?? '',extra,machine ?? '',operator ?? '',machineFee,operatorFee,
      machineFee === '' || operatorFee === '' ? '' : machineFee + operatorFee,j.version]);
  }
  write_(tab_(book,'日誌',HEAD.journals),journals,HEAD.journals.length);
  write_(tab_(book,'作業明細',HEAD.parts),parts,HEAD.parts.length);
}
