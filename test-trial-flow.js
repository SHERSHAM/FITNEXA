const http = require('http');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('=== FITNEXA AI 10-DAY FREE TRIAL & PAYMENT TEST SUITE ===\n');

  // 1. Health
  const health = await request({
    hostname: 'localhost',
    port: 8080,
    path: '/api/health',
    method: 'GET'
  });
  console.log('1. Health Check:', health.data.status, '| DB:', health.data.database, '| Engine:', health.data.engine);

  // 2. Register fresh athlete
  const testEmail = `athlete_trial_${Date.now()}@fitness.com`;
  const signupRes = await request({
    hostname: 'localhost',
    port: 8080,
    path: '/api/auth/signup',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    fullName: 'David Beckham',
    email: testEmail,
    password: 'password123'
  });

  console.log('\n2. Signup Result:');
  console.log('   Success:', signupRes.data.success);
  console.log('   Plan Tier:', signupRes.data.user.plan_tier);
  console.log('   Payment Status:', signupRes.data.user.payment_status);
  console.log('   Trial Days Left:', signupRes.data.user.trial_days_left);

  if (signupRes.data.user.payment_status !== 'trial') {
    throw new Error('FAILED: New user should be in trial status!');
  }

  const token = signupRes.data.token;
  const userId = signupRes.data.user.id;

  // 3. Login with that athlete
  const loginRes = await request({
    hostname: 'localhost',
    port: 8080,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    email: testEmail,
    password: 'password123'
  });

  console.log('\n3. Login Result:');
  console.log('   Success:', loginRes.data.success);
  console.log('   Plan Tier:', loginRes.data.user.plan_tier);
  console.log('   Payment Status:', loginRes.data.user.payment_status);
  console.log('   Trial Days Left:', loginRes.data.user.trial_days_left);

  if (loginRes.data.user.payment_status !== 'trial') {
    throw new Error('FAILED: Login should reflect free trial status!');
  }

  // 4. Session /me
  const meRes = await request({
    hostname: 'localhost',
    port: 8080,
    path: '/api/auth/me',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });

  console.log('\n4. Session (/api/auth/me) Result:');
  console.log('   Plan Tier:', meRes.data.user.plan_tier);
  console.log('   Payment Status:', meRes.data.user.payment_status);
  console.log('   Trial Days Left:', meRes.data.user.trial_days_left);

  // 5. Admin Members list
  const membersRes = await request({
    hostname: 'localhost',
    port: 8080,
    path: '/api/admin/members',
    method: 'GET'
  });

  const member = membersRes.data.members.find(m => m.email === testEmail);
  console.log('\n5. Admin Directory Athlete Record:');
  console.log('   Found Athlete:', member ? member.full_name : 'No');
  console.log('   Plan Tier in Admin:', member ? member.plan_tier : 'N/A');
  console.log('   Payment Status in Admin:', member ? member.payment_status : 'N/A');
  console.log('   Payment Amount in Admin: $' + (member ? member.payment_amount : 'N/A'));

  if (!member || member.payment_status !== 'trial') {
    throw new Error('FAILED: Admin panel must show athlete as trial with $0.00!');
  }

  // 6. Complete Payment ($39.00)
  console.log('\n6. Completing Payment for Athlete...');
  const payRes = await request({
    hostname: 'localhost',
    port: 8080,
    path: '/api/payment/complete',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  }, {
    userId: userId,
    planTier: 'Pro Athlete',
    amount: 39.00,
    paymentMethod: 'Credit Card (Visa)'
  });

  console.log('   Payment Success:', payRes.data.success);
  console.log('   Message:', payRes.data.message);
  console.log('   Updated Status:', payRes.data.user.payment_status);
  console.log('   Updated Plan:', payRes.data.user.plan_tier);

  // 7. Re-verify session after payment
  const meAfterPay = await request({
    hostname: 'localhost',
    port: 8080,
    path: '/api/auth/me',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });

  console.log('\n7. Session After Payment:');
  console.log('   Payment Status:', meAfterPay.data.user.payment_status);
  console.log('   Plan Tier:', meAfterPay.data.user.plan_tier);

  if (meAfterPay.data.user.payment_status !== 'paid') {
    throw new Error('FAILED: User should now be marked as paid!');
  }

  // 8. Re-verify Admin Members list
  const membersAfterPay = await request({
    hostname: 'localhost',
    port: 8080,
    path: '/api/admin/members',
    method: 'GET'
  });

  const memberPaid = membersAfterPay.data.members.find(m => m.email === testEmail);
  console.log('\n8. Admin Directory After Payment:');
  console.log('   Payment Status in Admin:', memberPaid.payment_status);
  console.log('   Payment Amount in Admin: $' + memberPaid.payment_amount);

  if (!memberPaid || memberPaid.payment_status !== 'paid') {
    throw new Error('FAILED: Admin panel must show athlete as PAID after payment!');
  }

  console.log('\n🎉 ALL 10-DAY FREE TRIAL & PAYMENT UPGRADE TESTS PASSED WITH 100% SUCCESS!');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});

