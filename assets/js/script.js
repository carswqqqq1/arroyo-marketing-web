(function () {
  const menuButton = document.querySelector("[data-menu-toggle]");
  const nav = document.querySelector("[data-main-nav]");

  if (menuButton && nav) {
    const inertTargets = [...document.querySelectorAll("main, .top-bar, .site-footer, .mobile-cta-bar")];
    const setMenuState = (isOpen, { restoreFocus = false } = {}) => {
      nav.classList.toggle("open", isOpen);
      menuButton.setAttribute("aria-expanded", String(isOpen));
      menuButton.setAttribute("aria-label", isOpen ? "Close site navigation" : "Open site navigation");
      menuButton.textContent = isOpen ? "Close" : "Menu";
      document.body.classList.toggle("menu-open", isOpen);

      inertTargets.forEach((target) => {
        target.inert = isOpen;
        if (isOpen) {
          target.setAttribute("aria-hidden", "true");
        } else {
          target.removeAttribute("aria-hidden");
        }
      });

      if (!isOpen && restoreFocus) {
        menuButton.focus();
      }
    };

    setMenuState(false);

    menuButton.addEventListener("click", () => {
      const expanded = menuButton.getAttribute("aria-expanded") === "true";
      setMenuState(!expanded);
    });

    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        setMenuState(false);
      });
    });

    document.addEventListener("keydown", (event) => {
      const expanded = menuButton.getAttribute("aria-expanded") === "true";
      if (event.key === "Escape" && expanded) {
        event.preventDefault();
        setMenuState(false, { restoreFocus: true });
        return;
      }

      if (event.key === "Tab" && expanded) {
        const focusable = [menuButton, ...nav.querySelectorAll("a[href]")];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    document.addEventListener("click", (event) => {
      const expanded = menuButton.getAttribute("aria-expanded") === "true";
      if (!expanded) {
        return;
      }

      if (!nav.contains(event.target) && !menuButton.contains(event.target)) {
        setMenuState(false);
      }
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 980 && menuButton.getAttribute("aria-expanded") === "true") {
        setMenuState(false);
      }
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
  if (revealItems.length && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.14 }
    );

    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add("is-visible"));
  }

  const form = document.querySelector('form[name="contact"], form[name="website-audit"]');
  if (!form) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const successPanel = document.querySelector("[data-success-panel]");
  const statusNode = document.querySelector("[data-form-status]");
  const auditResults = document.querySelector("[data-audit-results]");
  const auditHeadline = document.querySelector("[data-audit-headline]");
  const auditScore = document.querySelector("[data-audit-score]");
  const auditSummary = document.querySelector("[data-audit-summary]");
  const auditPriority = document.querySelector("[data-audit-priority]");
  const auditStrengths = document.querySelector("[data-audit-strengths]");
  const auditWins = document.querySelector("[data-audit-wins]");
  const submitLabel = form.dataset.submitLabel || "Send Request";

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

  function getPriorityMeta(priority) {
    const normalized = String(priority || "Medium").toLowerCase();
    if (normalized === "high") {
      return { label: "High Priority", className: "priority-high" };
    }
    if (normalized === "low") {
      return { label: "Low Priority", className: "priority-low" };
    }
    return { label: "Medium Priority", className: "priority-medium" };
  }

  function renderList(node, items, type) {
    if (!node) return;
    node.innerHTML = "";

    const listItems = items && items.length ? items : [{ text: "No automated notes yet. We can review it manually.", priority: "Medium" }];

    listItems.forEach((item) => {
      const li = document.createElement("li");
      li.className = "result-item";

      if (type === "quickWins") {
        const meta = document.createElement("div");
        meta.className = "result-meta";

        const priority = document.createElement("span");
        const priorityMeta = getPriorityMeta(item.priority);
        priority.className = `priority-pill ${priorityMeta.className}`;
        priority.textContent = priorityMeta.label;
        meta.appendChild(priority);

        li.appendChild(meta);

        const body = document.createElement("p");
        body.textContent = item.text || String(item);
        li.appendChild(body);
      } else {
        const body = document.createElement("p");
        body.textContent = item.text || String(item);
        li.appendChild(body);
      }

      node.appendChild(li);
    });
  }

  function renderAudit(audit) {
    if (!audit || !auditResults) return;

    auditResults.hidden = false;
    if (auditHeadline) auditHeadline.textContent = audit.headline || "Audit ready";
    if (auditScore) auditScore.textContent = String(audit.score || 0);
    if (auditSummary) auditSummary.textContent = audit.summary || "";

    if (auditPriority) {
      const priorityMeta = getPriorityMeta(audit.overallPriority || "Medium");
      auditPriority.textContent = `Priority: ${priorityMeta.label.replace(" Priority", "")}`;
      auditPriority.className = `audit-priority-chip ${priorityMeta.className}`;
    }

    renderList(auditStrengths, audit.strengths, "strengths");
    renderList(auditWins, audit.quickWins, "quickWins");
    auditResults.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function restoreHiddenValues() {
    Object.entries(hiddenValues).forEach(([name, value]) => {
      const field = form.querySelector(`[name="${name}"]`);
      if (field) field.value = value;
    });
  }

  function showSuccess() {
    if (!successPanel) return;
    successPanel.classList.add("is-visible");
    successPanel.setAttribute("tabindex", "-1");
    successPanel.focus();
  }

  function resetPreviousResult() {
    if (successPanel) {
      successPanel.classList.remove("is-visible");
      successPanel.removeAttribute("tabindex");
    }
    if (auditResults) auditResults.hidden = true;
    if (statusNode) statusNode.textContent = "";
  }

  async function saveNetlifyCopy(formData) {
    const encoded = new URLSearchParams();
    formData.forEach((value, key) => {
      encoded.append(key, String(value));
    });

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      return await fetch("/", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: encoded.toString(),
        signal: controller.signal
      });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    resetPreviousResult();

    if (!form.reportValidity()) {
      return;
    }

    const endpoint = form.getAttribute("data-lead-endpoint");
    if (!endpoint) {
      form.submit();
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    const runBackup = () => saveNetlifyCopy(formData).catch(() => null);

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Sending...";
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json().catch(() => ({}));
      const supportedPlatform = result.platform === "cloudflare" || result.platform === "netlify";
      const durablePrimary = result.delivery?.owner === "sent" || result.storage?.sheet === "saved";
      if (!response.ok || result.ok !== true || !supportedPlatform || !durablePrimary) {
        const requestError = new Error(result.message || "Lead submission failed");
        requestError.statusCode = response.status;
        requestError.platform = result.platform || "";
        throw requestError;
      }

      if (result.platform === "netlify") {
        void runBackup();
      }

      showSuccess();

      if (result.audit) {
        renderAudit(result.audit);
      }

      if (statusNode) {
        statusNode.textContent = result.message || "Your request was safely received. Arroyo will reply with the clearest next step.";
      }

      form.reset();
      restoreHiddenValues();
    } catch (error) {
      const shouldBackup = error.platform === "netlify" && (!error.statusCode || error.statusCode >= 500);
      const backupResponse = shouldBackup ? await runBackup() : null;
      const backupSaved = Boolean(backupResponse && backupResponse.ok);
      if (backupSaved) {
        showSuccess();
        form.reset();
        restoreHiddenValues();
      }
      if (statusNode) {
        statusNode.textContent = backupSaved
          ? "Your request was saved through our backup intake. Arroyo will review it manually."
          : error.message || "Submission failed. Call or email and Arroyo can still help.";
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = submitLabel;
      }
    }
  });
})();
