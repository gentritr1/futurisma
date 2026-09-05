import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {transformWithOxc} from 'vite';
const cache=new Map();
export async function sourceModule(name) {
 if(cache.has(name))return cache.get(name);
 const file=new URL('../../../src/game/'+name,import.meta.url);
 let {code}=await transformWithOxc(await readFile(file,'utf8'),file.pathname);
 const imports=[...code.matchAll(/import\s+([\s\S]*?)\s+from\s+"([^"]+)";/g)];
 for(const [statement,binding,specifier] of imports){
  if(specifier.endsWith('.json')){code=code.replace(statement,`const ${binding} = ${await readFile(new URL(specifier,file),'utf8')};`);continue;}
  let target;
  if(specifier==='three'||specifier.startsWith('three/'))target=import.meta.resolve(specifier);
  else if(specifier.startsWith('./')){
   const relative=specifier.slice(2);
   target=specifier.endsWith('.js')?new URL(specifier,file).href:existsSync(new URL(specifier+'.js',file))?new URL(specifier+'.js',file).href:await sourceModule(relative+'.ts');
  }else throw Error('Unresolved '+specifier);
  code=code.replace(statement,statement.replace('"'+specifier+'"',JSON.stringify(target)));
 }
 const url='data:text/javascript;base64,'+Buffer.from(code).toString('base64');cache.set(name,url);return url;
}
