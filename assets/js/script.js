(function () {
  const menuButton = document.querySelector('[data-menu-toggle]');
  const nav = document.querySelector('[data-main-nav]');

  if (menuButton && nav) {
    menuButton.addEventListener('click', () => {
      const expanded = menuButton.getAttribute('aria-expanded') === 'true';
      menuButton.setAttribute('aria-expanded', String(!expanded));
      nav.classList.toggle('open', !expanded);
      menuButton.textContent = expanded ? 'Menu' : 'Close';
    });

    nav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        nav.classList.remove('open');
        menuButton.setAttribute('aria-expanded', 'false');
        menuButton.textContent = 'Menu';
      });
    });
  }

  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  const navLinks = document.querySelectorAll('[data-main-nav] a');
  navLinks.forEach((link) => {
    const linkPath = link.getAttribute('href');
    if (linkPath === currentPath) {
      link.setAttribute('aria-current', 'page');
    }
  });

  const yearNode = document.querySelector('[data-year]');
  if (yearNode) {
    yearNode.textContent = String(new Date().getFullYear());
  }

  const revealItems = document.querySelectorAll('.reveal');
  if (revealItems.length) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );

    revealItems.forEach((item) => observer.observe(item));
  }
})();
