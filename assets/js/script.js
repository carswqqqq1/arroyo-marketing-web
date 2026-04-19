(function () {
  const menuButton = document.querySelector("[data-menu-toggle]");
  const nav = document.querySelector("[data-main-nav]");

  if (menuButton && nav) {
    const setMenuState = (isOpen) => {
      nav.classList.toggle("open", isOpen);
      menuButton.setAttribute("aria-expanded", String(isOpen));
      menuButton.setAttribute("aria-label", isOpen ? "Close site navigation" : "Open site navigation");
      menuButton.textContent = isOpen ? "Close" : "Menu";
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
      if (event.key === "Escape") {
        setMenuState(false);
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

  const hiddenValues = {
    source_page: window.location.pathname,
    current_path: window.location.pathname + window.location.search,
    utm_source: params.get("utm_source") || "",
    utm_medium: params.get("utm_medium") || "",
    utm_campaign: params.get("utm_campaign") || "",
    utm_term: params.get("utm_term") || "",
    utm_content: params.get("utm_content") || ""
  };

  if (params.get("submitted") === "1" && successPanel) {
    successPanel.classList.add("is-visible");
  }

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

  async function saveNetlifyCopy(formData) {
    const encoded = new URLSearchParams();
    formData.forEach((value, key) => {
      encoded.append(key, String(value));
    });

    return fetch("/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: encoded.toString()
    });
  }

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
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    const runBackup = () => saveNetlifyCopy(formData).catch(() => null);

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Scanning...";
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

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const requestError = new Error(result.message || "Lead submission failed");
        requestError.statusCode = response.status;
        throw requestError;
      }

      await runBackup();

      if (successPanel) {
        successPanel.classList.add("is-visible");
        successPanel.setAttribute("tabindex", "-1");
        successPanel.focus();
      }

      if (result.audit) {
        renderAudit(result.audit);
      }

      if (statusNode) {
      statusNode.textContent = result.message || "Message received. Best next move: book a quick call so we can map the work.";
      }

      form.reset();
      Object.entries(hiddenValues).forEach(([name, value]) => {
        const field = form.querySelector(`[name="${name}"]`);
        if (field) {
          field.value = value;
        }
      });
    } catch (error) {
      const shouldBackup = !error.statusCode || error.statusCode >= 500;
      const backupResponse = shouldBackup ? await runBackup() : null;
      if (statusNode) {
        statusNode.textContent = backupResponse && backupResponse.ok
          ? error.message || "Your request was saved, but the backend hit a snag. We can still review it manually."
          : error.message || "Submission failed. Call or email and Arroyo can still help.";
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = form.getAttribute("name") === "contact" ? "Send Message" : "Get a Free Website Audit";
      }
    }
  });
})();
