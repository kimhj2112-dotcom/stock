const loginForm = document.getElementById('login-form');
const loginMessage = document.getElementById('login-message');

loginForm.addEventListener('submit', event => {
  event.preventDefault();
  loginMessage.textContent = '계정 로그인을 사용하려면 Firebase Authentication 연동이 필요합니다.';
});