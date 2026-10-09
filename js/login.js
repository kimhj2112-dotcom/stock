const loginForm = document.getElementById('login-form');
const loginMessage = document.getElementById('login-message');
const loginButton = loginForm.querySelector('button[type="submit"]');

fetch('/api/auth/session')
  .then(response => response.ok ? response.json() : { authenticated: false })
  .then(session => {
    if (session.authenticated) window.location.replace('/');
  })
  .catch(() => {});

loginForm.addEventListener('submit', async event => {
  event.preventDefault();

  loginMessage.textContent = '로그인 중...';
  loginMessage.dataset.state = '';
  loginButton.disabled = true;

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: loginForm.elements.email.value.trim(),
        password: loginForm.elements.password.value
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || '로그인에 실패했습니다.');

    loginMessage.textContent = result.message;
    loginForm.reset();
    window.setTimeout(() => { window.location.href = '/'; }, 500);
  } catch (error) {
    loginMessage.textContent = error.message || '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
    loginMessage.dataset.state = 'error';
  } finally {
    loginButton.disabled = false;
  }
});