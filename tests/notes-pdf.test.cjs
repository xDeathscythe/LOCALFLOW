const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {app}=require('electron');const {printableHtml,exportPdf}=require('../electron/notes/pdf.cjs');
app.whenReady().then(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'localflow-pdf-'));try{
 const payload={title:'Izveštaj 日本語',html:'<h2>Results</h2><p style="text-align:center">Centered report</p><script>throw Error("executed")</script><img src="file:///C:/secret.png"><table><tr><th>Name</th><th>Total</th></tr><tr><td>One</td><td>42</td></tr></table><details><summary>Detail</summary><p>Preserved hidden text</p></details>'};
 const safe=await printableHtml(root,payload);assert(!safe.includes('<script'));assert(!safe.includes('file:///'));assert(safe.includes('text-align:center'));assert(require('linkedom').parseHTML(safe).document.querySelector('details').hasAttribute('open'));
 const file=path.join(root,'test.pdf');await exportPdf(root,payload,file);const data=fs.readFileSync(file);assert.equal(data.subarray(0,5).toString(),'%PDF-');assert(data.length>5000);fs.mkdirSync(path.resolve('output/notes-editing'),{recursive:true});fs.copyFileSync(file,path.resolve('output/notes-editing/pdf-proof.pdf'));console.log('NOTES_PDF_OK');
 }catch(e){console.error(e);app.exitCode=1;}finally{fs.rmSync(root,{recursive:true,force:true});app.exit(app.exitCode||0);}});
