import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, rm, readFile, appendFile, realpath, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const target=resolve(root,'.work/analytics/assets'),site=await realpath(resolve(root,'site'));
const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z','site'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
let count=0,bytes=0;
for(const path of [...new Set(paths)]) {
  const source=await realpath(resolve(root,path));if(!source.startsWith(site+'/'))throw new Error('Refusing asset outside site directory');
  const size=(await stat(source)).size;if(size>25*1024*1024)throw new Error(`Asset exceeds 25 MiB: ${path}`);
  const dest=resolve(target,path.slice(5));await mkdir(dirname(dest),{recursive:true});await copyFile(source,dest);count++;bytes+=size;
}
await appendFile(resolve(target,'_headers'),'\n# Preview only: exclude this independent copy from search indexes\n/*\n  X-Robots-Tag: noindex, nofollow\n');
const app=await readFile(resolve(target,'js/app.js'),'utf8');
if(!app.includes('trackRenderedPage'))throw new Error('Preview missing analytics integration');
console.log(JSON.stringify({assets:count,bytes,directory:target}));
