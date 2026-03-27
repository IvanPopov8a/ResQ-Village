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

function doLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const users = JSON.parse(localStorage.getItem('resq_users') || '[]');
  const user  = users.find(u => u.username === username && u.password === password);
  if (user) {
    loginSuccess(user.username);
  } else {
    showMsg('Грешно потребителско име или парола.', 'error');
  }
}

function doRegister(e) {
  e.preventDefault();
  const username = document.getElementById('regUser').value.trim();
  const email    = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPass').value;
  const confirm  = document.getElementById('regPass2').value;

  if (password.length < 4) { showMsg('Паролата трябва да е поне 4 символа.', 'error'); return; }
  if (password !== confirm) { showMsg('Паролите не съвпадат.', 'error'); return; }

  const users = JSON.parse(localStorage.getItem('resq_users') || '[]');
  if (users.find(u => u.username === username)) {
    showMsg('Потребителското име е заето.', 'error'); return;
  }

  users.push({ username, email, password });
  localStorage.setItem('resq_users', JSON.stringify(users));
  showMsg('Регистрацията е успешна!', 'success');
  setTimeout(() => loginSuccess(username), 1200);
}

function loginSuccess(username) {
  localStorage.setItem('resq_session', username);
  document.getElementById('authButtons').style.display  = 'none';
  document.getElementById('userGreeting').style.display = 'flex';
  document.getElementById('userName').textContent        = username;
  document.getElementById('userAvatar').textContent      = username.charAt(0).toUpperCase();
  closeAuth();
}

function logout() {
  localStorage.removeItem('resq_session');
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
  el.textContent = '';
  el.className   = 'auth-message';
}

// Close on backdrop click
document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('authModal').addEventListener('click', function (e) {
    if (e.target === this) closeAuth();
  });

  // Restore session on load
  const s = localStorage.getItem('resq_session');
  if (s) {
    document.getElementById('authButtons').style.display  = 'none';
    document.getElementById('userGreeting').style.display = 'flex';
    document.getElementById('userName').textContent        = s;
    document.getElementById('userAvatar').textContent      = s.charAt(0).toUpperCase();
  }
});
