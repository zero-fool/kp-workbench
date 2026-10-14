const fs = require('fs');
function colToNum(c){let n=0;for(const ch of c)n=n*26+(ch.charCodeAt(0)-64);return n;}
function parse(f){
  const xml=fs.readFileSync(f,'utf8');
  const rows=[...xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)];
  const out=[];
  for(const [,rn,body] of rows){
    const cells=[];
    const cs=[...body.matchAll(/<c[^>]*r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)];
    for(const [,col,attrs,inner] of cs){
      const m=inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
      let v=m?m[1]:'';
      v=v.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&#10;/g,'\n').replace(/&quot;/g,'"');
      const idx=colToNum(col)-1;
      cells[idx]=v;
    }
    out.push([rn,cells]);
  }
  return out;
}
for(const s of process.argv.slice(2)){
  console.log('\n===== '+s+' =====');
  for(const [rn,cells] of parse(s)){
    const line=(cells||[]).map((x,i)=>`[${i}]${x}`).filter(x=>!/^\[\d+\]$/.test(x));
    if(line.length) console.log('R'+rn+' :: '+line.join(' | '));
  }
}
