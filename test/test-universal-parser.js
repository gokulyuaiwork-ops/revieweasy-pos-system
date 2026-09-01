import { parseReceiptStream, validateIndianMobile, classifyDocument } from '../src/engine/parser.js';

console.log('====================================================');
console.log('🧪 RUNNING COMPREHENSIVE ALL-SCENARIO PARSER TEST SUITE');
console.log('====================================================\n');

let passed = 0;
let total = 0;

function assert(description, condition) {
  total++;
  if (condition) {
    console.log(`✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${description}`);
  }
}

// Scenario 1: Standard Retail/Restaurant Invoice (Petpooja/POSist style)
const sample1 = `
========================================
             SUNSHINE CAFE
         Helpline: 044-24412345
========================================
Tax Invoice #INV-2024-991
Date: 01-Sep-2026  Time: 14:30
Customer Name: Rahul Sharma
Mobile No: +91 93423 50747
----------------------------------------
1x Cold Brew Coffee              180.00
1x Margherita Pizza              350.00
----------------------------------------
Sub Total:                       530.00
CGST (2.5%):                      13.25
SGST (2.5%):                      13.25
Grand Total:                     556.50
Payment Mode: UPI (GPay)
========================================
`;
const res1 = parseReceiptStream(sample1);
assert('Scenario 1: Retail invoice extracted correctly', 
  res1.success === true && 
  res1.customerPhone === '9342350747' && 
  res1.invoiceNo === 'INV-2024-991' && 
  res1.totalAmount === '556.50' &&
  res1.customerName === 'Rahul Sharma'
);

// Scenario 2: Windows Notepad GDI UTF-16LE Spooler buffer (.SPL)
const sample2Text = `Demo business\nTax Invoice #INV-8899\nCustomer: Test UTF16\nMobile: 9342350747\nTotal: 450.00\nThank you!`;
const sample2Buffer = Buffer.from(sample2Text, 'utf16le');
const res2 = parseReceiptStream(sample2Buffer);
assert('Scenario 2: UTF-16LE Windows spool decoded and parsed',
  res2.success === true &&
  res2.customerPhone === '9342350747' &&
  res2.invoiceNo === 'INV-8899' &&
  res2.totalAmount === '450.00'
);

// Scenario 3: Raw ESC/POS Binary Buffer with Control Commands (0x1B, 0x1D)
const sample3Text = `\x1B\x40\x1B\x61\x01ABC AUTOMOBILE SERVICES\nHelpline: 9840012345\n\x1B\x61\x00Job Card #JC-4421\nCustomer: Vikram Singh\nPh: 9342350747\nService Charge: 1200.00\nTotal Amount: 1,200.00\n\x1D\x56\x00`;
const sample3Buffer = Buffer.from(sample3Text, 'utf8');
const res3 = parseReceiptStream(sample3Buffer);
assert('Scenario 3: Raw ESC/POS binary stream stripped & parsed',
  res3.success === true &&
  res3.customerPhone === '9342350747' &&
  res3.invoiceNo === 'JC-4421' &&
  res3.totalAmount === '1200.00'
);

// Scenario 4: Bill mentioning a KOT reference but containing final Tax Invoice settlement
const sample4 = `
HOTEL SARAVANA BHAVAN
Table No: T-12 | KOT Ref: KOT-88
FINAL BILL / TAX INVOICE #SB-771
Customer: Ananth Kumar
Mobile: 9342350747
1x Ghee Roast Dosa    110.00
1x Filter Coffee       45.00
Net Payable:          155.00
PAID VIA CASH
`;
const res4 = parseReceiptStream(sample4);
assert('Scenario 4: Settlement bill referencing KOT is NOT blocked',
  res4.success === true &&
  res4.customerPhone === '9342350747' &&
  res4.invoiceNo === 'SB-771' &&
  res4.totalAmount === '155.00'
);

// Scenario 5: Pure KOT Slip with no amount (Must be IGNORED_KOT)
const sample5 = `
KITCHEN ORDER TICKET
Table: 04 | Captain: Rajesh
KOT # 44
1x Butter Chicken
2x Garlic Naan
`;
const res5 = parseReceiptStream(sample5);
assert('Scenario 5: Pure Kitchen Order Ticket correctly filtered as IGNORED_KOT',
  res5.success === false &&
  res5.status === 'IGNORED_KOT'
);

// Scenario 6: Bill with menu item containing 'KOT' (Kottayam Chicken Curry)
const sample6 = `
MALABAR SPICE RESTAURANT
TAX INVOICE #MS-104
Customer: Priya Nair
Mob: 9342350747
1x Kottayam Special Chicken Curry   320.00
2x Kerala Parotta                    60.00
Grand Total:                        380.00
`;
const res6 = parseReceiptStream(sample6);
assert('Scenario 6: Menu item "Kottayam Chicken" not falsely blocked as KOT',
  res6.success === true &&
  res6.customerPhone === '9342350747' &&
  res6.invoiceNo === 'MS-104' &&
  res6.totalAmount === '380.00'
);

// Scenario 7: Vyapar / Tally Format with Comma Total and Dash Phone
const sample7 = `
SRI BALAJI ENTERPRISES (GSTIN: 33AAAAA0000A1Z5)
Cash Memo #BM/2026/088
Party: Rajeshwari Traders
Phone No: 93423-50747
Item: Cotton Fabrics 50m
Net Amount: ₹ 1,45,200.00
`;
const res7 = parseReceiptStream(sample7);
assert('Scenario 7: Tally/Vyapar comma formatted currency & hyphenated phone',
  res7.success === true &&
  res7.customerPhone === '9342350747' &&
  res7.totalAmount === '145200.00'
);

// Scenario 8: Dual-Zone Phone Disambiguation (Shop phone in header vs Customer in body)
const sample8 = `
CITY FASHION HUB
Shop Phone: 9840012345
Address: 12 Commercial Street
-----------------------------------
Retail Invoice #CFH-550
Cust Name: Sneha Reddy
Contact: 9342350747
1x Designer Kurti   1899.00
Final Amount:       1899.00
`;
const res8 = parseReceiptStream(sample8, { storePhone: '9840012345' });
assert('Scenario 8: Dual-zone disambiguates shop helpline from customer mobile',
  res8.success === true &&
  res8.customerPhone === '9342350747' &&
  res8.invoiceNo === 'CFH-550'
);

// Scenario 9: Dummy Phone Number Filter (9876543210 / 9999999999)
const sample9 = `
TASTY BITES QSR
Tax Invoice #QSR-123
Customer: Walkin
Phone: 9876543210
Total: 250.00
`;
const res9 = parseReceiptStream(sample9);
assert('Scenario 9: Dummy cashier number 9876543210 rejected as ANONYMOUS_WALKIN',
  res9.success === false &&
  res9.status === 'ANONYMOUS_WALKIN'
);

console.log('\n====================================================');
console.log(`📊 RESULTS: ${passed}/${total} TEST SCENARIOS PASSED (${Math.round((passed/total)*100)}%)`);
console.log('====================================================');
process.exit(passed === total ? 0 : 1);
