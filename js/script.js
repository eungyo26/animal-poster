/* =========================================================
   Parrot — Interactive Poster
   ---------------------------------------------------------
   · 문장 호버 : 문장이 1 → 1.4배 (CSS), 앵무새가 문장 쪽으로 고개를 숙임
   · 문장 클릭 : 앵무새가 음절(syllable)마다 위아래로 바운스하며 말함
                 같은 박자에 → 몸 바운스 · 부리 열림 · 꼬리 흔들림 · 소리
                 글자는 그 음절의 길이 안에서 한 글자씩 등장
   · 전환      : 문장마다 강조색(부리 · 꼬리 · 목소리 선 · 글자)이 바뀜
   ========================================================= */

$(function () {
  /* ---------- 박자 (ms) ---------- */
  const BEAT = {
    letter: 48, // 글자 하나
    syllableMin: 170, // 음절 하나의 최소 길이 (= 바운스 간격)
    space: 70, // 단어 사이
    comma: 340, // 쉼표
    stop: 560, // 마침표
  };

  /* ---------- 요소 ---------- */
  const $poster = $("#poster");
  const $lines = $(".lines li");
  const $speech = $("#speech");
  const svg = document.getElementById("parrot");
  const voicePath = document.querySelector("#voice path");
  const P = {};
  ["bird", "tail-move", "tail", "head", "jaw", "eye", "branch"].forEach(
    (id) => (P[id] = document.getElementById(id))
  );

  /* ---------- 움직임 상태 (스프링) ---------- */
  const M = {
    y: 0, vy: 0, // 몸 바운스
    tail: 0, tailV: 0, // 꼬리
    head: 0, tilt: 0, hoverTilt: 0, idleTilt: 0, nextIdle: 0,
    mouth: 0, // 부리 열림 0~1
    eye: 1, nextBlink: 0,
  };

  let speakToken = 0;
  let speaking = false;
  let audio = null;
  let restBeak = { x: 0, y: 0 };

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- SVG 좌표 → 화면 좌표 ---------- */
  function toScreen(x, y) {
    const pt = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
    return { x: pt.x, y: pt.y };
  }

  // 문장의 첫 줄이 부리 높이에서 시작하도록
  function layout() {
    restBeak = toScreen(284, 158);
    const top = $(".right")[0].getBoundingClientRect().top;
    $(".right")[0].style.setProperty("--beak-y", restBeak.y - top + "px");
  }

  /* ---------- 영어 단어를 음절로 나누기 (간단한 규칙) ---------- */
  // 모음 덩어리 하나 = 음절 하나. 예) feathers → fea | thers
  function syllables(word) {
    const parts = word.match(/[^aeiouy]*[aeiouy]+(?:[^aeiouy]*$)?/gi) || [word];
    const joined = parts.join("");
    if (joined.length < word.length) parts[parts.length - 1] += word.slice(joined.length);
    return parts;
  }

  /* ---------- 소리 : 음절마다 짧은 새소리 ---------- */
  function chirp(pitch, strong) {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(pitch, t);
    osc.frequency.exponentialRampToValueAtTime(pitch * (strong ? 1.5 : 1.25), t + 0.07);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(strong ? 0.05 : 0.035, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  /* ---------- 한 박자 (음절 시작) ---------- */
  function beat(text, wordStart) {
    M.vy -= wordStart ? 150 : 95; // 위로 튀어 오름 → 스프링으로 내려앉음
    M.tailV += wordStart ? 60 : 35;
    M.mouth = 1;
    M.tilt = wordStart ? -4 : 2;
    chirp(640 + (text.charCodeAt(0) % 9) * 45, wordStart);
  }

  function pauseBeat(isStop) {
    M.tilt = isStop ? -9 : -5; // 쉬는 곳 : 고개를 들고 숨 고르기
    M.vy -= isStop ? 50 : 25;
  }

  /* ---------- 말하기 ---------- */
  async function speak(index) {
    const token = ++speakToken;
    const $li = $lines.eq(index);
    const text = $li.find(".txt").text();

    // 전환 : 강조색 · 목록 상태
    $poster[0].style.setProperty("--accent", $li.data("color"));
    $lines.removeClass("active").each((i, el) => el.style.setProperty("--p", 0));
    $li.addClass("active");

    // 이전 문장은 위로 사라짐
    const $old = $speech.children();
    if ($old.length) {
      $old.find(".ch.on").each((i, el) => setTimeout(() => $(el).addClass("out"), i * 6));
      $old.filter(".hint").css("opacity", 0);
      await wait(360);
      if (token !== speakToken) return;
    }

    // 단어 → 음절 → 글자 단위로 나눔
    $speech.empty();
    const $p = $('<p class="line"></p>').appendTo($speech);
    const words = text.split(" ");
    const plan = []; // { syl, wordStart, chars[], pause }
    words.forEach((word, wi) => {
      const $w = $('<span class="word"></span>').appendTo($p);
      const core = word.replace(/[,.!?]+$/, "");
      const punct = word.slice(core.length);
      syllables(core).forEach((syl, si) => {
        const chars = [...syl].map((ch) => $('<span class="ch"></span>').text(ch).appendTo($w)[0]);
        plan.push({ syl, wordStart: si === 0, chars });
      });
      if (punct) {
        const chars = [...punct].map((ch) => $('<span class="ch"></span>').text(ch).appendTo($w)[0]);
        plan.push({ pause: /[.!?]/.test(punct) ? "stop" : "comma", chars });
      }
      if (wi < words.length - 1) {
        $p.append(" ");
        plan.push({ pause: "space", chars: [] });
      }
    });

    speaking = true;
    $poster.addClass("speaking");
    const total = $p.find(".ch").length;
    let shown = 0;

    for (const step of plan) {
      if (token !== speakToken) return;

      if (step.pause) {
        step.chars.forEach((el) => el.classList.add("on"));
        shown += step.chars.length;
        if (step.pause !== "space") pauseBeat(step.pause === "stop");
        $li[0].style.setProperty("--p", shown / total);
        await wait(BEAT[step.pause]);
        continue;
      }

      // 음절 시작 = 바운스 · 부리 · 소리, 그 음절의 글자들이 차례로 등장
      beat(step.syl, step.wordStart);
      const dur = Math.max(BEAT.syllableMin, step.chars.length * BEAT.letter);
      const gap = dur / step.chars.length;
      for (const el of step.chars) {
        if (token !== speakToken) return;
        el.classList.add("on");
        $li[0].style.setProperty("--p", ++shown / total);
        await wait(gap);
      }
    }

    if (token !== speakToken) return;
    await wait(500);
    speaking = false;
    $poster.removeClass("speaking");
  }

  /* =========================================================
     매 프레임 : 스프링으로 앵무새 자세 계산
     ========================================================= */
  function update(dt, now) {
    M.vy += (-380 * M.y - 13 * M.vy) * dt;
    M.y += M.vy * dt;
    M.tailV += (140 * (M.y * 0.25 - M.tail) - 7 * M.tailV) * dt; // 꼬리는 한 박자 늦게
    M.tail += M.tailV * dt;
    M.mouth = Math.max(0, M.mouth - dt * 6.5);

    if (!speaking && now > M.nextIdle) {
      M.idleTilt = rand(-6, 6); // 쉴 때 가끔 갸웃
      M.nextIdle = now + rand(1800, 4200);
    }
    const tiltTarget = speaking ? M.tilt : M.idleTilt + M.hoverTilt;
    M.head += (tiltTarget - M.y * 0.12 - M.head) * Math.min(1, dt * 10);
    if (speaking) M.tilt *= Math.pow(0.05, dt);

    if (now > M.nextBlink) {
      M.eye = 0.1;
      if (now > M.nextBlink + 110) {
        M.eye = 1;
        M.nextBlink = now + rand(2500, 5500);
      }
    }

    const y = M.y + Math.sin(now / 900) * 1.2; // 숨쉬기
    P.bird.setAttribute("transform", `translate(0 ${y.toFixed(2)})`);
    P["tail-move"].setAttribute("transform", `translate(0 ${y.toFixed(2)})`);
    P.tail.setAttribute("transform", `rotate(${(M.tail + Math.sin(now / 1300) * 1.5).toFixed(2)} 182 284)`);
    P.head.setAttribute("transform", `rotate(${M.head.toFixed(2)} 214 186)`);
    P.jaw.setAttribute("transform", `rotate(${(M.mouth * 26).toFixed(2)} 256 162)`);
    P.eye.setAttribute("transform", `translate(0 144) scale(1 ${M.eye}) translate(0 -144)`);
    P.branch.setAttribute("transform", `rotate(${(clamp(M.y, -6, 14) * 0.05).toFixed(3)} -400 302)`);

    // 목소리 선 : 부리 → 문장, 부리가 열릴수록 크게 일렁임
    const b = toScreen(290, 160 + y);
    const sx = $speech[0].getBoundingClientRect().left - 24;
    const len = sx - b.x;
    if (len > 20) {
      const amp = 1 + M.mouth * 10;
      const ph = now / 70;
      let d = `M ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
      for (let i = 1; i <= 48; i++) {
        const t = i / 48;
        const yy = b.y + (restBeak.y - b.y) * t + Math.sin(t * 22 - ph) * amp * Math.sin(Math.PI * t);
        d += ` L ${(b.x + len * t).toFixed(1)} ${yy.toFixed(1)}`;
      }
      voicePath.setAttribute("d", d);
    }
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt, now);
    requestAnimationFrame(loop);
  }

  /* ---------- 이벤트 ---------- */
  $lines
    .on("mouseenter focus", () => (M.hoverTilt = 12)) // 문장 쪽으로 고개를 숙임
    .on("mouseleave blur", () => (M.hoverTilt = 0))
    .on("click", function () {
      speak($lines.index(this));
    })
    .on("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        speak($lines.index(this));
      }
    });

  $(window).on("resize", layout);

  /* ---------- 시작 ---------- */
  layout();
  if (document.fonts) document.fonts.ready.then(layout);
  M.nextBlink = performance.now() + 2000;
  requestAnimationFrame(loop);
});
