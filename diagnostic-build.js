const BASE='https://app.dscontrol.ru';
const html=await (await fetch(`${BASE}/login`)).text();
const srcs=[...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m=>m[1]);
const hrefs=[...html.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)].map(m=>m[1]);
const assets=[...new Set([...srcs,...hrefs].filter(x=>/\.js(?:\?|$)/i.test(x)).map(x=>new URL(x,BASE).href))];
console.log('ASHK_ASSET_SCAN_START',JSON.stringify({scriptCount:srcs.length,jsAssets:assets.length,assets:assets.slice(0,30)}));
const api=new Set(),hits=[];
for(const url of assets.slice(0,40)){
  try{
    const r=await fetch(url); const text=await r.text();
    for(const m of text.matchAll(/\/(?:api|apia)\/[A-Za-z0-9_\-./]+/g)) api.add(m[0]);
    const terms=['Wallet','Balance','OLAP','DriveSession','ForMasterPayment','ForStudents','WalletOperation','Token'];
    for(const term of terms){
      let p=0,c=0;
      while((p=text.indexOf(term,p))>=0&&c<12){hits.push({asset:url.split('/').pop(),term,context:text.slice(Math.max(0,p-160),Math.min(text.length,p+260)).replace(/\s+/g,' ')});p+=term.length;c++;}
    }
  }catch(e){console.log('ASHK_ASSET_ERROR',url,String(e?.message||e));}
}
const relevantApi=[...api].filter(x=>/(wallet|balance|drive|session|olap|report|token)/i.test(x)).sort();
console.log('ASHK_INTERNAL_DISCOVERY_OK',JSON.stringify({allApiCount:api.size,relevantApi,hits:hits.slice(0,120)}));
