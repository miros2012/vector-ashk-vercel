const BASE='https://app.dscontrol.ru';
const headers={api_key:process.env.ASHK_API_KEY,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'};
const r=await fetch(`${BASE}/api/WalletTokenList`,{headers});
const j=await r.json();
const data=Array.isArray(j)?j:(Array.isArray(j?.data)?j.data:[]);
console.log('WALLET_TOKEN_MAP_OK',JSON.stringify(data.map(x=>({Id:x.Id??x.TokenId,Code:x.Code??x.ShortName??x.Name,Name:x.Name??x.Title??x.Description}))));
