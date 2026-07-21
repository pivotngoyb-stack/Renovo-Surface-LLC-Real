/* =========================================================================
   Renovo Surface Solutions — shared site interactivity
   Safe to include on every page: every block guards for missing elements.
   ========================================================================= */

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

document.addEventListener('DOMContentLoaded', () => {
  initLoader();
  initStickyHeader();
  initMobileMenu();
  initTypingAnimation();
  initScrollReveal();
  initCounters();
  initParticles();
  initParallax();
  initBeforeAfterSliders();
  initTiltCards();
  initRipple();
  initQuoteModal();
  initAllQuoteForms();
  initGalleryFilter();
  initServiceTabs();
  initTestimonialAutoRotate();
});

/* ---------------------------------------------------------------------- */
function initLoader() {
  const loader = document.getElementById('loader');
  if (!loader) return;
  const minDelay = prefersReducedMotion ? 0 : 1600;
  const start = Date.now();
  const finish = () => {
    const elapsed = Date.now() - start;
    const wait = Math.max(0, minDelay - elapsed);
    setTimeout(() => loader.classList.add('hidden'), wait);
  };
  if (document.readyState === 'complete') finish();
  else window.addEventListener('load', finish);
}

/* ---------------------------------------------------------------------- */
function initStickyHeader() {
  const nav = document.querySelector('.navbar');
  if (!nav) return;
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 80);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

/* ---------------------------------------------------------------------- */
function initMobileMenu() {
  const btn = document.querySelector('.hamburger');
  const menu = document.querySelector('.mobile-menu');
  if (!btn || !menu) return;
  const close = () => { btn.classList.remove('open'); menu.classList.remove('open'); };
  btn.addEventListener('click', () => {
    btn.classList.toggle('open');
    menu.classList.toggle('open');
  });
  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
}

/* ---------------------------------------------------------------------- */
function initTypingAnimation() {
  const el = document.querySelector('[data-typing]');
  if (!el) return;
  let phrases;
  try { phrases = JSON.parse(el.dataset.typing); } catch { phrases = []; }
  if (!phrases.length) return;

  const textSpan = document.createElement('span');
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  cursor.textContent = ' ';
  el.textContent = '';
  el.append(textSpan, cursor);

  if (prefersReducedMotion) { textSpan.textContent = phrases[0]; return; }

  let phraseIdx = 0, charIdx = 0, deleting = false;
  const TYPE_MS = 65, DELETE_MS = 35, HOLD_MS = 1400, GAP_MS = 400;

  function tick() {
    const current = phrases[phraseIdx];
    if (!deleting) {
      charIdx++;
      textSpan.textContent = current.slice(0, charIdx);
      if (charIdx === current.length) {
        deleting = true;
        return setTimeout(tick, HOLD_MS);
      }
      return setTimeout(tick, TYPE_MS);
    } else {
      charIdx--;
      textSpan.textContent = current.slice(0, charIdx);
      if (charIdx === 0) {
        deleting = false;
        phraseIdx = (phraseIdx + 1) % phrases.length;
        return setTimeout(tick, GAP_MS);
      }
      return setTimeout(tick, DELETE_MS);
    }
  }
  setTimeout(tick, 600);
}

/* ---------------------------------------------------------------------- */
function initScrollReveal() {
  const items = document.querySelectorAll('.reveal');
  if (!items.length) return;
  if (prefersReducedMotion) { items.forEach(i => i.classList.add('in')); return; }

  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const group = el.closest('[data-stagger]');
        let delay = 0;
        if (group) {
          const siblings = Array.from(group.querySelectorAll('.reveal'));
          delay = siblings.indexOf(el) * 100;
        }
        setTimeout(() => el.classList.add('in'), delay);
        io.unobserve(el);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });

  items.forEach(el => io.observe(el));
}

/* ---------------------------------------------------------------------- */
function initCounters() {
  const items = document.querySelectorAll('[data-counter]');
  if (!items.length) return;

  const animate = (el) => {
    const target = parseFloat(el.dataset.counter);
    const suffix = el.dataset.suffix || '';
    const dur = 1600;
    const start = performance.now();
    const easeOutExpo = t => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

    function frame(now) {
      const p = Math.min((now - start) / dur, 1);
      const val = Math.round(target * easeOutExpo(p));
      el.textContent = val + suffix;
      if (p < 1) requestAnimationFrame(frame);
      else el.textContent = target + suffix;
    }
    requestAnimationFrame(frame);
  };

  if (prefersReducedMotion) {
    items.forEach(el => { el.textContent = el.dataset.counter + (el.dataset.suffix || ''); });
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) { animate(entry.target); io.unobserve(entry.target); }
    });
  }, { threshold: 0.5 });
  items.forEach(el => io.observe(el));
}

/* ---------------------------------------------------------------------- */
function initParticles() {
  const canvas = document.getElementById('particle-canvas');
  if (!canvas || prefersReducedMotion) return;
  const ctx = canvas.getContext('2d');
  let w, h, particles;

  function resize() {
    w = canvas.width = canvas.offsetWidth;
    h = canvas.height = canvas.offsetHeight;
  }

  function makeParticles() {
    const count = Math.max(24, Math.round((w * h) / 22000));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 2.2 + 0.6,
      speed: Math.random() * 0.5 + 0.15,
      drift: (Math.random() - 0.5) * 0.3,
      alpha: Math.random() * 0.5 + 0.15
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    particles.forEach(p => {
      p.y -= p.speed;
      p.x += p.drift;
      if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
      if (p.x < -10) p.x = w + 10;
      if (p.x > w + 10) p.x = -10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(90, 180, 255, ${p.alpha})`;
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }

  const ro = new ResizeObserver(() => { resize(); makeParticles(); });
  ro.observe(canvas);
  resize();
  makeParticles();
  requestAnimationFrame(draw);
}

/* ---------------------------------------------------------------------- */
function initParallax() {
  const layers = document.querySelectorAll('[data-parallax]');
  if (!layers.length || prefersReducedMotion) return;

  let ticking = false;
  function update() {
    const vh = window.innerHeight;
    layers.forEach(layer => {
      const speed = parseFloat(layer.dataset.parallax) || 0.25;
      const rect = layer.parentElement.getBoundingClientRect();
      const centerOffset = rect.top + rect.height / 2 - vh / 2;
      const y = centerOffset * speed * -1;
      layer.style.transform = `translate3d(0, ${y}px, 0) scale(1.15)`;
    });
    ticking = false;
  }
  function onScroll() {
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
}

/* ---------------------------------------------------------------------- */
function initBeforeAfterSliders() {
  const sliders = document.querySelectorAll('.ba-slider');
  sliders.forEach(slider => {
    const after = slider.querySelector('.ba-after');
    const handle = slider.querySelector('.ba-handle');
    let dragging = false;

    function setPos(clientX) {
      const rect = slider.getBoundingClientRect();
      let pct = ((clientX - rect.left) / rect.width) * 100;
      pct = Math.min(100, Math.max(0, pct));
      after.style.clipPath = `inset(0 0 0 ${pct}%)`;
      handle.style.left = `${pct}%`;
    }

    slider.addEventListener('pointerdown', (e) => { dragging = true; setPos(e.clientX); slider.setPointerCapture(e.pointerId); });
    slider.addEventListener('pointermove', (e) => { if (dragging) setPos(e.clientX); });
    slider.addEventListener('pointerup', () => dragging = false);
    slider.addEventListener('pointerleave', () => dragging = false);
    slider.addEventListener('click', (e) => setPos(e.clientX));
  });
}

/* ---------------------------------------------------------------------- */
function initTiltCards() {
  if (prefersReducedMotion) return;
  const cards = document.querySelectorAll('.tilt-card');
  cards.forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      const rotateX = (y / rect.height) * -10;
      const rotateY = (x / rect.width) * 10;
      card.style.transform = `perspective(700px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(700px) rotateX(0) rotateY(0) translateY(0)';
    });
  });
}

/* ---------------------------------------------------------------------- */
function initRipple() {
  if (prefersReducedMotion) return;
  document.addEventListener('click', (e) => {
    const ripple = document.createElement('div');
    ripple.className = 'ripple';
    const size = 220;
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = e.clientX + 'px';
    ripple.style.top = e.clientY + 'px';
    document.body.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  });
}

/* ---------------------------------------------------------------------- */
function initQuoteModal() {
  const overlay = document.querySelector('.modal-overlay');
  if (!overlay) return;
  const openers = document.querySelectorAll('[data-open-modal]');
  const closeBtn = overlay.querySelector('.modal-close');
  const form = overlay.querySelector('form');
  const success = overlay.querySelector('.form-success');
  const serviceField = overlay.querySelector('[name="Service Needed"]');

  const open = (service) => {
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (service && serviceField) serviceField.value = service;
  };
  const close = () => {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  };

  openers.forEach(btn => btn.addEventListener('click', () => open(btn.dataset.service)));
  closeBtn?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

/* ---------------------------------------------------------------------- */
function initAllQuoteForms() {
  document.querySelectorAll('.quote-form').forEach(form => {
    const success = form.parentElement.querySelector('.form-success');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = form.querySelector('button[type="submit"]');
      const originalLabel = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
      try {
        const res = await fetch('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(new FormData(form)).toString()
        });
        if (res.ok) {
          form.style.display = 'none';
          success?.classList.add('show');
        } else {
          throw new Error('Submission failed');
        }
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
        alert('Something went wrong sending your request. Please call 801-369-2330 or try again.');
      }
    });
  });
}

/* ---------------------------------------------------------------------- */
function initGalleryFilter() {
  const buttons = document.querySelectorAll('.filter-btn');
  const items = document.querySelectorAll('.gallery-item');
  if (!buttons.length || !items.length) return;

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.dataset.filter;
      items.forEach(item => {
        const show = filter === 'all' || item.dataset.category === filter;
        item.style.display = show ? '' : 'none';
      });
    });
  });
}

/* ---------------------------------------------------------------------- */
function initServiceTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');
  if (!tabs.length || !panels.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab)?.classList.add('active');
    });
  });
}

/* ---------------------------------------------------------------------- */
function initTestimonialAutoRotate() {
  const grid = document.querySelector('.testimonial-grid');
  if (!grid) return;
  const cards = Array.from(grid.children);
  if (cards.length < 2) return;

  const mq = window.matchMedia('(max-width: 760px)');
  let idx = 0, timer = null;

  function show(i) {
    cards.forEach((c, ci) => c.style.display = ci === i ? '' : 'none');
  }
  function start() {
    if (timer || prefersReducedMotion) return;
    show(idx);
    timer = setInterval(() => { idx = (idx + 1) % cards.length; show(idx); }, 5000);
  }
  function stop() {
    clearInterval(timer);
    timer = null;
    cards.forEach(c => c.style.display = '');
  }
  function sync() { mq.matches ? start() : stop(); }
  mq.addEventListener('change', sync);
  sync();
}
