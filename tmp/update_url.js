const fs = require('fs');
const path = 'server/index.js';
let content = fs.readFileSync(path, 'utf8');

// Replace the old Vercel URL with the correct one provided by user
const oldUrl = "https://drawmatrix.vercel.app";
const newUrl = "https://drawmatrixreference.vercel.app";

if (content.includes(oldUrl)) {
  content = content.split(oldUrl).join(newUrl);
  fs.writeFileSync(path, content, 'utf8');
  console.log('✅ Vercel URL successfully updated to drawmatrixreference.vercel.app');
} else {
  console.log('ℹ️ URL update not needed or already applied.');
}
