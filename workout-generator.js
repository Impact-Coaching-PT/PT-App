// ═══════════════════════════════════════════════════════════════════
// IMPACT COACHING — AUTO WORKOUT GENERATOR
// Standalone module, loaded by index.html via <script src="workout-generator.js">
//
// Depends on globals already defined in index.html:
//   EX_BUILTIN, DB, B, SCHEMES, allExercises(), getExercise(), uid(),
//   renderSlots(), toast(), TEMPLATES
//
// Public entry point: window.autoGenerateWorkout()
// Called by the "🎲 Auto-Fill" button on the Build Session page.
// ═══════════════════════════════════════════════════════════════════

(function () {

  // ── Movement pattern inference ─────────────────────────────────────
  // We don't re-tag the 357-exercise library by hand. Instead we infer
  // a movement pattern from the existing cat + muscle tags + name
  // keywords already on every entry. Keeps the library single-source.
  const UNILATERAL_KEYWORDS = [
    "single", "bulgarian", "step up", "split squat", "curtsy",
    "lateral lunge", "reverse lunge", "step down", "single leg",
    "single arm", "forward lunge", "walking lunge"
  ];
  const COMPOUND_KEYWORDS = [
    "squat", "deadlift", "bench press", "press", "rdl", "romanian",
    "hip thrust", "glute bridge", "row"
  ];
  const ISOLATION_KEYWORDS = [
    "curl", "raise", "extension", "fly", "pushdown", "kickback",
    "shrug", "crunch", "ext"
  ];
  const POSTERIOR_MUSCLES = ["Hamstrings", "Glutes", "Lats", "Upper Back"];

  function inferPattern(ex) {
    const n = ex.name.toLowerCase();
    if (ex.cat === "combination" || ex.cat === "cardio") return "finisher";

    const isIsolationWord = ISOLATION_KEYWORDS.some(k => n.includes(k));
    if (UNILATERAL_KEYWORDS.some(k => n.includes(k))) return "unilateral";
    if (COMPOUND_KEYWORDS.some(k => n.includes(k)) && !isIsolationWord) return "compound";
    if ((ex.m || []).some(m => POSTERIOR_MUSCLES.includes(m))) return "posterior";
    return "isolation";
  }

  // ── Difficulty profiles ──────────────────────────────────────────
  // Controls both movement complexity (which patterns/cats are allowed)
  // and load/intensity (which scheme pool is used + how many finishers).
  const DIFFICULTY = {
    beginner: {
      label: "Beginner",
      allowUnilateral: false,
      allowCombination: false,
      allowFinisherSlot: false,
      schemePool: ["Strength", "High Rep"], // simple, flat set/rep — no supersets/drops
      preferSchemes: ["3×12", "3×10", "3×15", "10×3", "12×3", "15×3"],
    },
    intermediate: {
      label: "Intermediate",
      allowUnilateral: true,
      allowCombination: true,
      allowFinisherSlot: true,
      schemePool: ["Strength", "High Rep", "Supersets", "Pyramid"],
      preferSchemes: null, // any from schemePool groups
    },
    advanced: {
      label: "Advanced",
      allowUnilateral: true,
      allowCombination: true,
      allowFinisherSlot: true,
      schemePool: ["Strength", "Drop Sets", "Supersets", "Pyramid", "Failure"],
      preferSchemes: null,
    },
  };

  // ── Slot structure per session category ──────────────────────────
  // Each session type gets a fixed pattern of roles to fill, in order.
  // "any" patterns just mean: pick from the category pool, pattern-agnostic.
  const SESSION_STRUCTURE = {
    legs: [
      { role: "compound",   patterns: ["compound"] },
      { role: "unilateral", patterns: ["unilateral"], minDifficulty: "intermediate" },
      { role: "posterior",  patterns: ["posterior", "compound"] },
      { role: "accessory",  patterns: ["isolation", "unilateral"] },
      { role: "finisher",   patterns: ["finisher"], minDifficulty: "intermediate" },
    ],
    chest: [ // Chest, Tris & Shoulders
      { role: "compound",   patterns: ["compound"], catOverride: "chest" },
      { role: "accessory",  patterns: ["isolation", "compound"], catOverride: "chest" },
      { role: "shoulders",  patterns: ["compound", "isolation"], catOverride: "shoulders" },
      { role: "triceps",    patterns: ["isolation"], catOverride: "arms", muscleFilter: ["Triceps"] },
      { role: "finisher",   patterns: ["finisher"], minDifficulty: "intermediate" },
    ],
    back: [ // Back & Biceps
      { role: "compound",   patterns: ["compound", "posterior"], catOverride: "back" },
      { role: "posterior",  patterns: ["posterior"], catOverride: "back" },
      { role: "unilateral", patterns: ["unilateral"], catOverride: "back", minDifficulty: "intermediate" },
      { role: "biceps",     patterns: ["isolation"], catOverride: "arms", muscleFilter: ["Biceps"] },
      { role: "finisher",   patterns: ["finisher"], minDifficulty: "intermediate" },
    ],
    full: [ // Full Body
      { role: "lower-compound", patterns: ["compound"], catOverride: "legs" },
      { role: "upper-push",     patterns: ["compound", "isolation"], catOverride: "chest" },
      { role: "upper-pull",     patterns: ["compound", "posterior"], catOverride: "back" },
      { role: "unilateral-leg", patterns: ["unilateral"], catOverride: "legs", minDifficulty: "intermediate" },
      { role: "core",           patterns: ["isolation", "compound"], catOverride: "core" },
      { role: "finisher",       patterns: ["finisher"], minDifficulty: "intermediate" },
    ],
    upper: [ // Upper Body
      { role: "push-compound", patterns: ["compound"], catOverride: "chest" },
      { role: "pull-compound", patterns: ["compound", "posterior"], catOverride: "back" },
      { role: "shoulders",     patterns: ["compound", "isolation"], catOverride: "shoulders" },
      { role: "arms",          patterns: ["isolation"], catOverride: "arms" },
      { role: "finisher",      patterns: ["finisher"], minDifficulty: "intermediate" },
    ],
    lower: [ // Lower Body — maps onto the real "legs" category in the library
      { role: "compound",   patterns: ["compound"], catOverride: "legs" },
      { role: "unilateral", patterns: ["unilateral"], catOverride: "legs", minDifficulty: "intermediate" },
      { role: "posterior",  patterns: ["posterior"], catOverride: "legs" },
      { role: "accessory",  patterns: ["isolation"], catOverride: "legs" },
      { role: "core",       patterns: ["isolation", "compound"], catOverride: "core" },
      { role: "finisher",   patterns: ["finisher"], minDifficulty: "intermediate" },
    ],
  };

  const DIFFICULTY_ORDER = ["beginner", "intermediate", "advanced"];
  function meetsMinDifficulty(min, current) {
    if (!min) return true;
    return DIFFICULTY_ORDER.indexOf(current) >= DIFFICULTY_ORDER.indexOf(min);
  }

  // ── Scheme picking ──────────────────────────────────────────────
  function pickScheme(diffProfile, isFinisher) {
    const allSchemes = Object.assign({}, SCHEMES, DB.customSchemes || {});
    if (isFinisher) {
      // Finishers favour cardio/sled-style schemes when available, else fall back
      const pool = allSchemes["Cardio"] || allSchemes["Sled/Track"] || diffProfile.schemePool;
      if (Array.isArray(pool) && typeof pool[0] === "string" && allSchemes["Cardio"]) {
        return pool[Math.floor(Math.random() * pool.length)];
      }
    }
    if (diffProfile.preferSchemes) {
      return diffProfile.preferSchemes[Math.floor(Math.random() * diffProfile.preferSchemes.length)];
    }
    const groupKey = diffProfile.schemePool[Math.floor(Math.random() * diffProfile.schemePool.length)];
    const group = allSchemes[groupKey];
    if (!group || !group.length) return "3×12";
    return group[Math.floor(Math.random() * group.length)];
  }

  // ── Core selection logic ─────────────────────────────────────────
  function pickExerciseForSlot(slotDef, sessionCat, diffProfile, usedNames, usedMuscles) {
    // Finisher slots are special: combination/cardio exercises live under their
    // own cat tags ("combination"/"cardio"), never under the session's own cat
    // (e.g. "legs"), so they must search across both regardless of catOverride.
    const isFinisherRole = slotDef.patterns.length === 1 && slotDef.patterns[0] === "finisher";
    const targetCat = slotDef.catOverride || sessionCat;

    const pool = allExercises().filter(ex => {
      if (usedNames.has(ex.name)) return false;
      if (isFinisherRole) {
        if (ex.cat !== "combination" && ex.cat !== "cardio") return false;
        if (ex.cat === "combination" && !diffProfile.allowCombination) return false;
      } else {
        if (ex.cat !== targetCat) return false;
        const pattern = inferPattern(ex);
        if (!slotDef.patterns.includes(pattern)) return false;
        if (pattern === "unilateral" && !diffProfile.allowUnilateral) return false;
      }
      if (slotDef.muscleFilter && !(ex.m || []).some(m => slotDef.muscleFilter.includes(m))) return false;
      return true;
    });

    if (!pool.length) return null;

    // Prefer exercises that don't repeat a muscle we've already hit twice this session,
    // to spread coverage rather than stacking the same muscle group 3+ times.
    const scored = pool.map(ex => {
      const overlap = (ex.m || []).filter(m => usedMuscles.has(m)).length;
      return { ex, overlap };
    });
    scored.sort((a, b) => a.overlap - b.overlap);
    const minOverlap = scored[0].overlap;
    const best = scored.filter(s => s.overlap === minOverlap).map(s => s.ex);
    return best[Math.floor(Math.random() * best.length)];
  }

  // ── Main entry point ──────────────────────────────────────────────
  // Reads the current Build Session form state (B.cat, B.template, difficulty
  // selector), fills B.rows in place to match the template's slot COUNT,
  // and re-renders. Name/notes are left untouched per Ritchie's spec.
  window.autoGenerateWorkout = function () {
    const catSelect = document.getElementById("b-cat");
    const diffSelect = document.getElementById("b-difficulty");
    const sessionCat = catSelect ? catSelect.value : "legs";
    const difficulty = diffSelect ? diffSelect.value : "intermediate";
    const diffProfile = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;

    if (sessionCat === "custom") {
      toast("Pick a real category first (not Custom) to auto-generate");
      return;
    }

    const structure = SESSION_STRUCTURE[sessionCat];
    if (!structure) {
      toast("No generator pattern for this category yet");
      return;
    }

    const tDef = TEMPLATES[B.template] || TEMPLATES.strength1hr;
    const slotCount = (tDef.slots || []).length || 6;

    // Build the working slot list: take the structure roles in order,
    // looping back to the start if the template wants more slots than
    // we have defined roles for (e.g. an 8-slot template on a 5-role structure).
    const activeStructure = structure.filter(s => meetsMinDifficulty(s.minDifficulty, difficulty));
    const rolesToFill = [];
    for (let i = 0; i < slotCount; i++) {
      rolesToFill.push(activeStructure[i % activeStructure.length]);
    }

    const usedNames = new Set();
    const usedMuscles = new Set();
    const results = [];

    rolesToFill.forEach(function (slotDef) {
      const picked = pickExerciseForSlot(slotDef, sessionCat, diffProfile, usedNames, usedMuscles);
      if (picked) {
        usedNames.add(picked.name);
        (picked.m || []).forEach(m => usedMuscles.add(m));
      }
      results.push({ slotDef: slotDef, exercise: picked });
    });

    // Map results onto B.rows, following the template's existing slot
    // shape (slot/label/id) — only exerciseName, muscles, scheme change.
    B.rows = tDef.slots.map(function (s, idx) {
      const r = results[idx];
      const isFinisherSlot = r && r.slotDef.role === "finisher";
      const ex = r ? r.exercise : null;
      return {
        id: uid(),
        slot: s.slot,
        label: s.label,
        exerciseName: ex ? ex.name : "",
        scheme: ex ? pickScheme(diffProfile, isFinisherSlot) : s.scheme,
        target: "",
        muscles: ex ? (ex.m || []) : [],
      };
    });

    renderSlots();
    const filled = results.filter(r => r.exercise).length;
    if (filled < slotCount) {
      toast("Generated " + filled + "/" + slotCount + " — some slots had no match, fill manually");
    } else {
      toast("Workout generated ✓ — review & adjust as needed");
    }
  };

})();
