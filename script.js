/* ============================================================
   BioWire — feed logic
   Expects articles.json and news.json in the same directory,
   each an array of objects like:
   { "title": "...", "source": "...", "url": "...",
     "published_at": "2026-07-08T10:00:00Z",
     "category": "..." | "topic": "..." }
   Falls back to bundled sample data if the fetch fails, so the
   page still works when opened without a live feed.
   ============================================================ */

(() => {
  "use strict";

  // ---------- State ----------
  let allItems = [];        // combined, normalized news + articles
  let savedIds = new Set(); // in-memory bookmarks (session only)
  let state = {
    view: "all",            // all | news | articles | saved
    category: "all",
    sort: "newest",
    query: ""
  };
  let usingDemoData = false;

  // ---------- DOM refs ----------
  const $ = (id) => document.getElementById(id);
  const searchInput   = $("searchInput");
  const themeToggle    = $("themeToggle");
  const themeIcon      = $("themeIcon");
  const refreshBtn     = $("refreshBtn");
  const viewTabs       = $("viewTabs");
  const categoryChips  = $("categoryChips");
  const sortSelect     = $("sortSelect");
  const featuredWrap   = $("featuredWrap");
  const featuredEl     = $("featured");
  const feedGrid       = $("feedGrid");
  const skeletonGrid   = $("skeletonGrid");
  const emptyState     = $("emptyState");
  const errorState     = $("errorState");
  const resultsCount   = $("resultsCount");
  const demoBadge      = $("demoBadge");
  const lastUpdated    = $("lastUpdated");
  const savedCount     = $("savedCount");
  const clearFiltersBtn= $("clearFiltersBtn");
  const retryBtn       = $("retryBtn");
  const modalOverlay   = $("modalOverlay");
  const modalClose     = $("modalClose");
  const modalTitle     = $("modalTitle");
  const modalMeta      = $("modalMeta");
  const modalDate      = $("modalDate");
  const modalLink      = $("modalLink");

  // ---------- Sample fallback data ----------
  const SAMPLE_NEWS = [
    { title: "FDA Clears First mRNA Therapy for Rare Metabolic Disorder", source: "BioPulse Wire", url: "#", published_at: daysAgo(0.2), category: "Regulatory" },
    { title: "CRISPR Startup Raises $180M to Advance In-Vivo Gene Editing", source: "PharmaTrack", url: "#", published_at: daysAgo(0.6), category: "Funding" },
    { title: "New AI Model Predicts Protein Folding with Record Accuracy", source: "SciNet Daily", url: "#", published_at: daysAgo(1), category: "AI & Data" },
    { title: "Global Vaccine Alliance Announces Expanded Access Program", source: "Health Wire", url: "#", published_at: daysAgo(1.4), category: "Public Health" },
    { title: "Synthetic Biology Firm Unveils Carbon-Negative Fermentation Process", source: "BioPulse Wire", url: "#", published_at: daysAgo(2), category: "Sustainability" }
  ];
  const SAMPLE_ARTICLES = [
    { title: "Explainer: How Personalized Medicine Is Reshaping Oncology", source: "The Molecular Review", url: "#", published_at: daysAgo(0.5), topic: "Personalized Medicine" },
    { title: "Inside the Lab: Automating Genomic Sequencing at Scale", source: "LabTech Journal", url: "#", published_at: daysAgo(1.2), topic: "Lab Automation" },
    { title: "Opinion: Why Biosecurity Policy Needs an Upgrade", source: "Frontiers in Policy", url: "#", published_at: daysAgo(2.3), topic: "Biosecurity" },
    { title: "Deep Dive: The Data Behind Blue Biotechnology's Rise", source: "The Molecular Review", url: "#", published_at: daysAgo(3), topic: "Blue Biotech" }
  ];

  function daysAgo(n) {
    return new Date(Date.now() - n * 86400000).toISOString();
  }

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    bindEvents();
    loadFeed();
  });

  function initTheme() {
    const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    const theme = prefersLight ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    themeIcon.textContent = theme === "dark" ? "☀️" : "🌙";
  }

  function bindEvents() {
    themeToggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      themeIcon.textContent = next === "dark" ? "☀️" : "🌙";
    });

    refreshBtn.addEventListener("click", () => {
      refreshBtn.classList.add("spinning");
      loadFeed().finally(() => {
        setTimeout(() => refreshBtn.classList.remove("spinning"), 400);
      });
    });

    viewTabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn) return;
      [...viewTabs.querySelectorAll(".tab")].forEach(t => {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      state.view = btn.dataset.view;
      render();
    });

    sortSelect.addEventListener("change", (e) => {
      state.sort = e.target.value;
      render();
    });

    let debounce;
    searchInput.addEventListener("input", (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        state.query = e.target.value.trim().toLowerCase();
        render();
      }, 200);
    });

    clearFiltersBtn.addEventListener("click", () => {
      state.query = "";
      state.category = "all";
      searchInput.value = "";
      render();
    });

    retryBtn.addEventListener("click", loadFeed);

    modalClose.addEventListener("click", closeModal);
    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
  }

  // ---------- Data loading ----------
  async function loadFeed() {
    showLoading();
    try {
      const [articlesRes, newsRes] = await Promise.all([
        fetch("articles.json"),
        fetch("news.json")
      ]);
      if (!articlesRes.ok || !newsRes.ok) throw new Error("Bad response");

      const articles = await articlesRes.json();
      const news = await newsRes.json();
      usingDemoData = false;
      setData(articles, news);
    } catch (err) {
      console.warn("Live feed unavailable, using sample data:", err.message);
      usingDemoData = true;
      setData(SAMPLE_ARTICLES, SAMPLE_NEWS);
    }
  }

  function setData(articles, news) {
    const newsItems = news.map(item => ({ ...item, type: "news", _id: makeId(item) }));
    const articleItems = articles.map(item => ({ ...item, type: "article", _id: makeId(item) }));
    allItems = [...newsItems, ...articleItems];

    buildCategoryChips();
    lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    demoBadge.classList.toggle("hidden", !usingDemoData);
    hideLoading();
    render();
  }

  function makeId(item) {
    return `${item.source || ""}-${item.title || ""}`.replace(/\s+/g, "_").slice(0, 120);
  }

  // ---------- Category chips ----------
  function buildCategoryChips() {
    const cats = new Set();
    allItems.forEach(i => {
      const c = i.topic || i.category;
      if (c) cats.add(c);
    });

    categoryChips.innerHTML = "";
    const allChip = document.createElement("button");
    allChip.className = "chip active";
    allChip.textContent = "All topics";
    allChip.dataset.cat = "all";
    categoryChips.appendChild(allChip);

    [...cats].sort().forEach(cat => {
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.textContent = cat;
      chip.dataset.cat = cat;
      categoryChips.appendChild(chip);
    });

    categoryChips.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      [...categoryChips.querySelectorAll(".chip")].forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      state.category = chip.dataset.cat;
      render();
    });
  }

  // ---------- Rendering ----------
  function getFiltered() {
    let items = [...allItems];

    if (state.view === "news") items = items.filter(i => i.type === "news");
    else if (state.view === "articles") items = items.filter(i => i.type === "article");
    else if (state.view === "saved") items = items.filter(i => savedIds.has(i._id));

    if (state.category !== "all") {
      items = items.filter(i => (i.topic || i.category) === state.category);
    }

    if (state.query) {
      items = items.filter(i =>
        (i.title || "").toLowerCase().includes(state.query) ||
        (i.source || "").toLowerCase().includes(state.query) ||
        (i.topic || i.category || "").toLowerCase().includes(state.query)
      );
    }

    items.sort((a, b) => {
      if (state.sort === "newest") return new Date(b.published_at) - new Date(a.published_at);
      if (state.sort === "oldest") return new Date(a.published_at) - new Date(b.published_at);
      if (state.sort === "source") return (a.source || "").localeCompare(b.source || "");
      return 0;
    });

    return items;
  }

  function render() {
    savedCount.textContent = savedIds.size;

    const items = getFiltered();
    resultsCount.textContent = `${items.length} ${items.length === 1 ? "result" : "results"}`;

    // Featured story: only on the "all" view, unfiltered by search/category
    const showFeatured = state.view === "all" && !state.query && state.category === "all" && items.length > 0;
    featuredWrap.classList.toggle("hidden", !showFeatured);
    if (showFeatured) {
      renderFeatured(items[0]);
    }

    const gridItems = showFeatured ? items.slice(1) : items;

    if (gridItems.length === 0) {
      feedGrid.classList.add("hidden");
      emptyState.classList.remove("hidden");
    } else {
      emptyState.classList.add("hidden");
      feedGrid.classList.remove("hidden");
      feedGrid.innerHTML = "";
      gridItems.forEach(item => feedGrid.appendChild(createCard(item)));
    }
  }

  function renderFeatured(item) {
    featuredEl.innerHTML = `
      <div class="featured-media">${item.type === "news" ? "🔥" : "📚"}</div>
      <div class="featured-body">
        <div class="pill-group">
          <span class="pill source">${escapeHtml(item.source || "Unknown")}</span>
          ${(item.topic || item.category) ? `<span class="pill ${item.type === "article" ? "article-type" : "news-type"}">${escapeHtml(item.topic || item.category)}</span>` : ""}
        </div>
        <h2>${escapeHtml(item.title)}</h2>
        <p class="dek">${formatDate(item.published_at)} · Featured story</p>
      </div>
    `;
    featuredEl.onclick = () => openModal(item);
  }

  function createCard(item) {
    const card = document.createElement("article");
    card.className = "news-card";
    const tag = item.topic || item.category;
    const isSaved = savedIds.has(item._id);

    card.innerHTML = `
      <div class="card-top">
        <div class="pill-group">
          <span class="pill source">${escapeHtml(item.source || "Unknown")}</span>
          ${tag ? `<span class="pill ${item.type === "article" ? "article-type" : "news-type"}">${escapeHtml(tag)}</span>` : ""}
        </div>
        <button class="bookmark-btn ${isSaved ? "saved" : ""}" aria-label="Save article" title="Save">${isSaved ? "★" : "☆"}</button>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <div class="card-bottom">
        <span>${formatDate(item.published_at)}</span>
        <a href="${item.url || "#"}" target="_blank" rel="noopener" class="read-more">Read more →</a>
      </div>
    `;

    card.querySelector(".bookmark-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSave(item._id);
      render();
    });

    card.addEventListener("click", (e) => {
      if (e.target.closest(".read-more") || e.target.closest(".bookmark-btn")) return;
      openModal(item);
    });

    return card;
  }

  function toggleSave(id) {
    if (savedIds.has(id)) savedIds.delete(id);
    else savedIds.add(id);
  }

  // ---------- Modal ----------
  function openModal(item) {
    modalMeta.innerHTML = `
      <span class="pill source">${escapeHtml(item.source || "Unknown")}</span>
      ${(item.topic || item.category) ? `<span class="pill ${item.type === "article" ? "article-type" : "news-type"}">${escapeHtml(item.topic || item.category)}</span>` : ""}
    `;
    modalTitle.textContent = item.title;
    modalDate.textContent = formatDate(item.published_at, true);
    modalLink.href = item.url || "#";
    modalOverlay.classList.remove("hidden");
  }
  function closeModal() {
    modalOverlay.classList.add("hidden");
  }

  // ---------- Loading / error states ----------
  function showLoading() {
    errorState.classList.add("hidden");
    feedGrid.classList.add("hidden");
    emptyState.classList.add("hidden");
    featuredWrap.classList.add("hidden");
    skeletonGrid.classList.remove("hidden");
    skeletonGrid.innerHTML = Array.from({ length: 6 }).map(() => `
      <div class="skeleton-card">
        <div class="skel-line skel-pill"></div>
        <div class="skel-line skel-title"></div>
        <div class="skel-line skel-title short"></div>
        <div class="skel-line skel-meta"></div>
      </div>
    `).join("");
  }
  function hideLoading() {
    skeletonGrid.classList.add("hidden");
    skeletonGrid.innerHTML = "";
  }
  function showError() {
    hideLoading();
    feedGrid.classList.add("hidden");
    emptyState.classList.add("hidden");
    featuredWrap.classList.add("hidden");
    errorState.classList.remove("hidden");
  }

  // ---------- Helpers ----------
  function formatDate(iso, long = false) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("en-US", {
      month: long ? "long" : "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
