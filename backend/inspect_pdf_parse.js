const { PDFParse } = require('pdf-parse');
console.log('PDFParse is constructor:', typeof PDFParse);
// Create a fake 1-page PDF buffer or try to instantiate
try {
  const parser = new PDFParse(Buffer.from([]));
  console.log('Instantiated successfully');
  console.log('Parser properties:', Object.getOwnPropertyNames(Object.getPrototypeOf(parser)));
} catch (err) {
  console.error('Error during instantiation:', err);
}
