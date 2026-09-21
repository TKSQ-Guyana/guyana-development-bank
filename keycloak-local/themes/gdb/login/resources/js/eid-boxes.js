/* The three-box e-ID control: ___ − ____ − ____
 *
 * WHAT THIS DOES. Keycloak's login form has one text input named `username`.
 * This replaces it *visually* with three boxes and keeps the real input in the
 * DOM, hidden, holding the combined `123-4567-8901`. Keycloak posts the form it
 * always posted; it has no idea the boxes exist.
 *
 * WHY NOT A TEMPLATE OVERRIDE. Because then we would own a copy of Keycloak's
 * PatternFly markup and have to re-check it on every upgrade, to change one
 * field. See the note in theme.properties.
 *
 * WHY THE REAL INPUT IS KEPT RATHER THAN REPLACED. Keycloak's own code and its
 * error rendering both reference `#username` — it is what gets focused after a
 * failed attempt and what `aria-invalid` is set on. Removing it and posting our
 * own field would work right up until one of those paths ran.
 *
 * DEGRADATION. If this script does not run, the citizen sees the stock single
 * field and signs in perfectly well. That is why the enhancement is applied by
 * script rather than the field being replaced in a template: there is no state
 * in which the page is broken, only one in which it is plainer.
 *
 * THE SHAPE IS STATED IN THREE PLACES and they must agree:
 *   backend/apps/gdb_bank/gdb_bank/domain/eid_format.py   (3, 4, 4)
 *   frontend/src/shared/identity/eid.ts
 *   here
 * A disagreement does not fail loudly. It fails as "Incorrect e-ID or
 * password", because that is what a token endpoint answers for a username it
 * does not recognise.
 */
(function () {
  'use strict';

  var PART_LENGTHS = [3, 4, 4];
  var TOTAL_DIGITS = PART_LENGTHS.reduce(function (sum, n) {
    return sum + n;
  }, 0);

  function digitsOnly(value) {
    return (value || '').replace(/\D/g, '');
  }

  /** `123-4567-8901` from eleven digits. */
  function group(digits) {
    var out = [];
    var at = 0;
    for (var i = 0; i < PART_LENGTHS.length; i++) {
      out.push(digits.slice(at, at + PART_LENGTHS[i]));
      at += PART_LENGTHS[i];
    }
    return out;
  }

  function enhance(field) {
    // Guard against running twice — Keycloak re-renders the form on a failed
    // attempt, and a second set of boxes over the same input would fight the
    // first for focus.
    if (field.dataset.gdbEid === 'on') return;
    field.dataset.gdbEid = 'on';

    var parts = group(digitsOnly(field.value));

    var group_ = document.createElement('div');
    group_.className = 'gdb-eid';
    group_.setAttribute('role', 'group');
    group_.setAttribute('aria-label', field.labels && field.labels[0] ? field.labels[0].textContent.trim() : 'e-ID Number');

    var boxes = [];

    function sync() {
      // The real input is the single source of truth for what gets posted.
      // Rebuilt from the boxes on every keystroke rather than patched, so
      // there is no path where the two disagree.
      field.value = boxes
        .map(function (b) {
          return b.value;
        })
        .join('-');
    }

    PART_LENGTHS.forEach(function (length, index) {
      if (index > 0) {
        var dash = document.createElement('span');
        dash.className = 'gdb-eid__dash';
        dash.setAttribute('aria-hidden', 'true');
        dash.textContent = '−';
        group_.appendChild(dash);
      }

      var box = document.createElement('input');
      box.type = 'text';
      box.inputMode = 'numeric';
      box.autocomplete = 'off';
      box.maxLength = length;
      box.value = parts[index] || '';
      box.className = 'gdb-eid__box';
      box.style.flex = String(length);
      box.setAttribute('aria-label', 'e-ID digits, group ' + (index + 1) + ' of ' + PART_LENGTHS.length);
      box.setAttribute('aria-describedby', 'gdb-eid-hint');

      box.addEventListener('input', function () {
        var cleaned = digitsOnly(box.value).slice(0, length);
        box.value = cleaned;
        // Auto-advance when a box fills, so eleven digits can be typed
        // straight through without reaching for Tab.
        if (cleaned.length === length && boxes[index + 1]) boxes[index + 1].focus();
        sync();
      });

      box.addEventListener('keydown', function (event) {
        // Backspace out of an empty box steps back rather than doing nothing —
        // the difference between three inputs and one field made of three.
        if (event.key === 'Backspace' && box.value === '' && boxes[index - 1]) {
          event.preventDefault();
          boxes[index - 1].focus();
        }
      });

      // Focusing a box SELECTS what it holds, so typing replaces rather than
      // appends. Without this, clicking back into a full box puts the caret at
      // the end and maxLength silently eats the keystrokes — correcting an
      // e-ID would mean hand-clearing three boxes.
      box.addEventListener('focus', function () {
        box.select();
      });

      box.addEventListener('paste', function (event) {
        // A pasted "123-4567-8901" (or eleven bare digits) fills all three
        // boxes instead of dropping eleven characters into one that holds
        // three. Anything else is left to the browser.
        var pasted = digitsOnly((event.clipboardData || window.clipboardData).getData('text'));
        if (pasted.length !== TOTAL_DIGITS) return;
        event.preventDefault();
        group(pasted).forEach(function (value, i) {
          boxes[i].value = value;
        });
        sync();
        boxes[boxes.length - 1].focus();
      });

      boxes.push(box);
      group_.appendChild(box);
    });

    var hint = document.createElement('p');
    hint.id = 'gdb-eid-hint';
    hint.className = 'gdb-eid__hint';
    hint.textContent = field.dataset.gdbHint || 'The 11-digit number on your national e-ID card.';

    // INSERT OUTSIDE THE FORM-CONTROL WRAPPER, NOT NEXT TO THE INPUT.
    // keycloak.v2 wraps the input in `span.pf-v5-c-form-control`, which is
    // `display: grid` with a single cell sized for one control. Putting a
    // three-box flex row in that cell overflowed the card and pushed the hint
    // outside it. The form group one level up is an ordinary block, which is
    // where a replacement control belongs.
    var wrapper = field.closest('.pf-v5-c-form-control') || field;
    var host = wrapper.parentNode;

    host.insertBefore(group_, wrapper);
    host.insertBefore(hint, wrapper);

    // The original control is hidden, not removed — Keycloak's error handling
    // focuses and marks this element by id, and the input must stay inside the
    // form to be submitted. `display:none` on the wrapper hides PatternFly's
    // chrome with it; `type=hidden` on the input stops any browser trying to
    // autofill or validate a control nobody can see.
    if (wrapper !== field) wrapper.style.display = 'none';
    field.type = 'hidden';

    sync();

    // AFTER A FAILED ATTEMPT, FOCUS THE PASSWORD, NOT THE E-ID.
    //
    // Keycloak re-renders the whole form on a failed sign-in and clears only
    // the password. The e-ID is almost never the thing that was wrong — it is
    // printed on a card in the citizen's hand — so putting the caret back in
    // box one invites them to retype eleven correct digits while the field
    // that actually failed sits empty below.
    //
    // The selectors are Keycloak 26's: the message lands in a helper-text item
    // whose container is `input-error-<field>`, and the input carries
    // `aria-invalid`. An earlier guess at `#input-error` matched nothing, so
    // this stole focus on every failure.
    var failed =
      field.getAttribute('aria-invalid') === 'true' ||
      !!document.querySelector('[id^="input-error"], .kc-feedback-text, .pf-v5-c-alert.pf-m-danger');

    if (failed) {
      // Carry the invalid state onto the controls the citizen can actually
      // see. The real input is hidden, so its aria-invalid reaches nobody.
      boxes.forEach(function (b) {
        b.setAttribute('aria-invalid', 'true');
        b.classList.add('gdb-eid__box--invalid');
      });
      var password = document.getElementById('password');
      if (password) password.focus();
    } else {
      boxes[0].focus();
    }
  }

  function start() {
    var field = document.getElementById('username');
    // Only the sign-in form. The same id appears on the forgot-password and
    // registration pages, where a three-box control may not be what is wanted;
    // `data-page-id` is set by Keycloak's own base template.
    var page = document.body.getAttribute('data-page-id');
    if (field && page === 'login-login') enhance(field);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
