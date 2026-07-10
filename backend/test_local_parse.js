const fs = require('fs');
const path = require('path');

// We need to use the customized pdf-parse from the backend node_modules
const backendNodeModules = 'C:\\Users\\Geisi\\.gemini\\antigravity\\scratch\\woodflow-erp\\backend\\node_modules';
const { PDFParse } = require(path.join(backendNodeModules, 'pdf-parse'));

async function main() {
  const pdfPath = 'C:\\Users\\Geisi\\Downloads\\Aliana e Luiz.pdf';
  console.log('Reading PDF:', pdfPath);
  const buffer = fs.readFileSync(pdfPath);
  console.log('File size:', buffer.length, 'bytes');
  const uint8 = new Uint8Array(buffer);
  
  const parser = new PDFParse(uint8);
  console.log('Parsing text...');
  const result = await parser.getText();
  console.log('Text extracted successfully!');
  console.log('Text length:', result.text.length, 'characters');
  console.log('--- FIRST 1500 CHARACTERS ---');
  console.log(result.text.substring(0, 1500));
  console.log('-----------------------------');
}

main().catch(err => {
  console.error('Error parsing PDF:', err);
});
