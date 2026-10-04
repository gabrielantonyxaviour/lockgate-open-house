export function downloadAgreement(id: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `lockgate-${id.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)}.txt`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function printAgreement(title: string, text: string, id: string, digest: string, signed: boolean) {
  const popup = window.open('', '_blank', 'width=900,height=800');
  if (!popup) throw new Error('Allow pop-ups to open the printable agreement, then try again.');
  popup.opener = null;
  const doc = popup.document;
  doc.title = title;
  const style = doc.createElement('style');
  style.textContent = '@page{size:A4;margin:20mm}body{max-width:760px;margin:36px auto;color:#222;font:14px/1.7 Georgia,serif;padding:0 20px}header{border-bottom:2px solid #222;padding-bottom:18px;margin-bottom:28px;font:13px/1.6 sans-serif}h1{font:25px Georgia,serif}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}footer{border-top:1px solid #ccc;margin-top:28px;font:10px/1.6 monospace;overflow-wrap:anywhere}button{padding:10px 16px;margin:0 0 20px;cursor:pointer}@media print{body{margin:0;padding:0}button{display:none}}';
  doc.head.append(style);
  const button = doc.createElement('button');
  button.textContent = 'Print / save as PDF';
  button.onclick = () => popup.print();
  const header = doc.createElement('header');
  header.textContent = `Lockgate · ${signed ? 'Wallet signature recorded' : 'Unsigned draft for review'}`;
  const heading = doc.createElement('h1'); heading.textContent = title; header.append(heading);
  const body = doc.createElement('pre'); body.textContent = text;
  const footer = doc.createElement('footer'); footer.textContent = `Document: ${id}\nDigest: ${digest}`;
  doc.body.replaceChildren(button, header, body, footer);
  popup.focus();
  popup.setTimeout(() => popup.print(), 100);
}
