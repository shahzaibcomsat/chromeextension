self.onmessage=event=>{
 try {
  const expression=new RegExp(String(event.data.pattern).slice(0,1000),'gu');
  const text=String(event.data.text).slice(0,20000);const matches=[];
  for(const match of text.matchAll(expression)){matches.push(match[0]);if(matches.length===300)break;}
  self.postMessage({matches});
 }catch(error){self.postMessage({error:error.message});}
};
