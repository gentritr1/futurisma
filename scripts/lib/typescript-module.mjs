import {readFile} from 'node:fs/promises';
import {transformWithOxc} from 'vite';

/** Small acyclic leaf-module compiler for Node 20 validators. Uses the project's
 * own Vite transformer instead of Node's newer experimental strip-types flag.
 */
const compiled=new Map();
export async function typescriptModuleUrl(url) {
 if(compiled.has(url.href))return compiled.get(url.href);
 let {code}=await transformWithOxc(await readFile(url,'utf8'),url.pathname);
 for(const match of [...code.matchAll(/from ["']([^"']+)["']/g)]) {
  const specifier=match[1];let resolved;
  if(specifier.startsWith('.')) {
   const dependency=new URL(specifier,url);
   if(dependency.pathname.endsWith('.js'))resolved=dependency.href;
   else resolved=await typescriptModuleUrl(new URL(dependency.href+(dependency.pathname.endsWith('.ts')?'':'.ts')));
  }else resolved=import.meta.resolve(specifier);
  code=code.replace(match[0],`from ${JSON.stringify(resolved)}`);
 }
 const result=`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;compiled.set(url.href,result);return result;
}
