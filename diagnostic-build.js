const BASE='https://app.dscontrol.ru';
const names=['DriveWalletOperationList','WalletOperationList','WalletOperations','WalletHistory','WalletMovementList','WalletMovements','WalletBalanceOperationList','WalletTransactionList','WalletTransactions','DriveWalletList','DriveWalletHistory','DriveWalletMovementList','DriveWalletTransactionList','DriveSessionList','DriveSessions','DriveSessionExternalList','DriveSessionHistory','DriveSessionJournal','DriveSessionReport','DriveSessionOperationList','DriveScheduleList','DriveSchedule','DriveJournal','DriveHistory','OLAP','Olap','OlapReport','OLAPReport','ReportOlap','ReportOLAP','DriveOlap','DriveOLAP','DriveReport','DriveStatistics','DriveStats','WalletReport','BalanceReport','DriveBalanceReport'];
const recognized=[];
for(const name of names){
  try{
    const r=await fetch(`${BASE}/api/${name}`,{headers:{api_key:process.env.ASHK_API_KEY,'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json'},redirect:'manual'});
    const text=(await r.text()).replace(/\s+/g,' ');
    if(!/Invalid command name|Unknown API call/i.test(text)) recognized.push({name,status:r.status,body:text.slice(0,500)});
  }catch(e){recognized.push({name,error:String(e?.message||e)});}
}
console.log('ASHK_ENDPOINT_RECOGNIZED',JSON.stringify(recognized));
