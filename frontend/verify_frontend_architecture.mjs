import fs from 'fs';
import path from 'path';

const FRONTEND_DIR = path.resolve(process.cwd(), 'src');

const REQUIRED_FILES = [
  'widgets/layout/ApplicantLayout.tsx',
  'pages/Dashboard.tsx'
];

let failed = false;

console.log('=== Running Frontend Architectural Verification ===\\n');

// 1. Check required FSD files
for (const file of REQUIRED_FILES) {
  const fullPath = path.join(FRONTEND_DIR, file);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Missing Required File: ${file} (Spec §5.2)`);
    failed = true;
  } else {
    console.log(`✅ Found: ${file}`);
  }
}

// 2. Check nav-registry.ts for citizen destinations
const navRegistryPath = path.join(FRONTEND_DIR, 'widgets/navigation/nav-registry.ts');
if (fs.existsSync(navRegistryPath)) {
  const content = fs.readFileSync(navRegistryPath, 'utf8');
  if (!content.includes('Dashboard') || !content.includes('/loans')) {
    console.error(`❌ nav-registry.ts does not contain the citizen destinations (Spec §5.3)`);
    failed = true;
  } else {
    console.log(`✅ nav-registry.ts contains citizen destinations.`);
  }
} else {
  console.error(`❌ nav-registry.ts is completely missing!`);
  failed = true;
}

// 3. Check for hardcoded is_underwriter
let isUnderwriterFound = false;
function checkIsUnderwriter(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      checkIsUnderwriter(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('is_underwriter') && !fullPath.includes('types.ts')) {
        console.error(`❌ Hardcoded role check 'is_underwriter' found in: ${fullPath.replace(FRONTEND_DIR, '')}`);
        isUnderwriterFound = true;
        failed = true;
      }
    }
  }
}
checkIsUnderwriter(FRONTEND_DIR);
if (!isUnderwriterFound) {
  console.log(`✅ No 'is_underwriter' hardcoded checks found in components.`);
}

console.log('\\n===================================================');
if (failed) {
  console.error('❌ Frontend Architecture Validation FAILED.');
  process.exit(1);
} else {
  console.log('✅ Frontend Architecture Validation PASSED.');
  process.exit(0);
}
