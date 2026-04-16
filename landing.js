/* DepositDefender — Landing page interactions
 * Owned by Morgan
 *
 * Responsibilities:
 *  - Email capture form: validate, POST to /api/subscribe, redirect to /tool.html
 *  - Open-the-tool buttons: pass-through, no special handling
 *  - Smooth scroll behavior is left to the browser via CSS (none needed here)
 */

(function () {
  'use strict';

  var form = document.getElementById('landing-email-form');
  var input = document.getElementById('landing-email');
  var status = document.getElementById('landing-status');
  var submit = document.getElementById('landing-submit');

  if (!form || !input || !status || !submit) return;

  function setStatus(msg, isError) {
    status.textContent = msg || '';
    status.classList.toggle('is-error', !!isError);
  }

  function isValidEmail(value) {
    // Pragmatic check; server is authoritative.
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function redirectToTool(email) {
    var qs = email ? '?email=' + encodeURIComponent(email) + '&utm_source=landing' : '?utm_source=landing';
    window.location.href = '/tool.html' + qs;
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var email = (input.value || '').trim();

    if (!isValidEmail(email)) {
      setStatus('Enter a valid email — we only need it to send the report.', true);
      input.focus();
      return;
    }

    setStatus('');
    submit.disabled = true;
    var originalLabel = submit.textContent;
    submit.textContent = 'Saving…';

    fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, source: 'landing' })
    })
      .then(function (res) {
        // Don't block redirect on subscribe failure — the user wants the tool.
        if (!res.ok) {
          return res.json().catch(function () { return null; }).then(function () { return null; });
        }
        return res.json().catch(function () { return null; });
      })
      .catch(function () { return null; })
      .then(function () {
        setStatus('Got it. Opening the tool…');
        // Brief delay so the status reads.
        window.setTimeout(function () { redirectToTool(email); }, 350);
      })
      .finally(function () {
        // Restore button state in case redirect is blocked.
        submit.disabled = false;
        submit.textContent = originalLabel;
      });
  });
})();
