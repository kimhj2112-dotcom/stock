const signupForm = document.getElementById('signup-form');
const signupMessage = document.getElementById('signup-message');
const signupButton = signupForm.querySelector('button[type="submit"]');

signupForm.addEventListener('submit', async event => {
  event.preventDefault();

  const password = signupForm.elements.password.value;
  const passwordConfirm = signupForm.elements.passwordConfirm.value;
  if (password !== passwordConfirm) {
    signupMessage.textContent = '비밀번호가 일치하지 않습니다.';
    signupMessage.dataset.state = 'error';
    signupForm.elements.passwordConfirm.focus();
    return;
  }

  signupMessage.textContent = '계정을 만드는 중...';
  signupMessage.dataset.state = '';
  signupButton.disabled = true;

  try {
    const response = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: signupForm.elements.name.value.trim(),
        phone: signupForm.elements.phone.value.trim(),
        email: signupForm.elements.email.value.trim(),
        password
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || '회원가입에 실패했습니다.');

    signupForm.reset();
    signupMessage.textContent = `${result.message} 로그인 페이지로 이동합니다.`;
    window.setTimeout(() => { window.location.href = '/login'; }, 1200);
  } catch (error) {
    signupMessage.textContent = error.message || '회원가입에 실패했습니다. 잠시 후 다시 시도해 주세요.';
    signupMessage.dataset.state = 'error';
  } finally {
    signupButton.disabled = false;
  }
});