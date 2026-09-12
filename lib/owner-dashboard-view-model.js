const MONEY=['availableCash','cashGap','safeWithdrawal','salesPlanToDate','salesFact','receivables','openObligations','unconfirmedObligations','drivingFundReserve','drivingFundDeficit'];
const num=x=>typeof x==='number' && Number.isFinite(x) ? x : null;
const str=x=>typeof x==='string' ? x : null;
const texts=x=>Array.isArray(x) ? x.filter(v=>typeof v==='string') : [];
export function ownerDashboardView(pkg) {
  const snapshot=pkg?.snapshot || {};
  const health={status:['OK','WARNING','BLOCKED'].includes(snapshot.dataHealth?.status)?snapshot.dataHealth.status:'BLOCKED',reasons:texts(snapshot.dataHealth?.reasons)};
  const blockers=texts(pkg?.policy?.blockers);
  const metrics=Object.fromEntries(MONEY.map(k=>[k,num(snapshot[k])]));
  const withdrawalBlocked=health.status==='BLOCKED' || blockers.length>0;
  if(withdrawalBlocked && metrics.safeWithdrawal!==0) metrics.safeWithdrawal=null;
  if(blockers.includes('UNCONFIRMED_OBLIGATION_AMOUNT_MISSING')) {
    metrics.unconfirmedObligations=null;
    metrics.openObligations=null;
  }
  return {
    businessDate:str(snapshot.businessDate),generatedAt:str(snapshot.generatedAt),health,blockers,metrics,withdrawalBlocked,
    scenarios:(pkg?.cashScenario?.forecast?.scenarios || []).filter(s=>['base','conservative','target'].includes(s.name)).map(s=>({
      name:s.name,minimumBalance:num(s.minimumBalance),minimumBalanceDate:str(s.minimumBalanceDate),cashGap:num(s.cashGap),requiredCollection:num(s.requiredCollection),
      daily:(s.daily || []).map(d=>({date:str(d.date),closingBalance:num(d.closingBalance)}))
    })),
    actions:(pkg?.agenda?.actions || []).slice(0,7).map(a=>({id:str(a.id),action:str(a.action),priority:str(a.priority),responsible:str(a.responsible),deadline:str(a.deadline),amount:num(a.amount),overdue:a.overdue===true,blocked:a.executable===false})),
    verification:{pending:num(pkg?.summary?.pendingVerificationCount),overdue:num(pkg?.summary?.overdueVerificationCount)}
  };
}
