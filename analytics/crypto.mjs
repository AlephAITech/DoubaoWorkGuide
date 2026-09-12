import { isIP } from 'node:net';

const enc = new TextEncoder();
const encode = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode = (value) => Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export const randomToken = () => encode(crypto.getRandomValues(new Uint8Array(32)));
async function hmacKey(secret) { return crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']); }
export async function fingerprint(purpose,value,secret) {
  const hash=await crypto.subtle.sign('HMAC',await hmacKey(secret),enc.encode(`${purpose}\0${value}`));
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function signToken(payload,secret) {
  const body=encode(enc.encode(JSON.stringify(payload)));
  return `${body}.${encode(await crypto.subtle.sign('HMAC',await hmacKey(secret),enc.encode(body)))}`;
}
export async function readToken(token,secret,purpose,now=Date.now()) {
  try {
    if(typeof token!=='string'||token.length>2048) return null;
    const parts=token.split('.'); if(parts.length!==2) return null;
    const [body,sig]=parts;
    if(!await crypto.subtle.verify('HMAC',await hmacKey(secret),decode(sig),enc.encode(body))) return null;
    const value=JSON.parse(new TextDecoder().decode(decode(body)));
    return value.type===purpose && Number.isSafeInteger(value.exp) && value.exp>now ? value : null;
  } catch { return null; }
}

// Workers Web Crypto caps PBKDF2 at 100k iterations. The provisioning tool requires
// a generated 256-bit password; no user-selected or short password is provisioned.
export async function hashPassword(password) {
  if(typeof password!=='string'||password.length<24||password.length>256) throw new Error('Password must contain 24–256 characters');
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);
  return `pbkdf2:100000:${encode(salt)}:${encode(bits)}`;
}
export async function verifyPassword(password,stored) {
  try {
    if(typeof password!=='string'||!password||password.length>256) return false;
    const [type,iterations,salt,expected,...extra]=stored.split(':');
    if(type!=='pbkdf2'||iterations!=='100000'||extra.length||decode(salt).length!==16||decode(expected).length!==32) return false;
    const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
    const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:decode(salt),iterations:100000,hash:'SHA-256'},key,256);
    const actual=new Uint8Array(bits),want=decode(expected); let diff=0;
    for(let i=0;i<actual.length;i++) diff|=actual[i]^want[i];
    return diff===0;
  } catch { return false; }
}
async function encryptionKey(secret) {
  const digest=await crypto.subtle.digest('SHA-256',enc.encode(secret));
  return crypto.subtle.importKey('raw',digest,'AES-GCM',false,['encrypt','decrypt']);
}
export async function encryptIP(ip,secret) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(secret),enc.encode(ip));
  return `${encode(iv)}.${encode(cipher)}`;
}
export async function decryptIP(value,secret) {
  const [iv,cipher]=value.split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv)},await encryptionKey(secret),decode(cipher)));
}
export function canonicalIP(ip) {
  if(typeof ip!=='string'||!isIP(ip)||ip.includes('%')) return null;
  if(isIP(ip)===4) return ip;
  const normal=new URL(`http://[${ip}]/`).hostname.slice(1,-1).toLowerCase();
  const mapped=normal.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if(mapped) { const a=parseInt(mapped[1],16),b=parseInt(mapped[2],16); return `${a>>8}.${a&255}.${b>>8}.${b&255}`; }
  return normal;
}
export function maskedIP(ip) {
  return ip.includes(':') ? `${ip.split(':').slice(0,2).join(':')}:…` : `${ip.split('.').slice(0,3).join('.')}.*`;
}
