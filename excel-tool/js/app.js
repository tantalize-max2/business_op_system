// ========== STATE ==========
const S = {
  files: [],       // [{id, name, raw:[], hdr:[], l1:{}, grps:[], gid:0, addedCols:[]}]
  activeFileId: null,
  l1Temp: null,
  l1EditCol: null,
  selGColor: 'blue',
  selGVals: [],
};
const CM = {blue:{d:'#3b82f6',t:'t-blue'},green:{d:'#22c55e',t:'t-green'},orange:{d:'#f59e0b',t:'t-orange'},purple:{d:'#a78bfa',t:'t-purple'},cyan:{d:'#06b6d4',t:'t-cyan'},red:{d:'#ef4444',t:'t-red'}};
const SEC_COLORS = ['#3b82f6','#22c55e','#f59e0b','#a78bfa','#06b6d4','#ef4444','#ec4899','#84cc16'];

// ========== UTILS ==========
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function ntf(m,t='ok'){const e=document.getElementById('ntf');e.textContent=m;e.className='ntf '+t+' show';setTimeout(()=>e.classList.remove('show'),2200)}
function uniq(col,data){data=data||getActiveRaw();const s=new Set();data.forEach(r=>s.add(String(r[col]??'')));return[...s].sort()}
function fmtN(n){if(Number.isInteger(n))return n.toLocaleString();return n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}

function getActiveRaw(){const f=getActiveFile();return f?f.raw:[]}
function getActiveFile(){return S.files.find(f=>f.id===S.activeFileId)||null}
function getActiveHdr(){const f=getActiveFile();return f?f.hdr:[]}

// ========== L1 DATA FUNCTIONS ==========
function newL1(){return{checked:null,cascade:false,dependCol:null,sort:null,condOn:false,condOp:'eq',condVal:''}}

function getDepChain(col,f){
  const chain=[];let cur=col;const visited=new Set();
  while(cur){if(visited.has(cur))break;visited.add(cur);
    if(f&&f.cascade&&f.dependCol){chain.unshift(f.dependCol);const af=getActiveFile();cur=f.dependCol;f=af?af.l1[cur]:null}
    else break}
  return chain;
}
function getDataFilteredForCol(col){
  const af=getActiveFile();if(!af)return[];const f=af.l1[col];const chain=getDepChain(col,f);
  let data=getActiveRaw();
  for(const c of chain){const pf=af.l1[c];if(pf&&pf.checked&&pf.checked.size<uniq(c).length)data=data.filter(r=>pf.checked.has(String(r[c]??'')))}
  return data;
}

function getFilteredData(){
  const hdr=getActiveHdr(),l1=getActiveFile().l1;
  const order=[];const visited=new Set();const visiting=new Set();
  function visit(col){if(visited.has(col))return;if(visiting.has(col))return;visiting.add(col);const f=l1[col];if(f&&f.cascade&&f.dependCol)visit(f.dependCol);visiting.delete(col);visited.add(col);order.push(col)}
  hdr.forEach(c=>visit(c));
  let data=getActiveRaw();
  for(const col of order){
    const f=l1[col];
    if(f&&f.checked&&f.checked.size<uniq(col).length)data=data.filter(r=>f.checked.has(String(r[col]??'')));
    if(f&&f.condOn&&f.condVal!==''){const cv=f.condVal.toLowerCase(),op=f.condOp;
      data=data.filter(r=>{const v=String(r[col]??'').toLowerCase(),numV=parseFloat(v),numC=parseFloat(f.condVal);
        switch(op){case'eq':return v===cv;case'neq':return v!==cv;case'gt':return!isNaN(numV)&&!isNaN(numC)&&numV>numC;case'lt':return!isNaN(numV)&&!isNaN(numC)&&numV<numC;case'gte':return!isNaN(numV)&&!isNaN(numC)&&numV>=numC;case'lte':return!isNaN(numV)&&!isNaN(numC)&&numV<=numC;case'sw':return v.startsWith(cv);case'ew':return v.endsWith(cv);case'contains':return v.includes(cv);default:return true}})}
  }
  return data;
}

function getSortedData(data){
  const hdr=getActiveHdr(),l1=getActiveFile().l1;
  for(const col of hdr){const f=l1[col];if(f&&f.sort){
    const dir=f.sort==='asc'?1:-1;
    return[...data].sort((a,b)=>{const va=a[col]??'',vb=b[col]??'';const na=parseFloat(va),nb=parseFloat(vb);
      if(!isNaN(na)&&!isNaN(nb))return(na-nb)*dir;return String(va).localeCompare(String(vb),'zh-CN')*dir})}
  }
  return data;
}

// ========== L2 GROUP CONTEXT ==========
function getGroupContext(gid,l1Data,grps,cache){
  if(cache[gid])return cache[gid];
  const g=grps.find(x=>x.id===gid);let ctx;
  if(!g.parentId){ctx=l1Data.filter(r=>g.values.includes(String(r[g.column]??'')))}
  else{const parentCtx=getGroupContext(g.parentId,l1Data,grps,cache);const selfMatch=l1Data.filter(r=>g.values.includes(String(r[g.column]??'')));
    if(g.parentRel==='AND'){const ps=new Set(parentCtx);ctx=selfMatch.filter(r=>ps.has(r))}
    else{const seen=new Set();ctx=[];[...parentCtx,...selfMatch].forEach(r=>{if(!seen.has(r)){seen.add(r);ctx.push(r)}})}
  }
  cache[gid]=ctx;return ctx;
}

// ========== FILE MANAGEMENT ==========
let fileIdCounter=0;

function handleFile(file){
  const ext=file.name.split('.').pop().toLowerCase();
  if(!['xlsx','xls','csv'].includes(ext)){ntf('不支持该格式','err');return}
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:'array'});const ws=wb.Sheets[wb.SheetNames[0]];
      const json=XLSX.utils.sheet_to_json(ws,{defval:''});
      if(!json.length){ntf('文件为空','err');return}
      const hdr=Object.keys(json[0]);const l1={};hdr.forEach(c=>{l1[c]=newL1()});
      S.files.push({id:++fileIdCounter,name:file.name,raw:json,hdr,l1,grps:[],gid:0,addedCols:[],sumCol:'',hiddenCols:new Set()});
      switchFile(S.files[S.files.length-1].id);ntf(`已加载 ${file.name} (${json.length} 行)`);
    }catch(err){ntf('解析失败','err')}
  };
  reader.readAsArrayBuffer(file);
}

function switchFile(id){
  S.activeFileId=id;const f=getActiveFile();if(!f)return;
  document.getElementById('upWrap').style.display='none';
  document.getElementById('mainView').classList.add('vis');
  document.getElementById('resultView').classList.remove('vis');
  document.getElementById('hdrR').style.display='flex';
  renderFileTabs();renderTable();updHdr();popGCol();renderGrpCards();
}

function removeFile(id){
  S.files=S.files.filter(f=>f.id!==id);
  if(S.activeFileId===id){
    if(S.files.length)switchFile(S.files[0].id);
    else{document.getElementById('mainView').classList.remove('vis');document.getElementById('resultView').classList.remove('vis');document.getElementById('upWrap').style.display='';document.getElementById('hdrR').style.display='none'}
  }
  renderFileTabs();
}

// ========== RENDER: FILE TABS ==========
function renderFileTabs(){
  const div=document.getElementById('fileTabs');if(!div)return;
  let html='';
  S.files.forEach(f=>{
    const on=f.id===S.activeFileId?'on':'';
    html+=`<span class="ftab ${on}" data-fid="${f.id}"><span class="ftab-grip">⠿</span><span class="ftab-name">${esc(f.name)}</span><span class="rx" data-fid="${f.id}">✕</span></span>`;
  });
  div.innerHTML=html;
  div.querySelectorAll('.ftab').forEach(el=>el.addEventListener('click',e=>{
    if(e.target.classList.contains('rx')){removeFile(+e.target.dataset.fid);return}
    switchFile(+el.dataset.fid);
  }));
  // File tab drag reorder
  div.querySelectorAll('.ftab-grip').forEach(grip=>{
    grip.addEventListener('mousedown',e=>{
      e.preventDefault();e.stopPropagation();
      const srcTab=grip.closest('.ftab'),srcFid=+srcTab.dataset.fid;
      srcTab.classList.add('dragging');
      document.body.style.cursor='grabbing';document.body.style.userSelect='none';
      const onMove=ev=>{
        const el=document.elementFromPoint(ev.clientX,ev.clientY);
        const tgtTab=el?el.closest('.ftab'):null;
        div.querySelectorAll('.ftab').forEach(t=>t.classList.remove('drag-over'));
        if(tgtTab&&+tgtTab.dataset.fid!==srcFid)tgtTab.classList.add('drag-over');
      };
      const onUp=ev=>{
        document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);
        document.body.style.cursor='';document.body.style.userSelect='';
        srcTab.classList.remove('dragging');
        const el=document.elementFromPoint(ev.clientX,ev.clientY);
        const tgtTab=el?el.closest('.ftab'):null;
        div.querySelectorAll('.ftab').forEach(t=>t.classList.remove('drag-over'));
        if(tgtTab&&+tgtTab.dataset.fid!==srcFid){
          const si=S.files.findIndex(f=>f.id===srcFid),ti=S.files.findIndex(f=>f.id===+tgtTab.dataset.fid);
          if(si>=0&&ti>=0){const tmp=S.files[si];S.files[si]=S.files[ti];S.files[ti]=tmp;renderFileTabs();ntf('文件顺序已交换')}
        }
      };
      document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
    });
  });
}

// ========== RENDER: TABLE ==========
function renderTable(){
  const thead=document.getElementById('dth'),tbody=document.getElementById('dtb');
  const f=getActiveFile();if(!f)return;
  const hdr=f.hdr,l1=f.l1,data=getSortedData(getFilteredData()),hidden=f.hiddenCols;
  let hh='<tr><th style="width:34px"><div class="th-inner"><span class="th-name">#</span></div></th>';
  hdr.forEach(col=>{
    if(hidden.has(col))return; // skip hidden columns
    const cf=l1[col];const isActive=cf&&cf.checked&&cf.checked.size<uniq(col).length;
    const isCascade=cf&&cf.cascade;const dependLabel=isCascade&&cf.dependCol?`→ ${cf.dependCol}`:'';
    const isSort=cf&&cf.sort;const sortIcon=isSort==='asc'?'▲':isSort==='desc'?'▼':'⇅';
    const hasCond=cf&&cf.condOn&&cf.condVal!=='';
    hh+=`<th data-col="${esc(col)}"><div class="th-inner">
      <span class="th-grip" title="拖拽调换列">⠿</span>
      <span class="th-name">${esc(col)}${hasCond?' *':''}</span>
      ${isCascade?`<span class="th-dep on" data-col="${esc(col)}" title="级联: ${esc(cf.dependCol)}">${dependLabel}</span>`:`<span class="th-dep off" data-col="${esc(col)}" title="无依赖">○</span>`}
      <span class="th-fbtn ${isActive?'on':''}" data-col="${esc(col)}" title="过滤">▾</span>
      <span class="th-sort ${isSort?'on':''}" data-col="${esc(col)}" title="${hasCond?`${cf.condOp} ${cf.condVal} | `:''}排序">${sortIcon}</span>
      <span class="th-hide" data-col="${esc(col)}" title="隐藏此列">✕</span>
    </div></th>`;
  });
  hh+='</tr>';thead.innerHTML=hh;
  let bb='';data.forEach((r,i)=>{bb+=`<tr><td class="ti">${i+1}</td>`;hdr.forEach(c=>{if(!hidden.has(c))bb+=`<td title="${esc(String(r[c]??''))}">${esc(String(r[c]??''))}</td>`});bb+='</tr>'});
  tbody.innerHTML=bb;
  // Events
  thead.querySelectorAll('.th-fbtn').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();openFD(b.dataset.col,b)}));
  thead.querySelectorAll('.th-dep').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();openFD(b.dataset.col,b,true)}));
  thead.querySelectorAll('.th-sort').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();
    const col=b.dataset.col,l1=getActiveFile().l1;getActiveHdr().forEach(c=>{if(c!==col)l1[c].sort=null});
    const cf=l1[col];if(!cf.sort)cf.sort='asc';else if(cf.sort==='asc')cf.sort='desc';else cf.sort=null;
    renderTable();updHdr();
  }));
  // Column drag reorder via th-name grip
  thead.querySelectorAll('.th-grip').forEach(grip=>{
    grip.addEventListener('mousedown',e=>{
      e.preventDefault();e.stopPropagation();
      const srcTh=grip.closest('th'),srcCol=srcTh.dataset.col;
      srcTh.classList.add('dragging');
      document.body.style.cursor='grabbing';document.body.style.userSelect='none';
      const onMove=ev=>{
        const el=document.elementFromPoint(ev.clientX,ev.clientY);
        const tgtTh=el?el.closest('th[data-col]'):null;
        thead.querySelectorAll('th[data-col]').forEach(t=>t.classList.remove('drag-over'));
        if(tgtTh&&tgtTh.dataset.col!==srcCol)tgtTh.classList.add('drag-over');
      };
      const onUp=ev=>{
        document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);
        document.body.style.cursor='';document.body.style.userSelect='';
        srcTh.classList.remove('dragging');
        const el=document.elementFromPoint(ev.clientX,ev.clientY);
        const tgtTh=el?el.closest('th[data-col]'):null;
        thead.querySelectorAll('th[data-col]').forEach(t=>t.classList.remove('drag-over'));
        if(tgtTh&&tgtTh.dataset.col!==srcCol){
          const si=f.hdr.indexOf(srcCol),ti=f.hdr.indexOf(tgtTh.dataset.col);
          if(si>=0&&ti>=0){f.hdr.splice(si,1);f.hdr.splice(ti,0,srcCol);renderTable();ntf('列顺序已调整')}
        }
      };
      document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
    });
  });
  // Column hide
  thead.querySelectorAll('.th-hide').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();
    const col=btn.dataset.col;f.hiddenCols.add(col);renderTable();updHdr();ntf(`已隐藏 "${col}"`);
  }));
}

function updHdr(){
  const f=getActiveFile();if(!f)return;
  const fd=getFilteredData();
  document.getElementById('hAll').textContent=f.raw.length;
  document.getElementById('hFil').textContent=fd.length;
  const visCols=f.hdr.length-f.hiddenCols.size;
  document.getElementById('hCol').textContent=visCols+(f.hiddenCols.size?`/${f.hdr.length}`:'');
  updColMgr();
}

// ========== FILTER DROPDOWN ==========
const fdOv=document.getElementById('fdOv'),fdDd=document.getElementById('fdDd'),fdL=document.getElementById('fdL');

function openFD(col,anchor,focusCascade=false){
  S.l1EditCol=col;document.getElementById('fdCn').textContent=col;document.getElementById('fdSe').value='';
  const f=getActiveFile().l1[col];
  document.getElementById('fdCascade').checked=f.cascade||false;
  const depSel=document.getElementById('fdDepCol');const hdr=getActiveHdr();const colIdx=hdr.indexOf(col);
  depSel.innerHTML='<option value="">-- 选择依赖列 --</option>';
  for(let i=0;i<colIdx;i++)depSel.innerHTML+=`<option value="${esc(hdr[i])}">${esc(hdr[i])}</option>`;
  depSel.value=f.dependCol||'';depSel.style.display=f.cascade?'block':'none';updateCasInfo();
  const baseData=f.cascade&&f.dependCol?getDataFilteredForCol(col):getActiveRaw();
  const valSet=new Set();baseData.forEach(r=>valSet.add(String(r[col]??'')));const vals=[...valSet].sort();
  const allVals=uniq(col);
  S.l1Temp={checked:new Map(),cascade:f.cascade,dependCol:f.dependCol,sort:f.sort||null,condOn:f.condOn||false,condOp:f.condOp||'eq',condVal:f.condVal||''};
  allVals.forEach(v=>{const inScope=vals.includes(v);const cur=f.checked?f.checked.has(v):true;S.l1Temp.checked.set(v,inScope?cur:false)});
  document.querySelectorAll('.fd-sort .sbtn').forEach(b=>b.classList.toggle('on',b.dataset.s===(S.l1Temp.sort||'')));
  const condCb=document.getElementById('fdCondOn'),condRow=document.getElementById('fdCondRow'),condOp=document.getElementById('fdCondOp'),condVal=document.getElementById('fdCondVal');
  condCb.checked=S.l1Temp.condOn;condRow.style.display=S.l1Temp.condOn?'flex':'none';condOp.value=S.l1Temp.condOp;condVal.value=S.l1Temp.condVal;
  renderFDList('');
  const rect=anchor.closest('th').getBoundingClientRect();let left=rect.left,top=rect.bottom+2;
  if(left+300>window.innerWidth)left=window.innerWidth-308;if(top+480>window.innerHeight)top=rect.top-480;
  fdDd.style.left=left+'px';fdDd.style.top=top+'px';fdDd.style.width='300px';
  fdOv.classList.add('vis');fdDd.classList.add('vis');
  (focusCascade?document.getElementById('fdCascade'):document.getElementById('fdSe')).focus();
}

function updateCasInfo(){
  const casInfo=document.getElementById('fdCasInfo'),casCb=document.getElementById('fdCascade'),depSel=document.getElementById('fdDepCol');
  if(casCb.checked&&depSel.value){const depCol=depSel.value,depF=getActiveFile().l1[depCol];const isF=depF&&depF.checked&&depF.checked.size<uniq(depCol).length;
    const vs=isF?[...depF.checked]:uniq(depCol);casInfo.innerHTML=`依赖 <b>${esc(depCol)}</b> (${isF?'已过滤':'未过滤'}: ${vs.slice(0,5).map(v=>esc(v)).join(',')}${vs.length>5?'...':''})`;
    casInfo.style.display='block';
  }else{casInfo.innerHTML='限定在此列的过滤结果内';casInfo.style.display=casCb.checked?'block':'none'}
}

function recomputeFDVals(){
  const col=S.l1EditCol,cascade=document.getElementById('fdCascade').checked,dependCol=document.getElementById('fdDepCol').value;
  const baseData=cascade&&dependCol?getDataFilteredForCol(col):getActiveRaw();
  const allVals=uniq(col);allVals.forEach(v=>S.l1Temp.checked.set(v,true));
  S.l1Temp.cascade=cascade;S.l1Temp.dependCol=cascade?dependCol:null;
  renderFDList(document.getElementById('fdSe').value);
}

function renderFDList(search){
  const col=S.l1EditCol,allVals=uniq(col),cascade=S.l1Temp.cascade,dependCol=S.l1Temp.dependCol;
  const baseData=cascade&&dependCol?getDataFilteredForCol(col):getActiveRaw();
  const scopeSet=new Set();baseData.forEach(r=>scopeSet.add(String(r[col]??'')));
  let displayVals=allVals;if(search)displayVals=displayVals.filter(v=>v.toLowerCase().includes(search.toLowerCase()));
  const checkedCount=[...S.l1Temp.checked.entries()].filter(([,v])=>v).length;
  document.getElementById('fdCnt').textContent=`${checkedCount}/${allVals.length}${cascade&&dependCol?` (${scopeSet.size}可选)`:''}`;
  let html='';
  displayVals.forEach(v=>{const inScope=scopeSet.has(v),cnt=inScope?baseData.filter(r=>String(r[col]??'')===v).length:0;
    html+=`<div class="fd-item" data-v="${esc(v)}" style="${!inScope?'opacity:.35':''}"><input type="checkbox" ${S.l1Temp.checked.get(v)?'checked':''} ${!inScope?'disabled':''}><span class="vl">${esc(v)}${!inScope?' (外)':''}</span><span class="vc">${cnt}</span></div>`});
  fdL.innerHTML=html;
  fdL.querySelectorAll('.fd-item').forEach(item=>{item.addEventListener('click',()=>{const cb=item.querySelector('input');if(cb.disabled)return;cb.checked=!cb.checked;S.l1Temp.checked.set(item.dataset.v,cb.checked);
    const cc=[...S.l1Temp.checked.entries()].filter(([,v])=>v).length;document.getElementById('fdCnt').textContent=`${cc}/${allVals.length}`})});
}

document.getElementById('fdSe').addEventListener('input',e=>renderFDList(e.target.value));
document.getElementById('fdCascade').addEventListener('change',()=>{const ds=document.getElementById('fdDepCol');ds.style.display=document.getElementById('fdCascade').checked?'block':'none';if(!document.getElementById('fdCascade').checked)ds.value='';updateCasInfo();recomputeFDVals()});
document.getElementById('fdDepCol').addEventListener('change',()=>{updateCasInfo();recomputeFDVals()});
document.getElementById('fdAll').addEventListener('click',()=>{const col=S.l1EditCol,baseData=S.l1Temp.cascade&&S.l1Temp.dependCol?getDataFilteredForCol(col):getActiveRaw();const ss=new Set();baseData.forEach(r=>ss.add(String(r[col]??'')));S.l1Temp.checked.forEach((_,k)=>S.l1Temp.checked.set(k,ss.has(k)));renderFDList(document.getElementById('fdSe').value)});
document.getElementById('fdNone').addEventListener('click',()=>{S.l1Temp.checked.forEach((_,k)=>S.l1Temp.checked.set(k,false));renderFDList(document.getElementById('fdSe').value)});
document.querySelectorAll('.fd-sort .sbtn').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.fd-sort .sbtn').forEach(x=>x.classList.remove('on'));b.classList.add('on');S.l1Temp.sort=b.dataset.s||null}));
document.getElementById('fdCondOn').addEventListener('change',e=>{S.l1Temp.condOn=e.target.checked;document.getElementById('fdCondRow').style.display=e.target.checked?'flex':'none'});
document.getElementById('fdCondOp').addEventListener('change',e=>{S.l1Temp.condOp=e.target.value});
document.getElementById('fdCondVal').addEventListener('input',e=>{S.l1Temp.condVal=e.target.value});

document.getElementById('fdOk').addEventListener('click',()=>{
  const col=S.l1EditCol,l1=getActiveFile().l1,allVals=uniq(col),checkedVals=new Set();
  S.l1Temp.checked.forEach((v,k)=>{if(v)checkedVals.add(k)});
  l1[col]={checked:checkedVals.size===allVals.length?null:checkedVals,cascade:S.l1Temp.cascade,dependCol:S.l1Temp.dependCol,sort:S.l1Temp.sort,condOn:S.l1Temp.condOn,condOp:S.l1Temp.condOp,condVal:S.l1Temp.condVal};
  if(S.l1Temp.sort){getActiveHdr().forEach(c=>{if(c!==col)l1[c].sort=null})}
  closeFD();renderTable();updHdr();popGCol();ntf('过滤已应用');
});
document.getElementById('fdX').addEventListener('click',closeFD);
fdOv.addEventListener('click',closeFD);
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeFD()});

function closeFD(){fdOv.classList.remove('vis');fdDd.classList.remove('vis');S.l1EditCol=null;S.l1Temp=null}

// ========== COLUMN MANAGER ==========
const cmOv=document.getElementById('cmOv'),cmDd=document.getElementById('cmDd'),cmList=document.getElementById('cmList');

function updColMgr(){
  const f=getActiveFile();if(!f)return;
  let html='';f.hdr.forEach(col=>{
    const isHidden=f.hiddenCols.has(col);
    html+=`<div class="cm-item${isHidden?' hidden':''}" data-col="${esc(col)}"><input type="checkbox" ${isHidden?'':'checked'}><span class="vl">${esc(col)}</span>${isHidden?'<span class="cm-tag">已隐藏</span>':''}</div>`;
  });
  cmList.innerHTML=html;
  const vis=f.hdr.length-f.hiddenCols.size;
  document.getElementById('cmCnt').textContent=`${vis}/${f.hdr.length} 可见`;
  cmList.querySelectorAll('.cm-item').forEach(item=>item.addEventListener('click',()=>{
    const col=item.dataset.col,cb=item.querySelector('input');
    if(cb.disabled)return;cb.checked=!cb.checked;
    if(cb.checked){f.hiddenCols.delete(col);item.classList.remove('hidden');item.querySelector('.cm-tag')?.remove()}
    else{f.hiddenCols.add(col);item.classList.add('hidden');if(!item.querySelector('.cm-tag')){const tag=document.createElement('span');tag.className='cm-tag';tag.textContent='已隐藏';item.appendChild(tag)}}
    const v=f.hdr.length-f.hiddenCols.size;document.getElementById('cmCnt').textContent=`${v}/${f.hdr.length} 可见`;
    renderTable();updHdr();
  }));
}

document.getElementById('btnColMgr').addEventListener('click',e=>{
  const f=getActiveFile();if(!f)return;
  updColMgr();
  const rect=e.target.closest('.tb').getBoundingClientRect();
  cmDd.style.left=Math.min(rect.right-280,window.innerWidth-290)+'px';
  cmDd.style.top=(rect.bottom+2)+'px';
  cmOv.classList.add('vis');cmDd.classList.add('vis');
});
document.getElementById('cmShowAll').addEventListener('click',()=>{
  const f=getActiveFile();if(!f)return;f.hiddenCols.clear();updColMgr();renderTable();updHdr();ntf('全部列已显示');
});
document.getElementById('cmX').addEventListener('click',()=>{cmOv.classList.remove('vis');cmDd.classList.remove('vis')});
cmOv.addEventListener('click',()=>{cmOv.classList.remove('vis');cmDd.classList.remove('vis')});

document.getElementById('btnClrL1').addEventListener('click',()=>{
  const f=getActiveFile();if(!f)return;f.hdr.forEach(c=>{f.l1[c]=newL1()});renderTable();updHdr();popGCol();ntf('L1已清空');
});

// ========== L2 GROUPS ==========
function popGCol(){
  const sel=document.getElementById('gCol');const v=sel.value;sel.innerHTML='<option value="">-- 列 --</option>';
  getActiveHdr().forEach(c=>sel.innerHTML+=`<option value="${esc(c)}">${esc(c)}</option>`);if(v)sel.value=v;
}

document.getElementById('l2Tog').addEventListener('click',()=>{const t=document.getElementById('l2Tog'),b=document.getElementById('l2Body');t.classList.toggle('open');b.classList.toggle('open')});

document.getElementById('gCol').addEventListener('change',e=>{
  S.selGVals=[];const col=e.target.value;
  if(col){renderVP2(col);showL2BaseInfo(col);popDepGrp()}
  else{document.getElementById('vp2').innerHTML='';document.getElementById('l2BaseInfo').style.display='none'}
});

function popDepGrp(){
  const sel=document.getElementById('gDepGrp'),f=getActiveFile();sel.innerHTML='<option value="">-- 无(独立) --</option>';
  f.grps.forEach(g=>{sel.innerHTML+=`<option value="${g.id}">${esc(g.name)} (${esc(g.column)})</option>`});
  document.getElementById('l2RelF').style.display=sel.value?'flex':'none';
}
document.getElementById('gDepGrp').addEventListener('change',e=>{document.getElementById('l2RelF').style.display=e.target.value?'flex':'none'});

function showL2BaseInfo(col){
  const f=getActiveFile(),info=document.getElementById('l2BaseInfo'),l1f=f.l1[col];
  const isActive=l1f&&l1f.checked&&l1f.checked.size<uniq(col).length;
  info.innerHTML=`依托列: <b>${esc(col)}</b> ${isActive?`L1已过滤 (${[...l1f.checked].length}/${uniq(col).length})`:''}<br><span style="color:var(--t3)">虚线框 = L1范围外的值，仍可组合</span>`;
  info.style.display='block';
}

function renderVP2(col){
  const f=getActiveFile(),pk=document.getElementById('vp2'),fd=getFilteredData();
  const inScopeVals=uniq(col,fd),inScopeSet=new Set(inScopeVals),allVals=uniq(col);
  const grouped=new Set();f.grps.forEach(g=>{if(g.column===col)g.values.forEach(v=>grouped.add(String(v)))});
  const inScope=allVals.filter(v=>inScopeSet.has(v)),outScope=allVals.filter(v=>!inScopeSet.has(v));
  let html='';
  [...inScope,...outScope].forEach(v=>{const isG=grouped.has(v),isS=S.selGVals.includes(v),isIn=inScopeSet.has(v);
    let cls='vp2-i';if(isS)cls+=' sel';if(isG)cls+=' grp';if(!isIn)cls+=' l1out';
    html+=`<div class="${cls}" data-v="${esc(v)}">${esc(!isIn?v+' (L1外)':v)}</div>`});
  pk.innerHTML=html;
  pk.querySelectorAll('.vp2-i:not(.grp)').forEach(el=>el.addEventListener('click',()=>{
    const v=el.dataset.v;if(S.selGVals.includes(v)){S.selGVals=S.selGVals.filter(x=>x!==v);el.classList.remove('sel')}else{S.selGVals.push(v);el.classList.add('sel')}
  }));
}

document.querySelectorAll('.gco').forEach(o=>o.addEventListener('click',()=>{document.querySelectorAll('.gco').forEach(x=>x.classList.remove('sel'));o.classList.add('sel');S.selGColor=o.dataset.c}));

document.getElementById('btnAddGrp').addEventListener('click',()=>{
  const f=getActiveFile(),col=document.getElementById('gCol').value,name=document.getElementById('gName').value.trim();
  const pGroupId=document.getElementById('gDepGrp').value,pRel=document.getElementById('gDepRel').value;
  if(!col){ntf('请选择列','err');return}if(!name){ntf('请输入分组名','err');return}if(!S.selGVals.length){ntf('请选择值','err');return}
  const l1f=f.l1[col];
  f.grps.push({id:++f.gid,name,color:S.selGColor,column:col,values:[...S.selGVals],
    l1Dep:{col,cascade:l1f.cascade,dependCol:l1f.dependCol,filtered:l1f.checked&&l1f.checked.size<uniq(col).length},
    parentId:pGroupId?+pGroupId:null,parentRel:pGroupId?pRel:null});
  S.selGVals=[];document.getElementById('gName').value='';
  renderVP2(col);renderGrpCards();popDepGrp();
  ntf(`分组 "${name}" 已创建`);
});

function renderGrpCards(){
  const f=getActiveFile();if(!f)return;const div=document.getElementById('grpCards');
  if(!f.grps.length){div.innerHTML='';return}
  let html='';
  f.grps.forEach(g=>{
    const cm=CM[g.color]||CM.blue,l1Info=g.l1Dep?`L1:${esc(g.l1Dep.col)}`:'';
    let depHtml='';if(g.parentId){const pg=f.grps.find(x=>x.id===g.parentId);
      if(pg){const rc=g.parentRel==='AND'?'rel-and':'rel-or';depHtml=`<div class="gc-dep"><span class="dep-arrow">↑</span> <span class="gc-rel ${rc}">${g.parentRel}</span> ${esc(pg.name)}</div>`}}
    const children=f.grps.filter(x=>x.parentId===g.id);let chHtml='';
    if(children.length){chHtml='<div class="gc-dep"><span style="color:var(--t3)">↓</span> '+children.map(c=>{const rc=c.parentRel==='AND'?'rel-and':'rel-or';return`<span class="gc-rel ${rc}">${c.parentRel}</span> ${esc(c.name)}`}).join(' · ')+'</div>'}
    html+=`<div class="gc"><div class="gc-h"><span class="gc-dot" style="background:${cm.d}"></span><span class="gc-n">${esc(g.name)}</span><span class="gc-col">${esc(g.column)} ${l1Info}</span><button class="bd b bsm" data-del="${g.id}">✕</button></div><div class="gc-vs">${g.values.map(v=>`<span class="gc-v ${cm.t}">${esc(v)}</span>`).join('')}</div>${depHtml}${chHtml}</div>`;
  });
  div.innerHTML=html;
  div.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',()=>{
    const delId=+b.dataset.del;f.grps.forEach(g=>{if(g.parentId===delId)g.parentId=null});f.grps=f.grps.filter(g=>g.id!==delId);
    const col=document.getElementById('gCol').value;if(col){renderVP2(col);showL2BaseInfo(col)}renderGrpCards();popDepGrp();ntf('已删除');
  }));
}

document.getElementById('btnClrL2').addEventListener('click',()=>{
  const f=getActiveFile();if(!f)return;f.grps=[];f.gid=0;renderGrpCards();popDepGrp();
  const col=document.getElementById('gCol').value;if(col){renderVP2(col);showL2BaseInfo(col)}ntf('L2已清空');
});

// ========== RESULT VIEW ==========
document.getElementById('btnResult').addEventListener('click',()=>{
  document.getElementById('mainView').classList.remove('vis');document.getElementById('resultView').classList.add('vis');
  calcAllStats();
});
document.getElementById('btnBack').addEventListener('click',()=>{
  document.getElementById('resultView').classList.remove('vis');document.getElementById('mainView').classList.add('vis');
});
document.getElementById('btnCalc').addEventListener('click',calcAllStats);

function calcAllStats(){
  const area=document.getElementById('resArea');
  if(!S.files.length){area.innerHTML='<div style="text-align:center;padding:40px;color:var(--t3)">请先上传文件</div>';return}
  let html='';
  S.files.forEach((file,fi)=>{
    const sumCol=file.sumCol||'';const l1Data=getFilteredData_forFile(file);const ctxCache={};
    const entries=[];const groupedValsByCol={};
    file.grps.forEach(g=>{if(!groupedValsByCol[g.column])groupedValsByCol[g.column]=new Set();g.values.forEach(v=>groupedValsByCol[g.column].add(String(v)))});
    file.grps.forEach(g=>{
      const ctx=getGroupContext(g.id,l1Data,file.grps,ctxCache);
      let depLabel=g.l1Dep?`L1:${g.l1Dep.col}`:'';if(g.parentId){const pg=file.grps.find(x=>x.id===g.parentId);if(pg)depLabel+=` ${g.parentRel}→${pg.name}`}else depLabel+=' (独立)';
      const entry={name:g.name,color:g.color,isGroup:true,column:g.column,count:ctx.length,pct:l1Data.length>0?(ctx.length/l1Data.length*100).toFixed(1):'0',depInfo:depLabel};
      if(sumCol)entry.sum=ctx.reduce((a,r)=>a+(parseFloat(r[sumCol])||0),0);
      file.addedCols.forEach(ac=>{const tc={};ctx.forEach(r=>{const v=String(r[ac]??'');tc[v]=(tc[v]||0)+1});entry['ac_'+ac]=tc});
      entries.push(entry);
    });
    if(!file.grps.length){entries.push({name:'(未分组)',color:null,isGroup:false,column:'',count:l1Data.length,pct:'100',depInfo:''});}
    // Total
    const allRows=new Set();file.grps.forEach(g=>{getGroupContext(g.id,l1Data,file.grps,ctxCache).forEach(r=>allRows.add(r))});
    const totalRows=[...allRows];
    const total={name:'合计',isTotal:true,count:totalRows.length,pct:l1Data.length>0?(totalRows.length/l1Data.length*100).toFixed(1):'0',
      sum:sumCol?totalRows.reduce((a,r)=>a+(parseFloat(r[sumCol])||0),0):null};
    file.addedCols.forEach(ac=>{const tc={};totalRows.forEach(r=>{const v=String(r[ac]??'');tc[v]=(tc[v]||0)+1});total['ac_'+ac]=tc});

    const secColor=SEC_COLORS[fi%SEC_COLORS.length];
    let scOpts='<option value="">-- 无 --</option>';file.hdr.forEach(c=>{scOpts+=`<option value="${esc(c)}"${c===sumCol?' selected':''}>${esc(c)}</option>`});
    html+=`<div class="rv-section"><div class="rv-section-hdr"><span class="sec-dot" style="background:${secColor}"></span>${esc(file.name)}<span class="sec-info">${file.raw.length}行 / ${file.hdr.length}列 / ${file.grps.length}分组</span><div class="rv-sum-sel"><label>求和列</label><select data-fid="${file.id}" class="rv-sc">${scOpts}</select></div></div>`;
    // Table
    html+='<table class="rt"><thead><tr><th>类别</th><th>依托</th><th>列</th><th style="text-align:right">数量</th><th style="text-align:right">占比</th>';
    if(sumCol)html+=`<th style="text-align:right">${esc(sumCol)} 求和</th>`;
    file.addedCols.forEach(ac=>html+=`<th style="text-align:right">${esc(ac)} 类型数</th>`);
    html+='</tr></thead><tbody>';
    entries.forEach(e=>{
      const cm=e.color?CM[e.color]:null;html+='<tr>';
      html+=`<td><div class="cc">${cm?`<span class="cdot" style="background:${cm.d}"></span>`:''}<span class="gico">${e.isGroup?'📁':'📌'}</span> ${esc(e.name)}</div></td>`;
      html+=`<td style="color:var(--cy);font-size:10px;font-family:var(--mf)">${esc(e.depInfo)}</td>`;
      html+=`<td style="color:var(--t3);font-size:10px">${esc(e.column)}</td>`;
      html+=`<td class="nc">${e.count}</td><td class="nc">${e.pct}%</td>`;
      if(sumCol)html+=`<td class="nc" style="color:var(--wn)">${e.sum!==undefined?fmtN(e.sum):'-'}</td>`;
      file.addedCols.forEach(ac=>{const tc=e['ac_'+ac]||{};html+=`<td class="nc" style="color:var(--cy)">${Object.keys(tc).length} 种</td>`});
      html+='</tr>';
    });
    html+=`<tr class="tot"><td>合计</td><td></td><td></td><td class="nc">${total.count}</td><td class="nc">${total.pct}%</td>`;
    if(sumCol)html+=`<td class="nc" style="color:var(--wn)">${fmtN(total.sum)}</td>`;
    file.addedCols.forEach(ac=>{const tc=total['ac_'+ac]||{};html+=`<td class="nc" style="color:var(--cy)">${Object.keys(tc).length} 种</td>`});
    html+='</tr></tbody></table>';
    // Detail
    if(file.addedCols.length){file.addedCols.forEach(ac=>{
      html+=`<div class="det-sec"><div class="det-hdr">🎨 ${esc(ac)} 详细分布</div><table class="rt"><thead><tr><th>类别</th><th>${esc(ac)} 值</th><th style="text-align:right">数量</th></tr></thead><tbody>`;
      entries.forEach(e=>{const tc=e['ac_'+ac]||{};const sorted=Object.entries(tc).sort((a,b)=>b[1]-a[1]);
        if(!sorted.length){html+=`<tr><td style="font-weight:600">${esc(e.name)}</td><td>-</td><td class="nc">0</td></tr>`;return}
        sorted.forEach(([val,cnt],i)=>{html+='<tr>';if(i===0)html+=`<td rowspan="${sorted.length}" style="font-weight:600;vertical-align:top">${esc(e.name)}</td>`;html+=`<td style="font-family:var(--mf);font-size:11px">${esc(val)}</td><td class="nc">${cnt}</td></tr>`});
      });html+='</tbody></table></div>';
    });}
    html+='</div>';
  });
  area.innerHTML=html;
  area.querySelectorAll('.rv-sc').forEach(sel=>sel.addEventListener('change',e=>{
    const fid=+e.target.dataset.fid;const file=S.files.find(f=>f.id===fid);
    if(file){file.sumCol=e.target.value;calcAllStats()}
  }));
  document.getElementById('exportBtn').style.display=S.files.length?'inline-flex':'none';
}

function getFilteredData_forFile(file){
  // Same logic as getFilteredData but for a specific file object
  const hdr=file.hdr,l1=file.l1;
  const order=[];const visited=new Set();const visiting=new Set();
  function visit(col){if(visited.has(col))return;if(visiting.has(col))return;visiting.add(col);const f=l1[col];if(f&&f.cascade&&f.dependCol)visit(f.dependCol);visiting.delete(col);visited.add(col);order.push(col)}
  hdr.forEach(c=>visit(c));
  let data=file.raw;
  for(const col of order){
    const f=l1[col];
    if(f&&f.checked&&f.checked.size<uniq_for(col,file).length)data=data.filter(r=>f.checked.has(String(r[col]??'')));
    if(f&&f.condOn&&f.condVal!==''){const cv=f.condVal.toLowerCase(),op=f.condOp;
      data=data.filter(r=>{const v=String(r[col]??'').toLowerCase(),numV=parseFloat(v),numC=parseFloat(f.condVal);
        switch(op){case'eq':return v===cv;case'neq':return v!==cv;case'gt':return!isNaN(numV)&&!isNaN(numC)&&numV>numC;case'lt':return!isNaN(numV)&&!isNaN(numC)&&numV<numC;case'gte':return!isNaN(numV)&&!isNaN(numC)&&numV>=numC;case'lte':return!isNaN(numV)&&!isNaN(numC)&&numV<=numC;case'sw':return v.startsWith(cv);case'ew':return v.endsWith(cv);case'contains':return v.includes(cv);default:return true}})}
  }
  return data;
}
function uniq_for(col,file){const s=new Set();file.raw.forEach(r=>s.add(String(r[col]??'')));return[...s].sort()}

// ========== EXPORT EXCEL ==========
document.getElementById('exportBtn').addEventListener('click',()=>{
  if(!S.files.length){ntf('无数据可导出','err');return}
  const wb=XLSX.utils.book_new();
  S.files.forEach((file,fi)=>{
    const sumCol=file.sumCol||'';
    const l1Data=getFilteredData_forFile(file);const ctxCache={};const rows=[];
    const header=['文件','类别','依托','列','数量','占比(%)'];
    if(sumCol)header.push(`${sumCol} 求和`);
    file.grps.forEach(g=>{
      const ctx=getGroupContext(g.id,l1Data,file.grps,ctxCache);
      let depLabel=g.l1Dep?`L1:${g.l1Dep.col}`:'';if(g.parentId){const pg=file.grps.find(x=>x.id===g.parentId);if(pg)depLabel+=` ${g.parentRel}→${pg.name}`}else depLabel+=' (独立)';
      const row=[file.name,g.name,depLabel,g.column,ctx.length,l1Data.length>0?(ctx.length/l1Data.length*100).toFixed(1):'0'];
      if(sumCol)row.push(parseFloat((ctx.reduce((a,r)=>a+(parseFloat(r[sumCol])||0),0)).toFixed(2)));
      rows.push(row);
    });
    if(!file.grps.length){const row=[file.name,'(未分组)','','',l1Data.length,'100'];if(sumCol)row.push(0);rows.push(row)}
    const allRows=new Set();file.grps.forEach(g=>{getGroupContext(g.id,l1Data,file.grps,ctxCache).forEach(r=>allRows.add(r))});
    const totalRow=[file.name,'合计','',allRows.size,l1Data.length>0?(allRows.size/l1Data.length*100).toFixed(1):'0'];
    if(sumCol)totalRow.push([...allRows].reduce((a,r)=>a+(parseFloat(r[sumCol])||0),0));
    rows.push(totalRow);
    const ws=XLSX.utils.aoa_to_sheet([header,...rows]);XLSX.utils.book_append_sheet(wb,ws,file.name.substring(0,20));
  });
  XLSX.writeFile(wb,'统计结果.xlsx');ntf('已导出 统计结果.xlsx');
});

// ========== SAVE / LOAD ==========
document.getElementById('btnSave').addEventListener('click',()=>{
  const cfg={files:S.files.map(f=>({name:f.name,hdr:f.hdr,l1:{},grps:f.grps.map(g=>({name:g.name,color:g.color,column:g.column,values:g.values,l1Dep:g.l1Dep,parentId:g.parentId,parentRel:g.parentRel})),addedCols:f.addedCols,sumCol:f.sumCol||'',hiddenCols:[...f.hiddenCols]}))};
  S.files.forEach((_,fi)=>{const f=S.files[fi];f.hdr.forEach(col=>{const l1f=f.l1[col];cfg.files[fi].l1[col]={checked:l1f.checked?[...l1f.checked]:null,cascade:l1f.cascade||false,dependCol:l1f.dependCol||null,sort:l1f.sort||null,condOn:l1f.condOn||false,condOp:l1f.condOp||'eq',condVal:l1f.condVal||''}})});
  const blob=new Blob([JSON.stringify(cfg,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='filter_config.json';a.click();URL.revokeObjectURL(url);ntf('配置已保存');
});

document.getElementById('btnLoad').addEventListener('click',()=>document.getElementById('cfgIn').click());

document.getElementById('cfgIn').addEventListener('change',e=>{
  const file=e.target.files[0];if(!file)return;const reader=new FileReader();
  reader.onload=ev=>{
    try{
      const cfg=JSON.parse(ev.target.result);
      if(!cfg.files||!cfg.files.length){ntf('配置文件格式错误','err');return}
      S.files=[];S.activeFileId=null;
      cfg.files.forEach((fc,fi)=>{
        const hdr=fc.hdr||[];const l1={};const raw=[];hdr.forEach(c=>{const lf=fc.l1&&fc.l1[c];l1[c]=lf?{checked:lf.checked?new Set(lf.checked):null,cascade:lf.cascade||false,dependCol:lf.dependCol||null,sort:lf.sort||null,condOn:lf.condOn||false,condOp:lf.condOp||'eq',condVal:lf.condVal||''}:newL1()});
        S.files.push({id:++fileIdCounter,name:fc.name,raw,hdr,l1,grps:[],gid:0,addedCols:fc.addedCols||[],sumCol:fc.sumCol||'',hiddenCols:new Set(fc.hiddenCols||[])});
        if(cfg.grps)cfg.grps.forEach(g=>{S.files[fi].grps.push({id:++S.files[fi].gid,name:g.name,color:g.color,column:g.column,values:g.values,l1Dep:g.l1Dep||null,parentId:g.parentId||null,parentRel:g.parentRel||null})});
      });
      switchFile(S.files[0].id);ntf('配置已加载');
    }catch(err){ntf('配置文件格式错误','err')}
  };
  reader.readAsText(file);e.target.value='';
});

// ========== FILE UPLOAD EVENTS ==========
document.getElementById('upBox').addEventListener('click',()=>document.getElementById('fileInput').click());
document.getElementById('fileInput').addEventListener('change',e=>{if(e.target.files.length)handleFile(e.target.files[0])});
document.getElementById('upBox').addEventListener('dragover',e=>{e.preventDefault();document.getElementById('upBox').classList.add('drag')});
document.getElementById('upBox').addEventListener('dragleave',()=>document.getElementById('upBox').classList.remove('drag'));
document.getElementById('upBox').addEventListener('drop',e=>{e.preventDefault();document.getElementById('upBox').classList.remove('drag');if(e.dataTransfer.files.length)handleFile(e.dataTransfer.files[0])});
document.getElementById('btnReup').addEventListener('click',()=>{document.getElementById('fileInput').value='';document.getElementById('fileInput').click()});

// ========== L2 RESIZE ==========
(function(){
  const bar=document.querySelector('.l2-bar');if(!bar)return;
  const body=document.getElementById('l2Body');
  // Create a resize strip above the l2-bar
  const strip=document.createElement('div');strip.className='l2-resize-strip';
  bar.parentNode.insertBefore(strip,bar);
  let startY,startH;
  strip.addEventListener('mousedown',e=>{
    if(!body.classList.contains('open'))return;
    e.preventDefault();startY=e.clientY;startH=bar.offsetHeight;
    strip.classList.add('active');document.body.style.cursor='ns-resize';document.body.style.userSelect='none';
    const onMove=ev=>{
      const diff=startY-ev.clientY;
      bar.style.height=Math.max(80,startH+diff)+'px';
    };
    const onUp=()=>{
      document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);
      document.body.style.cursor='';document.body.style.userSelect='';strip.classList.remove('active');
    };
    document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
  });
})();
