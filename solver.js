/* WordleSolverCore - pure solver logic, translated from wordle_solver.rb.
 * No DOM dependencies; works headlessly with just the WORDLE_DATA payload.
 */

(function () {
  'use strict';

  const GRAY = 0;   // not in the word
  const YELLOW = 1; // in the word, wrong position
  const GREEN = 2;  // in the word, correct position

  const WORD_LENGTH = 5;

  class WordleSolverCore {
    constructor(data) {
      const { WORDS, FREQ } = data;
      this.validGuesses = new Set(WORDS);
      this.freq = FREQ;
      this.dict = WORDS;
      this.reset();
    }

    reset() {
      this.knownPositions = {};                 // index -> letter (green)
      this.mustInclude = new Set();             // kept for parity with the Ruby solver
      this.eliminated = new Set();              // letters ruled out entirely
      this.cannotBeAt = {};                     // letter -> Set of indexes (yellow)
      this.letterMinCount = {};                 // letter -> minimum occurrences
      this.letterExactCount = {};               // letter -> exact occurrences (when grays seen)
    }

    snapshot() {
      const cloneSet = s => new Set(s);
      const cloneCannotBeAt = obj => Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, cloneSet(v)])
      );
      return {
        knownPositions: { ...this.knownPositions },
        mustInclude: cloneSet(this.mustInclude),
        eliminated: cloneSet(this.eliminated),
        cannotBeAt: cloneCannotBeAt(this.cannotBeAt),
        letterMinCount: { ...this.letterMinCount },
        letterExactCount: { ...this.letterExactCount }
      };
    }

    restore(state) {
      const cloneSet = s => new Set(s);
      const cloneCannotBeAt = obj => Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, cloneSet(v)])
      );
      this.knownPositions = { ...state.knownPositions };
      this.mustInclude = cloneSet(state.mustInclude);
      this.eliminated = cloneSet(state.eliminated);
      this.cannotBeAt = cloneCannotBeAt(state.cannotBeAt);
      this.letterMinCount = { ...state.letterMinCount };
      this.letterExactCount = { ...state.letterExactCount };
    }

    isValidGuess(word) {
      return word.length === WORD_LENGTH && /^[a-z]{5}$/.test(word) &&
        this.validGuesses.has(word);
    }

    /* states: array of 0|1|2 (gray|yellow|green) for each position of guess. */
    parseFeedback(guess, states) {
      const letterGreens = {};
      const letterYellows = {};

      for (let i = 0; i < WORD_LENGTH; i++) {
        const letter = guess[i];
        const state = states[i];

        if (state === GREEN) {
          this.knownPositions[i] = letter;
          letterGreens[letter] = (letterGreens[letter] || 0) + 1;
        } else if (state === YELLOW) {
          this.cannotBeAt[letter] = this.cannotBeAt[letter] || new Set();
          this.cannotBeAt[letter].add(i);
          letterYellows[letter] = (letterYellows[letter] || 0) + 1;
        }
      }

      for (let i = 0; i < WORD_LENGTH; i++) {
        const letter = guess[i];
        if (states[i] !== GRAY) continue;
        if (!(letterGreens[letter] > 0) && !(letterYellows[letter] > 0)) {
          this.eliminated.add(letter);
        }
      }

      const allLetters = new Set([...Object.keys(letterGreens), ...Object.keys(letterYellows)]);
      for (const letter of allLetters) {
        const total = (letterGreens[letter] || 0) + (letterYellows[letter] || 0);
        this.letterMinCount[letter] = total;

        let grayCount = 0;
        for (let i = 0; i < WORD_LENGTH; i++) {
          if (guess[i] === letter && states[i] === GRAY) grayCount++;
        }
        if (grayCount > 0) this.letterExactCount[letter] = total;
      }
    }

    filterWords() {
      const out = [];
      for (const word of this.dict) {
        if (!this.greenMatch(word)) continue;
        if (!this.hasAllRequired(word)) continue;
        if (!this.avoidsEliminated(word)) continue;
        if (!this.respectsCannotBeAt(word)) continue;
        if (!this.meetsMinCounts(word)) continue;
        if (!this.meetsExactCounts(word)) continue;
        out.push(word);
      }
      return out;
    }

    greenMatch(word) {
      return Object.entries(this.knownPositions).every(([pos, letter]) => word[+pos] === letter);
    }

    hasAllRequired(word) {
      return Array.from(this.mustInclude).every(letter => word.includes(letter));
    }

    avoidsEliminated(word) {
      return Array.from(this.eliminated).every(letter => !word.includes(letter));
    }

    respectsCannotBeAt(word) {
      return Object.entries(this.cannotBeAt).every(([letter, positions]) =>
        Array.from(positions).every(pos => word[+pos] !== letter)
      );
    }

    meetsMinCounts(word) {
      return Object.entries(this.letterMinCount).every(([letter, min]) =>
        word.split('').filter(ch => ch === letter).length >= min
      );
    }

    meetsExactCounts(word) {
      return Object.entries(this.letterExactCount).every(([letter, exact]) =>
        word.split('').filter(ch => ch === letter).length === exact
      );
    }

    /* Candidates sorted by descending frequency, matching the Ruby solver. */
    getCandidates() {
      return this.filterWords().sort((a, b) => (this.freq[b] || 0) - (this.freq[a] || 0));
    }

    get bestGuess() {
      const candidates = this.getCandidates();
      return candidates[0] || null;
    }
  }

  window.WordleSolverCore = WordleSolverCore;
  window.WORDLE_STATES = { GRAY, YELLOW, GREEN };
  window.WORDLE_LENGTH = WORD_LENGTH;
})();