(() => {
  'use strict';

  const form = document.getElementById('pair-form');
  const input = document.getElementById('pair-code');
  const error = document.getElementById('pair-local-error');
  if (!form || !input || !error) return;

  function hideError() {
    error.hidden = true;
    error.textContent = '';
  }

  function showError(message) {
    error.textContent = message;
    error.hidden = false;
    input.focus();
  }

  input.addEventListener('input', () => {
    const normalized = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (input.value !== normalized) input.value = normalized;
    hideError();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = input.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) {
      showError('Enter the code shown under the QR on your laptop.');
      return;
    }
    location.assign(`/pair?t=${encodeURIComponent(code)}`);
  });
})();
