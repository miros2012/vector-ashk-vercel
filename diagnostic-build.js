const BASE='https://app.dscontrol.ru';
const names=[
'DriveWalletOperationList','WalletOperationList','WalletOperations','WalletHistory','WalletMovementList','WalletMovements','WalletBalanceOperationList','WalletTransactionList','WalletTransactions','DriveWalletList','DriveWalletHistory','DriveWalletMovementList','DriveWalletTransactionList',
'DriveSessionList','DriveSessions','DriveSessionExternalList','DriveSessionHistory','DriveSessionJournal','DriveSessionReport','DriveSessionOperationList','DriveScheduleList','DriveSchedule','DriveJournal','DriveHistory',
'OLAP','Olap','OlapReport','OLAPReport','ReportOlap','ReportOLAP','DriveOlap','DriveOLAP','DriveReport','DriveStatistics','DriveStats','WalletReport','BalanceReport','DriveBalanceReport'
];
const results=[];
for(const name of names){
  try{
    const url=`${BASE}/api/${name}`;
    const r=await fetch(url,{headers:{api_key:process.env.ASHK_API_KEY,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'},redirect:'manual'});
    const text=(await r.text()).slice(0,240).replace(/\s+/g,' ');
    results.push({name,status:r.status,contentType:r.headers.get('content-type'),body:text});
  }catch(e){results.push({name,error:String(e?.message||e)});}
}
console.log('ASHK_ENDPOINT_PROBE_OK',JSON.stringify(results));
