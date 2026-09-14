import stableWorker from './stable-worker.js';

const CARD_API = 'https://thecardapi.com/api/v1/market/sales';
const FATAL_UPSTREAM = new Set([401, 403, 429]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  }});
}
function apiKey(env) { return String(env?.THE_CARD_API_KEY || '').trim(); }
function normalize(v) { return String(v || '').normalize('NFKD').replace(/[’']/g,'').replace(/[^a-zA-Z0-9.]+/g,' ').toLowerCase().replace(/\s+/g,' ').trim(); }
function cardNumber(card) { return String(card?.number || '').trim().replace(/^#/,'') || String(card?.name || '').match(/#\s*([A-Za-z0-9-]+)/)?.[1] || ''; }
function nameWithoutNumber(card) { return String(card?.name || '').replace(/#\s*[A-Za-z0-9-]+/g,' ').replace(/\s+/g,' ').trim(); }
function broadName(card) { return nameWithoutNumber(card).replace(/\b(special illustration rare|illustration rare|alternate art|alt art|full art|secret rare|rainbow rare|rainbow|gold rare|gold|holographic|holo|staff|trainer gallery|gallery)\b/gi,' ').replace(/\b(SIR|IR|TG)\b/gi,' ').replace(/\s+/g,' ').trim(); }
function coreName(card) { return broadName(card).replace(/\b(vmax|vstar|v-union|vunion|v|ex|gx)\b/gi,' ').replace(/\s+/g,' ').trim(); }
function queryPlan(card) {
  const number=cardNumber(card), broad=broadName(card), core=coreName(card);
  return [...new Set([number ? `${broad} ${number}` : '', broad, core].map(x=>x.replace(/\s+/g,' ').trim()).filter(x=>x.length>=4))];
}
function rejected(title) { return /\b(japanese|korean|chinese|simplified chinese|traditional chinese|lot|bundle|collection|repack|proxy|custom)\b/i.test(String(title||'')); }
function identityScore(row, card) {
  const title=String(row?.title||''); if(!title||rejected(title)) return 0;
  const norm=normalize(title), flat=norm.replace(/\s+/g,''), number=normalize(cardNumber(card)).replace(/\s+/g,'');
  const core=normalize(coreName(card)).split(' ').filter(t=>t.length>=2), broad=normalize(broadName(card)).split(' ').filter(t=>t.length>=2);
  let score=0; if(number) score += flat.includes(number) ? 60 : -35;
  if(core.length) score += Math.round(35*core.filter(t=>norm.includes(t)).length/core.length);
  if(broad.length) score += Math.round(15*broad.filter(t=>norm.includes(t)).length/broad.length);
  return Math.max(0,Math.min(100,score));
}
function safeHttps(v){try{const u=new URL(String(v||''));return u.protocol==='https:'?u.toString():null}catch{return null}}
function publicSale(row,match){const p=Number(row?.price??row?.sale_price);return{title:String(row?.title||'').slice(0,220),price:Number.isFinite(p)&&p>0?p:null,date:row?.sale_date||row?.sold_at||null,url:safeHttps(row?.listing_url),image:safeHttps(row?.image_url),thumbnail:safeHttps(row?.thumbnail_url||row?.image_url),match}}
function rate(response){const n=x=>{const v=Number(response.headers.get(x));return Number.isFinite(v)?v:null};return{limit:n('X-RateLimit-Limit'),remaining:n('X-RateLimit-Remaining'),reset:n('X-RateLimit-Reset')}}
function mergeRate(rs){const v=rs.filter(Boolean),a=k=>v.map(x=>x[k]).filter(Number.isFinite);const l=a('limit'),r=a('remaining'),z=a('reset');return{limit:l.length?Math.max(...l):null,remaining:r.length?Math.min(...r):null,reset:z.length?Math.max(...z):null}}
async function fetchSales(env,q,limit=1){
  const u=new URL(CARD_API);u.searchParams.set('q',q);u.searchParams.set('platform','ebay');u.searchParams.set('sort','date_desc');u.searchParams.set('limit',String(limit));
  const response=await fetch(u,{headers:{'x-market-api-key':apiKey(env)}});const rt=rate(response);let body=null;try{body=await response.json()}catch{}
  if(!response.ok){const raw=body?.message??body?.error??body?.detail??`The Card API returned HTTP ${response.status}`;return{ok:false,status:response.status,message:typeof raw==='string'?raw:JSON.stringify(raw),rate:rt,rows:[]}}
  return{ok:true,status:response.status,rows:Array.isArray(body?.data)?body.data:[],total:Number.isFinite(Number(body?.pagination?.total))?Number(body.pagination.total):0,rate:rt};
}
async function activity(request,env){
  if(!apiKey(env)) return json({error:'THE_CARD_API_KEY is not configured in Cloudflare Runtime variables and secrets.',fatal:true},503);
  let body;try{body=await request.json()}catch{return json({error:'Invalid JSON body.'},400)}
  const cards=Array.isArray(body?.cards)?body.cards.slice(0,20):[];if(!cards.length)return json({error:'No cards supplied.'},400);
  const results=[],rates=[];let upstreamRequests=0,returnedRows=0;
  for(const card of cards){
    const plan=queryPlan(card), q=plan[0]||broadName(card)||coreName(card);
    if(!q||q.length<4){results.push({key:String(card?.key||''),active:false,returned:0,salesTotal:0,match:0,attempts:[],bestTitle:null,latest:null});continue}
    const response=await fetchSales(env,q,1);upstreamRequests++;rates.push(response.rate);
    const attempts=[{q,returned:response.rows.length,total:response.total,status:response.status,category:'none',platform:'ebay'}];
    if(!response.ok){
      if(FATAL_UPSTREAM.has(response.status))return json({error:response.message,upstreamStatus:response.status,fatal:true,checked:results.length,upstreamRequests,returnedRows,rate:mergeRate(rates),results},response.status);
      results.push({key:String(card?.key||''),active:false,returned:0,salesTotal:0,match:0,attempts,bestTitle:null,latest:null,error:response.message});continue;
    }
    returnedRows+=response.rows.length;let bestRow=null,bestMatch=0;
    for(const row of response.rows){const s=identityScore(row,card);if(s>bestMatch){bestMatch=s;bestRow=row}}
    const threshold=cardNumber(card)?55:30,active=!!bestRow&&bestMatch>=threshold;
    results.push({key:String(card?.key||''),active,returned:response.rows.length,salesTotal:response.total||0,match:bestMatch,attempts,bestTitle:bestRow?String(bestRow.title||'').slice(0,180):null,latest:active?publicSale(bestRow,bestMatch):null});
  }
  return json({ok:true,checked:results.length,upstreamRequests,returnedRows,maxRows:cards.length,rate:mergeRate(rates),results});
}

class BodyInjector {
  element(element) {
    element.append('<script src="/enhancements.js" defer></script><script src="/market-mode.js" defer></script><script src="/image-fallback.js" defer></script><script src="/sales-ui.js" defer></script><script src="/market-dashboard-v2.js" defer></script><script src="/dashboard-details-fix.js" defer></script>', { html: true });
  }
}

export default {
  async fetch(request,env,ctx) {
    const url=new URL(request.url);
    if(url.pathname==='/api/activity'&&request.method==='POST')return activity(request,env);
    const response=await stableWorker.fetch(request,env,ctx);
    const type=response.headers.get('content-type')||'';
    if(request.method==='GET'&&type.includes('text/html')) return new HTMLRewriter().on('body',new BodyInjector()).transform(response);
    return response;
  }
};
