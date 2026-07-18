import fs from 'node:fs/promises';
import crypto from 'node:crypto';
function canonicalize(v){if(Array.isArray(v))return `[${v.map(canonicalize).join(',')}]`;if(v&&typeof v==='object')return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonicalize(v[k])}`).join(',')}}`;return JSON.stringify(v);}
const [,, mf, kf] = process.argv;
if(!mf||!kf){console.error('Usage: node scripts/verify-capsule.mjs <capsule.json> <public-key.pem>');process.exit(2);}
const m = JSON.parse(await fs.readFile(mf,'utf-8'));
const pub = await fs.readFile(kf,'utf-8');
const sig = m.signature; const u = {...m}; delete u.signature;
const ok = sig && sig.algorithm==='ed25519' && crypto.verify(null, Buffer.from(canonicalize(u)), pub, Buffer.from(sig.value,'base64'));
if(!ok){console.error('Capsule verification FAILED:', mf);process.exit(1);}
console.log(`Capsule verified: ${m.productName} ${m.version}`);
