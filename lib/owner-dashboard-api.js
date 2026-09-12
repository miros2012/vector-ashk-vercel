import { equalSecret, validSecret, issueSession, verifySession, sessionCookie, requestSession } from './owner-dashboard-session.js';
import { ownerDashboardView } from './owner-dashboard-view-model.js';
import { firstRequestQueryValue } from './request-query.js';
function sameOrigin(req) {
  const origin=req.headers?.origin;
  const host=req.headers?.host;
  return typeof origin==='string' && typeof host==='string' && origin===`https://${host}`;
}
export function createOwnerDashboardApi({secret,readPackage,now=Date.now}) {
  return async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    const session=firstRequestQueryValue(req,'ownerRoute')==='dashboard-session';
    const allowed=session ? ['POST','DELETE'] : ['GET'];
    if(!allowed.includes(req.method)) {res.setHeader('Allow',allowed.join(', '));return res.status(405).json({ok:false,error:'method_not_allowed'});}
    if(session && !sameOrigin(req)) return res.status(403).json({ok:false,error:'forbidden'});
    if(session && req.method==='DELETE') {res.setHeader('Set-Cookie',sessionCookie('',0));return res.status(200).json({ok:true});}
    if(!validSecret(secret)) return res.status(503).json({ok:false,error:'authentication_unavailable'});
    if(session) {
      let body=req.body;
      if(typeof body==='string') {if(body.length>2048)return res.status(400).json({ok:false,error:'invalid_request'});try{body=JSON.parse(body);}catch{return res.status(400).json({ok:false,error:'invalid_request'});}}
      if(!equalSecret(body?.secret,secret)) return res.status(403).json({ok:false,error:'forbidden'});
      res.setHeader('Set-Cookie',sessionCookie(issueSession(secret,now())));
      return res.status(200).json({ok:true});
    }
    if(!verifySession(requestSession(req),secret,now()))return res.status(401).json({ok:false,error:'authentication_required'});
    try {return res.status(200).json({ok:true,dashboard:ownerDashboardView(await readPackage())});}
    catch {return res.status(503).json({ok:false,error:'owner_data_unavailable'});}
  };
}
