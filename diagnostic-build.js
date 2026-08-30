const BASE='https://app.dscontrol.ru';
async function get(path){
  const r=await fetch(`${BASE}${path}`,{headers:{api_key:process.env.ASHK_API_KEY,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'},redirect:'manual'});
  const text=(await r.text()).replace(/\s+/g,' ');
  let json=null; try{json=JSON.parse(text)}catch{}
  return {path,status:r.status,contentType:r.headers.get('content-type'),text,json};
}
const probes=[];
for(const path of ['/api/WalletTokenList','/api/WalletTokenList?OwnerId=3561934','/api/StudentDriveScores?param=3561934']){
  try{const x=await get(path); probes.push({path,status:x.status,body:x.text.slice(0,12000)});}catch(e){probes.push({path,error:String(e?.message||e)});}
}
console.log('ASHK_DOCUMENTED_READ_PROBE',JSON.stringify(probes));
