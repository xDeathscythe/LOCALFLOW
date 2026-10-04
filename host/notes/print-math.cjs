const {readFile}=require('node:fs/promises');
const {existsSync}=require('node:fs');
const {join}=require('node:path');

// Embed the existing KaTeX print assets. PDF exports do not fetch fonts from the network.
async function printMathCss(appRoot){
  const bundled=join(appRoot,'assets/print-math'),root=existsSync(bundled)?bundled:join(appRoot,'node_modules/katex/dist');
  let css=await readFile(join(root,'katex.min.css'),'utf8');
  for(const name of new Set([...css.matchAll(/url\(fonts\/([\w.-]+\.woff2)\)/g)].map(match=>match[1]))){
    const bytes=await readFile(join(root,'fonts',name));css=css.replaceAll(`url(fonts/${name})`,`url(data:font/woff2;base64,${bytes.toString('base64')})`);
  }
  return css;
}
module.exports={printMathCss};
