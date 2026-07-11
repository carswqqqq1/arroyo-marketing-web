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
  const genericSubmissionError = "We couldn't send your request right now. Call (480) 339-9585 or email contact@arroyomarketing.com and Arroyo can still help.";
  const submissionIdInput = form.querySelector('input[name="submission_id"]');
  const submissionStorageKey = "arroyo_contact_submission_id";

  function createSubmissionId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
      const random = Math.floor(Math.random() * 16);
      const value = character === "x" ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  }

  function setSubmissionId({ fresh = false } = {}) {
    if (!submissionIdInput) return;
    let id = "";
    if (!fresh) {
      try {
        id = window.sessionStorage.getItem(submissionStorageKey) || "";
      } catch {
        id = "";
      }
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) id = createSubmissionId();
    submissionIdInput.value = id;
    try {
      window.sessionStorage.setItem(submissionStorageKey, id);
    } catch {
      // The hidden value still keeps same-page retries stable when storage is unavailable.
    }
  }

  setSubmissionId();

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

  function safeSubmissionError(error) {
    const apiMessage = Number.isInteger(error?.statusCode) && typeof error.message === "string"
      ? error.message.trim()
      : "";
    return apiMessage || genericSubmissionError;
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

  let turnstileWidgetId = null;

  function renderTurnstile() {
    const widget = form.querySelector(".turnstile-widget");
    if (!widget || turnstileWidgetId !== null || !window.turnstile || typeof window.turnstile.render !== "function") return;
    turnstileWidgetId = window.turnstile.render(widget, {
      sitekey: widget.dataset.sitekey,
      action: widget.dataset.action,
      theme: widget.dataset.theme || "light"
    });
  }

  window.onArroyoTurnstileLoad = renderTurnstile;
  renderTurnstile();

  function resetTurnstile() {
    if (turnstileWidgetId !== null && window.turnstile && typeof window.turnstile.reset === "function") {
      try {
        window.turnstile.reset(turnstileWidgetId);
      } catch {
        // Submission cleanup must not be masked if the third-party widget is unavailable.
      }
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

    const payload = Object.fromEntries(new FormData(form).entries());
    if (!String(payload["cf-turnstile-response"] || "").trim()) {
      if (statusNode) statusNode.textContent = "Complete the security check and try again.";
      return;
    }
    const submitButton = form.querySelector('button[type="submit"]');

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
      const isCloudflare = result.platform === "cloudflare";
      const durablePrimary = result.delivery?.owner === "sent" || result.storage?.sheet === "saved";
      if (!response.ok || result.ok !== true || !isCloudflare || !durablePrimary) {
        const requestError = new Error(result.message || "Lead submission failed");
        requestError.statusCode = response.status;
        throw requestError;
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
      try {
        window.sessionStorage.removeItem(submissionStorageKey);
      } catch {
        // Ignore storage restrictions after a confirmed submission.
      }
      setSubmissionId({ fresh: true });
    } catch (error) {
      if (statusNode) {
        statusNode.textContent = safeSubmissionError(error);
      }
    } finally {
      resetTurnstile();
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = submitLabel;
      }
    }
  });
})();
