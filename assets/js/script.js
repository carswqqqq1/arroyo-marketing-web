(function () {
  const menuButton = document.querySelector("[data-menu-toggle]");
  const nav = document.querySelector("[data-main-nav]");

  if (menuButton && nav) {
    menuButton.addEventListener("click", () => {
      const expanded = menuButton.getAttribute("aria-expanded") === "true";
      menuButton.setAttribute("aria-expanded", String(!expanded));
      nav.classList.toggle("open", !expanded);
      menuButton.textContent = expanded ? "Menu" : "Close";
    });

    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        nav.classList.remove("open");
        menuButton.setAttribute("aria-expanded", "false");
        menuButton.textContent = "Menu";
      });
    });
  }

  const currentPath = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll("[data-main-nav] a").forEach((link) => {
    const linkPath = link.getAttribute("href");
    if (linkPath === currentPath) {
      link.setAttribute("aria-current", "page");
    }
  });

  const yearNode = document.querySelector("[data-year]");
  if (yearNode) {
    yearNode.textContent = String(new Date().getFullYear());
  }

  const revealItems = document.querySelectorAll(".reveal");
  if (revealItems.length) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );

    revealItems.forEach((item) => observer.observe(item));
  }

  const form = document.querySelector('form[name="website-audit"]');
  if (form) {
    const params = new URLSearchParams(window.location.search);
    const successPanel = document.querySelector("[data-success-panel]");
    const statusNode = document.querySelector("[data-form-status]");

    if (params.get("submitted") === "1" && successPanel) {
      successPanel.classList.add("is-visible");
      successPanel.setAttribute("tabindex", "-1");
      successPanel.focus();
    }

    const hiddenValues = {
      source_page: window.location.pathname,
      current_path: window.location.pathname + window.location.search,
      utm_source: params.get("utm_source") || "",
      utm_medium: params.get("utm_medium") || "",
      utm_campaign: params.get("utm_campaign") || "",
      utm_term: params.get("utm_term") || "",
      utm_content: params.get("utm_content") || ""
    };

    Object.entries(hiddenValues).forEach(([name, value]) => {
      const field = form.querySelector(`[name="${name}"]`);
      if (field) {
        field.value = value;
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (!form.reportValidity()) {
        return;
      }

      const endpoint = form.getAttribute("data-lead-endpoint");
      if (!endpoint) {
        form.submit();
        return;
      }

      const submitButton = form.querySelector('button[type="submit"]');
      const payload = Object.fromEntries(new FormData(form).entries());

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Submitting...";
      }

      if (statusNode) {
        statusNode.textContent = "";
      }

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error("Lead submission failed");
        }

        const nextUrl = new URL(form.getAttribute("action") || window.location.href, window.location.origin);
        window.location.assign(nextUrl.toString());
      } catch (error) {
        if (statusNode) {
          statusNode.textContent = "Submission failed. Call or email and we can still get your audit started.";
        }
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = "Get a Free Website Audit";
        }
      }
    });
  }
})();
