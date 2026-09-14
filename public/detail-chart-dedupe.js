(() => {
  const COMPANIES=['RAW','PSA','BGS','CGC','TAG'];
  const COLORS={RAW:'#dce6f7',PSA:'#ff7f89',BGS:'#f4c56b',CGC:'#75d79a',TAG:'#69c7ef'};
  const filters=new Map();
  let ready=false;
  const norm=v=>String(v||'').normalize('NFKD').replace(/[’']/g,'').replace(/[^a-zA-Z0-9]+/g,' ').toLowerCase().replace(/\s+/g,' ').trim();
  const num=c=>String(c?.number||'').trim().replace(/^#/,'')||String(c?.name||'').match(/#\s*([A-Za-z0-9-]+)/)?.[1]||'';
  const cname=c=>norm(String(c?.name||'').replace(/#\s*[A-Za-z0-9-]+/g,' '));
  const genericSet=s=>!String(s||'').trim()||/\bera\b/i.test(String(s||''));
  const latestLive=a=>a.map(c=>c?.live).filter(Boolean).sort((x,y)=>new Date(y.updatedAt||0)-new Date(x.updatedAt||0))[0]||null;

  function dedupe(){
    if(ready||!window.state?.cards?.length||typeof keyOf!=='function')return false;
    const numbered=new Map(),plain=new Map();
    for(const c of state.cards){
      const n=num(c);
      const k=n?`${cname(c)}|${norm(n)}`:`${cname(c)}|${norm(c.set)}`;
      const m=n?numbered:plain;
      if(!m.has(k))m.set(k,[]);m.get(k).push(c);
    }
    const out=[];
    for(const group of numbered.values()){
      const specific=group.filter(c=>!genericSet(c.set));
      const candidates=specific.length?specific:group;
      const seenSets=new Set();
      for(const c of candidates){
        const sk=norm(c.set)||'generic'; if(seenSets.has(sk))continue; seenSets.add(sk);
        const live=latestLive(group); if(live&&!c.live)c.live=live;
        const kk=keyOf(c);
        for(const d of group){const dk=keyOf(d);if(state.activity?.[dk]&&!state.activity?.[kk])state.activity[kk]=state.activity[dk];}
        out.push(c);
      }
    }
    for(const group of plain.values()){const c=group[0],live=latestLive(group);if(live&&!c.live)c.live=live;out.push(c);}
    state.cards=out;
    if(state.selected instanceof Set){const valid=new Set(out.map(keyOf));state.selected=new Set([...state.selected].filter(k=>valid.has(k)));try{saveSelected()}catch{}}
    ready=true;
    if(typeof render==='function')render();
    const table=document.querySelector('#body')?.closest('table');if(table)table.classList.add('raw-first-table');
    return true;
  }

  function points(card){
    const out=[];
    const add=(company,s)=>{const p=Number(s?.price),t=Date.parse(s?.date||'');if(!Number.isFinite(p)||p<=0||!Number.isFinite(t))return;const grade=company==='RAW'?'Raw':String(s?.displayGrade||s?.grade||'7+');out.push({company,series:company==='RAW'?'Raw':`${company} ${grade}`,price:p,time:t,title:String(s?.title||'')});};
    for(const s of card?.live?.rawSales||[])add('RAW',s);
    for(const g of ['PSA','BGS','CGC','TAG'])for(const s of card?.live?.gradedSales?.[g]||[])add(g,s);
    return out.sort((a,b)=>a.time-b.time);
  }
  function enabled(key){if(!filters.has(key))filters.set(key,new Set(COMPANIES));return filters.get(key)}
  const cash=v=>`$${Number(v).toFixed(2)}`;
  const day=t=>new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric'});

  function chartMarkup(card,key){
    const all=points(card),on=enabled(key);
    const controls=COMPANIES.map(c=>{const count=all.filter(p=>p.company===c).length;return `<button type="button" class="trend-filter ${on.has(c)?'on':''}" data-company="${c}" ${count?'':'disabled'}>${c==='RAW'?'Raw':c}<span>${count}</span></button>`}).join('');
    if(!card?.live)return `<div class="trend-controls">${controls}</div><div class="trend-empty">Deep scan this card to load its price trend.</div>`;
    const vis=all.filter(p=>on.has(p.company));
    if(!vis.length)return `<div class="trend-controls">${controls}</div><div class="trend-empty">No dated accepted sales are available for the selected filters.</div>`;
    const W=760,H=235,L=58,R=18,T=16,B=38;
    let t0=Math.min(...vis.map(p=>p.time)),t1=Math.max(...vis.map(p=>p.time));if(t0===t1){t0-=43200000;t1+=43200000}
    let p0=Math.min(...vis.map(p=>p.price)),p1=Math.max(...vis.map(p=>p.price));if(p0===p1){p0=Math.max(0,p0*.9);p1*=1.1}const pad=(p1-p0)*.1;p0=Math.max(0,p0-pad);p1+=pad;
    const x=t=>L+(t-t0)/(t1-t0)*(W-L-R),y=p=>T+(p1-p)/(p1-p0)*(H-T-B);
    let grid='';for(let i=0;i<5;i++){const yy=T+i*(H-T-B)/4,v=p1-i*(p1-p0)/4;grid+=`<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" class="trend-grid"/><text x="${L-7}" y="${yy+4}" text-anchor="end" class="trend-axis">${cash(v)}</text>`}
    const groups=new Map();for(const p of vis){if(!groups.has(p.series))groups.set(p.series,[]);groups.get(p.series).push(p)}
    let svg='',legend='';for(const [name,a] of groups){const col=COLORS[a[0].company],pts=a.sort((u,v)=>u.time-v.time);const path=pts.map((p,i)=>`${i?'L':'M'} ${x(p.time).toFixed(1)} ${y(p.price).toFixed(1)}`).join(' ');svg+=`<path d="${path}" fill="none" stroke="${col}" stroke-width="2.3"/>`;for(const p of pts)svg+=`<circle cx="${x(p.time).toFixed(1)}" cy="${y(p.price).toFixed(1)}" r="4" fill="${col}"><title>${esc(name)} · ${cash(p.price)} · ${esc(day(p.time))} · ${esc(p.title.slice(0,90))}</title></circle>`;legend+=`<span><i style="background:${col}"></i>${esc(name)}</span>`}
    const ticks=[0,.5,1].map(f=>{const t=t0+(t1-t0)*f;return `<text x="${x(t)}" y="${H-12}" text-anchor="middle" class="trend-axis">${day(t)}</text>`}).join('');
    return `<div class="trend-controls">${controls}<button type="button" class="trend-refresh">Refresh live prices</button></div><svg class="trend-svg" viewBox="0 0 ${W} ${H}" aria-label="Recent price trend">${grid}${svg}${ticks}</svg><div class="trend-legend">${legend}</div><div class="trend-foot">Accepted raw and graded sales from the free 3-day window. A new deep scan refreshes the chart.</div>`;
  }

  function mountChart(key){
    const dialog=document.querySelector('#cardDetailDialog');if(!dialog?.open)return;
    const card=state.cards.find(c=>keyOf(c)===key);if(!card)return;
    const actions=dialog.querySelector('.detail-actions');if(!actions)return;
    let panel=dialog.querySelector('.price-trend-panel');if(!panel){panel=document.createElement('section');panel.className='price-trend-panel';actions.insertAdjacentElement('afterend',panel)}
    panel.innerHTML=`<div class="trend-head"><h3>Live price trend</h3><div class="muted">Raw, PSA, BGS, CGC and TAG</div></div>${chartMarkup(card,key)}`;
    panel.querySelectorAll('.trend-filter').forEach(b=>b.onclick=()=>{const s=enabled(key),c=b.dataset.company;s.has(c)?s.delete(c):s.add(c);mountChart(key)});
    const r=panel.querySelector('.trend-refresh');if(r)r.onclick=async()=>{r.disabled=true;r.textContent='Refreshing…';try{await Promise.resolve(updateCards([card]))}catch{}setTimeout(()=>mountChart(key),150)};
  }

  const style=document.createElement('style');style.textContent=`
    .raw-first-table th:nth-child(n+4):nth-child(-n+9),.raw-first-table #body td:nth-child(n+4):nth-child(-n+9){display:none!important}
    .price-trend-panel{margin-top:16px;border:1px solid #2b3550;border-radius:14px;background:#0b1120;padding:12px}.trend-head{display:flex;justify-content:space-between;gap:12px;align-items:center}.trend-head h3{margin:0;font-size:17px}.trend-controls{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.trend-filter,.trend-refresh{padding:6px 9px;border-radius:999px;font-size:11px;border:1px solid #34415d;background:#111829;color:#aeb8cc}.trend-filter.on{background:#1a2940;color:#fff;border-color:#55739c}.trend-filter span{margin-left:5px;opacity:.7}.trend-filter:disabled{opacity:.35}.trend-refresh{margin-left:auto;border-radius:8px;color:var(--cyan);font-weight:800}.trend-svg{width:100%;height:auto;display:block}.trend-grid{stroke:#263149;stroke-width:1}.trend-axis{fill:#8994aa;font-size:10px}.trend-legend{display:flex;flex-wrap:wrap;gap:8px 12px;font-size:10px;color:#b7c1d3}.trend-legend span{display:flex;align-items:center;gap:5px}.trend-legend i{width:9px;height:9px;border-radius:50%;display:inline-block}.trend-foot{margin-top:8px;font-size:10px;color:#7f8ba3}.trend-empty{min-height:170px;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--muted);border:1px dashed #2c3750;border-radius:10px;padding:20px}
  `;document.head.appendChild(style);

  document.addEventListener('click',e=>{const b=e.target.closest?.('.open-card');if(b?.dataset?.k)setTimeout(()=>mountChart(b.dataset.k),35)});
  let tries=0;const timer=setInterval(()=>{tries++;if(dedupe()||tries>80){clearInterval(timer);const table=document.querySelector('#body')?.closest('table');if(table)table.classList.add('raw-first-table')}},100);
})();
