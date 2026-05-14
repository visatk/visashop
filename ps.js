import fs from 'node:fs';

function patchFile(filePath, patcher) {
  if (fs.existsSync(filePath)) {
    const original = fs.readFileSync(filePath, 'utf8');
    const patched = patcher(original);
    if (original !== patched) {
      fs.writeFileSync(filePath, patched);
      console.log(`✅ Patched ${filePath}`);
    } else {
      console.log(`ℹ️ No changes needed in ${filePath}`);
    }
  } else {
    console.warn(`⚠️ File not found: ${filePath}`);
  }
}

// 1. env.ts: Remove string overrides, let them inherit from generated Env
patchFile('worker/env.ts', code => {
  return code.replace(/[A-Z0-9_]+\s*:\s*string\s*;/g, (match) => {
    // Only remove known Cloudflare env binding overrides to avoid breaking valid ones
    if (/^(APP_|APIRONE_|R2_|MAIL_|ORDER_)/.test(match)) {
      return '';
    }
    return match;
  });
});

// 2. crypto.ts: Cast .buffer to ArrayBuffer
patchFile('worker/lib/crypto.ts', code => {
  return code.replace(/\.buffer(?!\s*as)/g, '.buffer as ArrayBuffer');
});

// 3. seo.ts: Fix HTMLRewriter element handlers (should not return the element)
patchFile('worker/lib/seo.ts', code => {
  let newCode = code.replace(/element\s*\(\s*el\s*\)\s*\{([^}]*)return\s+el;([^}]*)\}/g, 'element(el) {$1$2}');
  newCode = newCode.replace(/el\s*=>\s*el/g, 'el => {}');
  return newCode;
});

// 4. admin.ts: Remove unused jsonResponse
patchFile('worker/routes/admin.ts', code => {
  let newCode = code.replace(/\bjsonResponse\s*,\s*/g, '');
  newCode = newCode.replace(/,\s*jsonResponse\b/g, '');
  newCode = newCode.replace(/import\s*\{\s*jsonResponse\s*\}\s*from\s*['"][^'"]+['"];?/g, '');
  return newCode;
});

// 5. order-lifecycle.ts: Fix workflows imports & strictly typed step configs
patchFile('worker/workflows/order-lifecycle.ts', code => {
  let newCode = code.replace(/import\s*\{([^}]*)NonRetryableError([^}]*)\}\s*from\s*['"]cloudflare:workers['"]/g, 
    (match, p1, p2) => {
      const otherImports = [p1, p2].join('').replace(/,\s*,/g, ',').replace(/^\s*,\s*|\s*,\s*$/g, '').trim();
      let res = `import { NonRetryableError } from "cloudflare:workflows";\n`;
      if (otherImports) {
        res += `import { ${otherImports} } from "cloudflare:workers";`;
      }
      return res;
    });
  
  newCode = newCode.replace(/delay:\s*("[^"]+")(?!\s*as)/g, 'delay: $1 as any');
  newCode = newCode.replace(/timeout:\s*("[^"]+")(?!\s*as)/g, 'timeout: $1 as any');
  return newCode;
});
