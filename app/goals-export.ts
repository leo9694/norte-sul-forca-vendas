import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
const escapeXml=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
function column(index:number){let name='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;}
export function goalsWorkbook(rows:(string|number)[][]){
  const sheet=`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row,i)=>`<row r="${i+1}">${row.map((v,j)=>typeof v==='number'&&Number.isFinite(v)?`<c r="${column(j)}${i+1}"><v>${v}</v></c>`:`<c r="${column(j)}${i+1}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  return zipSync({'[Content_Types].xml':strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    '_rels/.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml':strToU8('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Metas" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml':strToU8(sheet)},{level:6});
}
export function readGoalsWorkbook(bytes:Uint8Array):string[][]{
  if(bytes.length>5_000_000)throw Error('A planilha deve ter no máximo 5 MB.');
  let total=0;const files=unzipSync(bytes,{filter:entry=>{total+=entry.originalSize;if(total>20_000_000)throw Error('Planilha muito grande.');return /^(xl\/(worksheets\/sheet1|sharedStrings)\.xml)$/.test(entry.name);}});
  const parse=(name:string)=>{const xml=files[name];if(!xml)return null;const text=strFromU8(xml);if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('Arquivo XML não permitido.');const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw Error('Planilha inválida.');return doc;};
  const strings=Array.from(parse('xl/sharedStrings.xml')?.getElementsByTagName('si')||[]).map(node=>Array.from(node.getElementsByTagName('t')).map(n=>n.textContent||'').join(''));
  const sheet=parse('xl/worksheets/sheet1.xml');if(!sheet)throw Error('Não foi encontrada a primeira planilha.');
  const rows=Array.from(sheet.getElementsByTagName('row'));if(rows.length>501)throw Error('Importe no máximo 500 vendedores.');
  return rows.map(row=>{const result:string[]=[];for(const c of Array.from(row.getElementsByTagName('c'))){const address=c.getAttribute('r')||'',letters=address.match(/^[A-Z]+/)?.[0]||'A';let index=0;for(const l of letters)index=index*26+l.charCodeAt(0)-64;index--;if(index>100)throw Error('Máximo de 100 colunas.');const value=c.getElementsByTagName('v')[0]?.textContent||'';result[index]=c.getAttribute('t')==='s'?(strings[Number(value)]||''):c.getAttribute('t')==='inlineStr'?Array.from(c.getElementsByTagName('t')).map(n=>n.textContent||'').join(''):value;}return result;});
}
export function downloadGoalsExcel(rows:(string|number)[][],name:string){const bytes=goalsWorkbook(rows),url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const link=document.createElement('a');link.href=url;link.download=name+'.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function downloadGoalsPdf(title:string,headers:string[],rows:(string|number)[][]){
  const {jsPDF}=await import('jspdf'),pdf=new jsPDF({orientation:'landscape'});let y=18;const width=277/headers.length;
  const heading=()=>{pdf.setFontSize(14);pdf.text(title,10,12);pdf.setFontSize(8);headers.forEach((h,i)=>pdf.text(pdf.splitTextToSize(h,width-3),10+i*width,22));y=32;};heading();
  for(const row of rows){if(y>185){pdf.addPage();heading();}let height=10;const lines=row.map(v=>pdf.splitTextToSize(String(v),width-3));for(const line of lines)height=Math.max(height,line.length*4+3);if(y+height>200){pdf.addPage();heading();}lines.forEach((line,i)=>pdf.text(line,10+i*width,y));pdf.setDrawColor(220);pdf.line(10,y+height-5,287,y+height-5);y+=height;}
  pdf.save('metas.pdf');
}
