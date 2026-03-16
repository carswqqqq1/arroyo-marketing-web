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
    const auditResults = document.querySelector("[data-audit-results]");
    const auditHeadline = document.querySelector("[data-audit-headline]");
    const auditScore = document.querySelector("[data-audit-score]");
    const auditSummary = document.querySelector("[data-audit-summary]");
    const auditStrengths = document.querySelector("[data-audit-strengths]");
    const auditWins = document.querySelector("[data-audit-wins]");

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

    function renderList(node, items) {
      if (!node) return;
      node.innerHTML = "";
      const listItems = items && items.length ? items : ["No automated notes yet. We can review it manually."];
      listItems.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        node.appendChild(li);
      });
    }

    function renderAudit(audit) {
      if (!audit || !auditResults) return;
      auditResults.hidden = false;
      if (auditHeadline) auditHeadline.textContent = audit.headline || "Audit ready";
      if (auditScore) auditScore.textContent = String(audit.score || 0);
      if (auditSummary) auditSummary.textContent = audit.summary || "";
      renderList(auditStrengths, audit.strengths);
      renderList(auditWins, audit.quickWins);
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
      const backupPromise = saveNetlifyCopy(formData).catch(() => null);

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

        const result = await response.json();
        await backupPromise;

        if (successPanel) {
          successPanel.classList.add("is-visible");
          successPanel.setAttribute("tabindex", "-1");
          successPanel.focus();
        }

        if (result.audit) {
          renderAudit(result.audit);
        }

        if (statusNode) {
          const delivery = result.delivery || {};
          if (delivery.owner === "sent" && delivery.client === "sent") {
            statusNode.textContent = "Inquiry saved. Owner alert and client audit email were both sent.";
          } else if (delivery.owner === "sent" || delivery.client === "sent") {
            statusNode.textContent = "Inquiry saved. One email was sent and the other is waiting on mail setup.";
          } else {
            statusNode.textContent = "Inquiry saved and audit generated.";
          }
        }

        form.reset();
        Object.entries(hiddenValues).forEach(([name, value]) => {
          const field = form.querySelector(`[name="${name}"]`);
          if (field) {
            field.value = value;
          }
        });
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = "Get a Free Website Audit";
        }
      } catch (error) {
        const backupResponse = await backupPromise;
        if (statusNode) {
          statusNode.textContent = backupResponse && backupResponse.ok
            ? "Your request was saved, but the instant audit hit a backend issue. We can still follow up manually."
            : "Submission failed. Call or email and we can still get your audit started.";
        }
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = "Get a Free Website Audit";
        }
      }
    });
  }
})();
