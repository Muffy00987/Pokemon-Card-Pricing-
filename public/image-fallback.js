(() => {
  const API='https://api.tcgdex.net/v2/en/cards';
  const CACHE_KEY='ptcg-canonical-images-v1';
  const cache=(()=>{try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'{}')}catch{return {}}})();
  const save=()=>{try{localStorage.setItem(CACHE_KEY,JSON.stringify(cache))}catch{}};
  const norm=s=>String(s||'').normalize('NFKD').replace(/[’']/g,'').replace(/[^a-zA-Z0-9]+/g,' ').toLowerCase().replace(/\s+/g,' ').trim();
  const stripName=s=>String(s||'')
    .replace(/#\s*[A-Za-z0-9-]+/g,' ')
    .replace(/\([^)]*\)\s*$/g,' ')
    .replace(/\b(special illustration rare|illustration rare|alternate art|alt art|full art|secret rare|rainbow rare|rainbow|gold rare|gold|holographic|holo|staff|trainer gallery|gallery)\b/gi,' ')
    .replace(/\b(SIR|IR|TG)\b/gi,' ')
    .replace(/\s+/g,' ').trim();
  const setScore=(want,got)=>{const a=norm(want),b=norm(got);if(!a||!b)return 0;if(a===b)return 100;if(a.includes(b)||b.includes(a))return 70;const toks=a.split(' ').filter(x=>x.length>2);return toks.length?Math.round(60*toks.filter(x=>b.includes(x)).length/toks.length):0;};
  const keyFor=c=>typeof keyOf==='function'?keyOf(c):`${c.name}|${c.set}|${c.number||''}`.toLowerCase();
  async function resolveCard(c){
    const key=keyFor(c);if(Object.prototype.hasOwnProperty.call(cache,key))return cache[key];
    const number=String(c.number||'').replace(/^#/,'').trim();
    const names=[stripName(c.name),String(c.name||'').replace(/#\s*[A-Za-z0-9-]+/g,' ').replace(/\([^)]*\)\s*$/g,' ').replace(/\s+/g,' ').trim()].filter(Boolean);
    let briefs=[];
    for(const name of [...new Set(names)]){
      try{const u=new URL(API);u.searchParams.set('name',name);if(number)u.searchParams.set('localId',number);const r=await fetch(u,{cache:'force-cache'});if(!r.ok)continue;const rows=await r.json();if(Array.isArray(rows)&&rows.length){briefs=rows.filter(x=>x?.image);if(briefs.length)break;}}catch{}
    }
    if(!briefs.length){cache[key]=null;save();return null;}
    let chosen=briefs[0],best=-1;
    for(const b of briefs.slice(0,8)){
      try{const r=await fetch(`${API}/${encodeURIComponent(b.id)}`,{cache:'force-cache'});if(!r.ok)continue;const full=await r.json();const score=setScore(c.set,full?.set?.name);if(score>best){best=score;chosen={...b,...full};if(score>=100)break;}}catch{}
    }
    const base=chosen?.image||briefs[0]?.image||null;
    const out=base?{base,thumb:`${base}/low.webp`,high:`${base}/high.webp`,id:chosen?.id||briefs[0]?.id||null}:null;
    cache[key]=out;save();return out;
  }
  async function applyOne(c){
    const key=keyFor(c),data=await resolveCard(c);if(!data)return;
    c._canonicalImage=data.high;if(c.live&&!c.live.image)c.live.image=data.high;
    document.querySelectorAll('.open-card[data-k]').forEach(el=>{if(el.dataset.k!==key)return;const img=el.querySelector?.('img.card-thumb');if(img){if(!img.dataset.canonicalFallback){img.dataset.canonicalFallback='1';img.addEventListener('error',()=>{img.src=data.thumb},{once:true});}return;}const ph=el.querySelector?.('.card-thumb.placeholder');if(ph){const i=document.createElement('img');i.className='card-thumb';i.src=data.thumb;i.alt=c.name;i.loading='lazy';i.referrerPolicy='no-referrer';ph.replaceWith(i);}});
  }
  let scheduled=false;
  async function hydrate(){
    if(scheduled)return;scheduled=true;await new Promise(r=>setTimeout(r,80));scheduled=false;if(!window.state?.cards)return;
    const visible=[...document.querySelectorAll('.card-link.open-card[data-k]')].map(el=>state.cards.find(c=>keyFor(c)===el.dataset.k)).filter(Boolean);
    for(const c of visible)await applyOne(c);
  }
  new MutationObserver(()=>hydrate()).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('click',e=>{const b=e.target.closest?.('.open-card[data-k]');if(!b)return;const c=state?.cards?.find(x=>keyFor(x)===b.dataset.k);if(!c)return;resolveCard(c).then(data=>{if(!data)return;setTimeout(()=>{const dlg=document.querySelector('#cardDetailDialog');if(!dlg?.open)return;const old=dlg.querySelector('.detail-image.placeholder');if(old){const img=document.createElement('img');img.className='detail-image';img.src=data.high;img.alt=c.name;img.referrerPolicy='no-referrer';old.replaceWith(img);}const img=dlg.querySelector('img.detail-image');if(img&&!img.dataset.canonicalFallback){img.dataset.canonicalFallback='1';img.addEventListener('error',()=>{img.src=data.high},{once:true});}},60)});},true);
  hydrate();
})();