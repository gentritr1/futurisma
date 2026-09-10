/** Run the unchanged npm suite on a byte-identical temporary snapshot.
 * Several validators write historical evidence paths unconditionally; their
 * writes must not overwrite Phase C or another map in the shared worktree. */
import {execFileSync,spawn} from 'node:child_process';
import {mkdtemp,mkdir,copyFile,symlink,readFile,writeFile,cp,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
const root=process.cwd(),out=path.join(root,'art/evidence/dreamisland-v1/polish/test-code');await mkdir(out,{recursive:true});
const reuse=process.argv.find(a=>a.startsWith('--snapshot='))?.slice(11);
const snapshot=reuse??await mkdtemp(path.join(os.tmpdir(),'dream-island-polish-tests-'));
const gitDirectory=execFileSync('git',['rev-parse','--absolute-git-dir'],{cwd:root,encoding:'utf8'}).trim();
const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean),hashes={};
for(const file of files){
 const source=path.join(root,file),target=path.join(snapshot,file);
 try{if(!(await stat(source)).isFile())continue;}catch{continue;}
 await mkdir(path.dirname(target),{recursive:true});
 if(!reuse||!(await readFile(target).catch(()=>Buffer.alloc(0))).equals(await readFile(source)))await copyFile(source,target);
 if(/^(src\/|scripts\/|package|tsconfig|vite|public\/assets\/dreamisland\/)/.test(file)){
  const a=await readFile(source),b=await readFile(target);if(!a.equals(b))throw Error('Snapshot differs: '+file);
  hashes[file]=createHash('sha256').update(a).digest('hex');
 }
}
if(!reuse)await symlink(path.join(root,'node_modules'),path.join(snapshot,'node_modules'),'dir');
const child=spawn('npm',['run','test:code'],{cwd:snapshot,env:{...process.env,GIT_DIR:gitDirectory,GIT_WORK_TREE:snapshot,GIT_OPTIONAL_LOCKS:'0'},stdio:['ignore','pipe','pipe']});
let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log+=b;process.stdout.write(b);});
const code=await new Promise(resolve=>child.on('close',resolve));
await writeFile(path.join(out,'npm-test-code.log'),log);
const generated=path.join(snapshot,'art/evidence/dreamisland-v1/phase-c');
for(const directory of ['validators','skies'])try{await cp(path.join(generated,directory),path.join(out,directory),{recursive:true});}catch{}
const report={command:'npm run test:code',cwd:snapshot,exitCode:code,sourceWorktree:root,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),verifiedSnapshotHashes:hashes,gitDirectory,gitUse:'Read-only git ls-files in security/soundtrack uses the original index; GIT_WORK_TREE is the snapshot and optional locks are disabled.',note:'Tracked files copied from the current worktree including uncommitted edits. Node dependencies reused by symlink. The unchanged suite writes only inside this temporary snapshot; its Dream Island outputs and log are copied into polish evidence.'};
await writeFile(path.join(out,'test-code.json'),JSON.stringify(report,null,2)+'\n');
process.exitCode=code??1;
