/* wordle_solver.js - game controller + DOM manipulation.
 * Drives WordleSolverCore (solver.js) with a NYT-style 5x6 grid.
 */
(function () {
  'use strict';

  const { GRAY, YELLOW, GREEN } = window.WORDLE_STATES;
  const ROWS = 6;
  const COLS = window.WORDLE_LENGTH;
  const PAGE_SIZE = 24;
  const STATE_COLOR = { [GRAY]: 'gray', [YELLOW]: 'yellow', [GREEN]: 'green' };

  const core = new window.WordleSolverCore(window.WORDLE_DATA);

  const $ = id => document.getElementById(id);
  const cells = [];      // cells[row][col] -> DOM element
  const rowWords = [];   // rowWords[row] -> {'letters': '', 'states': []}
  const keyButtons = {}; // letter -> DOM element

  let turn = 0;
  let col = 0;
  let keyStates = {};
  let history = [];
  let gameOver = false;
  let toastTimer = null;
  let resetArmed = false;
  let resetTimer = null;
  let hintShown = false;
  let modalAction = null;
  let candidateList = [];
  let candidatePage = 0;

  /* ---------------- Board ---------------- */

  function buildBoard() {
    const board = $('board');
    for (let r = 0; r < ROWS; r++) {
      const row = document.createElement('div');
      row.className = 'row';
      row.id = 'row-' + r;
      const rowCells = [];
      rowWords[r] = { letters: '', states: [GRAY, GRAY, GRAY, GRAY, GRAY] };
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.id = 'cell-' + r + '-' + c;
        cell.title = 'Click: 1x yellow, 2x green, 3x gray';
        cell.addEventListener('click', () => onCellClick(r, c));
        row.appendChild(cell);
        rowCells.push(cell);
      }
      board.appendChild(row);
      cells.push(rowCells);
    }
  }

  function activeCell() {
    return turn < ROWS ? cells[turn][Math.min(col, COLS - 1)] : null;
  }

  function renderCursor() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        cells[r][c].classList.toggle('active', r === turn && c === Math.min(col, COLS - 1) && !gameOver);
      }
    }
  }

  function setCell(r, c, letter, state) {
    const cell = cells[r][c];
    cell.textContent = letter || '';
    cell.classList.toggle('filled', !!letter);
    if (state == null) {
      delete cell.dataset.state;
    } else {
      cell.dataset.state = STATE_COLOR[state];
    }
  }

  function clearColors(r) {
    for (let c = 0; c < COLS; c++) {
      const cell = cells[r][c];
      delete cell.dataset.state;
      cells[r][c].classList.remove('flipped');
      setCell(r, c, cell.textContent, null);
    }
  }

  function currentWord() {
    return rowWords[turn] ? rowWords[turn].letters : '';
  }

  function currentStates() {
    return rowWords[turn] ? rowWords[turn].states.slice() : [GRAY, GRAY, GRAY, GRAY, GRAY];
  }

  /* ---------------- Input ---------------- */

  function addLetter(ch) {
    if (gameOver || col >= COLS) return;
    const row = rowWords[turn];
    row.letters = row.letters.slice(0, col) + ch + row.letters.slice(col + 1);
    row.states[col] = GRAY;
    setCell(turn, col, ch, GRAY);
    col++;
    renderCursor();

    if (!hintShown) {
      hintShown = true;
      toast('Click the tiles: 1X&nbsp<span class="toast-yellow">YELLOW</span>, 2X&nbsp' +
        '<span class="toast-green">GREEN</span>, 3X&nbsp<span class="toast-gray">GRAY</span>', true);
    }
  }

  function backspace() {
    if (gameOver || col <= 0) return;
    col--;
    const row = rowWords[turn];
    row.letters = row.letters.slice(0, col) + row.letters.slice(col + 1);
    row.states[col] = GRAY;
    setCell(turn, col, '', null);
    renderCursor();
  }

  function onCellClick(r, c) {
    if (gameOver || r !== turn) return;
    const row = rowWords[turn];
    if (!row.letters[c]) return;
    row.states[c] = (row.states[c] + 1) % (GREEN + 1);
    setCell(r, c, row.letters[c], row.states[c]);
  }

  /* ---------------- Submit ---------------- */

  function flipRow(word, states) {
    for (let i = 0; i < COLS; i++) {
      const cell = cells[turn][i];
      cell.dataset.state = STATE_COLOR[states[i]];
      cell.style.animationDelay = (i * 110) + 'ms';
      cell.classList.add('flipped');
    }
    $('row-' + turn).addEventListener('animationend', () => {
      for (let i = 0; i < COLS; i++) cells[turn][i].style.animationDelay = '';
    }, { once: true });
  }

  function submit() {
    if (gameOver) return;
    const word = currentWord();
    if (col < COLS) { toast('Not enough letters'); shake(turn); return; }
    if (!core.isValidGuess(word)) {
      toast('Invalid Word');
      shake(turn);
      return;
    }

    const states = currentStates();
    const snapshot = { constraints: core.snapshot(), keyStates: { ...keyStates }, turn };
    history.push(snapshot);

    core.parseFeedback(word, states);
    const candidates = core.getCandidates();

    if (candidates.length === 0) {
      history.pop();
      core.restore(snapshot.constraints);
      keyStates = snapshot.keyStates;
      syncKeys();
      clearColors(turn);
      toast('Contradictory feedback - fix the tiles, then press Enter');
      shake(turn);
      renderCursor();
      return;
    }

    if (hintShown) hideToast();

    updateKeys(word, states);
    flipRow(word, states);
    renderCursor();

    const solvedGuess = word === candidates[0];
    const usedGuesses = turn + 1;
    turn++;
    col = 0;

    if (candidates.length === 1) {
      gameOver = true;
      win(candidates[0], solvedGuess ? usedGuesses : usedGuesses + 1);
    } else if (turn >= ROWS) {
      gameOver = true;
      lose(candidates);
    } else {
      renderCursor();
    }

    showRecommend(candidates);
    if (!$('candidates-panel').classList.contains('hidden')) {
      renderCandidates(candidates);
    }
  }

  function shake(r) {
    const row = $('row-' + r);
    row.classList.remove('shake');
    void row.offsetWidth;
    row.classList.add('shake');
  }

  /* ---------------- Candidates / recommendation ---------------- */

  function showRecommend(candidates) {
    $('candidate-count').textContent =
      'Remaining: ' + candidates.length + (candidates.length === 1 ? ' word' : ' words');
    $('recommend').classList.remove('hidden');
  }

  function renderCandidates(candidates) {
    candidateList = candidates.slice();
    candidatePage = 0;
    const shown = candidateList.slice(0, PAGE_SIZE);
    const list = $('candidate-list');
    list.innerHTML = shown.map(w =>
      '<span class="candidate-word" data-word="' + w + '">' + w.toUpperCase() + '</span>'
    ).join('') ||
      '<span class="candidate-word">No possible words</span>';
    const more = $('btn-more');
    more.classList.toggle('hidden', candidateList.length <= PAGE_SIZE);
  }

  function showMoreCandidates() {
    if (candidatePage * PAGE_SIZE >= candidateList.length) return;
    candidatePage++;
    const shown = candidateList.slice(0, (candidatePage + 1) * PAGE_SIZE);
    $('candidate-list').innerHTML = shown.map(w =>
      '<span class="candidate-word" data-word="' + w + '">' + w.toUpperCase() + '</span>'
    ).join('');
    const more = $('btn-more');
    more.classList.toggle('hidden', shown.length >= candidateList.length);
  }

  /* ---------------- Keyboard ---------------- */

  function buildKeyboard() {
    const kb = $('keyboard');
    const rows = [
      ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
      [['ENTER', 1], 'z', 'x', 'c', 'v', 'b', 'n', 'm', ['BACK', 1]]
    ];

    for (const rowDef of rows) {
      const row = document.createElement('div');
      row.className = 'key-row';
      for (const def of rowDef) {
        let key, wide = false;
        if (Array.isArray(def)) { key = def[0]; wide = true; }
        else { key = def.toUpperCase(); }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'key' + (wide ? ' key-wide' : '');
        btn.textContent = key === 'BACK' ? '\u232B' : key;
        btn.dataset.key = key === 'ENTER' ? 'enter' : key === 'BACK' ? 'back' : def;

        btn.addEventListener('click', () => {
          btn.blur();
          if (key === 'ENTER') submit();
          else if (key === 'BACK') backspace();
          else addLetter(def);
        });

        row.appendChild(btn);
        if (!Array.isArray(def)) keyButtons[def] = btn;
      }
      kb.appendChild(row);
    }
  }

  function syncKeys() {
    for (const [letter, btn] of Object.entries(keyButtons)) {
      const state = keyStates[letter];
      btn.className = 'key' +
        (state === GREEN ? ' k-green' : state === YELLOW ? ' k-yellow' : state === GRAY ? ' k-gray' : '');
    }
  }

  function updateKeys(word, states) {
    for (let i = 0; i < COLS; i++) {
      const letter = word[i];
      const state = states[i];
      if (state === GREEN) keyStates[letter] = GREEN;
      else if (state === YELLOW && keyStates[letter] !== GREEN) keyStates[letter] = YELLOW;
      else if (state === GRAY && keyStates[letter] == null) keyStates[letter] = GRAY;
    }
    syncKeys();
  }

  /* ---------------- Controls ---------------- */

  function undo() {
    if (gameOver) { toast('Game is over'); return; }
    if (!history.length) { toast('Nothing to undo'); return; }
    const snapshot = history.pop();
    core.restore(snapshot.constraints);
    keyStates = snapshot.keyStates;
    syncKeys();

    const undoneRow = snapshot.turn;
    turn = undoneRow;
    col = COLS;
    clearColors(undoneRow);
    renderCursor();

    const candidates = core.getCandidates();
    showRecommend(candidates);
    renderCandidates(candidates);
    $('candidates-panel').classList.remove('hidden');
    toast('Guess undone');
  }

  function resetGame() {
    closeModal();
    core.reset();
    for (let r = 0; r < ROWS; r++) {
      rowWords[r] = { letters: '', states: [GRAY, GRAY, GRAY, GRAY, GRAY] };
      for (let c = 0; c < COLS; c++) {
        cells[r][c].classList.remove('flipped');
        cells[r][c].style.animationDelay = '';
        setCell(r, c, '', null);
      }
    }
    turn = 0;
    col = 0;
    keyStates = {};
    history = [];
    gameOver = false;
    hintShown = false;
    syncKeys();
    $('recommend').classList.add('hidden');
    $('candidates-panel').classList.add('hidden');
    $('btn-more').classList.add('hidden');
    candidatePage = 0;
    renderCursor();
    toast('New game');
  }

  function armReset() {
    if (resetArmed) {
      resetGame();
      disarmReset();
      return;
    }
    resetArmed = true;
    $('btn-reset').textContent = 'Confirm?';
    $('btn-reset').classList.add('danger');
    clearTimeout(resetTimer);
    resetTimer = setTimeout(disarmReset, 3000);
  }

  function disarmReset() {
    resetArmed = false;
    clearTimeout(resetTimer);
    const b = $('btn-reset');
    b.textContent = 'Reset Game';
    b.classList.remove('danger');
  }

  function win(answer, tries) {
    openModal(
      '<div class="modal-title">You won!</div>' +
      '<div class="modal-answer">' + answer.toUpperCase() + '</div>' +
      '<div class="modal-sub">Solved in ' + tries + (tries === 1 ? ' guess' : ' guesses') + '.</div>',
      { onAction: resetGame }
    );
  }

  function lose(candidates) {
    openModal(
      '<div class="modal-title">No more guesses</div>' +
      '<div class="modal-sub">' + candidates.length +
      ' possible word' + (candidates.length === 1 ? '' : 's') +
      ' remained. Try a fresh game.</div>',
      { onAction: resetGame }
    );
  }

  /* ---------------- Modal / toast ---------------- */

  function openModal(html, options) {
    options = options || {};
    modalAction = options.onAction || null;
    $('modal-content').innerHTML = html;
    $('btn-play-again').textContent = options.buttonLabel || 'New game';
    $('modal-overlay').classList.remove('hidden');
  }

  function closeModal() {
    $('modal-overlay').classList.add('hidden');
    modalAction = null;
    $('btn-play-again').textContent = 'New game';
  }

  function triggerModalButton() {
    if (!modalAction) { closeModal(); return; }
    modalAction();
  }

  function toast(message, persistent) {
    const el = $('toast');
    el.innerHTML = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    if (!persistent) {
      toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
    }
  }

  function hideToast() {
    clearTimeout(toastTimer);
    $('toast').classList.remove('show');
  }

  /* ---------------- "Use" a candidate word ---------------- */

  function useWord(word) {
    if (!word) return;
    if (gameOver || turn >= ROWS) return;
    const row = rowWords[turn];
    for (let c = 0; c < COLS; c++) {
      row.letters = row.letters.slice(0, c) + word[c] + row.letters.slice(c + 1);
      row.states[c] = GRAY;
      setCell(turn, c, word[c], GRAY);
    }
    col = COLS;
    renderCursor();
  }

  /* ---------------- Wiring / init ---------------- */

  function wire() {
    document.addEventListener('keydown', e => {
      if (!$('modal-overlay').classList.contains('hidden')) {
        if (e.key === 'Enter') { e.preventDefault(); triggerModalButton(); }
        return;
      }
      if (e.key === 'Enter') { e.preventDefault(); submit(); return; }
      if (e.key === 'Backspace') { e.preventDefault(); backspace(); return; }
      if (e.key === ' ') e.preventDefault();
      const ch = e.key.toLowerCase();
      if (/^[a-z]$/.test(ch)) addLetter(ch);
    });

    $('btn-undo').addEventListener('click', e => { e.currentTarget.blur(); undo(); });
    $('btn-reset').addEventListener('click', e => { e.currentTarget.blur(); armReset(); });
    $('btn-play-again').addEventListener('click', () => { triggerModalButton(); });
    $('btn-more').addEventListener('click', e => { e.currentTarget.blur(); showMoreCandidates(); });

    $('candidate-list').addEventListener('click', e => {
      const word = e.target.dataset && e.target.dataset.word;
      if (word) useWord(word);
    });

    $('toggle-candidates').addEventListener('click', e => {
      const btn = e.currentTarget;
      btn.blur();
      const panel = $('candidates-panel');
      const show = panel.classList.contains('hidden');
      panel.classList.toggle('hidden');
      if (show) renderCandidates(core.getCandidates());
    });
  }

  function init() {
    buildBoard();
    buildKeyboard();
    wire();
    renderCursor();

    document.body.classList.add('window-active');
    window.addEventListener('focus', () => document.body.classList.add('window-active'));
    window.addEventListener('blur', () => document.body.classList.remove('window-active'));
  }

  init();
})();