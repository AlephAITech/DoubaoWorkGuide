// One named Durable Object coordinates quotas across Cloudflare locations.
// Never use an isolate-local Map for a security limit.
export class TrafficGate {
  constructor(state,env) { this.state=state;this.env=env; }
  async fetch(request) {
    const data=await request.json(),now=Date.now();
    const result=await this.state.storage.transaction(async(tx)=>{
      const setting=(key,fallback)=>{const n=Number(this.env[key]);return Number.isSafeInteger(n)&&n>0&&n<=10000000?n:fallback;};
      const bucket=(window,offset=0)=>Math.floor((now+offset)/window);
      const peek=async(key,window,offset=0)=>(await tx.get(`c:${key}:${bucket(window,offset)}`))?.count||0;
      const tick=async(key,window,cap,offset=0)=>{
        const name=`c:${key}:${bucket(window,offset)}`;
        const value=(await tx.get(name))?.count||0;
        if(value>=cap)return cap+1;
        await tx.put(name,{count:value+1,expires:now+window*2});return value+1;
      };
      const reject=async(reason,challenge=false)=>({allowed:false,challenge,reason,sample:await tick(`log:${reason}`,60000,1)===1});
      const action=data.action;
      if(!['request','session','login','event'].includes(action)) return {allowed:false,reason:'invalid'};
      if(action==='request') {
        if(await tick('requests',60000,setting('MAX_REQUESTS_PER_MINUTE',1200))>setting('MAX_REQUESTS_PER_MINUTE',1200)) return reject('request_budget');
        return {allowed:true};
      }
      if(action==='login') {
        if(await tick('login-global',60000,30)>30||await tick(`login:${data.ip}`,900000,10)>10) return reject('login_rate');
        return {allowed:true};
      }
      if(action==='session') {
        const global=await tick('sessions',60000,180);if(global>180)return reject('session_budget');
        const ip=await tick(`session:${data.ip}`,60000,11);
        if(!data.proof&&(global>60||ip>10||data.bot)) return reject('session_challenge',true);
        return {allowed:true};
      }
      const minuteLimit=setting('MAX_EVENTS_PER_MINUTE',300),dayLimit=setting('MAX_EVENTS_PER_DAY',5000);
      const global=await peek('events',60000),daily=await peek('events-day',86400000,8*3600000);
      if(global>=minuteLimit||daily>=dayLimit)return reject('event_budget');
      if(global>=Math.ceil(minuteLimit/2)&&!data.proof)return reject('global_challenge',true);
      const visitor=await tick(`visitor:${data.visitor}`,60000,90),ip=await tick(`ip:${data.ip}`,60000,301);
      if(visitor>90) return reject('visitor_rate');
      if(!data.proof&&(visitor>30||ip>300||data.bot)) return reject('event_challenge',true);
      await tick('events',60000,minuteLimit);await tick('events-day',86400000,dayLimit,8*3600000);
      return {allowed:true,quality:visitor>30||data.bot?'suspicious':'valid'};
    });
    if(!await this.state.storage.getAlarm()) await this.state.storage.setAlarm(now+60000);
    return Response.json(result);
  }
  async alarm() {
    const now=Date.now();const entries=await this.state.storage.list({prefix:'c:'});
    const expired=[...entries].filter(([,v])=>v.expires<now).map(([key])=>key);
    for(let i=0;i<expired.length;i+=128) await this.state.storage.delete(expired.slice(i,i+128));
    if(entries.size>expired.length) await this.state.storage.setAlarm(now+60000);
  }
}
