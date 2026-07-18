/* BioWire quiz view: reads quiz.json and keeps score in the current session. */
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  let quiz;
  let questionIndex = 0;
  let score = 0;
  let answered = false;
  let quizPromise;

  const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
  const ICON_CROSS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
  const ICON_ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>`;
  const ICON_STAR = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.9-6.3 3.9 1.7-7L2 9.2l7.1-.6L12 2z"/></svg>`;

  document.addEventListener("DOMContentLoaded", () => {
    $("quizBtn").addEventListener("click", openQuiz);
    $("viewTabs").addEventListener("click", () => closeQuiz());
    document.addEventListener("keydown", handleKeydown);
  });

  function handleKeydown(event) {
    const view = $("quizView");
    if (!view || view.classList.contains("hidden")) return;
    const key = event.key;
    if (["1", "2", "3", "4"].includes(key) && !answered) {
      const buttons = [...view.querySelectorAll(".quiz-choice")];
      const idx = Number(key) - 1;
      if (buttons[idx]) buttons[idx].click();
    } else if ((key === "Enter" || key === " ") && answered) {
      const next = $("quizNext");
      if (next && !next.classList.contains("hidden")) next.click();
    }
  }

  async function openQuiz() {
    hideFeed();
    const view = $("quizView");
    view.classList.remove("hidden");
    view.innerHTML = `<div class="quiz-card"><p class="quiz-kicker">Loading quiz…</p></div>`;

    try {
      if (!quizPromise) quizPromise = loadQuiz();
      quiz = await quizPromise;
      questionIndex = 0;
      score = 0;
      renderQuestion();
    } catch (error) {
      view.innerHTML = `<div class="quiz-card quiz-result"><div class="empty-icon">⚠️</div><h2 class="quiz-heading">Quiz unavailable</h2><p>We couldn't load the quiz questions. Please try again.</p></div>`;
      console.warn("Unable to load quiz:", error);
    }
  }

  async function loadQuiz() {
    const response = await fetch("quiz.json");
    if (!response.ok) throw new Error("Quiz file could not be loaded");
    // Accept a JSON file that has been wrapped in Markdown code fences as well.
    const raw = (await response.text()).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const data = JSON.parse(raw);
    if (!Array.isArray(data.questions) || !data.questions.length) throw new Error("Quiz has no questions");
    return data;
  }

  function renderQuestion() {
    const question = quiz.questions[questionIndex];
    answered = false;
    const view = $("quizView");
    const progress = (questionIndex / quiz.questions.length) * 100;
    view.innerHTML = `
      <div class="quiz-card">
        <div class="quiz-top-row">
          <p class="quiz-kicker">${escapeHtml(quiz.category || "Knowledge")}</p>
          <span class="quiz-difficulty-pill">${escapeHtml(quiz.difficulty || "Quiz")}</span>
        </div>
        <h1 class="quiz-heading">${escapeHtml(quiz.title || "Quiz")}</h1>
        <div class="quiz-progress" aria-hidden="true"><span style="width: ${progress}%"></span></div>
        <div class="quiz-meta-row">
          <span class="quiz-question-number">Question ${questionIndex + 1} of ${quiz.questions.length}</span>
          <span class="quiz-score-chip">${ICON_STAR} Score: ${score}</span>
        </div>
        <h2 class="quiz-question">${escapeHtml(question.question)}</h2>
        <div class="quiz-choices"></div>
        <div class="quiz-footer"><span id="quizFeedback" class="quiz-feedback" aria-live="polite"></span><button id="quizNext" class="btn-primary quiz-next hidden" type="button"><span>Next question</span>${ICON_ARROW}</button></div>
      </div>`;

    const choices = view.querySelector(".quiz-choices");
    question.choices.forEach((choice, index) => {
      const button = document.createElement("button");
      button.className = "quiz-choice";
      button.type = "button";
      button.style.animationDelay = `${index * 0.05}s`;
      button.innerHTML = `
        <span class="quiz-choice-letter">${String.fromCharCode(65 + index)}</span>
        <span class="quiz-choice-text">${escapeHtml(choice)}</span>
        <span class="quiz-choice-icon"></span>`;
      button.addEventListener("click", () => answerQuestion(index));
      choices.appendChild(button);
    });
    $("quizNext").addEventListener("click", nextQuestion);
  }

  function answerQuestion(choiceIndex) {
    if (answered) return;
    answered = true;
    const question = quiz.questions[questionIndex];
    const correctIndex = Number(question.correctChoice) - 1;
    const buttons = [...$("quizView").querySelectorAll(".quiz-choice")];
    buttons.forEach((button, index) => {
      button.disabled = true;
      const iconSlot = button.querySelector(".quiz-choice-icon");
      if (index === correctIndex) {
        button.classList.add("correct");
        if (iconSlot) iconSlot.innerHTML = ICON_CHECK;
      }
      if (index === choiceIndex && index !== correctIndex) {
        button.classList.add("incorrect");
        if (iconSlot) iconSlot.innerHTML = ICON_CROSS;
      }
    });
    const isCorrect = choiceIndex === correctIndex;
    if (isCorrect) score += 1;
    const feedback = $("quizFeedback");
    feedback.innerHTML = isCorrect
      ? `${ICON_CHECK} Correct!`
      : `${ICON_CROSS} Not quite — ${escapeHtml(question.choices[correctIndex])} is correct.`;
    feedback.classList.add(isCorrect ? "correct" : "incorrect");
    const next = $("quizNext");
    next.querySelector("span").textContent = questionIndex === quiz.questions.length - 1 ? "See results" : "Next question";
    next.classList.remove("hidden");
  }

  function nextQuestion() {
    questionIndex += 1;
    if (questionIndex < quiz.questions.length) renderQuestion();
    else renderResults();
  }

  function renderResults() {
    const total = quiz.questions.length;
    const percentage = Math.round((score / total) * 100);
    const grade = percentage >= 90 ? "Outstanding" : percentage >= 70 ? "Excellent work" : percentage >= 50 ? "Good effort" : "Keep practicing";
    const icon = percentage >= 70 ? "🏆" : "🧬";
    const confettiCount = percentage >= 70 ? 24 : 0;
    const confetti = Array.from({ length: confettiCount }, (_, i) => {
      const left = Math.round(Math.random() * 100);
      const delay = (Math.random() * 0.6).toFixed(2);
      const duration = (2 + Math.random() * 1.2).toFixed(2);
      return `<span style="left:${left}%; animation-delay:${delay}s; animation-duration:${duration}s;"></span>`;
    }).join("");

    $("quizView").innerHTML = `
      <div class="quiz-card quiz-result">
        ${confettiCount ? `<div class="quiz-confetti">${confetti}</div>` : ""}
        <p class="quiz-kicker">Quiz complete</p>
        <div class="empty-icon">${icon}</div>
        <div class="score-ring" style="--pct:${percentage}">
          <div class="score-ring-inner">
            <div class="score-ring-value">${score}/${total}</div>
            <div class="score-ring-total">${percentage}%</div>
          </div>
        </div>
        <span class="quiz-result-grade">${grade}</span>
        <p class="quiz-result-sub">${percentage >= 70 ? "You clearly know your biotech." : "Try again to sharpen your score."}</p>
        <button id="restartQuiz" class="btn-primary" type="button" style="margin-top: 24px">Try again</button>
      </div>`;
    $("restartQuiz").addEventListener("click", () => { questionIndex = 0; score = 0; renderQuestion(); });
  }

  function hideFeed() {
    ["featuredWrap", "skeletonGrid", "feedGrid", "emptyState", "errorState"].forEach(id => $(id).classList.add("hidden"));
    document.querySelector(".results-meta").classList.add("hidden");
    document.querySelector(".filter-right").classList.add("hidden");
  }

  function closeQuiz() {
    $("quizView").classList.add("hidden");
    document.querySelector(".results-meta").classList.remove("hidden");
    document.querySelector(".filter-right").classList.remove("hidden");
  }

  function escapeHtml(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
})();
