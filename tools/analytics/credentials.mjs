import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, randomToken } from '../../analytics/crypto.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const mode=process.argv.includes('--production')?'production':process.argv.includes('--preview')?'preview':'local';
const directory=resolve(root,'.secrets');await mkdir(directory,{recursive:true,mode:0o700});
const secretsFile=resolve(directory,`${mode}-secrets.json`),loginFile=resolve(directory,`${mode}-login.txt`);
try {await access(secretsFile);console.log(`凭据已存在，未覆盖：${loginFile}`);process.exit(0);}catch{}
const password=randomToken();
const secrets={ADMIN_USERNAME:'admin',ADMIN_PASSWORD_HASH:await hashPassword(password),SIGNING_KEY:randomToken(),IP_ENCRYPTION_KEY:randomToken()};
await writeFile(secretsFile,JSON.stringify(secrets,null,2)+'\n',{mode:0o600,flag:'wx'});
const environmentName={local:'仅本地开发',preview:'独立云端预览',production:'正式环境'}[mode];
const address={local:'http://localhost:8787/admin/analytics',preview:'部署后使用该独立 Worker 的 /admin/analytics 地址。',production:'https://doubaowork.homes/admin/analytics'}[mode];
await writeFile(loginFile,`豆包统计后台（${environmentName}）\n账号：admin\n密码：${password}\n\n此文件禁止提交、截图、发到公开聊天或放入部署包。\n地址：${address}\nCloudflare secrets 文件仅含密码哈希，不含此明文密码。\n`,{mode:0o600,flag:'wx'});
if(mode==='local')await writeFile(resolve(root,'.dev.vars'),Object.entries(secrets).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n',{mode:0o600,flag:'wx'});
console.log(`已生成凭据。请在本地打开：${loginFile}\nSecrets 文件：${secretsFile}\n密码未输出到终端。`);
