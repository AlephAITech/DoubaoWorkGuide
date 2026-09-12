export const DAY=86400000;
export const shanghaiDay = (date=new Date()) => new Date(date.getTime()+8*3600000).toISOString().slice(0,10);
export const dayStart = (day) => new Date(`${day}T00:00:00+08:00`);
export const shiftDay = (day,offset) => shanghaiDay(new Date(dayStart(day).getTime()+offset*DAY));
export function parseRange(from,to,now=new Date()) {
  const today=shanghaiDay(now); to=to||today; from=from||shiftDay(to,-6);
  for(const value of [from,to]) if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(dayStart(value).getTime())||shanghaiDay(dayStart(value))!==value) throw new Error('日期格式不正确');
  if(from>to||to>today||from<shiftDay(today,-89)) throw new Error('请选择近 90 天内的有效日期范围');
  return {from,to};
}
const rows = async (query) => (await query.all()).results||[];
export class AnalyticsStore {
  constructor(db) { this.db=db; }
  async record(e) {
    const result=await this.db.prepare('INSERT OR IGNORE INTO page_events(id,occurred_at,day,page,visitor_key,ip_key,quality,referrer,country,device) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .bind(e.id,e.time,e.day,e.page,e.visitor,e.ip,e.quality,e.referrer,e.country,e.device).run();
    return result.meta.changes>0;
  }
  async saveIP({key,masked,encrypted,time}) {
    return this.db.prepare('INSERT INTO ip_details(key,masked,encrypted,last_seen) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET encrypted=excluded.encrypted,last_seen=excluded.last_seen')
      .bind(key,masked,encrypted,time).run();
  }
  async ip(key,now=Date.now()) {
    const value=await this.db.prepare('SELECT encrypted,last_seen FROM ip_details WHERE key=?').bind(key).first();
    return value?.encrypted && Date.parse(value.last_seen)>now-7*DAY ? value : null;
  }
  async createSession(digest,csrf,expiry) { await this.db.prepare('INSERT INTO admin_sessions(digest,csrf,expires_at) VALUES(?,?,?)').bind(digest,csrf,expiry).run(); }
  async session(digest,now=Date.now()) { return this.db.prepare('SELECT csrf,expires_at FROM admin_sessions WHERE digest=? AND expires_at>?').bind(digest,now).first(); }
  async revokeSession(digest) { await this.db.prepare('DELETE FROM admin_sessions WHERE digest=?').bind(digest).run(); }
  async security(kind,detail,time=new Date().toISOString()) { await this.db.prepare('INSERT INTO security_events(occurred_at,kind,detail) VALUES(?,?,?)').bind(time,kind,String(detail).slice(0,300)).run(); }
  async report({from,to},now=new Date()) {
    const where='day>=? AND day<=?';
    const ipDetailCutoff=new Date(now.getTime()-7*DAY).toISOString();
    const group=async(column)=>rows(this.db.prepare(`SELECT ${column} AS name,COUNT(*) AS count FROM page_events WHERE ${where} AND quality='valid' GROUP BY ${column} ORDER BY count DESC LIMIT 20`).bind(from,to));
    const [totals,distinct,daily,pages,referrers,countries,devices,ips,security,total]=await Promise.all([
      this.db.prepare(`SELECT COALESCE(SUM(pv),0) AS pv,COALESCE(SUM(valid_pv),0) AS validPv FROM traffic_daily WHERE ${where}`).bind(from,to).first(),
      this.db.prepare(`SELECT COUNT(DISTINCT visitor_key) AS uv,COUNT(DISTINCT ip_key) AS ips FROM page_events WHERE ${where} AND quality='valid'`).bind(from,to).first(),
      rows(this.db.prepare(`SELECT day AS date,COUNT(*) AS pv,SUM(quality='valid') AS validPv,COUNT(DISTINCT CASE WHEN quality='valid' THEN visitor_key END) AS uv,COUNT(DISTINCT CASE WHEN quality='valid' THEN ip_key END) AS ips FROM page_events WHERE ${where} GROUP BY day ORDER BY day`).bind(from,to)),
      rows(this.db.prepare(`SELECT page,COUNT(*) AS pv,COUNT(DISTINCT visitor_key) AS uv FROM page_events WHERE ${where} AND quality='valid' GROUP BY page ORDER BY pv DESC LIMIT 100`).bind(from,to)),
      group('referrer'),group('country'),group('device'),
      rows(this.db.prepare(`SELECT e.ip_key AS key,COALESCE(i.masked,'已脱敏') AS masked,COUNT(*) AS pv,COUNT(DISTINCT e.visitor_key) AS visitors,MAX(e.occurred_at) AS lastSeen,MIN(e.country) AS country,SUM(e.quality='suspicious') AS suspicious FROM page_events e LEFT JOIN ip_details i ON i.key=e.ip_key WHERE e.day>=? AND e.day<=? AND e.occurred_at>? GROUP BY e.ip_key ORDER BY pv DESC LIMIT 100`).bind(from,to,ipDetailCutoff)),
      rows(this.db.prepare('SELECT occurred_at AS time,kind,detail FROM security_events WHERE occurred_at>=? AND occurred_at<? ORDER BY occurred_at DESC LIMIT 100').bind(dayStart(from).toISOString(),dayStart(shiftDay(to,1)).toISOString())),
      this.db.prepare('SELECT pv,started_at FROM traffic_total WHERE id=1').first(),
    ]);
    const days=new Map(daily.map(row=>[row.date,row]));
    const complete=[]; for(let date=from;date<=to;date=shiftDay(date,1)) complete.push(days.get(date)||{date,pv:0,validPv:0,uv:0,ips:0});
    return {range:{from,to},summary:{...totals,...distinct,suspicious:totals.pv-totals.validPv,totalPv:total?.pv||0},daily:complete,pages,referrers,countries,devices,ips,security,ipDetailCutoff,collectionStartedAt:total?.started_at||null};
  }
  async history() { return rows(this.db.prepare('SELECT day AS date,pv,valid_pv AS validPv FROM traffic_daily ORDER BY day')); }
  async cleanup(now=new Date()) {
    const today=shanghaiDay(now),month=new Date(dayStart(today));month.setUTCFullYear(month.getUTCFullYear()-1);
    await this.db.batch([
      this.db.prepare('DELETE FROM page_events WHERE day<?').bind(shiftDay(today,-89)),
      this.db.prepare('DELETE FROM traffic_daily WHERE day<?').bind(shanghaiDay(month)),
      this.db.prepare('UPDATE ip_details SET encrypted=NULL WHERE last_seen<? AND encrypted IS NOT NULL').bind(new Date(now.getTime()-7*DAY).toISOString()),
      this.db.prepare('DELETE FROM ip_details WHERE last_seen<?').bind(dayStart(shiftDay(today,-89)).toISOString()),
      this.db.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').bind(now.getTime()),
      this.db.prepare('DELETE FROM security_events WHERE occurred_at<?').bind(dayStart(shiftDay(today,-89)).toISOString()),
    ]);
  }
}
export function csv(data) {
  return '\uFEFF'+data.map(row=>row.map(value=>{
    let str=String(value??''); if(/^[\s]*[=+@\-\t\r]/.test(str)) str="'"+str;
    return `"${str.replaceAll('"','""')}"`;
  }).join(',')).join('\r\n');
}
