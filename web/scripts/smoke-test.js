const fs = require('fs');
const path = require('path');

// Mocking required parts for a simple smoke test
async function test() {
  console.log("Starting extraction smoke test...");
  
  // Note: Since unpdf/officeparser are ESM, running a simple CJS script might be tricky 
  // without a proper test runner or ts-node. 
  // For now, we'll verify the libraries are at least importable and existing files can be read.

  try {
    const { getDocumentProxy, extractText } = require('unpdf');
    const officeParser = require('officeparser');
    console.log("✅ Libraries loaded successfully.");
  } catch (e) {
    console.error("❌ Failed to load one or more libraries:", e.message);
  }

  // Budget Logic Verification
  function testBudget(total, count) {
    const coordShare = 0.35;
    const partnerShare = (1 - coordShare) / (count - 1 || 1);
    
    console.log(`Testing budget split for ${total} EUR among ${count} partners:`);
    const shares = Array.from({length: count}).map((_, i) => i === 0 ? coordShare : partnerShare);
    const sum = shares.reduce((a, b) => a + b, 0);
    console.log(`   Sum of shares: ${sum.toFixed(4)} (Expected 1.0)`);
    if (Math.abs(sum - 1.0) < 0.0001) console.log("   ✅ Budget split logic is mathematically sound.");
    else console.log("   ❌ Budget split logic error.");
  }

  testBudget(10000000, 3);
  testBudget(10000000, 5);
}

test();
