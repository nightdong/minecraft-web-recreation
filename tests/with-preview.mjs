import { spawn } from 'node:child_process';
import net from 'node:net';

// Run one or more real browser suites against the current built dist. The
// temporary listener belongs solely to this process and is always closed.
const suites=process.argv.slice(2);if(!suites.length)throw new Error('Provide at least one browser test path');
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const url=`http://127.0.0.1:${port}`,server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'pipe'});
try{
  let ready=false;
  for(let i=0;i<60;i++){try{const response=await fetch(url);const html=await response.text();if(response.ok&&html.includes('/assets/')){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!ready)throw new Error('Production preview did not start');
  console.log(`Actual built-dist browser target: ${url}`);
  for(const file of suites){const code=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,[file],{env:{...process.env,GAME_URL:url},stdio:'inherit'});p.once('error',reject);p.once('exit',resolve);});if(code!==0){process.exitCode=code||1;break;}}
}finally{await new Promise(resolve=>{const timer=setTimeout(resolve,3000);server.once('exit',()=>{clearTimeout(timer);resolve();});server.kill();});}
