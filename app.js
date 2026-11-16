const $=id=>document.getElementById(id);
const DB='my-kakeibo-local', STORE='kv';
let db, txs=[], balances=[], pending=[], activeSource='三井住友銀行';
const yen=n=>'¥'+Number(n||0).toLocaleString('ja-JP');
const today=()=>new Date().toISOString().slice(0,10);
$('month').value=today().slice(0,7);
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>req.result.createObjectStore(STORE);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
function get(key){return new Promise((resolve,reject)=>{const r=db.transaction(STORE).objectStore(STORE).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function put(key,val){return new Promise((resolve,reject)=>{const r=db.transaction(STORE,'readwrite').objectStore(STORE).put(val,key);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});}
async function persist(){await put('transactions',txs);await put('balances',balances);}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function render(){
 const m=$('month').value, list=txs.filter(t=>(t.date||'').slice(0,7)===m);
 const inc=list.filter(t=>t.type==='income').reduce((a,t)=>a+Number(t.amount),0);
 const exp=list.filter(t=>t.type==='expense').reduce((a,t)=>a+Number(t.amount),0);
 $('income').textContent=yen(inc);$('expense').textContent=yen(exp);$('net').textContent=yen(inc-exp);
 $('transactions').innerHTML=list.length?list.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(t=>`<div class="tx"><div class="tx-name">${esc(t.description)}<small>${esc(t.date)} ・ ${esc(t.source)}</small></div><b>${t.type==='income'?'+':'−'}${yen(t.amount)}</b></div>`).join(''):'<p class="muted">この月の取引はありません。</p>';
 $('balances').innerHTML=balances.slice().sort((a,b)=>b.checkedAt.localeCompare(a.checkedAt)).map(b=>`<div class="balance-item"><div>${esc(b.source)}<small>確認日：${esc(b.checkedAt)}</small></div><b>${yen(b.amount)}</b></div>`).join('')||'<p class="muted">残高はまだ登録されていません。</p>';
}
function parseCSV(text,source){
 text=text.replace(/^\\uFEFF/,'');const lines=text.split(/\\r?\\n/).filter(x=>x.trim());if(lines.length<2)return [];
 const delim=(lines[0].match(/;/g)||[]).length>(lines[0].match(/,/g)||[]).length?';':',';
 const lineParse=s=>{let a=[],v='',q=false;for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'&&s[i+1]==='"'&&q){v+='"';i++;}else if(c==='"')q=!q;else if(c===delim&&!q){a.push(v);v='';}else v+=c;}a.push(v);return a;};
 let header=lineParse(lines[0]).map(s=>s.trim().toLowerCase());
 const find=words=>header.findIndex(h=>words.some(w=>h.includes(w)));
 let di=find(['日付','取引日','利用日','date','年月日']), ai=find(['金額','取引金額','利用金額','amount','入金額','出金額']), ni=find(['内容','摘要','取引内容','利用店名','加盟店','description','店名','メモ']), ti=find(['区分','入出金','種別','type']);
 if(ai<0){ // Some bank CSVs have separate debit/credit columns
   const debit=find(['出金','支払金額']), credit=find(['入金','預入金額']);
   if(debit<0&&credit<0)return [];
   return lines.slice(1).map(lineParse).map(c=>{let d=debit>=0?Number((c[debit]||'').replace(/[¥￥,\\s]/g,'')):0,cr=credit>=0?Number((c[credit]||'').replace(/[¥￥,\\s]/g,'')):0;let amount=Math.abs(d||cr);return amount?{date:normalDate(di>=0?c[di]:''),description:ni>=0?c[ni]:'取引',amount,type:d?'expense':'income',source}:null;}).filter(Boolean);
 }
 return lines.slice(1).map(lineParse).map(c=>{
  let raw=(c[ai]||'').replace(/[¥￥,\\s]/g,'');let n=Number(raw);if(!Number.isFinite(n)||n===0)return null;
  let label=ti>=0?c[ti]:'';let type=/出金|支払|支出|expense|決済/i.test(label)?'expense':/入金|預入|収入|チャージ|income/i.test(label)?'income':n<0?'expense':'income';
  return {date:normalDate(di>=0?c[di]:''),description:ni>=0&&c[ni]?c[ni]:'取引',amount:Math.abs(n),type,source};
 }).filter(Boolean);
}
function normalDate(s){s=String(s||'').trim().replace(/[年月]/g,'-').replace(/[日]/g,'').replaceAll('/','-');const m=s.match(/(20\\d{2})-(\\d{1,2})-(\\d{1,2})/);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:today();}
function filePicker(source){activeSource=source;$('source').value=source;$('csvFile').click();}
document.querySelectorAll('.select-service').forEach(b=>b.onclick=()=>filePicker(b.dataset.source));
$('previewBtn').onclick=async()=>{const f=$('csvFile').files[0];if(!f){alert('CSVファイルを選択してください。');return;}activeSource=$('source').value;const content=await f.text();pending=parseCSV(content,activeSource);$('preview').hidden=false;$('consent').checked=false;$('commitBtn').disabled=true;$('previewSummary').textContent=pending.length?`${f.name} から ${pending.length} 件を読み取りました。以下を確認してください。`:'明細を読み取れませんでした。CSVの列名・形式が未対応の可能性があります。';$('previewRows').innerHTML=pending.length?`<table><thead><tr><th>日付</th><th>内容</th><th>区分</th><th>金額</th></tr></thead><tbody>${pending.slice(0,8).map(t=>`<tr><td>${esc(t.date)}</td><td>${esc(t.description)}</td><td>${t.type==='income'?'収入':'支出'}</td><td>${yen(t.amount)}</td></tr>`).join('')}</tbody></table>${pending.length>8?`<small>ほか ${pending.length-8} 件</small>`:''}`:'';};
$('consent').onchange=()=>{$('commitBtn').disabled=!$('consent').checked||!pending.length;};
$('commitBtn').onclick=async()=>{if(!$('consent').checked||!pending.length)return;const seen=new Set(txs.map(t=>t.fingerprint));let added=0,dupes=0;for(const t of pending){const fp=[t.source,t.date,t.description,t.amount,t.type].join('|');if(seen.has(fp)){dupes++;continue;}txs.push({...t,fingerprint:fp,id:crypto.randomUUID()});seen.add(fp);added++;}await persist();pending=[];$('csvFile').value='';$('preview').hidden=true;render();alert(`${added}件を登録しました。重複候補 ${dupes}件は登録しませんでした。`);};
$('saveBalance').onclick=async()=>{const amount=Number($('balanceAmount').value);if(!Number.isFinite(amount)||amount<0){alert('残高を入力してください。');return;}const source=$('balanceSource').value;const ok=confirm(`${source}の残高 ${yen(amount)} を記録しますか？`);if(!ok)return;balances.push({source,amount,checkedAt:today()});await persist();$('balanceAmount').value='';render();};
$('addBtn').onclick=async()=>{const amount=Number($('amount').value),description=$('memo').value.trim();if(!amount||amount<1||!description){alert('内容と金額を入力してください。');return;}const t={date:today(),description,amount,type:$('kind').value,source:'手入力'};t.fingerprint=[t.source,t.date,t.description,t.amount,t.type].join('|')+'|'+crypto.randomUUID();txs.push(t);await persist();$('memo').value='';$('amount').value='';render();};
$('month').onchange=render;
$('exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),transactions:txs,balances},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='my-kakeibo-backup-'+today()+'.json';a.click();URL.revokeObjectURL(url);};
(async()=>{try{db=await openDB();txs=await get('transactions')||[];balances=await get('balances')||[];render();}catch(e){alert('端末内データベースを開けませんでした。Safariで開き直してください。');}})();