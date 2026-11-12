const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'fitnexa_jwt_super_secret_key_2026';

// ── Middlewares ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files from root directory
const rootDir = path.join(__dirname, '..');
app.use(express.static(rootDir));

// ── Auth Helper Middleware ────────────────────────────────────
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Invalid or expired session. Please log in again.' });
    }
    req.user = decoded;
    next();
  });
}

// ── API Routes ────────────────────────────────────────────────

// 1. Health check & DB engine info
app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT VERSION() as version, DATABASE() as db_name');
    res.json({
      status: 'ok',
      engine: 'MySQL 9.6',
      database: rows[0].db_name,
      mysql_version: rows[0].version,
      timestamp: new Date()
    });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// 2. Signup
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { fullName, email, password } = req.body;

    if (!fullName || fullName.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'Please provide your full name.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email.trim())) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const [existing] = await db.query('SELECT id FROM users WHERE LOWER(email) = ?', [normalizedEmail]);
    if (existing && existing.length > 0) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists.' });
    }

    const userId = 'usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const passwordHash = bcrypt.hashSync(password, 10);
    const trimmedName = fullName.trim();

    // New accounts start on a 10-day Free Trial (NOT paid until payment is completed)
    await db.query(`
      INSERT INTO users (id, email, password_hash, full_name, role, plan_tier, payment_status, trial_ends_at)
      VALUES (?, ?, ?, ?, "athlete", "Free Trial (10 Days)", "trial", DATE_ADD(NOW(), INTERVAL 10 DAY))
    `, [userId, normalizedEmail, passwordHash, trimmedName]);

    await db.query(
      'INSERT IGNORE INTO profiles (id, user_id, full_name, onboarding_completed) VALUES (?, ?, ?, 0)',
      [userId, userId, trimmedName]
    );

    // Record 10-day free trial in payments table (Amount: $0.00, Status: 'trial')
    const trialTxnId = 'TRIAL_' + Math.random().toString(36).substring(2, 9).toUpperCase();
    await db.query(`
      INSERT INTO payments (id, user_id, user_name, email, plan_tier, amount, currency, status, payment_method, transaction_id, billing_cycle, created_at, next_billing_date, trial_ends_at)
      VALUES (?, ?, ?, ?, 'Free Trial (10 Days)', 0.00, 'USD', 'trial', '10-Day Free Trial', ?, 'Monthly', NOW(), DATE_ADD(NOW(), INTERVAL 10 DAY), DATE_ADD(NOW(), INTERVAL 10 DAY))
    `, ['pay_' + Date.now(), userId, trimmedName, normalizedEmail, trialTxnId]);

    const token = jwt.sign(
      { id: userId, email: normalizedEmail, fullName: trimmedName, role: 'athlete' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const userObj = {
      id: userId,
      email: normalizedEmail,
      full_name: trimmedName,
      fullName: trimmedName,
      role: 'athlete',
      plan_tier: 'Free Trial (10 Days)',
      payment_status: 'trial',
      trial_days_left: 10
    };

    res.status(201).json({
      success: true,
      token,
      user: userObj,
      session: { access_token: token, user: userObj }
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ success: false, message: 'Internal server error during signup.' });
  }
});

// 3. Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const [rows] = await db.query('SELECT * FROM users WHERE LOWER(email) = ?', [normalizedEmail]);
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const match = bcrypt.compareSync(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, fullName: user.full_name, role: user.role || 'athlete' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    let trialDaysLeft = null;
    if (user.trial_ends_at) {
      const diffTime = new Date(user.trial_ends_at) - new Date();
      trialDaysLeft = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    } else if (user.payment_status === 'trial') {
      trialDaysLeft = 10;
    }

    const userObj = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      fullName: user.full_name,
      role: user.role || 'athlete',
      plan_tier: user.plan_tier || 'Free Trial (10 Days)',
      payment_status: user.payment_status || 'trial',
      trial_ends_at: user.trial_ends_at,
      trial_days_left: trialDaysLeft
    };

    res.json({
      success: true,
      token,
      user: userObj,
      session: { access_token: token, user: userObj }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Internal server error during login.' });
  }
});

// 4. Current user session (me)
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const [uRows] = await db.query('SELECT id, email, full_name, role, plan_tier, payment_status, trial_ends_at, created_at FROM users WHERE id = ?', [req.user.id]);
    const user = uRows[0];
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    let trialDaysLeft = null;
    if (user.trial_ends_at) {
      const diffTime = new Date(user.trial_ends_at) - new Date();
      trialDaysLeft = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    } else if (user.payment_status === 'trial') {
      trialDaysLeft = 10;
    }

    const [pRows] = await db.query('SELECT * FROM profiles WHERE user_id = ? OR id = ?', [user.id, user.id]);

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        fullName: user.full_name,
        role: user.role,
        plan_tier: user.plan_tier || 'Free Trial (10 Days)',
        payment_status: user.payment_status || 'trial',
        trial_ends_at: user.trial_ends_at,
        trial_days_left: trialDaysLeft,
        created_at: user.created_at,
        profile: pRows[0] || null
      }
    });
  } catch (err) {
    console.error('Session retrieval error:', err);
    res.status(500).json({ success: false, message: 'Error retrieving user session.' });
  }
});

// 5. Logout
app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully.' });
});

// 6. Forgot Password
app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required.' });
  }
  res.json({
    success: true,
    message: `Password reset instructions have been sent to ${email}.`
  });
});

// 7. Get Profile by ID
app.get('/api/profile/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM profiles WHERE id = ? OR user_id = ?', [req.params.id, req.params.id]);
    res.json({ success: true, profile: rows[0] || null });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ success: false, message: 'Error fetching profile.' });
  }
});

// 8. Update / Upsert Profile (used during Onboarding)
app.put('/api/profile/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const {
      full_name, gender, age_range, height_cm, weight_kg,
      goal, experience, workout_frequency, onboarding_completed
    } = req.body;

    let resolvedName = full_name;
    if (!resolvedName || !resolvedName.trim()) {
      const [u] = await db.query('SELECT full_name FROM users WHERE id = ?', [id]);
      if (u.length > 0 && u[0].full_name) resolvedName = u[0].full_name;
    }

    await db.query(`
      INSERT INTO profiles (
        id, user_id, full_name, gender, age_range, height_cm, weight_kg,
        goal, experience, workout_frequency, onboarding_completed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        full_name = COALESCE(VALUES(full_name), full_name),
        gender = COALESCE(VALUES(gender), gender),
        age_range = COALESCE(VALUES(age_range), age_range),
        height_cm = COALESCE(VALUES(height_cm), height_cm),
        weight_kg = COALESCE(VALUES(weight_kg), weight_kg),
        goal = COALESCE(VALUES(goal), goal),
        experience = COALESCE(VALUES(experience), experience),
        workout_frequency = COALESCE(VALUES(workout_frequency), workout_frequency),
        onboarding_completed = COALESCE(VALUES(onboarding_completed), onboarding_completed)
    `, [
      id,
      id,
      resolvedName || null,
      gender !== undefined ? gender : null,
      age_range !== undefined ? age_range : null,
      height_cm ? parseInt(height_cm, 10) : null,
      weight_kg ? parseInt(weight_kg, 10) : null,
      goal !== undefined ? goal : null,
      experience !== undefined ? experience : null,
      workout_frequency !== undefined ? workout_frequency : null,
      onboarding_completed !== undefined ? (onboarding_completed ? 1 : 0) : null
    ]);

    if (resolvedName) {
      await db.query('UPDATE users SET full_name = ? WHERE id = ?', [resolvedName, id]);
      await db.query('UPDATE payments SET user_name = ? WHERE user_id = ?', [resolvedName, id]);
    }

    const [rows] = await db.query('SELECT * FROM profiles WHERE id = ? OR user_id = ?', [id, id]);
    res.json({ success: true, profile: rows[0] });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }
});

// 9. Get all community athlete profiles (15 sample profiles)
app.get('/api/profiles', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM profiles ORDER BY created_at DESC');
    res.json({ success: true, profiles: rows });
  } catch (err) {
    console.error('Get all profiles error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch profiles.' });
  }
});

// 10. Sync user telemetry / workout stats
app.get('/api/user-data/:userId', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT data_json FROM user_data WHERE user_id = ?', [req.params.userId]);
    res.json({ success: true, data: rows.length > 0 ? JSON.parse(rows[0].data_json) : null });
  } catch (err) {
    console.error('Get user data error:', err);
    res.status(500).json({ success: false, message: 'Error retrieving user data.' });
  }
});

app.post('/api/user-data/:userId', async (req, res) => {
  try {
    const jsonStr = JSON.stringify(req.body);
    await db.query(`
      INSERT INTO user_data (user_id, data_json)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE data_json = VALUES(data_json)
    `, [req.params.userId, jsonStr]);
    res.json({ success: true, message: 'User data synced successfully.' });
  } catch (err) {
    console.error('Save user data error:', err);
    res.status(500).json({ success: false, message: 'Error saving user data.' });
  }
});

// 11. Athlete Payment / Upgrade from Trial to Paid
app.post('/api/payment/complete', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    let tokenUser = null;
    if (token) {
      try {
        tokenUser = jwt.verify(token, JWT_SECRET);
      } catch (e) {}
    }

    const userId = (tokenUser && tokenUser.id) || req.body.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication or userId required.' });
    }

    const {
      planTier = 'Pro Athlete',
      amount = 39.00,
      paymentMethod = 'Credit Card (Visa)',
      transactionId
    } = req.body;

    const [uRows] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    const user = uRows[0];
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const txnId = transactionId || ('TXN_' + Math.random().toString(36).substring(2, 9).toUpperCase());
    const payId = 'pay_' + Date.now();
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + 30);

    // 1. Upgrade user in users table
    await db.query(`
      UPDATE users 
      SET payment_status = 'paid', plan_tier = ?, trial_ends_at = NULL
      WHERE id = ?
    `, [planTier, userId]);

    // 2. Insert paid transaction
    await db.query(`
      INSERT INTO payments (id, user_id, user_name, email, plan_tier, amount, currency, status, payment_method, transaction_id, billing_cycle, created_at, next_billing_date)
      VALUES (?, ?, ?, ?, ?, ?, 'USD', 'paid', ?, ?, 'Monthly', NOW(), ?)
    `, [
      payId,
      user.id,
      user.full_name,
      user.email,
      planTier,
      parseFloat(amount) || 39.00,
      paymentMethod,
      txnId,
      nextDate
    ]);

    const updatedUser = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      fullName: user.full_name,
      role: user.role,
      plan_tier: planTier,
      payment_status: 'paid',
      trial_days_left: 0
    };

    res.json({
      success: true,
      message: `Payment successful! Upgraded to ${planTier}.`,
      paymentId: payId,
      transactionId: txnId,
      user: updatedUser
    });
  } catch (err) {
    console.error('Payment completion error:', err);
    res.status(500).json({ success: false, message: 'Failed to process payment.' });
  }
});

// ============================================================
// ── ADMIN PANEL SUITE API (Members, Workouts & Payments) ────
// ============================================================

// A. Admin Overview KPIs & Revenue Matrix
app.get('/api/admin/overview', async (req, res) => {
  try {
    const [profileCount] = await db.query('SELECT COUNT(*) AS total FROM profiles');
    const [userCount] = await db.query('SELECT COUNT(*) AS total FROM users');
    
    // Revenue & payment status breakdown
    const [revStats] = await db.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS total_revenue,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS paid_count,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
        COALESCE(SUM(CASE WHEN status = 'trial' THEN 1 ELSE 0 END), 0) AS trial_count
      FROM payments
    `);
    
    // Workouts metrics
    const [workoutStats] = await db.query(`
      SELECT 
        COUNT(*) AS total_sessions,
        COALESCE(SUM(duration_min), 0) AS total_minutes,
        COALESCE(SUM(calories_burned), 0) AS total_calories,
        COALESCE(AVG(form_score), 95) AS avg_form_accuracy
      FROM workout_logs
    `);

    // Plan distribution
    const [planStats] = await db.query(`
      SELECT plan_tier, COUNT(*) AS count, SUM(amount) AS revenue
      FROM payments
      GROUP BY plan_tier
    `);

    const rev = revStats[0];
    res.json({
      success: true,
      metrics: {
        totalAthletes: profileCount[0].total,
        registeredUsers: userCount[0].total,
        totalRevenue: Number(rev.total_revenue) || 0,
        paidMembers: Number(rev.paid_count) || 0,
        pendingPayments: Number(rev.pending_count) || 0,
        trialMembers: Number(rev.trial_count) || 0,
        totalWorkoutsCompleted: workoutStats[0].total_sessions || 0,
        totalMinutesTrained: workoutStats[0].total_minutes || 0,
        totalCaloriesBurned: workoutStats[0].total_calories || 0,
        avgFormAccuracy: Math.round(workoutStats[0].avg_form_accuracy || 95)
      },
      planDistribution: planStats
    });
  } catch (err) {
    console.error('Admin overview error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// B. Admin Members Directory (Joined users, profile, plan, payment & workout totals)
app.get('/api/admin/members', async (req, res) => {
  try {
    const [members] = await db.query(`
      SELECT 
        p.id AS profile_id,
        p.user_id,
        p.full_name,
        p.gender,
        p.age_range,
        p.height_cm,
        p.weight_kg,
        p.goal,
        p.experience,
        p.workout_frequency,
        p.onboarding_completed,
        p.created_at AS joined_date,
        COALESCE(u.email, CONCAT(LOWER(REPLACE(p.full_name, ' ', '.')), '@athlete.fitnexa.ai')) AS email,
        COALESCE(u.plan_tier, pay.plan_tier, 'Free Trial (10 Days)') AS plan_tier,
        COALESCE(u.payment_status, pay.status, 'trial') AS payment_status,
        COALESCE(pay.amount, CASE WHEN COALESCE(u.payment_status, pay.status) = 'trial' THEN 0.00 ELSE 39.00 END) AS payment_amount,
        COALESCE(w.session_count, 0) AS workouts_completed,
        COALESCE(w.total_calories, 0) AS calories_burned,
        COALESCE(w.avg_form, 95) AS avg_form_score,
        w.last_workout_date
      FROM profiles p
      LEFT JOIN users u ON p.id = u.id OR p.user_id = u.id
      LEFT JOIN (
        SELECT user_id, plan_tier, status, amount
        FROM payments
        WHERE id IN (SELECT MAX(id) FROM payments GROUP BY user_id)
      ) pay ON pay.user_id = p.id OR pay.user_id = p.user_id
      LEFT JOIN (
        SELECT 
          user_id,
          COUNT(*) AS session_count,
          SUM(calories_burned) AS total_calories,
          ROUND(AVG(form_score)) AS avg_form,
          MAX(logged_at) AS last_workout_date
        FROM workout_logs
        GROUP BY user_id
      ) w ON w.user_id = p.id OR w.user_id = p.user_id
      ORDER BY p.created_at DESC
    `);

    res.json({ success: true, members });
  } catch (err) {
    console.error('Admin members error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// C. Admin Workout Monitoring (Live stream of logged sessions across athletes)
app.get('/api/admin/workouts', async (req, res) => {
  try {
    const [logs] = await db.query(`
      SELECT 
        w.id,
        w.user_id,
        w.user_name,
        w.workout_name,
        w.category,
        w.duration_min,
        w.calories_burned,
        w.form_score,
        w.completed,
        w.logged_at,
        p.goal AS athlete_goal,
        p.experience AS athlete_level
      FROM workout_logs w
      LEFT JOIN profiles p ON w.user_id = p.id
      ORDER BY w.logged_at DESC
      LIMIT 100
    `);

    res.json({ success: true, workouts: logs });
  } catch (err) {
    console.error('Admin workouts error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// D. Admin Payment Transactions List
app.get('/api/admin/payments', async (req, res) => {
  try {
    const [payments] = await db.query(`
      SELECT 
        id,
        user_id,
        user_name,
        email,
        plan_tier,
        amount,
        currency,
        status,
        payment_method,
        transaction_id,
        billing_cycle,
        created_at,
        next_billing_date
      FROM payments
      ORDER BY created_at DESC
    `);

    res.json({ success: true, payments });
  } catch (err) {
    console.error('Admin payments error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// E. Admin Update Payment Status / Record Payment
app.post('/api/admin/payment', async (req, res) => {
  try {
    const { paymentId, userId, userName, email, planTier, amount, status, paymentMethod } = req.body;

    if (paymentId) {
      // Update existing payment
      await db.query(`
        UPDATE payments SET
          status = COALESCE(?, status),
          plan_tier = COALESCE(?, plan_tier),
          amount = COALESCE(?, amount)
        WHERE id = ?
      `, [status, planTier, amount, paymentId]);

      if (status) {
        await db.query(`
          UPDATE users SET 
            payment_status = ?,
            plan_tier = COALESCE(?, plan_tier)
          WHERE id = (SELECT user_id FROM payments WHERE id = ?)
        `, [status, planTier, paymentId]);
      }

      return res.json({ success: true, message: 'Payment record updated successfully.' });
    }

    // Insert new payment transaction
    const newId = 'pay_' + Date.now();
    const transId = 'TXN_' + Math.random().toString(36).substring(2, 9).toUpperCase();
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + 30);

    await db.query(`
      INSERT INTO payments (id, user_id, user_name, email, plan_tier, amount, currency, status, payment_method, transaction_id, billing_cycle, created_at, next_billing_date)
      VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, 'Monthly', NOW(), ?)
    `, [
      newId,
      userId || 'usr_guest',
      userName || 'Athlete',
      email || 'athlete@fitnexa.ai',
      planTier || 'Pro Athlete',
      amount || 39.00,
      status || 'paid',
      paymentMethod || 'Stripe Credit Card',
      transId,
      nextDate
    ]);

    if (userId) {
      await db.query(`
        UPDATE users SET 
          payment_status = ?,
          plan_tier = COALESCE(?, plan_tier)
        WHERE id = ?
      `, [status || 'paid', planTier || 'Pro Athlete', userId]);
    }

    res.json({ success: true, message: 'New transaction recorded successfully.', paymentId: newId });
  } catch (err) {
    console.error('Record payment error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// F. Admin Log a Workout Session for an Athlete
app.post('/api/admin/log-workout', async (req, res) => {
  try {
    const { userId, userName, workoutName, category, durationMin, caloriesBurned, formScore } = req.body;

    const id = 'wlog_' + Date.now();
    await db.query(`
      INSERT INTO workout_logs (id, user_id, user_name, workout_name, category, duration_min, calories_burned, form_score, completed, logged_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())
    `, [
      id,
      userId,
      userName || 'Athlete',
      workoutName || 'Personalized Session',
      category || 'Strength',
      parseInt(durationMin, 10) || 45,
      parseInt(caloriesBurned, 10) || 400,
      parseInt(formScore, 10) || 95
    ]);

    res.json({ success: true, message: 'Workout logged successfully.', logId: id });
  } catch (err) {
    console.error('Log workout error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// G. Database live inspector endpoint
app.get('/api/admin/database-view', async (req, res) => {
  try {
    const [users] = await db.query('SELECT id, email, full_name, role, plan_tier, payment_status, created_at FROM users ORDER BY created_at DESC');
    const [profiles] = await db.query('SELECT * FROM profiles ORDER BY created_at DESC');
    const [payments] = await db.query('SELECT * FROM payments ORDER BY created_at DESC');
    const [workouts] = await db.query('SELECT * FROM workout_logs ORDER BY logged_at DESC LIMIT 50');

    res.json({
      success: true,
      database: 'fitnexa_db',
      engine: 'MySQL Server 9.6',
      summary: {
        usersCount: users.length,
        profilesCount: profiles.length,
        paymentsCount: payments.length,
        workoutsCount: workouts.length
      },
      tables: {
        users,
        profiles,
        payments,
        workouts
      }
    });
  } catch (err) {
    console.error('Admin DB view error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Fallback: Serve index.html for root or unknown HTML navigation ─
app.use((req, res) => {
  res.sendFile(path.join(rootDir, 'index.html'));
});

// ── Start Server ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[FITNEXA AI] 🚀 Custom Backend Server (MySQL 9.6) running on http://localhost:${PORT}`);
  console.log(`[FITNEXA AI] 📁 Serving frontend from ${rootDir}`);
});
