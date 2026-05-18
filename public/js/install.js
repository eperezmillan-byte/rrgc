// js/install.js
// PWA: registra el service worker y maneja el botón "Instalar"
//
// Comportamiento:
//  - Si el navegador dispara `beforeinstallprompt` (Chrome/Edge desktop+mobile),
//    mostramos el botón y al click llamamos prompt().
//  - En iOS Safari el evento no existe; mostramos un tooltip con instrucciones manuales
//    ("Compartir → Agregar a pantalla de inicio").
//  - Si la app ya está instalada (display-mode standalone), ocultamos el botón.

(function () {
  'use strict';

  let deferredPrompt = null;
  const btn = document.getElementById('btnInstall');
  const hint = document.getElementById('installHint');

  // ===== Registro del service worker =====
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/service-worker.js', { scope: '/' })
        .catch((err) => console.warn('[PWA] registro SW falló:', err));
    });
  }

  // ===== Detectar si ya está instalada =====
  function isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function showBtn(label = 'Instalar') {
    if (!btn) return;
    btn.textContent = label;
    btn.hidden = false;
  }

  function hideBtn() {
    if (btn) btn.hidden = true;
  }

  function showHint(msg) {
    if (!hint) return;
    hint.textContent = msg;
    hint.hidden = false;
    setTimeout(() => { hint.hidden = true; }, 8000);
  }

  // ===== Si ya está instalada, ocultamos todo =====
  if (isStandalone()) {
    hideBtn();
    return;
  }

  // ===== Chrome / Edge / Android: capturamos el evento =====
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showBtn('Instalar');
  });

  // ===== iOS: no hay evento, sólo instrucción manual =====
  if (isIOS()) {
    // Mostrar el botón con label distinto
    showBtn('Instalar');
  }

  // ===== Click del botón =====
  if (btn) {
    btn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          hideBtn();
        }
        deferredPrompt = null;
      } else if (isIOS()) {
        showHint(
          'En iOS: tocá el botón Compartir en Safari y elegí "Agregar a pantalla de inicio".'
        );
      } else {
        showHint(
          'Tu navegador no soporta instalación directa. Probá desde Chrome o Edge en mobile.'
        );
      }
    });
  }

  // ===== Cuando se completa la instalación, ocultamos el botón =====
  window.addEventListener('appinstalled', () => {
    hideBtn();
    deferredPrompt = null;
  });
})();
