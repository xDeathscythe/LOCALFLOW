const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'localflow-glass-')));
const {windowAppearance}=require('../electron/appearance.cjs');
const {applyWindowGlass}=require('../electron/windows-glass.cjs');
app.whenReady().then(async()=>{
 const board=new BrowserWindow({title:'Glass color backdrop',width:650,height:520,x:20,y:100,frame:false});
 await board.loadURL('data:text/html,'+encodeURIComponent('<style>body{background:repeating-linear-gradient(90deg,#cc2255 0 80px,#1177cc 80px 160px,#44aa55 160px 240px)}</style>'));
 const focus=new BrowserWindow({title:'Glass focus target',width:240,height:120,x:750,y:150});await focus.loadURL('data:text/html,Focus target');
 const w=new BrowserWindow({title:'LocalFlow Glass Probe',width:650,height:520,x:20,y:100,show:false,transparent:true,titleBarStyle:'hidden',...windowAppearance('dark'),backgroundMaterial:'none'});
 await w.loadURL('data:text/html,'+encodeURIComponent('<style>html,body{margin:0;background:transparent;color:white;font:16px Arial}aside{box-sizing:border-box;width:260px;height:100vh;background:#0000003d;padding:50px 20px}main{position:absolute;left:260px;right:0;top:0;bottom:0;background:#0b0b0b;padding:50px 20px}</style><aside>Glass focus check</aside><main>LocalFlow glass probe</main>'));
 const child=applyWindowGlass(w,true); child.on('exit',code=>console.log('GLASS_APPLIED',code));
 w.show();setTimeout(()=>focus.focus(),12000);setTimeout(()=>app.quit(),180000);
});
