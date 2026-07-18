// ==================== 数据存储函数 ====================
function saveUserAnswers(userAnswers) {
  if (Persistence && Persistence.isAvailable()) {
    Persistence.setItem("quizUserAnswers", userAnswers);
  }
}

function loadUserAnswers() {
  if (Persistence && Persistence.isAvailable()) {
    return Persistence.getItem("quizUserAnswers") || { fitbs: {}, mcqs: {} };
  } else {
    return { fitbs: {}, mcqs: {} };
  }
}

function clearUserAnswers() {
  if (Persistence && Persistence.isAvailable()) {
    Persistence.removeItem("quizUserAnswers");
  }
}


// ==================== marked 扩展 ====================

window.myquizify = window.myquizify || {};

if (!window.myquizify._extensionsRegistered) {
  // 计数器
  window.myquizify.fitbCounter = 0;
  window.myquizify.mcqCounter = 0;

  // 折叠块 ::: title ... :::
  window.myquizify.collapse = {
    name: 'collapse',
    level: 'block',
    childTokens: ['tokens'],
    start(src) { return src.indexOf(':::'); },
    tokenizer(src) {
      const opener = /^:::\s*(.*?)\n/;
      const match = opener.exec(src);
      if (!match) return;
      const title = match[1].trim();
      let depth = 1;
      let offset = match[0].length;
      const lines = [];
      while (depth > 0 && offset < src.length) {
        let lineEnd = src.indexOf('\n', offset);
        if (lineEnd === -1) lineEnd = src.length;
        const line = src.slice(offset, lineEnd);
        offset = lineEnd + 1;
        if (/^:::\s*$/.test(line)) {
          depth--;
          if (depth === 0) break;
          lines.push(line);
        } else if (/^:::\s+\S/.test(line)) {
          depth++;
          lines.push(line);
        } else {
          lines.push(line);
        }
      }
      if (depth !== 0) return;
      // 去除首尾空行
      while (lines.length && lines[0].trim() === '') lines.shift();
      while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
      const raw = src.slice(0, offset);
      const childTokens = this.lexer.blockTokens(lines.join('\n'));
      return { type: 'collapse', raw, title, tokens: childTokens };
    },
    renderer(token) {
      const contentHtml = this.parser.parse(token.tokens);
      return `<details><summary>${token.title}</summary><div class="collapse-content">${contentHtml}</div></details>`;
    }
  };

  // 标签页 === title ... ===
  window.myquizify.tabs = {
    name: 'tabs',
    level: 'block',
    start(src) { return src.indexOf('==='); },
    tokenizer(src) {
      const tabsBlockRule = /^===[^\n]+\n[\s\S]+?\n===(?:\n|$)/;
      const tabsMatch = tabsBlockRule.exec(src);
      if (!tabsMatch) return false;
      const matchedStr = tabsMatch[0];
      const singleTabRule = /^===\s*(.+?)\n([\s\S]*?)(?=^===)/m;
      const tabs = [];
      let subSource = matchedStr.trim();
      let match;
      while ((match = singleTabRule.exec(subSource))) {
        const tabTitle = match[1].trim();
        const tabContent = match[2].trim();
        tabs.push({
          title: tabTitle,
          content: this.lexer.blockTokens(tabContent),
        });
        subSource = subSource.slice(match.index + match[0].length).trim();
      }
      return {
        type: 'tabs',
        raw: matchedStr,
        tabs,
      };
    },
    renderer(token) {
      return `<div class="tabs-container"><nav class="tabs-nav">${token.tabs.map((t, i) => `<button class="tab-button${i === 0 ? ' active' : ''}">${t.title}</button>`).join('')}</nav><div class="tabs-content">${token.tabs.map((t, i) => `<div class="tab-pane${i === 0 ? ' active' : ''}">${this.parser.parse(t.content)}</div>`).join('')}</div></div>`;
    }
  };

  /*** 批注语法 [内容]^(批注)^ ***/
  window.myquizify.annotation = {
    name: 'annotation',
    level: 'inline',
    start(src) {
      const m = src.match(/\[.*?\]\^\(.*?\)\^/);
      return m ? m.index : -1;
    },
    tokenizer(src) {
      const rule = /^\[(.+?)\]\^\((.+?)\)\^/;
      const match = rule.exec(src);
      if (!match) return;
      return {
        type: 'annotation',
        raw: match[0],
        text: match[1],
        tooltip: match[2]
      };
    },
    renderer(token) {
      return `<span class="annotation">${token.text}<span class="tooltip">${token.tooltip}</span></span>`;
    }
  };

  /*** 填空语法 {{答案}} ***/
  window.myquizify.fitb = {
    name: 'fitb',
    level: 'inline',
    start(src) { return src.indexOf('{{'); },
    tokenizer(src) {
      const rule = /^\{\{(.*?)\}\}/;
      const match = rule.exec(src);
      if (!match) return;
      // 用 window.myquizify.fitbCounter
      const prefix = window.myquizify._fitbNamePrefix || '';
      const fitbName = prefix + `fitb-${window.myquizify.fitbCounter++}`;
      return {
        type: 'fitb',
        raw: match[0],
        key: match[1],
        fitbName
      };
    },
    renderer(token) {
      return `<span class="fitb"><input type="text" name="${token.fitbName}" data-answer="${token.key}" placeholder="请输入答案"><span class="feedback-icon"></span></span>`;
    }
  };

  /*** reveal 语法 [[题干||答案]] ***/
  window.myquizify.reveal = {
    name: 'reveal',
    level: 'inline',
    start(src) {
      const m = src.match(/\[\[.*?\|\|.*?\]\]/);
      return m ? m.index : -1;
    },
    tokenizer(src) {
      const rule = /^\[\[(.*?)\|\|(.*?)\]\]/;
      const match = rule.exec(src);
      if (!match) return;
      return {
        type: 'reveal',
        raw: match[0],
        question: match[1].trim(),
        answer: match[2].trim()
      };
    },
    renderer(token) {
      return `<span class="reveal">${token.question}<span class="secret">${token.answer}</span></span>`;
    }
  };

  /*** 多选/单选语法  ;;; ... ;;;AB ***/
  window.myquizify.mcq = {
    name: 'mcq',
    level: 'block',
    start(src) { return src.indexOf(';;;'); },
    tokenizer(src) {
      // 规则：;;; \n(选项) \n;;;(答案)
      const rule = /^;;;\n([\s\S]+?)\n;;;([A-Za-z]+)(?:\n|$)/;
      const match = rule.exec(src);
      if (!match) return;
      const raw = match[0];
      const optionsRaw = match[1].trim();
      const correct = match[2];
      const isSingle = correct.length === 1;
      const options = [];
      const optionRegex = /^([A-Za-z])\. ?(.*)$/gm;
      let optionMatch;
      while ((optionMatch = optionRegex.exec(optionsRaw)) !== null) {
        options.push({
          letter: optionMatch[1].toUpperCase(),
          description: optionMatch[2],
        });
      }
      if (options.length === 0) return; // 防止无选项时崩溃
      // 用 window.myquizify.mcqCounter
      const prefix = window.myquizify._mcqNamePrefix || '';
      const mcqName = prefix + `mcq-${window.myquizify.mcqCounter++}`;
      return {
        type: 'mcq',
        raw,
        options,
        correct,
        isSingle,
        mcqName
      };
    },
    renderer(token) {
      const typeLabel = token.isSingle ? "单选题 | " : "多选题 | ";
      const inputType = token.isSingle ? "radio" : "checkbox";
      const optionsHTML = token.options.map(opt => `<label class="option"><input type="${inputType}" name="${token.mcqName}" value="${opt.letter}"><span class="checkmark"></span>${opt.description}</label>`).join('');
      return `<div class="choice" data-correct="${token.correct}"><div class="options">${optionsHTML}</div><span class="feedback" data-correct="${token.correct}" data-is-answered="false">${typeLabel}点击显示答案</span></div>`;
    }
  };

  window.myquizify.audio = {
    name: 'audio',
    level: 'block',
    start(src) {
      return src.indexOf('!audio[');
    },
    tokenizer(src) {
      const rule = /^!audio\[(.*?)\]\((.*?)\)/;
      const match = rule.exec(src);
      if (!match) return;
      const title = match[1].trim();
      const url = match[2].trim();
      return {
        type: 'audio',
        raw: match[0],
        title,
        url,
      };
    },
    renderer(token) {
      return `<div class="audio-player"><audio><source src="${token.url}" type="audio/mpeg" />Your browser does not support the audio element.</audio><div class="time-display"><span class="current-time">0:00</span><span class="duration">0:00</span></div><div class="progress-container"><div class="progress-bar"></div></div><div class="player-controls"><button class="replay-btn" title="Replay"><i class="fas fa-redo"></i></button><button class="play-btn" title="Play"><i class="fas fa-play"></i></button><button class="setA-btn" title="Set A Point"><i class="fas fa-flag"></i></button><button class="setB-btn" title="Set B Point"><i class="fas fa-flag-checkered"></i></button><button class="cancelLoop-btn" title="Cancel Loop"><i class="fas fa-times-circle"></i></button><select class="speed-select"><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="1.5">1.5x</option><option value="2">2x</option></select></div></div>`;
    }
  };


  window.myquizify.mathInline = {
    name: 'mathInline',
    level: 'inline', // 这是 inline token
    start(src) {
      return src.match(/\\\(/)?.index;
    },
    tokenizer(src) {
      const match = /^\\\((.+?)\\\)/.exec(src);
      if (match) {
        return {
          type: 'mathInline',
          raw: match[0],
          text: match[1],
          tokens: [], // 不需要再递归 token
        };
      }
    },
    renderer(token) {
      return `\\(${token.text}\\)`; // 原样输出
    }
  };

  window.myquizify.mathBlock = {
    name: 'mathBlock',
    level: 'block',
    start(src) {
      return src.match(/\\\[/)?.index;
    },
    tokenizer(src) {
      const match = /^\\\[(.+?)\\\]/s.exec(src); // s 标志匹配跨行
      if (match) {
        return {
          type: 'mathBlock',
          raw: match[0],
          text: match[1],
          tokens: [],
        };
      }
    },
    renderer(token) {
      return `\\[${token.text}\\]`;
    }
  };


  // 扩展列表导出
  window.myquizify.quizifyExtensions = [
    window.myquizify.collapse,
    window.myquizify.tabs,
    window.myquizify.annotation,
    window.myquizify.fitb,
    window.myquizify.reveal,
    window.myquizify.mcq,
    window.myquizify.audio,
    window.myquizify.mathInline,
    window.myquizify.mathBlock
  ];

  window.myquizify._extensionsRegistered = true;
}

window.quizifyExtensions = window.myquizify.quizifyExtensions;

function initAllQuizFeatures() {
  let userAnswers = loadUserAnswers();

  // 填空题还原
  document.querySelectorAll('.fitb input').forEach(input => {
    if (userAnswers.fitbs[input.name]) {
      input.value = userAnswers.fitbs[input.name];
    }
    input.dispatchEvent(new Event('input'));
  });

  // 选择题还原
  document.querySelectorAll('.choice').forEach(choiceEl => {
    const inputs = Array.from(choiceEl.querySelectorAll('input'));
    const mcqName = inputs[0].name;
    const restore = userAnswers.mcqs[mcqName];
    if (restore) {
      inputs.forEach(input => {
        input.checked = restore.includes(input.value);
      });
    }
  });

  // ===== 填空题自适应宽度与即时反馈 =====
  (function() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    function getFontFromElement(el) {
      const style = window.getComputedStyle(el);
      return [style.fontStyle, style.fontVariant, style.fontWeight, style.fontSize, style.fontFamily].join(' ');
    }

    document.querySelectorAll('.fitb').forEach(fitb => {
      const input = fitb.querySelector('input');
      const feedbackIcon = fitb.querySelector('.feedback-icon');
      const correctAnswer = (input.dataset.answer || '').trim();

      // === 页面加载时还原答案 ===
      if (userAnswers.fitbs[input.name]) {
        input.value = userAnswers.fitbs[input.name];
      }

      function updateInputWidth() {
        ctx.font = getFontFromElement(input);
        const text = input.value || input.placeholder || '';
        const padding = 52;
        const width = ctx.measureText(text).width + padding;
        input.style.width = Math.max(Math.ceil(width), 40) + 'px';
      }

      updateInputWidth();

      input.addEventListener('input', () => {
        updateInputWidth();

        const userAnswer = input.value.trim();
        userAnswers.fitbs[input.name] = userAnswer;
        saveUserAnswers(userAnswers);
      });

      // 如果是返回状态，注册额外的判分逻辑
      if (window.isBack) {
        input.addEventListener('input', () => {
          const userAnswer = input.value.trim();

          if (userAnswer === correctAnswer) {
            fitb.classList.add('correct');
            fitb.classList.remove('error');
            feedbackIcon.textContent = '✓';
          } else {
            fitb.classList.remove('correct');
            if (userAnswer !== '') {
              fitb.classList.add('error');
              feedbackIcon.textContent = '✕';
            } else {
              input.value = correctAnswer;
              input.dispatchEvent(new Event('input'));
              fitb.classList.add('error');
              feedbackIcon.textContent = '！';
            }
          }
        });
      }


      // 点击 feedbackIcon 填入正确答案
      feedbackIcon.addEventListener('click', () => {
        input.value = correctAnswer;
        input.dispatchEvent(new Event('input'));
      });

      // 还原后立即判分、显示icon
      input.dispatchEvent(new Event('input'));
    });
  })();

  // ===== 选项卡切换 =====
  (function() {
    document.querySelectorAll('.tabs-container').forEach(tabGroup => {
      const nav = tabGroup.querySelector('.tabs-nav');
      const buttons = nav.querySelectorAll('.tab-button');
      const contents = tabGroup.querySelectorAll('.tab-pane');

      buttons.forEach((btn, index) => {
        btn.addEventListener('click', () => {
          buttons.forEach(b => b.classList.remove('active'));
          contents.forEach(c => c.classList.remove('active'));
          btn.classList.add('active');
          contents[index].classList.add('active');
        });
      });
    });
  })();

  // ===== 音频播放器（含A/B点循环） =====
  (function() {
    document.querySelectorAll('.audio-player').forEach(player => {
      const audio = player.querySelector('audio');
      const playBtn = player.querySelector('.play-btn');
      const replayBtn = player.querySelector('.replay-btn');
      const speedSelect = player.querySelector('.speed-select');
      const progressBar = player.querySelector('.progress-bar');
      const progressContainer = player.querySelector('.progress-container');
      const currentTimeEl = player.querySelector('.current-time');
      const durationEl = player.querySelector('.duration');
      const setABtn = player.querySelector('.setA-btn');
      const setBBtn = player.querySelector('.setB-btn');
      const cancelLoopBtn = player.querySelector('.cancelLoop-btn');
      let loopA = null, loopB = null, isLooping = false, markerA = null, markerB = null;

      function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
      }
      function createMarker(time, label) {
        const marker = document.createElement('div');
        marker.className = 'ab-marker';
        const percent = (time / audio.duration) * 100;
        marker.style.left = `${percent}%`;
        marker.title = `Point ${label}: ${formatTime(time)}`;
        progressContainer.appendChild(marker);
        return marker;
      }
      function removeMarker(marker) {
        if (marker && progressContainer.contains(marker)) progressContainer.removeChild(marker);
      }
      function checkLoopReady() {
        if (loopA !== null && loopB !== null) isLooping = true;
      }

      audio.addEventListener('loadedmetadata', () => {
        durationEl.textContent = formatTime(audio.duration);
      });

      playBtn.addEventListener('click', () => {
        if (audio.paused) {
          audio.play();
          playBtn.innerHTML = '<i class="fas fa-pause"></i>';
          playBtn.classList.add('playing');
        } else {
          audio.pause();
          playBtn.innerHTML = '<i class="fas fa-play"></i>';
          playBtn.classList.remove('playing');
        }
      });
      replayBtn.addEventListener('click', () => {
        audio.currentTime = 0;
        if (audio.paused) {
          audio.play();
          playBtn.innerHTML = '<i class="fas fa-pause"></i>';
          playBtn.classList.add('playing');
        }
      });
      speedSelect.addEventListener('change', () => {
        audio.playbackRate = speedSelect.value;
      });

      audio.addEventListener('timeupdate', () => {
        if (audio.duration) {
          const percent = (audio.currentTime / audio.duration) * 100;
          progressBar.style.width = `${percent}%`;
          currentTimeEl.textContent = formatTime(audio.currentTime);
          if (isLooping && loopA !== null && loopB !== null) {
            if (audio.currentTime >= loopB) audio.currentTime = loopA;
          }
        }
      });
      progressContainer.addEventListener('click', (e) => {
        const rect = progressContainer.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const width = rect.width;
        audio.currentTime = (clickX / width) * audio.duration;
      });

      setABtn.addEventListener('click', () => {
        loopA = audio.currentTime;
        if (loopB !== null && loopB < loopA) {
          loopB = null;
          removeMarker(markerB);
          markerB = null;
        }
        if (markerA) removeMarker(markerA);
        markerA = createMarker(loopA, 'A');
        checkLoopReady();
      });
      setBBtn.addEventListener('click', () => {
        loopB = audio.currentTime;
        if (loopA !== null && loopB < loopA) {
          [loopA, loopB] = [loopB, loopA];
          if (markerA) removeMarker(markerA);
          if (markerB) removeMarker(markerB);
          markerA = createMarker(loopA, 'A');
          markerB = createMarker(loopB, 'B');
        } else {
          if (markerB) removeMarker(markerB);
          markerB = createMarker(loopB, 'B');
        }
        checkLoopReady();
      });
      cancelLoopBtn.addEventListener('click', () => {
        loopA = null; loopB = null; isLooping = false;
        removeMarker(markerA); removeMarker(markerB);
        markerA = null; markerB = null;
      });
    });
  })();

  // ===== 批注气泡（annotation tooltip） =====
  (function() {
    document.querySelectorAll('.annotation').forEach(annotation => {
      const tooltip = annotation.querySelector('.tooltip');

      function toggleTooltip(e) {
        if (tooltip.style.visibility === "visible") {
          tooltip.style.opacity = 0;
          tooltip.style.visibility = "hidden";
        } else {
          positionTooltip();
          tooltip.style.visibility = "visible";
          tooltip.style.opacity = 1;
        }
        e.stopPropagation();
      }
      function positionTooltip() {
        const annotationRect = annotation.getBoundingClientRect();
        tooltip.style.visibility = "hidden";
        tooltip.style.display = "block";
        tooltip.style.opacity = 0;
        let tooltipRect = tooltip.getBoundingClientRect();
        const pageWidth = window.innerWidth;

        const defaultLeft = annotationRect.left + (annotationRect.width - tooltipRect.width) / 2;
        const adjustedLeft = Math.max(10, Math.min(defaultLeft, pageWidth - tooltipRect.width - 10));
        tooltip.style.left = `${adjustedLeft}px`;
        tooltip.style.whiteSpace = "normal";
        tooltipRect = tooltip.getBoundingClientRect();

        let adjustedTop = annotationRect.top - tooltipRect.height - 10;
        if (adjustedTop < 0) {
          adjustedTop = annotationRect.bottom + 10;
          tooltip.style.setProperty("--tooltip-after-top", "-8px");
          tooltip.style.setProperty("--tooltip-after-bottom", "auto");
          tooltip.style.setProperty("--tooltip-after-border-top", "none");
          tooltip.style.setProperty("--tooltip-after-border-bottom", "8px solid var(--tooltip-bg)");
        } else {
          tooltip.style.setProperty("--tooltip-after-top", "auto");
          tooltip.style.setProperty("--tooltip-after-bottom", "-8px");
          tooltip.style.setProperty("--tooltip-after-border-top", "8px solid var(--tooltip-bg)");
          tooltip.style.setProperty("--tooltip-after-border-bottom", "none");
        }
        tooltip.style.top = `${adjustedTop}px`;

        const arrowOffset = defaultLeft - adjustedLeft;
        tooltip.style.setProperty("--tooltip-after-left", `${arrowOffset}px`);
        tooltip.style.display = "";
      }

      annotation.addEventListener('click', toggleTooltip);
      document.addEventListener('click', function(e) {
        if (!annotation.contains(e.target)) {
          tooltip.style.opacity = 0;
          tooltip.style.visibility = "hidden";
        }
      });
      window.addEventListener('scroll', function() {
        tooltip.style.opacity = 0;
        tooltip.style.visibility = "hidden";
      }, true);
      window.addEventListener('resize', function() {
        tooltip.style.opacity = 0;
        tooltip.style.visibility = "hidden";
      });
    });
  })();

  // ===== 点击 reveal 区块展开答案 =====
  (function() {
    document.querySelectorAll('.reveal').forEach(el => {
      const secret = el.querySelector('.secret');
      secret.style.display = "none";
      el.classList.remove("active");

      el.addEventListener('click', function() {
        if (secret.style.display === "inline") {
          secret.style.display = "none";
          el.classList.remove("active");
        } else {
          secret.style.display = "inline";
          el.classList.add("active");
        }
      });
    });
  })();

  // ===== 单选/多选题自动判分与展示答案 =====
  (function() {
    document.querySelectorAll('.choice').forEach(choiceEl => {
      const correct = (choiceEl.getAttribute('data-correct') || '').split('').sort();
      const optionsEl = choiceEl.querySelector('.options');
      const feedbackEl = choiceEl.querySelector('.feedback');
      const labels = Array.from(optionsEl.querySelectorAll('label.option'));
      const inputs = Array.from(optionsEl.querySelectorAll('input'));
      const mcqName = inputs[0].name;

      // 添加序号标签（只执行一次）
      labels.forEach((label, i) => {
        if (!label.querySelector('.option-seq')) {
          const seq = document.createElement('span');
          seq.className = "option-seq";
          seq.textContent = String.fromCharCode(65 + i);
          seq.style.display = "none";
          label.insertBefore(seq, label.firstChild);
        }
      });

      // Fisher-Yates Shuffle
      function shuffleOptions() {
        let arr = Array.from(optionsEl.getElementsByTagName("label"));
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        arr.forEach(label => optionsEl.appendChild(label));
      }
      // 恢复顺序
      function restoreOptions() {
        let arr = Array.from(optionsEl.getElementsByTagName("label")).map(label => {
          const val = label.querySelector('input').value;
          return { label, val };
        });
        arr.sort((a, b) => a.val.localeCompare(b.val));
        arr.forEach(item => optionsEl.appendChild(item.label));
      }

      // 切换显示/评判
      function toggleValidate(shouldShuffle = true, showType = true) {
        const isAnswered = feedbackEl.getAttribute('data-is-answered') === "true";
        if (isAnswered) {
          // 进入答题模式
          labels.forEach(function (label) {
            label.classList.remove("correct", "incorrect", "not-selected");
            const input = label.querySelector('input');
            const seq = label.querySelector('.option-seq');
            const checkmark = label.querySelector('.checkmark');
            input.disabled = false;
            input.checked = false;
            seq.style.display = "none";
            input.style.display = "inline-block";
            checkmark && (checkmark.style.display = "inline-block");
          });
          if (shouldShuffle) shuffleOptions();
          feedbackEl.textContent = (correct.length === 1 && showType) ? "单选题 | " : (showType ? "多选题 | " : "");
          feedbackEl.textContent += "点击显示答案";
          feedbackEl.classList.remove("correct", "incorrect", "incomplete");
          feedbackEl.setAttribute("data-is-answered", "false");
        } else {
          // 进入显示答案模式
          restoreOptions();
          labels.forEach(function (label) {
            const input = label.querySelector('input');
            const seq = label.querySelector('.option-seq');
            const checkmark = label.querySelector('.checkmark');
            input.disabled = true;
            input.style.display = "none";
            checkmark && (checkmark.style.display = "none");
            seq.style.display = "inline-block";
          });

          let selected = inputs.filter(input => input.checked).map(input => input.value).sort();
          if (selected.length === 0) {
            feedbackEl.textContent = "你没有回答";
            feedbackEl.classList.add("incorrect");
          } else if (JSON.stringify(selected) === JSON.stringify(correct)) {
            feedbackEl.textContent = "回答正确";
            feedbackEl.classList.add("correct");
          } else {
            feedbackEl.textContent = "你的答案：" + selected.join('');
            if (selected.every(val => correct.includes(val))) {
              feedbackEl.classList.add("incomplete");
            } else {
              feedbackEl.classList.add("incorrect");
            }
          }
          feedbackEl.textContent += " | 正确答案：" + correct.join('');
          // 标注选项
          labels.forEach(function (label) {
            const input = label.querySelector('input');
            const value = input.value;
            if (input.checked) {
              if (correct.includes(value)) {
                label.classList.add("correct");
              } else {
                label.classList.add("incorrect");
              }
            } else {
              if (correct.includes(value)) {
                label.classList.add("not-selected");
              }
            }
          });
          feedbackEl.setAttribute("data-is-answered", "true");
        }
      }

      // 页面加载时先还原用户作答
      const restore = userAnswers.mcqs[mcqName];
      if (restore) {
        inputs.forEach(input => {
          input.checked = restore.includes(input.value);
        });
      }

      // 初始化时先乱序
      shuffleOptions();

      if (window.isBack) {
        toggleValidate(false, true);
      }

      // 点击 feedback（显示答案/再做一次）
      feedbackEl.addEventListener('click', function() {
        toggleValidate(true, true);
      });

      // 每个 input 变动时保存答案
      inputs.forEach(function (input) {
        input.addEventListener('change', function() {
          // 先清除所有的 selected
          labels.forEach(label => label.classList.remove('selected'));
          // 给选中的加 selected
          inputs.forEach((inp, idx) => {
            if (inp.checked) {
              labels[idx].classList.add('selected');
            }
          });

          // === 保存用户作答 ===
          const selected = inputs.filter(inp => inp.checked).map(inp => inp.value);
          userAnswers.mcqs[mcqName] = selected;
          saveUserAnswers(userAnswers);
        });
      });
    });
  })();
}


function renderQuizify(selector) {
  window.myquizify.fitbCounter = 0;
  window.myquizify.mcqCounter = 0;
  const field = document.querySelector(selector);
  if (!field) return;

  // 生成唯一前缀（防正反面重名冲突）
  // 可根据卡片id、时间戳、isBack等拼接
  const uniq = field.id + '-';

  // 修改 quizify 扩展的 fitb/mcq 题目的 name 生成方式
  window.myquizify._fitbNamePrefix = uniq;
  window.myquizify._mcqNamePrefix = uniq;

  // 内容处理
  const raw = field.innerHTML
    .replace(/&nbsp;/g, ' ')
    .replace(/<br>/g, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  const htmlContent = marked.parse(raw);
  field.innerHTML = htmlContent;
}