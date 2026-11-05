import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export const root=fileURLToPath(new URL('../',import.meta.url));
export async function bundle(){
  await mkdir(new URL('../dist/',import.meta.url),{recursive:true});
  await build({absWorkingDir:root,entryPoints:{app:'src/main.ts',preview:'src/preview.ts',builder:'src/builder.ts'},bundle:true,outdir:'dist',platform:'browser',format:'esm',target:'es2022',minify:true,metafile:true,
    plugins:[{name:'server-boundary',setup(builder){builder.onResolve({filter:/marketplace\/(index|vault|auth|payment|http)\.ts$|^node:/},()=>({errors:[{text:'Server-only code cannot enter the frontend'}]}));}}]});
  for(const file of ['index.html','favicon.svg'])await copyFile(new URL('../'+file,import.meta.url),new URL('../dist/'+file,import.meta.url));
  await copyFile(new URL('../src/style.css',import.meta.url),new URL('../dist/app.css',import.meta.url));
}
if(process.argv[1]===fileURLToPath(import.meta.url))await bundle();
