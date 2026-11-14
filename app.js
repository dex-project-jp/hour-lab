'use strict';
const H = window.Hour;
const storageKey = 'hour-lab-v1';
const main = document.querySelector('#main');
const message = document.querySelector('#message');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const uid = () => crypto.randomUUID();
const h = (value, divisor) => (value / divisor).toFixed(2).replace(/(\.\d)0$/, '$1');
const yen = value => value === null ? '未設定' : value.toLocaleString('ja-JP') + '円';
const dayLabel = value => value.split('-').map(Number).join('/').replace(/^(\d+)\/(\d+)\/(\d+)$/, '$1年$2月$3日');
const mark = index => index < 20 ? String.fromCharCode(9312 + index) : String(index + 1) + '.';
const btn = (action, label, attrs = '', cls = '') => `<button type="button" class="${cls}" data-action="${action}" ${attrs}>${label}</button>`;
const field = (target, name, label, value, attributes = '') =>
  `<label>${label}<input data-target="${target}" name="${name}" value="${esc(value)}" ${attributes}></label>`;
let data;
try {
  const saved = localStorage.getItem(storageKey);
  data = saved ? JSON.parse(saved) : {
    journals: [], machines: [{id: 'mania', name: 'マニア', rate: null}],
    sites: [], operator: null, extra: 2000, url: '', key: '', draft: null
  };
} catch {
  main.textContent = '記録を読み込めませんでした。ブラウザに保存されているデータを確認してください。';
  throw Error('HOUR LAB local storage unavailable');
}
let screen = 'work', detailId = '', year = H.clock().day.slice(0, 4), month = '', newest = true;
let busy = false, syncStatus = '', toastTimer;
function notice(text) {
  message.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { message.textContent = ''; }, 6500);
}
function saveState(next) {
  localStorage.setItem(storageKey, JSON.stringify(next));
  data = next;
}
function change(update) {
  const next = JSON.parse(JSON.stringify(data));
  update(next);
  try { saveState(next); }
  catch { throw Error('端末に保存できません。ブラウザの空き容量や保存設定を確認してください。'); }
}
function navigate(next) {
  screen = next;
  render();
  window.scrollTo(0, 0);
}
const visible = () => H.listed(data.journals, year, month, newest);
const live = () => data.journals.filter(j => !j.deleted);
const current = id => live().find(j => j.id === id);
const idAttr = id => `data-id="${esc(id)}"`;
function showDetail(journal, preserve = false) {
  detailId = journal.id;
  if (!preserve) {
    year = journal.day.slice(0,4);
    if (month && journal.day.slice(5,7) !== month) month = '';
  }
  navigate('detail');
}
function reserveDraft() {
  if (data.draft) {
    navigate('work');
    if (data.draft.running) throw Error('作業中の記録があります。先に作業を終了して保存してください。');
    throw Error('入力途中の作業があります。保存または入力破棄してから開始してください。');
  }
}
function startDraft(source, originalDay = false) {
  reserveDraft();
  const now = H.clock();
  const identity = {day: originalDay ? source.day : now.day, machineId: source?.machineId ?? data.machines[0]?.id ?? '',
    site: source?.site ?? ''};
  const target = source && H.findJournal(data.journals, identity);
  const previous = (target || source)?.parts.slice(-1)[0];
  const draft = {...identity, originalDay, tsurui: (target || source)?.tsurui ?? false,
    start: now.time, startCapture: now.time, first: previous?.last ?? '',
    end: '', endCapture: '', last: '', finished: false, editId: '', partId: ''};
  change(next => { next.draft = draft; });
  navigate('work');
}
function timeInput(draft, key, label) {
  const captured = draft[key + 'Capture'];
  const minute = H.minutes(captured);
  const value = draft[key];
  const options = [['切り下げ', H.timeAt(Math.floor(minute / 15) * 15)],
    ['取得時刻', captured], ['切り上げ', H.timeAt(Math.ceil(minute / 15) * 15)]];
  const choice = (label, time) => btn('time', `${label}<small>${esc(time || '翌日')}</small>`,
    `data-key="${key}" data-time="${esc(time)}" ${time ? '' : 'disabled'}`);
  return field('draft', key, label, value, 'type="time"') +
    (captured ? '<div class="time-grid">' + options.map(item => choice(...item)).join('') + '</div>' : '');
}
function workView() {
  const d = data.draft;
  if (!d) {
    const last = current(data.lastWorkId) || (data.workOrder || []).slice().reverse().map(current).find(Boolean) || live().slice(-1)[0];
    const today = H.clock().day;
    return `<div class="between"><h1>作業入力</h1>${btn('refresh','更新')}</div>
      <section class="card">${btn('new','＋ 新規作成','','primary wide')}</section>
      ${last ? `<section class="card"><h2>最後の作業</h2>
        <p>${dayLabel(last.day)}</p><p class="break">${esc(last.machine)} · ${esc(last.site)}</p>
        <p>終了アワー　${(H.meter(last.parts.at(-1).last)/10).toFixed(1)}</p>
        <div class="row">${btn('resume','この作業の続きから',idAttr(last.id),'primary')}
        ${last.day !== today ? btn('resume-today','今日の作業として引き継ぐ',idAttr(last.id)) : ''}</div>
        ${last.day !== today ? '<p class="muted">「この作業の続きから」は表示の日付の日誌に追加します。</p>' : ''}
      </section>` : ''}`;
  }
  const match = H.findJournal(data.journals, d);
  const working = d.running && !d.finished;
  const editable = !d.partId && !d.running && !d.originalDay;
  const machines = [...data.machines];
  if (d.machineId && !machines.some(m => m.id === d.machineId)) {
    const past = live().find(j => j.machineId === d.machineId);
    if (past) machines.unshift({id: past.machineId, name: past.machine});
  }
  const sites = [...new Set([...data.sites, ...live().map(j => j.site)])];
  const machineName = machines.find(m => m.id === d.machineId)?.name;
  const heading = d.partId ? '作業を編集' : working ? '作業中' : d.running ? '作業終了' : '作業入力';
  return `<div class="between"><h1>${heading}</h1>${btn('refresh','更新')}</div>
  ${working ? btn('finish','作業終了','','primary wide work-end') : ''}
  ${d.running ? `<section class="card">
    <h2>${dayLabel(d.day)}</h2><p class="break">${esc(d.machineName || machineName || d.machineId)} · ${esc(d.site)}</p>
    <p>鶴居　${d.tsurui ? 'あり' : 'なし'}</p>
  </section>` : `<section class="card">
  ${field('draft','day','作業日',d.day,`type="date" ${editable ? '' : 'disabled'}`)}
  <label>作業機械<select data-target="draft" name="machineId" ${editable ? '' : 'disabled'}>
  <option value="">選択してください</option>${machines.map(m => `<option value="${esc(m.id)}" ${m.id === d.machineId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
  ${field('draft','site','作業先',d.site,`list="sites" maxlength="100" autocomplete="off" ${editable ? '' : 'disabled'}`)}
  <datalist id="sites">${sites.map(site => `<option value="${esc(site)}"></option>`).join('')}</datalist>
  <label class="check"><input type="checkbox" data-target="draft" name="tsurui" ${(match?.tsurui ?? d.tsurui) ? 'checked' : ''} ${match ? 'disabled' : ''}>鶴居加算</label>
  <p id="match" class="muted">${match && !d.partId ? '同じ日・機械・作業先の日誌に追加します。' : ''}</p></section>`}
  <section class="card"><h2>開始</h2>${timeInput(d,'start','開始時刻')}
  ${field('draft','first','開始アワメーター',d.first,'inputmode="decimal" placeholder="4756.6"')}</section>
  ${d.finished ? `<section class="card"><h2>終了</h2>${timeInput(d,'end','終了時刻')}
  ${field('draft','last','終了アワメーター',d.last,'inputmode="decimal" placeholder="4758.6"')}
  <p id="preview" class="muted"></p></section>` : ''}
  ${working ? '' : btn(d.finished ? 'save' : 'begin', d.finished ? '保存' : '開始', '', 'primary wide')}
  ${btn('discard','入力を破棄','','danger spaced')}`;
}
function refreshDraftHints() {
  const d = data.draft;
  const match = H.findJournal(data.journals, d);
  const checkbox = main.querySelector('[name=tsurui]');
  if (checkbox) {
    checkbox.disabled = Boolean(match);
    checkbox.checked = match?.tsurui ?? d.tsurui;
    main.querySelector('#match').textContent = match && !d.partId ? '同じ日・機械・作業先の日誌に追加します。' : '';
  }
  const preview = main.querySelector('#preview');
  if (!preview) return;
  const duration = H.minutes(d.end) - H.minutes(d.start);
  const meter = H.meter(d.last) - H.meter(d.first);
  preview.textContent = [
    duration > 0 ? '作業 ' + h(duration,60) + 'h' : '',
    meter >= 0 ? '稼働 ' + h(meter,10) + 'h' : ''
  ].filter(Boolean).join('　');
}
function journalButton(j) {
  const t = H.totals(j);
  return btn(screen === 'recent' ? 'resume-today' : 'open',
    `<small>${dayLabel(j.day)}</small><strong>${esc(j.machine)} · ${esc(j.site)}</strong><span class="number">${h(t.mins,60)}h</span>`,
    idAttr(j.id), 'journal');
}
function syncControl() {
  const awaiting = data.journals.filter(j => j.dirty).length;
  return `<section class="card"><div class="between">${btn('sync',busy ? '同期中…' : 'スプシに保存',busy ? 'disabled' : '', 'primary')}
  <small>未同期 ${awaiting}件</small></div>${syncStatus ? `<p class="muted">${esc(syncStatus)}</p>` : ''}</section>`;
}
function listView() {
  const years = [...new Set([year, H.clock().day.slice(0,4), ...live().map(j => j.day.slice(0,4))])].sort().reverse();
  const options = (values, selected, label) => values.map(v =>
    `<option value="${v}" ${v === selected ? 'selected' : ''}>${label(v)}</option>`).join('');
  return `<div class="between"><h1>作業日誌一覧</h1>${btn('refresh','更新')}</div><section class="card grid grid3">
  <label>年<select data-filter="year">${options(years,year,v => v+'年')}</select></label>
  <label>月<select data-filter="month">${options(['', ...Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0'))],month,v=>v ? Number(v)+'月':'全月')}</select></label>
  <label>順番<select data-filter="order">${options(['old','new'],newest?'new':'old',v=>v==='old'?'古い順':'新しい順')}</select></label>
  </section>${visible().map(journalButton).join('') || '<p class="muted">この期間の作業日誌はありません。</p>'}${syncControl()}`;
}
function feeLine(label, rate, value, divisor, fee) {
  return `<div class="money"><strong>${label}</strong><p>${yen(rate)} × ${h(value,divisor)}h ＝ ${yen(fee)}</p></div>`;
}
function detailView() {
  const journal = current(detailId);
  if (!journal) return '<h1>作業日誌</h1>' + btn('list', '一覧に戻る');
  const t = H.totals(journal);
  const group = (title, rows, sum) => `<section class="card"><h2>${title}</h2>${rows.join('')}
    <div class="between total"><strong>${title}合計</strong><span class="number">${sum}h</span></div></section>`;
  const row = (index, range, total) => `<div class="segment"><span>${mark(index)}</span><strong>${range}</strong><span>${total}h</span></div>`;
  const journals = visible();
  const index = journals.findIndex(j => j.id === journal.id);
  const prev = journals[index-1], next = journals[index+1];
  const pagination = `<div class="between card" role="group" aria-label="日誌の前後移動">
    ${btn('open','← 前へ',prev ? idAttr(prev.id) : 'disabled')}<small>${index+1} / ${journals.length}</small>
    ${btn('open','次へ →',next ? idAttr(next.id) : 'disabled')}</div>`;
  return `<div class="between"><h1>作業日誌</h1>${btn('list','一覧に戻る','','compact')}</div>
    ${pagination}
    <section class="card"><h2>${dayLabel(journal.day)}</h2><p class="break">作業機械　${esc(journal.machine)}</p><p class="break">作業先　${esc(journal.site)}</p>
    <p>鶴居　${journal.tsurui ? 'あり' : 'なし'}</p></section>
    ${group('作業時間',journal.parts.map((p,i)=>row(i,esc(p.start)+'〜'+esc(p.end),h(t.parts[i].mins,60))),h(t.mins,60))}
    ${group('アワメーター',journal.parts.map((p,i)=>row(i,(H.meter(p.first)/10).toFixed(1)+'〜'+(H.meter(p.last)/10).toFixed(1),h(t.parts[i].tenths,10))),h(t.tenths,10))}
    <section class="card"><h2>料金計算</h2>${feeLine('機械使用料',t.machineRate,t.tenths,10,t.machineFee)}
    ${feeLine('オペレーター料',journal.rates.operator,t.mins,60,t.operatorFee)}
    <div class="between total"><strong>合計金額</strong><span class="number">${yen(t.total)}</span></div></section>
    ${btn('resume','この作業の続きから',idAttr(journal.id),'primary wide')}
    <details class="card spaced"><summary>日誌・作業を編集</summary>
    <form data-form="journal" data-id="${esc(journal.id)}">
    ${field('editor','day','作業日',journal.day,'type="date" required')}
    <label>作業機械<select name="machineId">
    ${[...data.machines, ...(!data.machines.some(m=>m.id===journal.machineId) ? [{id:journal.machineId,name:journal.machine}] : [])].map(m=>
      `<option value="${esc(m.id)}" ${m.id===journal.machineId?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label>
    ${field('editor','site','作業先',journal.site,'maxlength="100" required')}
    <label class="check"><input type="checkbox" name="tsurui" ${journal.tsurui?'checked':''}>鶴居加算</label>
    ${field('editor','machineRate','この日誌の機械単価（円/h）',journal.rates.machine,'type="number" min="0" max="1000000" step="1"')}
    ${field('editor','operatorRate','この日誌のオペレーター単価（円/h）',journal.rates.operator,'type="number" min="0" max="1000000" step="1"')}
    <button>日誌情報を保存</button></form>
    ${journal.parts.map((p,i)=>`<div class="between total"><span>${mark(i)} ${esc(p.start)}〜${esc(p.end)}</span>
    <div class="row">${btn('edit-part','編集',idAttr(p.id),'compact')}${btn('remove-part','削除',idAttr(p.id),'danger compact')}</div></div>`).join('')}
    ${btn('remove-journal','日誌を削除',idAttr(journal.id),'danger spaced')}</details>
    ${pagination}`;
}
function settingsView() {
  const rates = 'type="number" min="0" max="1000000" step="1"';
  const machineForm = (m = {}) => `<form class="card" data-form="machine" data-id="${esc(m.id)}">
    <h2>${m.id ? esc(m.name) : '作業機械を追加'}</h2>
    ${field('editor','name','機械名',m.name,'required maxlength="100"')}
    ${field('editor','rate','時間単価（円/h）',m.rate,rates)}
    <div class="row"><button>${m.id?'変更を保存':'追加'}</button>
    ${m.id ? btn('remove-machine','削除',idAttr(m.id),'danger') : ''}</div></form>`;
  return `<h1>設定</h1><form class="card" data-form="rates"><h2>共通の時間単価</h2>
  ${field('editor','operator','オペレーター料金（円/h）',data.operator,rates)}
  ${field('editor','extra','鶴居加算（円/h）',data.extra,rates + ' required')}
  <button>単価を保存</button></form>
  ${data.machines.map(machineForm).join('')}${machineForm()}
  <form class="card" data-form="connection"><h2>Googleスプレッドシート</h2>
  ${field('editor','url','Apps Script ウェブアプリURL',data.url,'type="url" autocomplete="off" spellcheck="false"')}
  ${field('editor','key','接続キー',data.key,'type="password" autocomplete="off" spellcheck="false"')}
  <button>接続設定を保存</button></form>${syncControl()}${conflictCards()}`;
}
function render() {
  const views = {work:workView,list:listView,detail:detailView,settings:settingsView,recent:() =>
    '<h1>続きから</h1>' +
    ([...live()].sort((a,b)=>b.day.localeCompare(a.day)||b.created-a.created).map(journalButton).join('') ||
      '<p class="muted">引き継げる日誌がありません。</p>')};
  main.innerHTML = views[screen]();
  document.querySelectorAll('.nav button').forEach(button => {
    const active = screen === 'detail' || screen === 'recent' ? 'list' : screen;
    if (active === button.dataset.action) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  });
  if (screen === 'work' && data.draft) refreshDraftHints();
}
function editPart(id) {
  reserveDraft();
  const j = current(detailId);
  const p = j.parts.find(part => part.id === id);
  change(next => { next.draft = {...p, day:j.day, machineId:j.machineId, site:j.site,
    tsurui:j.tsurui, editId:j.id, partId:id, finished:true}; });
  navigate('work');
}
function touch(journal) {
  journal.dirty = true;
  journal.mutation = uid();
}
function validateOrder(parts) {
  parts.forEach((part, index) => {
    H.validateSegment(part);
    if (index && H.minutes(part.start) < H.minutes(parts[index-1].end)) {
      throw Error('作業時刻が前の作業と重なっています。開始・終了時刻を確認してください。');
    }
  });
}
function saveDraft() {
  const d = data.draft;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.day) || !d.site.trim() || !d.machineId) throw Error('作業日・機械・作業先を入力してください。');
  const part = {id:d.partId || uid(), start:d.start, end:d.end, first:d.first.trim(), last:d.last.trim()};
  const target = d.partId ? current(d.editId) : H.findJournal(data.journals, d);
  if (d.partId && !target?.parts.some(p=>p.id===d.partId)) throw Error('編集中の作業が見つかりません。');
  const historical = live().find(j => j.machineId === d.machineId);
  const machine = data.machines.find(m => m.id === d.machineId) ||
    (historical && {id:historical.machineId, name:historical.machine, rate:historical.rates.machine});
  if (!target && !machine) throw Error('設定から作業機械を登録して選択してください。');
  const j = target ? {...target} : {
    id:uid(), day:d.day, machineId:machine.id, machine:machine.name, site:d.site.trim(),
    tsurui:d.tsurui, rates:{machine:machine.rate, operator:data.operator, extra:data.extra},
    parts:[], created:Date.now(), version:0, deleted:false
  };
  j.parts = d.partId ? j.parts.map(p => p.id === d.partId ? part : p) : [...j.parts,part];
  validateOrder(j.parts);
  touch(j);
  change(next => {
    next.journals = [...next.journals.filter(item=>item.id!==j.id),j];
    next.draft = null;
    if (!d.partId) {
      next.lastWorkId = j.id;
      next.workOrder = [...(next.workOrder || []).filter(id=>id!==j.id),j.id];
    }
    if (!next.sites.some(site=>site===j.site)) next.sites.push(j.site);
  });
  showDetail(j);
  notice('端末に保存しました。');
}
function removeJournal(id, partId) {
  const j = current(id);
  if (!j || !confirm(partId ? 'この作業を削除しますか？' : 'この作業日誌を削除しますか？')) return;
  change(next => {
    const record = next.journals.find(item=>item.id===id);
    if (partId) record.parts = record.parts.filter(p=>p.id!==partId);
    record.deleted = !partId || !record.parts.length;
    if (record.deleted) record.parts = [];
    touch(record);
  });
  navigate(current(id) ? 'detail' : 'list');
  notice('端末から削除しました。');
}
const rate = value => {
  if (value === '') return null;
  if (!/^\d+$/.test(value) || Number(value) > 1000000) throw Error('単価は0〜1,000,000円の整数で入力してください。');
  return Number(value);
};
function endpoint(value) {
  const url = new URL(value);
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url.href)) {
    throw Error('Apps Scriptの /exec で終わるウェブアプリURLを入力してください。');
  }
  return url.href;
}
async function sync() {
  if (busy) return;
  if (!data.url || !data.key) throw Error('設定でウェブアプリURLと接続キーを保存してください。');
  busy = true;
  syncStatus = '';
  render();
  const pending = data.journals.filter(j=>j.dirty);
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), 45000);
  try {
    const response = await fetch(endpoint(data.url), {
      method:'POST', body:JSON.stringify({key:data.key, changes:pending}), signal:controller.signal
    });
    if (!response.ok) throw Error('通信エラー ' + response.status);
    const result = await response.json();
    if (!result.ok || !Array.isArray(result.records) || !Array.isArray(result.ack) || !Array.isArray(result.conflicts)) {
      throw Error(result.error || '同期結果を確認できませんでした。');
    }
    change(next => {
      const conflicts = new Map(result.conflicts.map(item=>[item.id,item]));
      for (const sent of pending) {
        const local = next.journals.find(j=>j.id===sent.id);
        const accepted = result.ack.find(j=>j.id===sent.id);
        if (accepted && local) {
          local.version = accepted.version;
          local.dirty = local.mutation !== sent.mutation;
          delete local.conflict;
        } else if (conflicts.has(sent.id) && local) local.conflict = conflicts.get(sent.id);
      }
      for (const record of result.records) {
        const index = next.journals.findIndex(j=>j.id===record.id);
        if (index >= 0 && next.journals[index].dirty) continue;
        if (!record.deleted && H.findJournal(next.journals.filter(j=>j.id!==record.id),record)) continue;
        if (index < 0) next.journals.push(record);
        else next.journals[index] = record;
      }
    });
    syncStatus = result.conflicts.length ?
      `同期先と競合 ${result.conflicts.length}件。端末の内容を保持しました。設定で同期先の内容を確認できます。` :
      `同期しました（${result.ack.length}件送信）。`;
    notice(syncStatus);
  } catch (error) {
    syncStatus = '同期できませんでした。記録は端末に残っています。' +
      (error.name === 'AbortError' ? ' 接続がタイムアウトしました。' : ' ' + error.message);
    notice(syncStatus);
  } finally {
    clearTimeout(timer);
    busy = false;
    if (screen === 'list' || screen === 'settings') render();
  }
}
function conflictCards() {
  return data.journals.filter(j=>j.conflict).map(j=>{
    const remote = j.conflict.remote;
    const summary = record => !record || record.deleted ? '<p>削除済み</p>' :
      `<p class="break">${dayLabel(record.day)}　${esc(record.machine)} · ${esc(record.site)}</p>
      <p>鶴居 ${record.tsurui ? 'あり' : 'なし'}　合計 ${yen(H.totals(record).total)}</p>` +
      record.parts.map(p=>`<p>${esc(p.start)}〜${esc(p.end)}　${esc(p.first)}〜${esc(p.last)}</p>`).join('');
    return `<details class="card"><summary>同期の競合を確認</summary><h2>端末</h2>${summary(j)}
      <h2>スプレッドシート側</h2>${summary(remote)}
      ${btn('use-remote','スプレッドシート側を採用',idAttr(j.id))}</details>`;
  }).join('');
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const {action,id,key,time} = button.dataset;
  try {
    if (action === 'recent' && data.draft?.running) reserveDraft();
    if (['work','list','settings','recent'].includes(action)) navigate(action);
    if (action === 'new') startDraft();
    if (action === 'open') showDetail(current(id), screen === 'list' || screen === 'detail');
    if (action === 'resume' || action === 'resume-today') {
      const source = current(id);
      if (source) startDraft(source, action === 'resume');
    }
    if (action === 'refresh') {
      const stored = localStorage.getItem(storageKey);
      if (stored) data = JSON.parse(stored);
      render();
      notice('端末の保存データを読み込みました。');
    }
    if (action === 'begin' || action === 'finish') {
      const d = data.draft, now = H.clock();
      if (!d || d.finished || (action === 'begin') === Boolean(d.running)) return;
      if (!d.day || !d.machineId || !d.site.trim() || !Number.isFinite(H.meter(d.first.trim())) ||
          !Number.isFinite(H.minutes(d.start))) throw Error('作業日・機械・作業先・開始時刻・開始アワーを確認してください。');
      if (action === 'begin') {
        const existing = H.findJournal(data.journals,d);
        if (existing && H.minutes(d.start) < H.minutes(existing.parts[existing.parts.length-1].end)) {
          throw Error('前の作業の終了以降の開始時刻を入力してください。');
        }
        const machine = data.machines.find(m=>m.id===d.machineId);
        change(next => {
          Object.assign(next.draft, {running:true, site:d.site.trim(), tsurui:existing?.tsurui ?? d.tsurui,
            machineName:machine?.name ?? existing?.machine ?? live().find(j=>j.machineId===d.machineId)?.machine,
            end:'', endCapture:'', last:''});
        });
        navigate('work');
        notice('開始を端末に保存しました。');
        return;
      }
      change(next => { Object.assign(next.draft, {finished:true,end:d.day === now.day ? now.time : '',endCapture:d.day === now.day ? now.time : ''}); });
      render();
      main.querySelector('[name=end]').closest('section').scrollIntoView({block:'start'});
      if (d.day !== now.day) notice('作業日と取得日の違いを確認し、作業日当日の終了時刻を入力してください。');
    }
    if (action === 'time' && time) {
      change(next => { next.draft[key] = time; });
      main.querySelector(`[name="${key}"]`).value = time;
      refreshDraftHints();
    }
    if (action === 'save' && data.draft?.finished) saveDraft();
    if (action === 'discard' && confirm('入力途中の作業を破棄しますか？')) {
      change(next=>{ next.draft = null; });
      navigate('work');
    }
    if (action === 'edit-part') editPart(id);
    if (action === 'remove-part') removeJournal(detailId,id);
    if (action === 'remove-journal') removeJournal(id);
    if (action === 'remove-machine' && data.draft?.running && data.draft.machineId === id) {
      throw Error('作業中の機械です。作業を保存してから削除してください。');
    }
    if (action === 'remove-machine' && confirm('機械を選択候補から削除しますか？')) {
      change(next=>{ next.machines = next.machines.filter(m=>m.id!==id); });
      render();
    }
    if (action === 'use-remote' && confirm('競合している端末の変更を取り消し、スプレッドシート側の内容を使いますか？')) {
      change(next=>{
        const item = next.journals.find(j=>j.id===id);
        const remote = item.conflict.remote;
        next.journals = next.journals.filter(j=>j.id!==id && j.id!==remote?.id);
        if (remote) next.journals.push(remote);
      });
      render();
    }
    if (action === 'sync') await sync();
  } catch (error) { notice(error.message); }
});
main.addEventListener('input', event => {
  const input = event.target;
  if (input.dataset.target !== 'draft') return;
  try {
    change(next=>{ next.draft[input.name] = input.type === 'checkbox' ? input.checked : input.value; });
    refreshDraftHints();
  } catch (error) { notice(error.message); }
});
main.addEventListener('change', event=>{
  const {value,dataset} = event.target;
  if (!dataset.filter) return;
  if (dataset.filter === 'year') year = value;
  if (dataset.filter === 'month') month = value;
  if (dataset.filter === 'order') newest = value === 'new';
  render();
});
main.addEventListener('submit', event=>{
  event.preventDefault();
  const form = event.target;
  const fields = new FormData(form);
  const get = key => String(fields.get(key) ?? '').trim();
  try {
    change(next => {
      if (form.dataset.form === 'rates') {
        next.operator = rate(get('operator'));
        next.extra = rate(get('extra'));
      }
      if (form.dataset.form === 'connection') {
        const url = get('url');
        const key = get('key');
        if (Boolean(url) !== Boolean(key)) throw Error('URLと接続キーを両方入力してください。');
        const normalized = url ? endpoint(url) : '';
        if (next.url && normalized && next.url !== normalized && next.journals.some(j=>j.version > 0)) {
          throw Error('保存先の変更には、移行先に現在の日誌と同期履歴を引き継いでください。同じデプロイを更新するとURLを維持できます。');
        }
        next.url = normalized;
        next.key = key;
        syncStatus = '';
      }
      if (form.dataset.form === 'machine') {
        const name = get('name'), id = form.dataset.id || uid();
        if (!name) throw Error('機械名を入力してください。');
        if (next.machines.some(m=>m.id!==id && m.name.normalize('NFKC')===name.normalize('NFKC'))) {
          throw Error('同じ名前の機械が登録されています。');
        }
        const record = {id,name,rate:rate(get('rate'))};
        const index = next.machines.findIndex(m=>m.id===id);
        if (index < 0) next.machines.push(record);
        else next.machines[index] = record;
      }
      if (form.dataset.form === 'journal') {
        const saved = next.journals.find(j=>j.id===form.dataset.id && !j.deleted);
        const machine = next.machines.find(m=>m.id===get('machineId'));
        if (!saved || !get('day') || !get('site')) throw Error('作業日と作業先を確認してください。');
        const updated = {...saved,day:get('day'), site:get('site'), machineId:get('machineId'),
          machine:machine?.name ?? saved.machine, tsurui:fields.has('tsurui'),
          rates:{...saved.rates,machine:rate(get('machineRate')),operator:rate(get('operatorRate'))}};
        if (H.findJournal(next.journals.filter(j=>j.id!==saved.id),updated)) {
          throw Error('同じ日・機械・作業先の日誌が存在します。');
        }
        touch(updated);
        Object.assign(saved,updated);
        if (!next.sites.includes(updated.site)) next.sites.push(updated.site);
      }
    });
    if (form.dataset.form === 'journal') showDetail(current(form.dataset.id));
    else render();
    notice('保存しました。');
  } catch (error) { notice(error.message); }
});
window.addEventListener('storage', event=>{
  if (event.key !== storageKey || !event.newValue) return;
  data = JSON.parse(event.newValue);
  render();
  notice('別のタブで保存された内容を表示しました。');
});
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
