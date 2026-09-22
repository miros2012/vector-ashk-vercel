export function createFinanceCycleHandler({cronSecret,run,mode='intraday',recoveryOnly=false}) {
  return async (req,res)=>{
    res.setHeader?.('Cache-Control','no-store');
    if(req?.method!=='GET')return res.status(405).json({ok:false,error:'Use GET'});
    if(!cronSecret || req?.headers?.authorization!==`Bearer ${cronSecret}`)return res.status(403).json({ok:false,error:'forbidden'});
    let result;
    try { result=await run({mode,recoveryOnly:recoveryOnly||req.headers?.['x-vector-finance-recovery-only']==='true'}); }
    catch { result={ok:false,statusCode:503,errorClass:'CYCLE_UNAVAILABLE'}; }
    return res.status(result.statusCode||(result.ok?200:503)).json(result);
  };
}

export async function invokeFinanceStage(handler,secret,{method='GET',cycle,verifyDecision=false}={}) {
  const res={statusCode:200,body:null,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;},end(){return this;}};
  await handler({method,headers:{authorization:`Bearer ${secret}`,...cycle?{'x-vector-finance-cycle-id':cycle.id}:{}},query:{},body:{}},res);
  const ok=res.statusCode>=200&&res.statusCode<300&&res.body?.ok===true;
  const verified=!verifyDecision||(res.body?.mode==='commit'&&res.body?.verified===true&&Number.isInteger(res.body?.matches)&&res.body.matches>=0&&res.body.matches===res.body.total);
  return {ok:ok&&verified,statusCode:res.statusCode,errorClass:res.body?.errorClass};
}
