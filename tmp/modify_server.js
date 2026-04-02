const fs = require('fs');
const path = 'server/index.js';
let content = fs.readFileSync(path, 'utf8');

if (!content.includes("const dns = require('dns');")) {
  const dnsFix = `const dns = require('dns');
if (dns && dns.setServers) {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
}
`;
  content = dnsFix + content;
  fs.writeFileSync(path, content, 'utf8');
  console.log('✅ DNS override successfully prepended to server/index.js');
} else {
  console.log('ℹ️ DNS override already exists.');
}
