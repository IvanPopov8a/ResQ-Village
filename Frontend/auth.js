/* ===================== AUTH.JS — ResQ Village ===================== */

function openAuth(tab) {
  document.getElementById('authModal').style.display = 'flex';
  switchTab(tab || 'login');
  clearMsg();
}

function closeAuth() {
  document.getElementById('authModal').style.display = 'none';
  document.getElementById('loginForm').reset();
  document.getElementById('registerForm').reset();
  clearMsg();
}

function switchTab(tab) {
  clearMsg();
  const isLogin = tab === 'login';
  document.getElementById('tabLogin').classList.toggle('active', isLogin);
  document.getElementById('tabRegister').classList.toggle('active', !isLogin);
  document.getElementById('loginForm').style.display  = isLogin ? 'flex' : 'none';
  document.getElementById('registerForm').style.display = isLogin ? 'none' : 'flex';
}

async function doLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPass').value.trim();
  
  try {
    const data = await window.api.login(email, password);
    
    if (data.access_token) {
      localStorage.setItem('resq_token', data.access_token);
      loginSuccess(email);
    } else {
      showMsg(data.error || 'Грешен имейл или парола.', 'error');
    }
  } catch (error) {
    showMsg('Грешка при свързване със сървъра.', 'error');
    console.error('Login error:', error);
  }
}

async function doRegister(e) {
  e.preventDefault();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPass').value.trim();
  const confirm = document.getElementById('regPass2').value.trim();

  // Validate password strength
  if (password.length < 12) {
    showMsg('Паролата трябва да е поне 12 символа.', 'error');
    return;
  }
  if (!/[A-Z]/.test(password)) {
    showMsg('Паролата трябва да съдържа поне една главна буква.', 'error');
    return;
  }
  if (!/[a-z]/.test(password)) {
    showMsg('Паролата трябва да съдържа поне една малка буква.', 'error');
    return;
  }
  if (!/[0-9]/.test(password)) {
    showMsg('Паролата трябва да съдържа поне една цифра.', 'error');
    return;
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};\':"\\|,.<>\/?]/.test(password)) {
    showMsg('Паролата трябва да съдържа поне един специален символ.', 'error');
    return;
  }
  if (password !== confirm) { 
    showMsg('Паролите не съвпадат.', 'error'); 
    return; 
  }

  try {
    const data = await window.api.register(email, password);
    
    if (!data.error) {
      showMsg('Регистрацията е успешна! Влизане...', 'success');
      // Automatically log in using the credentials we just registered
      setTimeout(() => {
        document.getElementById('loginEmail').value = email;
        document.getElementById('loginPass').value = password;
        switchTab('login');
        document.getElementById('loginForm').dispatchEvent(new Event('submit', { cancelable: true }));
      }, 1500);
    } else {
      showMsg(data.error || 'Възникна грешка при регистрация.', 'error');
    }
  } catch (error) {
    showMsg('Грешка при свързване със сървъра.', 'error');
    console.error('Register error:', error);
  }
}

function loginSuccess(email) {
  localStorage.setItem('resq_session_email', email);
  localStorage.setItem('resq_session', email);  // Set for map.js usage
  document.getElementById('authButtons').style.display  = 'none';
  document.getElementById('userGreeting').style.display = 'flex';
  
  // Display the prefix of the email as the username
  const displayName = email.split('@')[0];
  document.getElementById('userName').textContent = displayName;
  document.getElementById('userAvatar').textContent = displayName.charAt(0).toUpperCase();
  closeAuth();
}

function logout() {
  localStorage.removeItem('resq_session_email');
  localStorage.removeItem('resq_session');
  localStorage.removeItem('resq_token');
  document.getElementById('authButtons').style.display  = 'flex';
  document.getElementById('userGreeting').style.display = 'none';
}

function showMsg(text, type) {
  const el = document.getElementById('authMsg');
  el.textContent = text;
  el.className   = 'auth-message ' + type;
}

function clearMsg() {
  const el = document.getElementById('authMsg');
  if(el) {
    el.textContent = '';
    el.className   = 'auth-message';
  }
}

// Close on backdrop click & Restore Session
document.addEventListener('DOMContentLoaded', function () {
  const authModal = document.getElementById('authModal');
  if (authModal) {
    authModal.addEventListener('click', function (e) {
      if (e.target === this) closeAuth();
    });
  }

  // Restore session on load
  const email = localStorage.getItem('resq_session_email');
  const token = localStorage.getItem('resq_token');
  
  if (email && token && document.getElementById('authButtons')) {
    localStorage.setItem('resq_session', email);  // Ensure it's set
    document.getElementById('authButtons').style.display  = 'none';
    document.getElementById('userGreeting').style.display = 'flex';
    
    const displayName = email.split('@')[0];
    document.getElementById('userName').textContent = displayName;
    document.getElementById('userAvatar').textContent = displayName.charAt(0).toUpperCase();
  }
});
