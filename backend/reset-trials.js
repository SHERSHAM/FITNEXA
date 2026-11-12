const db = require('./db');

async function resetTrials() {
  try {
    await db.query(`
      UPDATE users 
      SET plan_tier = 'Free Trial (10 Days)', payment_status = 'trial', trial_ends_at = DATE_ADD(NOW(), INTERVAL 10 DAY)
      WHERE role != 'admin'
    `);

    await db.query(`
      UPDATE payments 
      SET plan_tier = 'Free Trial (10 Days)', amount = 0.00, status = 'trial', payment_method = '10-Day Free Trial', trial_ends_at = DATE_ADD(NOW(), INTERVAL 10 DAY)
      WHERE email IN (SELECT email FROM users WHERE role != 'admin')
    `);

    console.log('Successfully set athletes to Free Trial.');
    process.exit(0);
  } catch (err) {
    console.error('Reset error:', err);
    process.exit(1);
  }
}

resetTrials();

