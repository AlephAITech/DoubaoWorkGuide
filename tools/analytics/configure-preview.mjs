import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function configure(base,{accountId,databaseId,host,siteKey}) {
  if(!/^[a-f0-9]{32}$/.test(accountId||''))throw new Error('需要 Cloudflare account ID');
  if(!/^[a-f0-9-]{36}$/.test(databaseId||'')||databaseId.startsWith('00000000-'))throw new Error('需要独立预览 D1 的真实 database ID');
  if(!/^doubao-analytics-preview\.[a-z0-9-]+\.workers\.dev$/.test(host||''))throw new Error('只允许独立 doubao-analytics-preview.*.workers.dev 主机，禁止正式域名');
  if(!/^[A-Za-z0-9_-]{20,100}$/.test(siteKey||'')||/^[123]x0{18,}/.test(siteKey))throw new Error('需要真实 Turnstile site key，禁止测试密钥');
  const config=structuredClone(base);delete config.routes;delete config.env;
  config.account_id=accountId;config.vars.ENVIRONMENT='preview';delete config.vars.LOCAL_TEST;
  config.vars.ALLOWED_HOSTS=host;config.vars.TURNSTILE_SITE_KEY=siteKey;
  config.d1_databases[0].database_id=databaseId;
  return config;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
  const args=Object.fromEntries(Array.from({length:Math.floor((process.argv.length-2)/2)},(_,i)=>[process.argv[2+i*2].replace(/^--/,''),process.argv[3+i*2]]));
  const base=JSON.parse(await readFile(resolve(root,'wrangler.analytics.jsonc'),'utf8'));
  const config=configure(base,{accountId:args['account-id'],databaseId:args['database-id'],host:args.host,siteKey:args['site-key']});
  const path=resolve(root,'wrangler.analytics.preview.json');await writeFile(path,JSON.stringify(config,null,2)+'\n');
  console.log(`预览配置已生成：${path}\n不会创建或修改正式域名路由。`);
}
