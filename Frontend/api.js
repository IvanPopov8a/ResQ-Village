/**
 * api.js — ResQ Village Central API Client
 * Manages all HTTP communication with the Python Backend.
 */

// Configuration - change these for production
const API_BASE_URL = window.location.protocol + '//' + window.location.hostname + ':8000';

const API = {
  login: `${API_BASE_URL}/login`,
  register: `${API_BASE_URL}/users`,
};

const api = {
    /**
     * Core Fetch wrapper with Auth header support
     */
    async request(endpoint, options = {}) {
        const url = `${API_BASE_URL}${endpoint}`;
        const token = localStorage.getItem('resq_token');

        const headers = {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            ...options.headers
        };

        try {
            const response = await fetch(url, { ...options, headers });
            const data = await response.json();

            if (!response.ok) {
                // Handle 401 Unauthorized - token expired
                if (response.status === 401 && token) {
                    // Token is invalid, logout user
                    localStorage.removeItem('resq_session_email');
                    localStorage.removeItem('resq_session');
                    localStorage.removeItem('resq_token');
                    // Update UI if elements exist
                    const authButtons = document.getElementById('authButtons');
                    const userGreeting = document.getElementById('userGreeting');
                    if (authButtons && userGreeting) {
                        authButtons.style.display = 'flex';
                        userGreeting.style.display = 'none';
                    }
                    // Open login modal
                    if (typeof openAuth === 'function') {
                        openAuth('login');
                    }
                    return { error: 'Сесията е изтекла. Моля, влезте отново.', status: 401 };
                }
                // Return errors in a consistent format
                return { error: data.error || data.detail || 'Възникна системна грешка', status: response.status };
            }
            return data;
        } catch (error) {
            console.error(`API Error [${endpoint}]:`, error);
            return { error: 'Няма връзка със сървъра. Проверете интернет връзката си.', status: 500 };
        }
    },

    // --- AUTH ---
    async login(email, password) {
        return this.request('/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
    },

    async register(email, password) {
        return this.request('/users', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
    },

    async getProfile() {
        return this.request('/profile');
    },

    // --- DISASTER STATUS ---
    /**
     * getStatus() calls the backend logic which:
     * 1. Fetches current real-time disaster probabilities.
     * 2. Automatically triggers Node.js alerts for high-risk areas.
     */
    async getStatus() {
        return this.request('/get-status');
    },

    async getDistrictGuide(lat, lng, hasDisaster) {
        return this.request('/districts/guide', {
            method: 'POST',
            body: JSON.stringify({ lat, lng, has_disaster: hasDisaster })
        });
    },

    async getSafeLocation(lat, lng, currentDistrictId = "") {
        const query = new URLSearchParams({ lat, lng, current_district_id: currentDistrictId }).toString();
        return this.request(`/safe-location?${query}`);
    }
};

// Export to window for global access (since we are using static HTML/JS)
window.api = api;
