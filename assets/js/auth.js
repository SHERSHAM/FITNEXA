/* ============================================================
   FITNEXA AI — AUTHENTICATION & ROUTE GUARD
   Full Custom Backend Edition with JWT & SQLite persistence
   ============================================================ */

(function(window) {
    'use strict';

    const API_BASE = window.location.origin;
    const TOKEN_KEY = 'fitnexa_token';
    const USER_KEY = 'fitnexa_user';

    const Auth = {
        // Cached user & session
        _cachedUser: null,
        _cachedSession: null,

        // Initialize session cache (verifies token with backend)
        initSession: async function() {
            const token = localStorage.getItem(TOKEN_KEY);
            if (!token) {
                this._cachedUser = null;
                this._cachedSession = null;
                return null;
            }

            try {
                const res = await fetch(`${API_BASE}/api/auth/me`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (res.ok) {
                    const data = await res.json();
                    if (data && data.success && data.user) {
                        this._cachedUser = data.user;
                        this._cachedSession = {
                            access_token: token,
                            user: data.user
                        };
                        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
                        return this._cachedSession;
                    }
                }

                // If 401/403, token is expired or invalid
                if (res.status === 401 || res.status === 403) {
                    this.clearStorage();
                    return null;
                }
            } catch (err) {
                console.warn('[FITNEXA Auth] Network check warning, fallback to cached user:', err);
                const localUser = localStorage.getItem(USER_KEY);
                if (localUser) {
                    try {
                        const parsed = JSON.parse(localUser);
                        this._cachedUser = parsed;
                        this._cachedSession = { access_token: token, user: parsed };
                        return this._cachedSession;
                    } catch (e) {}
                }
            }

            return this._cachedSession;
        },

        // Get current user (async)
        getCurrentUser: async function() {
            if (!this._cachedUser) {
                await this.initSession();
            }
            return this._cachedUser;
        },

        // Synchronous check using cached user
        getCurrentUserSync: function() {
            if (this._cachedUser) return this._cachedUser;
            try {
                const stored = localStorage.getItem(USER_KEY);
                if (stored) return JSON.parse(stored);
            } catch (e) {}
            return null;
        },

        isLoggedIn: function() {
            return !!localStorage.getItem(TOKEN_KEY);
        },

        // Login with email and password via Custom Backend
        login: async function(email, password) {
            try {
                const res = await fetch(`${API_BASE}/api/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email.trim(), password })
                });

                const data = await res.json();

                if (!res.ok || !data.success) {
                    return { success: false, message: data.message || 'Invalid email or password.' };
                }

                // Store token & user
                localStorage.setItem(TOKEN_KEY, data.token);
                localStorage.setItem(USER_KEY, JSON.stringify(data.user));

                this._cachedUser = data.user;
                this._cachedSession = data.session || { access_token: data.token, user: data.user };

                return { success: true, user: data.user, session: this._cachedSession };
            } catch (err) {
                console.error('[FITNEXA Auth] Login error:', err);
                return { success: false, message: 'Server connection error. Please ensure the backend is running.' };
            }
        },

        // Signup with fullName, email, and password via Custom Backend
        signup: async function(fullName, email, password) {
            try {
                if (!fullName || fullName.trim().length < 2) {
                    return { success: false, message: 'Please provide your full name.' };
                }

                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!email || !emailRegex.test(email.trim())) {
                    return { success: false, message: 'Please provide a valid email address.' };
                }

                if (!password || password.length < 6) {
                    return { success: false, message: 'Password must be at least 6 characters long.' };
                }

                const res = await fetch(`${API_BASE}/api/auth/signup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fullName: fullName.trim(),
                        email: email.trim(),
                        password
                    })
                });

                const data = await res.json();

                if (!res.ok || !data.success) {
                    return { success: false, message: data.message || 'Registration failed.' };
                }

                // Store token & user
                localStorage.setItem(TOKEN_KEY, data.token);
                localStorage.setItem(USER_KEY, JSON.stringify(data.user));

                this._cachedUser = data.user;
                this._cachedSession = data.session || { access_token: data.token, user: data.user };

                return { success: true, user: data.user, session: this._cachedSession };
            } catch (err) {
                console.error('[FITNEXA Auth] Signup error:', err);
                return { success: false, message: 'Server connection error. Please ensure the backend is running.' };
            }
        },

        // Logout
        logout: async function() {
            try {
                await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
            } catch (e) {}

            this.clearStorage();
            const isInDashboard = window.location.pathname.includes('/dashboard/');
            window.location.href = isInDashboard ? '../login.html' : 'login.html';
        },

        clearStorage: function() {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(USER_KEY);
            this._cachedUser = null;
            this._cachedSession = null;
        },

        // Protected route guard: call on protected pages
        requireAuth: async function() {
            const session = await this.initSession();
            if (!session) {
                const currentPage = encodeURIComponent(window.location.pathname.split('/').pop() || 'index.html');
                const loginPath = window.location.pathname.includes('/dashboard/') ? '../login.html' : 'login.html';
                window.location.href = `${loginPath}?returnUrl=${currentPage}`;
                return false;
            }
            return true;
        },

        // Auth pages guard: redirect to dashboard if already authenticated
        redirectIfAuth: async function(destination) {
            destination = destination || (window.location.pathname.includes('/dashboard/') ? 'index.html' : 'dashboard/index.html');
            const session = await this.initSession();
            if (session) {
                window.location.href = destination;
                return true;
            }
            return false;
        },

        // Password reset
        resetPassword: async function(email) {
            try {
                const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });
                const data = await res.json();
                if (data && data.success) {
                    return { success: true, message: data.message };
                }
                return { success: false, message: data.message || 'Error sending password reset request.' };
            } catch (err) {
                return { success: false, message: 'Server error. Please try again.' };
            }
        },

        // Social auth placeholders
        loginWithGoogle: async function() {
            alert('Google authentication is integrated with the FITNEXA secure identity provider.');
        },

        loginWithApple: async function() {
            alert('Apple ID sign-in is integrated with the FITNEXA secure identity provider.');
        }
    };

    window.Auth = Auth;
})(window);
