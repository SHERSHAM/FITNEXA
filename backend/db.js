const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'Shersha123',
  database: process.env.DB_NAME || 'fitnexa_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

// Initialize tables and seed records
async function initDatabase() {
  try {
    // 1. Core Users Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(255),
        role VARCHAR(32) DEFAULT 'athlete',
        plan_tier VARCHAR(64) DEFAULT 'Pro Athlete',
        payment_status VARCHAR(32) DEFAULT 'paid',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Safely check & add columns if table already existed without them
    const [userCols] = await pool.query(`
      SELECT COLUMN_NAME FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = 'fitnexa_db' AND TABLE_NAME = 'users'
    `);
    const colNames = userCols.map(c => c.COLUMN_NAME.toLowerCase());
    if (!colNames.includes('role')) {
      await pool.query("ALTER TABLE users ADD COLUMN role VARCHAR(32) DEFAULT 'athlete'");
    }
    if (!colNames.includes('plan_tier')) {
      await pool.query("ALTER TABLE users ADD COLUMN plan_tier VARCHAR(64) DEFAULT 'Pro Athlete'");
    }
    if (!colNames.includes('payment_status')) {
      await pool.query("ALTER TABLE users ADD COLUMN payment_status VARCHAR(32) DEFAULT 'paid'");
    }

    // 2. Athlete Profiles Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64),
        full_name VARCHAR(255),
        gender VARCHAR(32),
        age_range VARCHAR(32),
        height_cm INT,
        weight_kg INT,
        goal VARCHAR(64),
        experience VARCHAR(64),
        workout_frequency VARCHAR(64),
        onboarding_completed TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // 3. Telemetry User Data
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_data (
        user_id VARCHAR(64) PRIMARY KEY,
        data_json LONGTEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // 4. Payments Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64),
        user_name VARCHAR(255),
        email VARCHAR(255),
        plan_tier VARCHAR(64),
        amount DECIMAL(10,2),
        currency VARCHAR(10) DEFAULT 'USD',
        status VARCHAR(32) DEFAULT 'paid',
        payment_method VARCHAR(64),
        transaction_id VARCHAR(64),
        billing_cycle VARCHAR(32) DEFAULT 'Monthly',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        next_billing_date DATE
      )
    `);

    // 5. Workout Logs Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS workout_logs (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64),
        user_name VARCHAR(255),
        workout_name VARCHAR(255),
        category VARCHAR(64),
        duration_min INT,
        calories_burned INT,
        form_score INT DEFAULT 95,
        completed TINYINT(1) DEFAULT 1,
        logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 6. Seed demo users (including an Admin account)
    const demoAccounts = [
      {
        id: 'usr_admin_001',
        email: 'admin@fitnexa.ai',
        password: 'adminpassword',
        fullName: 'Lead Coach Marcus',
        role: 'admin',
        planTier: 'Administrator',
        paymentStatus: 'paid'
      },
      {
        id: 'usr_alex_001',
        email: 'alex@fitnexa.ai',
        password: 'password123',
        fullName: 'Alex Mercer',
        role: 'athlete',
        planTier: 'Pro Athlete',
        paymentStatus: 'paid'
      },
      {
        id: 'usr_alex_002',
        email: 'alex.mercer@fitnexa.ai',
        password: 'strength2026',
        fullName: 'Alex Mercer',
        role: 'athlete',
        planTier: 'Pro Athlete',
        paymentStatus: 'paid'
      },
      {
        id: 'usr_sarah_001',
        email: 'sarah@fitnexa.ai',
        password: 'password123',
        fullName: 'Sarah Connor',
        role: 'athlete',
        planTier: 'Elite Team',
        paymentStatus: 'paid'
      },
      {
        id: 'usr_sarah_002',
        email: 'sarah.connor@fitnexa.ai',
        password: 'endurance2026',
        fullName: 'Sarah Connor',
        role: 'athlete',
        planTier: 'Elite Team',
        paymentStatus: 'paid'
      }
    ];

    for (const acct of demoAccounts) {
      const [rows] = await pool.query('SELECT id FROM users WHERE email = ?', [acct.email]);
      if (rows.length === 0) {
        const hash = bcrypt.hashSync(acct.password, 10);
        await pool.query(
          'INSERT INTO users (id, email, password_hash, full_name, role, plan_tier, payment_status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [acct.id, acct.email, hash, acct.fullName, acct.role, acct.planTier, acct.paymentStatus]
        );
        await pool.query(
          'INSERT IGNORE INTO profiles (id, user_id, full_name, onboarding_completed) VALUES (?, ?, ?, 1)',
          [acct.id, acct.id, acct.fullName]
        );
      }
    }

    // 7. Seed 15 sample athlete profiles
    const sampleAthletes = [
      { id: 'a1000000-0000-0000-0000-000000000001', full_name: 'Marcus Vance', email: 'marcus.vance@athletes.com', gender: 'male', age_range: '21-29', height_cm: 185, weight_kg: 88, goal: 'gain_muscle', experience: 'advanced', workout_frequency: '5-6 days/week', plan: 'Pro Athlete', status: 'paid', amount: 39 },
      { id: 'a1000000-0000-0000-0000-000000000002', full_name: 'Elena Rostova', email: 'elena.rostova@athletes.com', gender: 'female', age_range: '21-29', height_cm: 168, weight_kg: 58, goal: 'lose_weight', experience: 'intermediate', workout_frequency: '3-4 days/week', plan: 'Pro Athlete', status: 'paid', amount: 39 },
      { id: 'a1000000-0000-0000-0000-000000000003', full_name: 'David Chen', email: 'david.chen@athletes.com', gender: 'male', age_range: '30-39', height_cm: 176, weight_kg: 74, goal: 'stay_fit', experience: 'intermediate', workout_frequency: '3-4 days/week', plan: 'Starter', status: 'paid', amount: 19 },
      { id: 'a1000000-0000-0000-0000-000000000004', full_name: 'Sarah Jenkins', email: 'sarah.jenkins@athletes.com', gender: 'female', age_range: '16-20', height_cm: 162, weight_kg: 52, goal: 'endurance', experience: 'beginner', workout_frequency: '1-2 days/week', plan: 'Starter', status: 'trial', amount: 0 },
      { id: 'a1000000-0000-0000-0000-000000000005', full_name: 'Tyler Brooks', email: 'tyler.brooks@athletes.com', gender: 'male', age_range: '21-29', height_cm: 192, weight_kg: 96, goal: 'gain_weight', experience: 'advanced', workout_frequency: 'Everyday', plan: 'Elite Team', status: 'paid', amount: 79 },
      { id: 'a1000000-0000-0000-0000-000000000006', full_name: 'Priya Sharma', email: 'priya.sharma@athletes.com', gender: 'female', age_range: '30-39', height_cm: 165, weight_kg: 61, goal: 'flexibility', experience: 'beginner', workout_frequency: '3-4 days/week', plan: 'Starter', status: 'paid', amount: 19 },
      { id: 'a1000000-0000-0000-0000-000000000007', full_name: "Liam O'Connor", email: 'liam.oconnor@athletes.com', gender: 'male', age_range: '40-49', height_cm: 180, weight_kg: 83, goal: 'stay_fit', experience: 'intermediate', workout_frequency: '3-4 days/week', plan: 'Pro Athlete', status: 'paid', amount: 39 },
      { id: 'a1000000-0000-0000-0000-000000000008', full_name: 'Maya Lin', email: 'maya.lin@athletes.com', gender: 'female', age_range: '21-29', height_cm: 170, weight_kg: 64, goal: 'gain_muscle', experience: 'intermediate', workout_frequency: '5-6 days/week', plan: 'Elite Team', status: 'paid', amount: 79 },
      { id: 'a1000000-0000-0000-0000-000000000009', full_name: 'Jordan Taylor', email: 'jordan.taylor@athletes.com', gender: 'other', age_range: '21-29', height_cm: 174, weight_kg: 69, goal: 'endurance', experience: 'advanced', workout_frequency: '5-6 days/week', plan: 'Pro Athlete', status: 'pending', amount: 39 },
      { id: 'a1000000-0000-0000-0000-000000000010', full_name: 'Carlos Mendez', email: 'carlos.mendez@athletes.com', gender: 'male', age_range: '30-39', height_cm: 178, weight_kg: 86, goal: 'lose_weight', experience: 'beginner', workout_frequency: '3-4 days/week', plan: 'Starter', status: 'paid', amount: 19 },
      { id: 'a1000000-0000-0000-0000-000000000011', full_name: 'Emma Watson', email: 'emma.watson@athletes.com', gender: 'female', age_range: '16-20', height_cm: 166, weight_kg: 55, goal: 'stay_fit', experience: 'beginner', workout_frequency: '1-2 days/week', plan: 'Starter', status: 'trial', amount: 0 },
      { id: 'a1000000-0000-0000-0000-000000000012', full_name: 'Alexander Wright', email: 'alex.wright@athletes.com', gender: 'male', age_range: '50-59', height_cm: 183, weight_kg: 89, goal: 'stay_fit', experience: 'intermediate', workout_frequency: '3-4 days/week', plan: 'Pro Athlete', status: 'paid', amount: 39 },
      { id: 'a1000000-0000-0000-0000-000000000013', full_name: 'Sophia Kowalski', email: 'sophia.k@athletes.com', gender: 'female', age_range: '21-29', height_cm: 172, weight_kg: 63, goal: 'gain_muscle', experience: 'advanced', workout_frequency: '5-6 days/week', plan: 'Elite Team', status: 'paid', amount: 79 },
      { id: 'a1000000-0000-0000-0000-000000000014', full_name: 'Noah Patel', email: 'noah.patel@athletes.com', gender: 'male', age_range: '21-29', height_cm: 175, weight_kg: 70, goal: 'gain_muscle', experience: 'intermediate', workout_frequency: '3-4 days/week', plan: 'Pro Athlete', status: 'paid', amount: 39 },
      { id: 'a1000000-0000-0000-0000-000000000015', full_name: 'Chloe Dubois', email: 'chloe.dubois@athletes.com', gender: 'female', age_range: '30-39', height_cm: 160, weight_kg: 54, goal: 'flexibility', experience: 'intermediate', workout_frequency: '3-4 days/week', plan: 'Starter', status: 'pending', amount: 19 }
    ];

    for (const a of sampleAthletes) {
      await pool.query(`
        INSERT INTO profiles (
          id, user_id, full_name, gender, age_range, height_cm, weight_kg,
          goal, experience, workout_frequency, onboarding_completed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE
          full_name = VALUES(full_name),
          gender = VALUES(gender),
          age_range = VALUES(age_range),
          height_cm = VALUES(height_cm),
          weight_kg = VALUES(weight_kg),
          goal = VALUES(goal),
          experience = VALUES(experience),
          workout_frequency = VALUES(workout_frequency)
      `, [
        a.id, a.id, a.full_name, a.gender, a.age_range, a.height_cm, a.weight_kg,
        a.goal, a.experience, a.workout_frequency
      ]);
    }

    // 8. Seed Payments
    const [existingPayments] = await pool.query('SELECT COUNT(*) AS count FROM payments');
    if (existingPayments[0].count === 0) {
      const paymentMethods = ['Stripe Credit Card', 'Apple Pay', 'PayPal', 'Google Pay'];
      for (let idx = 0; idx < sampleAthletes.length; idx++) {
        const a = sampleAthletes[idx];
        const transId = 'TXN_' + Math.random().toString(36).substring(2, 10).toUpperCase();
        const pMethod = paymentMethods[Math.floor(Math.random() * paymentMethods.length)];
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + 28);
        const payId = 'pay_' + (idx + 1) + '_' + Math.random().toString(36).substring(2, 7);

        await pool.query(`
          INSERT IGNORE INTO payments (
            id, user_id, user_name, email, plan_tier, amount, currency,
            status, payment_method, transaction_id, billing_cycle, created_at, next_billing_date
          ) VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, 'Monthly', NOW() - INTERVAL FLOOR(RAND() * 20) DAY, ?)
        `, [
          payId,
          a.id,
          a.full_name,
          a.email,
          a.plan,
          a.amount,
          a.status,
          pMethod,
          transId,
          nextDate
        ]);
      }

      // Add payments for Alex & Sarah
      await pool.query(`
        INSERT INTO payments (id, user_id, user_name, email, plan_tier, amount, status, payment_method, transaction_id, billing_cycle, next_billing_date)
        VALUES 
          ('pay_alex_01', 'usr_alex_001', 'Alex Mercer', 'alex@fitnexa.ai', 'Pro Athlete', 39.00, 'paid', 'Apple Pay', 'TXN_ALEX_9981', 'Monthly', DATE_ADD(NOW(), INTERVAL 24 DAY)),
          ('pay_sarah_01', 'usr_sarah_001', 'Sarah Connor', 'sarah@fitnexa.ai', 'Elite Team', 79.00, 'paid', 'Stripe Credit Card', 'TXN_SARAH_4412', 'Monthly', DATE_ADD(NOW(), INTERVAL 22 DAY))
      `);
    }

    // 9. Seed Workout Logs for Monitoring
    const [existingLogs] = await pool.query('SELECT COUNT(*) AS count FROM workout_logs');
    if (existingLogs[0].count === 0) {
      const routineOptions = [
        { name: 'Upper Body Power', category: 'Strength', cal: 420, min: 45 },
        { name: 'HIIT Metabolic Blaze', category: 'HIIT', cal: 480, min: 30 },
        { name: 'Lower Body Hypertrophy', category: 'Muscle Building', cal: 490, min: 50 },
        { name: 'Athletic Conditioning & Core', category: 'Endurance', cal: 380, min: 40 },
        { name: 'Deep Mobility & Recovery', category: 'Mobility', cal: 140, min: 25 },
        { name: 'Iron Bench: Chest Specialization', category: 'Strength', cal: 470, min: 55 }
      ];

      for (let aIdx = 0; aIdx < sampleAthletes.length; aIdx++) {
        const a = sampleAthletes[aIdx];
        // Generate 2 to 4 recent workout sessions for each athlete
        const numSessions = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < numSessions; i++) {
          const r = routineOptions[Math.floor(Math.random() * routineOptions.length)];
          const formScore = 90 + Math.floor(Math.random() * 9);
          const daysAgo = i * 2 + 1;
          const logId = 'wlog_' + aIdx + '_' + i + '_' + Math.random().toString(36).substring(2, 6);
          await pool.query(`
            INSERT IGNORE INTO workout_logs (id, user_id, user_name, workout_name, category, duration_min, calories_burned, form_score, completed, logged_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW() - INTERVAL ? DAY)
          `, [
            logId,
            a.id,
            a.full_name,
            r.name,
            r.category,
            r.min,
            r.cal,
            formScore,
            daysAgo
          ]);
        }
      }

      // Add workout logs for Alex & Sarah
      await pool.query(`
        INSERT IGNORE INTO workout_logs (id, user_id, user_name, workout_name, category, duration_min, calories_burned, form_score, completed, logged_at)
        VALUES
          ('wlog_alex_01', 'usr_alex_001', 'Alex Mercer', 'Upper Body Power', 'Strength', 46, 430, 94, 1, NOW() - INTERVAL 1 DAY),
          ('wlog_alex_02', 'usr_alex_001', 'Alex Mercer', 'Lower Body Hypertrophy', 'Muscle Building', 52, 510, 92, 1, NOW() - INTERVAL 3 DAY),
          ('wlog_sarah_01', 'usr_sarah_001', 'Sarah Connor', 'HIIT Metabolic Blaze', 'HIIT', 31, 495, 96, 1, NOW() - INTERVAL 1 DAY),
          ('wlog_sarah_02', 'usr_sarah_001', 'Sarah Connor', 'Athletic Conditioning & Core', 'Endurance', 40, 410, 97, 1, NOW() - INTERVAL 2 DAY)
      `);
    }

    console.log('[FITNEXA MySQL] ✅ Database connected, tables created, and admin telemetry seeded successfully.');
  } catch (err) {
    console.error('[FITNEXA MySQL] ❌ Database initialization failed:', err.message);
  }
}

// Auto-run initialization
initDatabase();

module.exports = pool;
